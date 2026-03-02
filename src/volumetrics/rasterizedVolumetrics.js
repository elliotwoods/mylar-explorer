import * as THREE from "three/webgpu";
import {
  Fn, uniform, float, vec3, vec4,
  attribute, normalize, dot, clamp, pow, max, mix, exp, length, abs,
  positionWorld, cameraPosition
} from "three/tsl";
import { VOLUMETRIC_QUALITY_MODES } from "./volumetricParams.js";

function qualityScale(mode) {
  return VOLUMETRIC_QUALITY_MODES[mode] ?? 0.5;
}

/**
 * Rasterized volumetric renderer.
 *
 * Builds square prism geometry from the traced ray grid — one prism per
 * grid cell (i,j)→(i+1,j+1) for reflected beams and optionally another for
 * incoming beams. Because prisms share edges with neighbours the resulting
 * volume is watertight with no gaps.
 *
 * Each prism has 8 vertices (4 near + 4 far) and 4 side quads (8 triangles).
 * Uniform brightness across the cross-section ensures no visible seams.
 *
 * Optical model per fragment:
 *   irradiance    = totalPower / (numRays × crossSectionArea)
 *   pathLength    ≈ sqrt(crossSectionArea)              (beam diameter)
 *   extinction    = exp(−σ_e × density × distToCamera)  (Beer-Lambert approx)
 *   contribution  = irradiance × σ_s × density × Φ(θ) × pathLength × extinction × intensity
 *
 * Rendering setup:
 *   - Back-face only (THREE.BackSide): each camera ray hits at most one
 *     back face per convex prism → exactly one contribution per beam per pixel.
 *   - Additive blending: contributions from all beams sum naturally.
 *   - Depth tested against scene depth prepass so beams are occluded by scene geometry.
 */
