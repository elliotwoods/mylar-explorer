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
 * Instead of raymarching a 3D texture, this builds triangular prism geometry
 * from the reflected ray grid (Delaunay-style grid triangulation), then
 * rasterises those prisms with a scattering fragment shader.
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
 *   - No depth write / no depth test: all beams visible regardless of order.
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
      numRays: uniform(1.0),
      pipeSoftness: uniform(3.0)
    };
    this.uniforms = u;

    // ── TSL fragment shader ────────────────────────────────────────────
    const fragmentFn = Fn(() => {
      // Custom per-vertex attributes (interpolated as varyings)
      const beamDir = attribute("beamDirection", "vec3");
      const tParam = attribute("tParam", "float");
      const nearArea = attribute("nearArea", "float");
      const farArea = attribute("farArea", "float");
      const centroidPos = attribute("centroidPos", "vec3");
      const beamRadius = attribute("beamRadius", "float");

      // Cross-section area at this depth (use original un-oversized area for energy)
      const area = max(mix(nearArea, farArea, tParam), float(1e-8));

      // ── Gaussian cross-section falloff ──
      // Distance from fragment to interpolated prism centroid axis
      const worldPos = positionWorld;
      const distFromAxis = length(worldPos.sub(centroidPos));
      const normDist = distFromAxis.div(max(beamRadius, float(1e-4)));
      const gaussFade = exp(u.pipeSoftness.negate().mul(normDist).mul(normDist));

      // View direction: fragment → camera
      const viewDir = normalize(cameraPosition.sub(worldPos));
      const distToCamera = length(cameraPosition.sub(worldPos));

      // Beam direction (unit)
      const beamDirN = normalize(beamDir);

      // ── Henyey–Greenstein phase function ──
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
        .mul(u.intensity)
        .mul(gaussFade);

      return vec4(vec3(scattered), scattered);
    });

    // ── Material ───────────────────────────────────────────────────────
    this.material = new THREE.NodeMaterial();
    this.material.transparent = true;
    this.material.depthWrite = false;
    this.material.depthTest = false;
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
      depthBuffer: false,
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
    this._centroids = null;
    this._radii = null;
    this._indices = null;
    this._gridMap = null;
    this._prismCount = 0;
    this._reflectedCount = 0;
    this._clearColor = new THREE.Color(0x000000);
  }

  // ── Buffer management ──────────────────────────────────────────────

  _ensureBuffers(maxPrisms) {
    if (maxPrisms <= this._maxPrisms) return;
    this._maxPrisms = maxPrisms;

    const maxVerts = maxPrisms * 6;
    const maxIdx = maxPrisms * 18;

    this._positions = new Float32Array(maxVerts * 3);
    this._beamDirs = new Float32Array(maxVerts * 3);
    this._tParams = new Float32Array(maxVerts);
    this._nearAreas = new Float32Array(maxVerts);
    this._farAreas = new Float32Array(maxVerts);
    this._centroids = new Float32Array(maxVerts * 3);
    this._radii = new Float32Array(maxVerts);
    this._indices = new Uint32Array(maxIdx);

    const g = this.geometry;
    g.setAttribute("position", new THREE.BufferAttribute(this._positions, 3));
    g.setAttribute("beamDirection", new THREE.BufferAttribute(this._beamDirs, 3));
    g.setAttribute("tParam", new THREE.BufferAttribute(this._tParams, 1));
    g.setAttribute("nearArea", new THREE.BufferAttribute(this._nearAreas, 1));
    g.setAttribute("farArea", new THREE.BufferAttribute(this._farAreas, 1));
    g.setAttribute("centroidPos", new THREE.BufferAttribute(this._centroids, 3));
    g.setAttribute("beamRadius", new THREE.BufferAttribute(this._radii, 1));
    g.setIndex(new THREE.BufferAttribute(this._indices, 1));
  }

  // ── Geometry construction ──────────────────────────────────────────

  buildGeometry(opticsState) {
    if (!opticsState) {
      this.geometry.setDrawRange(0, 0);
      this._prismCount = 0;
      this._reflectedCount = 0;
      return;
    }
    const rays = opticsState.rays;
    const runtime = opticsState.runtime;
    const reflectedSamples = runtime.reflectedRaySamples;
    const reflectedIndices = runtime.reflectedRayIndices;
    const reflectedCount = runtime.reflectedRayCount || 0;
    const p = this.params;

    this._reflectedCount = reflectedCount;

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

    const maxPrisms = 2 * (uCount - 1) * (vCount - 1);
    this._ensureBuffers(maxPrisms);

    const positions = this._positions;
    const beamDirs = this._beamDirs;
    const tParams = this._tParams;
    const nearAreas = this._nearAreas;
    const farAreas = this._farAreas;
    const centroids = this._centroids;
    const radii = this._radii;
    const indices = this._indices;
    const oversize = Math.max(1, p.volumetrics.pipeOversize);

    let vertIdx = 0;
    let idxIdx = 0;

    function triArea(ax, ay, az, bx, by, bz, cx, cy, cz) {
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      return 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
    }

    // Characteristic radius of a triangle: radius of circumscribed circle approximation
    function triRadius(area) {
      // For an equilateral triangle with area A, circumradius = sqrt(4A/3√3).
      // We use a simpler heuristic: r ≈ sqrt(A / π) (radius of equal-area circle).
      return Math.sqrt(Math.max(0, area) / Math.PI);
    }

    const addPrism = (k0, k1, k2) => {
      const b0 = k0 * 6, b1 = k1 * 6, b2 = k2 * 6;

      const n0x = reflectedSamples[b0], n0y = reflectedSamples[b0 + 1], n0z = reflectedSamples[b0 + 2];
      const n1x = reflectedSamples[b1], n1y = reflectedSamples[b1 + 1], n1z = reflectedSamples[b1 + 2];
      const n2x = reflectedSamples[b2], n2y = reflectedSamples[b2 + 1], n2z = reflectedSamples[b2 + 2];

      const d0x = reflectedSamples[b0 + 3], d0y = reflectedSamples[b0 + 4], d0z = reflectedSamples[b0 + 5];
      const d1x = reflectedSamples[b1 + 3], d1y = reflectedSamples[b1 + 4], d1z = reflectedSamples[b1 + 5];
      const d2x = reflectedSamples[b2 + 3], d2y = reflectedSamples[b2 + 4], d2z = reflectedSamples[b2 + 5];

      // Original (un-expanded) far positions
      let f0x = n0x + d0x * maxBeamDist, f0y = n0y + d0y * maxBeamDist, f0z = n0z + d0z * maxBeamDist;
      let f1x = n1x + d1x * maxBeamDist, f1y = n1y + d1y * maxBeamDist, f1z = n1z + d1z * maxBeamDist;
      let f2x = n2x + d2x * maxBeamDist, f2y = n2y + d2y * maxBeamDist, f2z = n2z + d2z * maxBeamDist;

      const nArea = triArea(n0x, n0y, n0z, n1x, n1y, n1z, n2x, n2y, n2z);
      const fArea = triArea(f0x, f0y, f0z, f1x, f1y, f1z, f2x, f2y, f2z);

      if (nArea < 1e-8 && fArea < 1e-8) return;

      // Centroids of near and far triangles (before expansion)
      const nCx = (n0x + n1x + n2x) / 3, nCy = (n0y + n1y + n2y) / 3, nCz = (n0z + n1z + n2z) / 3;
      const fCx = (f0x + f1x + f2x) / 3, fCy = (f0y + f1y + f2y) / 3, fCz = (f0z + f1z + f2z) / 3;

      // Characteristic radii (of original triangles, before oversize)
      const nRad = triRadius(nArea);
      const fRad = triRadius(fArea);

      // Expand vertices outward from centroid by oversize factor
      const expandNear = (vx, vy, vz) => [
        nCx + (vx - nCx) * oversize,
        nCy + (vy - nCy) * oversize,
        nCz + (vz - nCz) * oversize
      ];
      const expandFar = (vx, vy, vz) => [
        fCx + (vx - fCx) * oversize,
        fCy + (vy - fCy) * oversize,
        fCz + (vz - fCz) * oversize
      ];

      const en0 = expandNear(n0x, n0y, n0z);
      const en1 = expandNear(n1x, n1y, n1z);
      const en2 = expandNear(n2x, n2y, n2z);
      const ef0 = expandFar(f0x, f0y, f0z);
      const ef1 = expandFar(f1x, f1y, f1z);
      const ef2 = expandFar(f2x, f2y, f2z);

      // Expanded radii (for falloff normalization)
      const nRadExp = nRad * oversize;
      const fRadExp = fRad * oversize;

      const base = vertIdx;

      // [expanded pos(3), beamDir(3), t, centroid(3), radius]
      const verts = [
        [...en0, d0x, d0y, d0z, 0, nCx, nCy, nCz, nRadExp],
        [...en1, d1x, d1y, d1z, 0, nCx, nCy, nCz, nRadExp],
        [...en2, d2x, d2y, d2z, 0, nCx, nCy, nCz, nRadExp],
        [...ef0, d0x, d0y, d0z, 1, fCx, fCy, fCz, fRadExp],
        [...ef1, d1x, d1y, d1z, 1, fCx, fCy, fCz, fRadExp],
        [...ef2, d2x, d2y, d2z, 1, fCx, fCy, fCz, fRadExp]
      ];

      for (let vi = 0; vi < 6; vi++) {
        const v = verts[vi];
        const p3 = (vertIdx + vi) * 3;
        positions[p3] = v[0];
        positions[p3 + 1] = v[1];
        positions[p3 + 2] = v[2];
        beamDirs[p3] = v[3];
        beamDirs[p3 + 1] = v[4];
        beamDirs[p3 + 2] = v[5];
        tParams[vertIdx + vi] = v[6];
        nearAreas[vertIdx + vi] = nArea;
        farAreas[vertIdx + vi] = fArea;
        centroids[p3] = v[7];
        centroids[p3 + 1] = v[8];
        centroids[p3 + 2] = v[9];
        radii[vertIdx + vi] = v[10];
      }

      vertIdx += 6;

      const v0n = base, v1n = base + 1, v2n = base + 2;
      const v0f = base + 3, v1f = base + 4, v2f = base + 5;

      indices[idxIdx++] = v0n; indices[idxIdx++] = v1n; indices[idxIdx++] = v1f;
      indices[idxIdx++] = v0n; indices[idxIdx++] = v1f; indices[idxIdx++] = v0f;
      indices[idxIdx++] = v1n; indices[idxIdx++] = v2n; indices[idxIdx++] = v2f;
      indices[idxIdx++] = v1n; indices[idxIdx++] = v2f; indices[idxIdx++] = v1f;
      indices[idxIdx++] = v2n; indices[idxIdx++] = v0n; indices[idxIdx++] = v0f;
      indices[idxIdx++] = v2n; indices[idxIdx++] = v0f; indices[idxIdx++] = v2f;
    };

    for (let j = 0; j < vCount - 1; j++) {
      for (let i = 0; i < uCount - 1; i++) {
        const k00 = this._gridMap[j * uCount + i];
        const k10 = this._gridMap[j * uCount + (i + 1)];
        const k01 = this._gridMap[(j + 1) * uCount + i];
        const k11 = this._gridMap[(j + 1) * uCount + (i + 1)];

        if (k00 >= 0 && k10 >= 0 && k11 >= 0) addPrism(k00, k10, k11);
        if (k00 >= 0 && k11 >= 0 && k01 >= 0) addPrism(k00, k11, k01);
      }
    }

    this._prismCount = vertIdx / 6;

    const g = this.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.beamDirection.needsUpdate = true;
    g.attributes.tParam.needsUpdate = true;
    g.attributes.nearArea.needsUpdate = true;
    g.attributes.farArea.needsUpdate = true;
    g.attributes.centroidPos.needsUpdate = true;
    g.attributes.beamRadius.needsUpdate = true;
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
    u.numRays.value = Math.max(1, this._reflectedCount);
    u.pipeSoftness.value = Math.max(0, p.pipeSoftness);

    const scale = qualityScale(p.reducedResolutionMode);
    if (Math.abs(scale - this._currentScale) > 1e-6) {
      this.setSize(this._size.x, this._size.y);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────

  render(renderer, opticsState) {
    this.buildGeometry(opticsState);
    this.updateUniforms();

    const prevClearColor = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();

    renderer.setRenderTarget(this.renderTarget);
    renderer.setClearColor(this._clearColor, 0);
    renderer.clear();
    renderer.render(this._scene, this.camera);
    renderer.setRenderTarget(null);

    renderer.setClearColor(prevClearColor, prevClearAlpha);
  }

  get texture() {
    return this.renderTarget.texture;
  }

  dispose() {
    this.material.dispose();
    this.geometry.dispose();
    this.renderTarget.dispose();
  }
}
