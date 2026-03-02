import * as THREE from "three/webgpu";
import {
  Fn, Loop, If, Break,
  uniform, float, int, vec2, vec3, vec4,
  uv, texture3D,
  min, max, normalize, dot, clamp, pow, exp, mix, select,
  reciprocal
} from "three/tsl";
import { VOLUMETRIC_QUALITY_MODES } from "./volumetricParams.js";

const MAX_RAY_STEPS = 128;

function qualityScale(mode) {
  return VOLUMETRIC_QUALITY_MODES[mode] ?? 0.5;
}

function createPlaceholder3DTexture() {
  const data = new Float32Array(1);
  const tex = new THREE.Data3DTexture(data, 1, 1, 1);
  tex.format = THREE.RedFormat;
  tex.type = THREE.FloatType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export class VolumetricRenderer {
  constructor(camera, params, volumetricState) {
    this.camera = camera;
    this.params = params;
    this.volumetricState = volumetricState;

    // TSL uniforms
    const u = {
      boundsMin: uniform(new THREE.Vector3()),
      boundsMax: uniform(new THREE.Vector3()),
      cameraPos: uniform(new THREE.Vector3()),
      invProjection: uniform(new THREE.Matrix4()),
      cameraMatrixWorld: uniform(new THREE.Matrix4()),
      raymarchStepCount: uniform(72),
      raymarchMaxDistance: uniform(36.0),
      hazeDensity: uniform(1.0),
      scatteringCoeff: uniform(1.0),
      extinctionCoeff: uniform(0.42),
      anisotropy: uniform(0.4),
      forwardScatterBias: uniform(0.6),
      intensity: uniform(1.45),
      primaryLightDir: uniform(new THREE.Vector3(0, -0.4, 1).normalize()),
      jitter: uniform(0.0)
    };
    this.uniforms = u;

    // The volume texture3D node is created inside the Fn and captured here
    // so we can update its .value when the texture object changes.
    this._volumeTexNode = null;
    const initialTexture = volumetricState.volumeTexture || createPlaceholder3DTexture();

    // Build TSL raymarch shader
    const self = this;
    const raymarchFn = Fn(() => {
      const _uv = uv();
      // WebGPU UV origin is top-left; flip Y so NDC (-1,-1) = bottom-left
      const ndc = vec2(_uv.x.mul(2.0).sub(1.0), float(1.0).sub(_uv.y).mul(2.0).sub(1.0));

      // Reconstruct ray direction from NDC -> view -> world
      // WebGPU clip space Z: 0 (near) to 1 (far), unlike WebGL's -1 to 1
      const clipPos = vec4(ndc.x, ndc.y, float(0.0), float(1.0));
      const viewNear = u.invProjection.mul(clipPos);
      const viewNearDiv = viewNear.div(max(viewNear.w, float(1e-6)));
      const rayDirView = normalize(viewNearDiv.xyz);
      const rayDirWorld = normalize(u.cameraMatrixWorld.mul(vec4(rayDirView, float(0.0))).xyz);
      const origin = u.cameraPos;

      // AABB ray intersection
      const invDir = reciprocal(rayDirWorld);
      const t0 = u.boundsMin.sub(origin).mul(invDir);
      const t1 = u.boundsMax.sub(origin).mul(invDir);
      const tsmaller = min(t0, t1);
      const tbigger = max(t0, t1);
      const tNearRaw = max(max(tsmaller.x, tsmaller.y), tsmaller.z);
      const tFarRaw = min(min(tbigger.x, tbigger.y), tbigger.z);

      const tNear = max(tNearRaw, float(0.0));
      const tFar = min(tFarRaw, u.raymarchMaxDistance);
      const noHit = tFarRaw.lessThan(tNearRaw);
      const noRange = tFar.lessThanEqual(tNear);

      // March setup — exponential step distribution:
      // Smaller steps near camera (where detail matters), larger steps far away.
      // Total distance = sum of geometric series: s * (r^N - 1) / (r - 1)
      // where s = base step, r = growth ratio, N = step count.
      const steps = max(u.raymarchStepCount, int(1));
      const stepsF = float(steps);
      const totalDist = tFar.sub(tNear);
      // Growth ratio: each step is ~0.5% larger than previous (subtle but effective)
      const growthRatio = float(1.012);
      // Geometric series sum for normalisation
      const rN = pow(growthRatio, stepsF);
      const geoSum = rN.sub(float(1.0)).div(growthRatio.sub(float(1.0)));
      const baseStep = totalDist.div(max(geoSum, float(1e-6)));
      // Jitter the starting position by one base step
      const marchT = tNear.add(u.jitter.mul(baseStep)).toVar();
      // Current step length (grows each iteration)
      const curStep = baseStep.toVar();

      const transmittance = float(1.0).toVar();
      const accumulated = float(0.0).toVar();
      const boundsSize = max(u.boundsMax.sub(u.boundsMin), vec3(1e-6));

      // Phase function (Henyey-Greenstein) — computed once outside the loop
      const primaryDir = normalize(u.primaryLightDir);
      // Sign convention: compare beam travel direction against camera->sample
      // direction so positive anisotropy brightens when looking down-beam.
      const cosTheta = clamp(dot(rayDirWorld, primaryDir), float(-1.0), float(1.0));
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

      // Precompute extinction outside loop (uniform across volume)
      const extinction = max(float(0.0), u.extinctionCoeff.mul(u.hazeDensity));

      // Raymarch loop
      Loop(MAX_RAY_STEPS, ({ i }) => {
        If(int(i).greaterThanEqual(steps), () => { Break(); });

        const worldPos = origin.add(rayDirWorld.mul(marchT.add(curStep.mul(0.5))));
        const uvw = clamp(worldPos.sub(u.boundsMin).div(boundsSize), float(0.0), float(1.0));

        // Create the texture3D sampling node — capture the node reference for later .value updates
        const volSample = texture3D(initialTexture, uvw);
        if (!self._volumeTexNode) self._volumeTexNode = volSample;
        const energy = volSample.r;

        const scatter = energy.mul(u.hazeDensity).mul(u.scatteringCoeff).mul(directionalBoost);
        accumulated.addAssign(transmittance.mul(scatter).mul(curStep));

        transmittance.mulAssign(exp(extinction.negate().mul(curStep)));

        // Early exit — slightly raised threshold (0.02 vs 0.01) saves ~5-10% of steps
        If(transmittance.lessThan(float(0.02)), () => { Break(); });
        marchT.addAssign(curStep);
        curStep.mulAssign(growthRatio);
      });

      const alpha = clamp(float(1.0).sub(transmittance), float(0.0), float(1.0));
      const color = vec3(accumulated.mul(u.intensity));

      // Zero out if no intersection
      const hitMask = select(noHit.or(noRange), float(0.0), float(1.0));
      return vec4(color.mul(hitMask), alpha.mul(hitMask));
    });

    // Material for fullscreen quad
    this.material = new THREE.MeshBasicNodeMaterial();
    this.material.transparent = true;
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.material.fragmentNode = raymarchFn();

    // Fullscreen quad rendered to off-screen target
    this.quadMesh = new THREE.QuadMesh(this.material);

    // Reduced-resolution render target
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
  }

  get raymarchUniforms() {
    return this.uniforms;
  }

  setSize(width, height) {
    this._size.set(Math.max(1, width), Math.max(1, height));
    const scale = qualityScale(this.params.volumetrics.reducedResolutionMode);
    this._currentScale = scale;
    const targetW = Math.max(1, Math.floor(this._size.x * scale));
    const targetH = Math.max(1, Math.floor(this._size.y * scale));
    this.renderTarget.setSize(targetW, targetH);
  }

  updateUniforms() {
    const u = this.uniforms;
    const vs = this.volumetricState;
    const p = this.params.volumetrics;

    // Update the volume texture reference if it changed (e.g. resolution resize)
    if (vs.volumeTexture && this._volumeTexNode) {
      this._volumeTexNode.value = vs.volumeTexture;
    }
    u.boundsMin.value.copy(vs.boundsMin);
    u.boundsMax.value.copy(vs.boundsMax);
    u.cameraPos.value.copy(this.camera.position);
    u.invProjection.value.copy(this.camera.projectionMatrixInverse);
    u.cameraMatrixWorld.value.copy(this.camera.matrixWorld);
    u.raymarchStepCount.value = Math.max(1, Math.floor(p.raymarchStepCount));
    u.raymarchMaxDistance.value = Math.max(0.1, p.raymarchMaxDistance);
    u.hazeDensity.value = Math.max(0, p.hazeDensity);
    u.scatteringCoeff.value = Math.max(0, p.scatteringCoeff);
    u.extinctionCoeff.value = Math.max(0, p.extinctionCoeff);
    u.anisotropy.value = p.anisotropy;
    u.forwardScatterBias.value = p.forwardScatterBias;
    u.intensity.value = Math.max(0, p.intensity);
    u.jitter.value = ((vs.frameIndex * 0.75487766) % 1 + 1) % 1;

    const scale = qualityScale(p.reducedResolutionMode);
    if (Math.abs(scale - this._currentScale) > 1e-6) {
      this.setSize(this._size.x, this._size.y);
    }
  }

  render(renderer) {
    this.updateUniforms();
    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    this.quadMesh.render(renderer);
    renderer.setRenderTarget(null);
  }

  get texture() {
    return this.renderTarget.texture;
  }

  dispose() {
    this.material.dispose();
    this.renderTarget.dispose();
  }
}