export class RasterizedVolumetricRenderer {
  constructor(camera, params) {
    this.camera = camera;
    this.params = params;

    // TSL uniforms
    const u = {
      hazeDensity: uniform(1.0),
      scatteringCoeff: uniform(1.0),
      extinctionCoeff: uniform(0.42),
      anisotropy: uniform(0.4),
      forwardScatterBias: uniform(0.6),
      intensity: uniform(1.45),
      beamPower: uniform(1.0),
      numRays: uniform(1.0)
    };
    this.uniforms = u;

    // ── TSL fragment shader ────────────────────────────────────────────
    const fragmentFn = Fn(() => {
      // Custom per-vertex attributes (interpolated as varyings)
      const beamDir = attribute("beamDirection", "vec3");
      const tParam = attribute("tParam", "float");
      const nearArea = attribute("nearArea", "float");
      const farArea = attribute("farArea", "float");

      // Cross-section area at this depth
      const area = max(mix(nearArea, farArea, tParam), float(1e-8));

      // View direction: fragment → camera
      const worldPos = positionWorld;
      const viewDir = normalize(cameraPosition.sub(worldPos));
      const distToCamera = length(cameraPosition.sub(worldPos));

      // Beam direction (unit)
      const beamDirN = normalize(beamDir);

      // ── Henyey–Greenstein phase function ──
      // viewDir is sample->camera, so this matches the raymarched convention.
      const cosTheta = clamp(dot(beamDirN, viewDir), float(-1.0), float(1.0));
      const g = clamp(u.anisotropy, float(-0.8), float(0.8));
      const gg = g.mul(g);
      const phaseDenom = pow(
        max(float(0.05), float(1.0).add(gg).sub(g.mul(cosTheta).mul(2.0))),
        float(1.5)
      );
      const phaseValue = gg.oneMinus().div(float(12.566370614359172).mul(phaseDenom));
      const directionalBoost = mix(
        float(1.0),
        phaseValue.mul(20.0),
        clamp(u.forwardScatterBias, float(0.0), float(1.0))
      );

      // ── Beer-Lambert extinction approximation ──
      const transmittance = exp(
        u.extinctionCoeff.negate().mul(u.hazeDensity).mul(distToCamera).mul(float(0.02))
      );

      // ── Scattering contribution ──
      // irradiance  = beamPower / (numRays × sqrt(area))
      const sqrtArea = max(pow(area, float(0.5)), float(1e-4));
      const irradiance = u.beamPower.div(max(u.numRays, float(1.0)).mul(sqrtArea));

      const scattered = irradiance
        .mul(u.scatteringCoeff)
        .mul(u.hazeDensity)
        .mul(directionalBoost)
        .mul(transmittance)
        .mul(u.intensity);

      return vec4(vec3(scattered), scattered);
    });

    // ── Material ───────────────────────────────────────────────────────
    this.material = new THREE.NodeMaterial();
    this.material.transparent = true;
    this.material.depthWrite = false;
    this.material.depthTest = true;
    this.material.depthFunc = THREE.LessEqualDepth;
    this.material.side = THREE.BackSide;
    this.material.blending = THREE.AdditiveBlending;
    this.material.fragmentNode = fragmentFn();

    // ── Geometry (pre-allocated, updated per frame) ────────────────────
    this.geometry = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;

    // Internal scene used to render prisms to the off-screen target
    this._scene = new THREE.Scene();
    this._scene.add(this.mesh);

    // ── Render target (matches raymarched version) ─────────────────────
    this.renderTarget = new THREE.RenderTarget(1, 1, {
      depthBuffer: true,
      stencilBuffer: false,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter
    });

    this._size = new THREE.Vector2(1, 1);
    this._currentScale = 0;

    // Pre-allocated CPU buffers (grown as needed)
    this._maxPrisms = 0;
    this._positions = null;
    this._beamDirs = null;
    this._tParams = null;
    this._nearAreas = null;
    this._farAreas = null;
    this._indices = null;
    this._gridMap = null;
    this._prismCount = 0;
    this._reflectedCount = 0;
    this._incidentCount = 0;
    this._beamRayCount = 0;
    this._clearColor = new THREE.Color(0x000000);
    this._depthPrepassMaterial = new THREE.MeshDepthMaterial();
    this._depthPrepassMaterial.depthTest = true;
    this._depthPrepassMaterial.depthWrite = true;
    this._depthPrepassMaterial.colorWrite = false;
    this._depthPrepassMaterial.side = THREE.DoubleSide;
  }

  // ── Buffer management ──────────────────────────────────────────────

  _ensureBuffers(maxPrisms) {
    if (maxPrisms <= this._maxPrisms) return;
    this._maxPrisms = maxPrisms;

    const maxVerts = maxPrisms * 8;   // 4 near + 4 far per quad prism
    const maxIdx = maxPrisms * 24;    // 4 side quads × 2 tris × 3 indices

    this._positions = new Float32Array(maxVerts * 3);
    this._beamDirs = new Float32Array(maxVerts * 3);
    this._tParams = new Float32Array(maxVerts);
    this._nearAreas = new Float32Array(maxVerts);
    this._farAreas = new Float32Array(maxVerts);
    this._indices = new Uint32Array(maxIdx);

    const g = this.geometry;
    g.setAttribute("position", new THREE.BufferAttribute(this._positions, 3));
    g.setAttribute("beamDirection", new THREE.BufferAttribute(this._beamDirs, 3));
    g.setAttribute("tParam", new THREE.BufferAttribute(this._tParams, 1));
    g.setAttribute("nearArea", new THREE.BufferAttribute(this._nearAreas, 1));
    g.setAttribute("farArea", new THREE.BufferAttribute(this._farAreas, 1));
    g.setIndex(new THREE.BufferAttribute(this._indices, 1));
  }

  // ── Geometry construction ──────────────────────────────────────────

  buildGeometry(opticsState) {
    if (!opticsState) {
      this.geometry.setDrawRange(0, 0);
      this._prismCount = 0;
      this._reflectedCount = 0;
      this._incidentCount = 0;
      this._beamRayCount = 0;
      return;
    }
    const rays = opticsState.rays;
    const runtime = opticsState.runtime;
    const reflectedSamples = runtime.reflectedRaySamples;
    const reflectedIndices = runtime.reflectedRayIndices;
    const reflectedCount = runtime.reflectedRayCount || 0;
    const incidentSamples = runtime.incidentRaySamples;
    const incidentLengths = runtime.incidentRayLengths;
    const incidentCount = runtime.incidentRayCount || 0;
    const includeIncident = this.params.volumetrics.pairInjectionScope === "reflected+incident";
    const p = this.params;

    this._reflectedCount = reflectedCount;
    this._incidentCount = includeIncident ? incidentCount : 0;
    this._beamRayCount = reflectedCount + this._incidentCount;

    if (!reflectedCount || !reflectedSamples || !reflectedIndices || !rays.length) {
      this.geometry.setDrawRange(0, 0);
      this._prismCount = 0;
      return;
    }

    const uCount = Math.max(2, Math.floor(p.optics.sampleCountU));
    const vCount = Math.max(2, Math.floor(p.optics.sampleCountV));
    const maxBeamDist = Math.max(0.25, p.volumetrics.maxBeamDistance);

    // Build grid map: flat index [j * uCount + i] → reflected ray index, or −1
    const gridSize = uCount * vCount;
    if (!this._gridMap || this._gridMap.length < gridSize) {
      this._gridMap = new Int32Array(gridSize);
    }
    this._gridMap.fill(-1);

    for (let k = 0; k < reflectedCount; k++) {
      const origIdx = reflectedIndices[k];
      if (origIdx < rays.length) {
        const ray = rays[origIdx];
        this._gridMap[ray.j * uCount + ray.i] = k;
      }
    }

    const prismsPerCell = includeIncident ? 2 : 1;
    const maxPrisms = (uCount - 1) * (vCount - 1) * prismsPerCell;
    this._ensureBuffers(maxPrisms);

    const positions = this._positions;
    const beamDirs = this._beamDirs;
    const tParams = this._tParams;
    const nearAreas = this._nearAreas;
    const farAreas = this._farAreas;
    const indices = this._indices;

    let vertIdx = 0;
    let idxIdx = 0;

    // Area of a quad (two triangles sharing a diagonal)
    function quadArea(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) {
      // triangle ABC
      let e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      let e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const a1 = 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
      // triangle ACD
      e1x = cx - ax; e1y = cy - ay; e1z = cz - az;
      e2x = dx - ax; e2y = dy - ay; e2z = dz - az;
      nx = e1y * e2z - e1z * e2y;
      ny = e1z * e2x - e1x * e2z;
      nz = e1x * e2y - e1y * e2x;
      const a2 = 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
      return a1 + a2;
    }

    // Add a square prism from 4 grid-corner reflected-ray indices.
    // Corner order: 00(i,j) → 10(i+1,j) → 11(i+1,j+1) → 01(i,j+1)
    const addQuadPrism = (k00, k10, k11, k01, s, lengths = null, defaultLength = maxBeamDist) => {
      const b00 = k00 * 6, b10 = k10 * 6, b11 = k11 * 6, b01 = k01 * 6;

      // Near positions (ray hit points)
      const n00x = s[b00], n00y = s[b00+1], n00z = s[b00+2];
      const n10x = s[b10], n10y = s[b10+1], n10z = s[b10+2];
      const n11x = s[b11], n11y = s[b11+1], n11z = s[b11+2];
      const n01x = s[b01], n01y = s[b01+1], n01z = s[b01+2];

      // Ray directions
      const d00x = s[b00+3], d00y = s[b00+4], d00z = s[b00+5];
      const d10x = s[b10+3], d10y = s[b10+4], d10z = s[b10+5];
      const d11x = s[b11+3], d11y = s[b11+4], d11z = s[b11+5];
      const d01x = s[b01+3], d01y = s[b01+4], d01z = s[b01+5];

      // Far positions
      const l00 = Math.max(0.001, lengths ? lengths[k00] ?? defaultLength : defaultLength);
      const l10 = Math.max(0.001, lengths ? lengths[k10] ?? defaultLength : defaultLength);
      const l11 = Math.max(0.001, lengths ? lengths[k11] ?? defaultLength : defaultLength);
      const l01 = Math.max(0.001, lengths ? lengths[k01] ?? defaultLength : defaultLength);
      const f00x = n00x + d00x * l00, f00y = n00y + d00y * l00, f00z = n00z + d00z * l00;
      const f10x = n10x + d10x * l10, f10y = n10y + d10y * l10, f10z = n10z + d10z * l10;
      const f11x = n11x + d11x * l11, f11y = n11y + d11y * l11, f11z = n11z + d11z * l11;
      const f01x = n01x + d01x * l01, f01y = n01y + d01y * l01, f01z = n01z + d01z * l01;

      const nArea = quadArea(n00x,n00y,n00z, n10x,n10y,n10z, n11x,n11y,n11z, n01x,n01y,n01z);
      const fArea = quadArea(f00x,f00y,f00z, f10x,f10y,f10z, f11x,f11y,f11z, f01x,f01y,f01z);
      if (nArea < 1e-8 && fArea < 1e-8) return;

      // Average beam direction for this cell
      const avgDx = (d00x+d10x+d11x+d01x)*0.25;
      const avgDy = (d00y+d10y+d11y+d01y)*0.25;
      const avgDz = (d00z+d10z+d11z+d01z)*0.25;

      const base = vertIdx;

      // 8 vertices: near 00,10,11,01 then far 00,10,11,01
      // [pos(3), beamDir(3), t]
      const vdata = [
        n00x,n00y,n00z, n10x,n10y,n10z, n11x,n11y,n11z, n01x,n01y,n01z,
        f00x,f00y,f00z, f10x,f10y,f10z, f11x,f11y,f11z, f01x,f01y,f01z
      ];

      for (let vi = 0; vi < 8; vi++) {
        const p3 = (vertIdx + vi) * 3;
        const s3 = vi * 3;
        positions[p3]   = vdata[s3];
        positions[p3+1] = vdata[s3+1];
        positions[p3+2] = vdata[s3+2];
        beamDirs[p3]    = avgDx;
        beamDirs[p3+1]  = avgDy;
        beamDirs[p3+2]  = avgDz;
        tParams[vertIdx + vi]   = vi < 4 ? 0 : 1;
        nearAreas[vertIdx + vi] = nArea;
        farAreas[vertIdx + vi]  = fArea;
      }

      vertIdx += 8;

      // Near: 0=00, 1=10, 2=11, 3=01   Far: 4=00, 5=10, 6=11, 7=01
      const n0 = base, n1 = base+1, n2 = base+2, n3 = base+3;
      const f0 = base+4, f1 = base+5, f2 = base+6, f3 = base+7;

      // 4 side quads (outward-facing front, BackSide renders interior exit face)
      indices[idxIdx++] = n0; indices[idxIdx++] = n1; indices[idxIdx++] = f1;
      indices[idxIdx++] = n0; indices[idxIdx++] = f1; indices[idxIdx++] = f0;
      indices[idxIdx++] = n1; indices[idxIdx++] = n2; indices[idxIdx++] = f2;
      indices[idxIdx++] = n1; indices[idxIdx++] = f2; indices[idxIdx++] = f1;
      indices[idxIdx++] = n2; indices[idxIdx++] = n3; indices[idxIdx++] = f3;
      indices[idxIdx++] = n2; indices[idxIdx++] = f3; indices[idxIdx++] = f2;
      indices[idxIdx++] = n3; indices[idxIdx++] = n0; indices[idxIdx++] = f0;
      indices[idxIdx++] = n3; indices[idxIdx++] = f0; indices[idxIdx++] = f3;
    };

    for (let j = 0; j < vCount - 1; j++) {
      for (let i = 0; i < uCount - 1; i++) {
        const k00 = this._gridMap[j * uCount + i];
        const k10 = this._gridMap[j * uCount + (i + 1)];
        const k01 = this._gridMap[(j + 1) * uCount + i];
        const k11 = this._gridMap[(j + 1) * uCount + (i + 1)];

        // Need all 4 corners to form a watertight quad prism
        if (k00 >= 0 && k10 >= 0 && k11 >= 0 && k01 >= 0) {
          addQuadPrism(k00, k10, k11, k01, reflectedSamples, null, maxBeamDist);
          if (includeIncident && incidentSamples && incidentCount > 0 && incidentLengths && incidentLengths.length > 0) {
            addQuadPrism(k00, k10, k11, k01, incidentSamples, incidentLengths, maxBeamDist);
          }
        }
      }
    }

    this._prismCount = vertIdx / 8;

    const g = this.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.beamDirection.needsUpdate = true;
    g.attributes.tParam.needsUpdate = true;
    g.attributes.nearArea.needsUpdate = true;
    g.attributes.farArea.needsUpdate = true;
    g.index.needsUpdate = true;
    g.setDrawRange(0, idxIdx);
    g.computeBoundingSphere();
  }

  // ── Sizing ─────────────────────────────────────────────────────────

  setSize(width, height) {
    this._size.set(Math.max(1, width), Math.max(1, height));
    const scale = qualityScale(this.params.volumetrics.reducedResolutionMode);
    this._currentScale = scale;
    const targetW = Math.max(1, Math.floor(this._size.x * scale));
    const targetH = Math.max(1, Math.floor(this._size.y * scale));
    this.renderTarget.setSize(targetW, targetH);
  }

  // ── Uniform sync ───────────────────────────────────────────────────

  updateUniforms() {
    const u = this.uniforms;
    const p = this.params.volumetrics;

    u.hazeDensity.value = Math.max(0, p.hazeDensity);
    u.scatteringCoeff.value = Math.max(0, p.scatteringCoeff);
    u.extinctionCoeff.value = Math.max(0, p.extinctionCoeff);
    u.anisotropy.value = p.anisotropy;
    u.forwardScatterBias.value = p.forwardScatterBias;
    u.intensity.value = Math.max(0, p.intensity);
    u.beamPower.value = Math.max(0, p.injectionIntensity);
    u.numRays.value = Math.max(1, this._beamRayCount);

    const scale = qualityScale(p.reducedResolutionMode);
    if (Math.abs(scale - this._currentScale) > 1e-6) {
      this.setSize(this._size.x, this._size.y);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────

  render(renderer, opticsState, depthScene = null) {
    this.buildGeometry(opticsState);
    this.updateUniforms();

    const prevClearColor = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();
    const prevOverride = depthScene ? depthScene.overrideMaterial : null;

    renderer.setRenderTarget(this.renderTarget);
    renderer.setClearColor(this._clearColor, 0);
    renderer.clear();

    // Populate depth in this target so beam fragments are properly occluded
    // by opaque scene geometry (e.g. floor, sheet, rig).
    if (depthScene) {
      depthScene.overrideMaterial = this._depthPrepassMaterial;
      renderer.render(depthScene, this.camera);
      depthScene.overrideMaterial = prevOverride;
    }

    renderer.render(this._scene, this.camera);
    renderer.setRenderTarget(null);

    renderer.setClearColor(prevClearColor, prevClearAlpha);
  }

  get texture() {
    return this.renderTarget.texture;
  }

  dispose() {
    this.material.dispose();
    this._depthPrepassMaterial.dispose();
    this.geometry.dispose();
    this.renderTarget.dispose();
  }
}
