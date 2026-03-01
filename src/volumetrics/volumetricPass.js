import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { VOLUMETRIC_QUALITY_MODES } from "./volumetricParams.js";

const MAX_RAY_STEPS = 192;

function qualityScale(mode) {
  return VOLUMETRIC_QUALITY_MODES[mode] ?? 0.5;
}

function debugModeToInt(mode) {
  if (mode === "volumetric-only") return 1;
  if (mode === "scene-only") return 2;
  return 0;
}

function makeRaymarchMaterial() {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    uniforms: {
      uVolumeTexture: { value: null },
      uBoundsMin: { value: new THREE.Vector3() },
      uBoundsMax: { value: new THREE.Vector3() },
      uCameraPos: { value: new THREE.Vector3() },
      uInvProjection: { value: new THREE.Matrix4() },
      uCameraMatrixWorld: { value: new THREE.Matrix4() },
      uRaymarchStepCount: { value: 72 },
      uRaymarchMaxDistance: { value: 36 },
      uHazeDensity: { value: 1 },
      uScatteringCoeff: { value: 1 },
      uExtinctionCoeff: { value: 0.42 },
      uAnisotropy: { value: 0.4 },
      uForwardScatterBias: { value: 0.6 },
      uIntensity: { value: 1.45 },
      uPrimaryLightDir: { value: new THREE.Vector3(0, -0.4, 1).normalize() },
      uJitter: { value: 0 }
    },
    vertexShader: /* glsl */ `
      out vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp sampler3D;

      in vec2 vUv;
      out vec4 outColor;

      uniform sampler3D uVolumeTexture;
      uniform vec3 uBoundsMin;
      uniform vec3 uBoundsMax;
      uniform vec3 uCameraPos;
      uniform mat4 uInvProjection;
      uniform mat4 uCameraMatrixWorld;
      uniform int uRaymarchStepCount;
      uniform float uRaymarchMaxDistance;
      uniform float uHazeDensity;
      uniform float uScatteringCoeff;
      uniform float uExtinctionCoeff;
      uniform float uAnisotropy;
      uniform float uForwardScatterBias;
      uniform float uIntensity;
      uniform vec3 uPrimaryLightDir;
      uniform float uJitter;

      bool intersectAabb(vec3 origin, vec3 dir, vec3 boxMin, vec3 boxMax, out float tNear, out float tFar) {
        vec3 invDir = 1.0 / dir;
        vec3 t0 = (boxMin - origin) * invDir;
        vec3 t1 = (boxMax - origin) * invDir;
        vec3 tsmaller = min(t0, t1);
        vec3 tbigger = max(t0, t1);
        tNear = max(max(tsmaller.x, tsmaller.y), tsmaller.z);
        tFar = min(min(tbigger.x, tbigger.y), tbigger.z);
        return tFar >= tNear;
      }

      float phaseHG(float cosTheta, float g) {
        float gg = g * g;
        float denom = pow(max(0.05, 1.0 + gg - 2.0 * g * cosTheta), 1.5);
        return (1.0 - gg) / (12.566370614359172 * denom);
      }

      void main() {
        vec2 ndc = vUv * 2.0 - 1.0;
        vec4 viewNear = uInvProjection * vec4(ndc, -1.0, 1.0);
        viewNear /= max(1e-6, viewNear.w);
        vec3 rayDirView = normalize(viewNear.xyz);
        vec3 rayDirWorld = normalize((uCameraMatrixWorld * vec4(rayDirView, 0.0)).xyz);
        vec3 origin = uCameraPos;

        float tNear = 0.0;
        float tFar = 0.0;
        if (!intersectAabb(origin, rayDirWorld, uBoundsMin, uBoundsMax, tNear, tFar)) {
          outColor = vec4(0.0);
          return;
        }

        tNear = max(tNear, 0.0);
        tFar = min(tFar, uRaymarchMaxDistance);
        if (tFar <= tNear) {
          outColor = vec4(0.0);
          return;
        }

        int steps = max(1, uRaymarchStepCount);
        float stepLength = (tFar - tNear) / float(steps);
        float marchT = tNear + uJitter * stepLength;

        float transmittance = 1.0;
        float accumulated = 0.0;
        vec3 boundsSize = max(vec3(1e-6), uBoundsMax - uBoundsMin);
        vec3 primaryDir = normalize(uPrimaryLightDir);
        float cosTheta = clamp(dot(-rayDirWorld, primaryDir), -1.0, 1.0);
        float phaseValue = phaseHG(cosTheta, clamp(uAnisotropy, -0.8, 0.8));
        float directionalBoost = mix(1.0, phaseValue * 20.0, clamp(uForwardScatterBias, 0.0, 1.0));

        for (int i = 0; i < ${MAX_RAY_STEPS}; i += 1) {
          if (i >= steps) break;
          vec3 worldPos = origin + rayDirWorld * (marchT + stepLength * 0.5);
          vec3 uvw = clamp((worldPos - uBoundsMin) / boundsSize, 0.0, 1.0);
          float energy = texture(uVolumeTexture, uvw).r;

          float scatter = energy * uHazeDensity * uScatteringCoeff * directionalBoost;
          accumulated += transmittance * scatter * stepLength;

          float extinction = max(0.0, uExtinctionCoeff * uHazeDensity);
          transmittance *= exp(-extinction * stepLength);

          if (transmittance < 0.01) break;
          marchT += stepLength;
        }

        float alpha = clamp(1.0 - transmittance, 0.0, 1.0);
        vec3 color = vec3(accumulated * uIntensity);
        outColor = vec4(color, alpha);
      }
    `
  });
}

function makeOverlayMaterial() {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    uniforms: {
      tVolumetric: { value: null },
      uVolumetricOnly: { value: 0 },
      uCompositeOpacity: { value: 0.75 }
    },
    vertexShader: /* glsl */ `
      out vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      in vec2 vUv;
      out vec4 outColor;

      uniform sampler2D tVolumetric;
      uniform int uVolumetricOnly;
      uniform float uCompositeOpacity;

      void main() {
        vec4 volumeSample = texture(tVolumetric, vUv);
        vec3 volumeColor = max(volumeSample.rgb, vec3(0.0));
        float finiteGuard = step(abs(volumeSample.r), 1e10) * step(abs(volumeSample.g), 1e10) * step(abs(volumeSample.b), 1e10);
        volumeColor *= finiteGuard;
        float alpha = uVolumetricOnly == 1 ? 1.0 : clamp(dot(volumeColor, vec3(0.3333)) * uCompositeOpacity, 0.0, 1.0);
        outColor = vec4(volumeColor * uCompositeOpacity, alpha);
      }
    `
  });
}

function makeCopyMaterial() {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tDiffuse: { value: null }
    },
    vertexShader: /* glsl */ `
      out vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec2 vUv;
      out vec4 outColor;
      uniform sampler2D tDiffuse;
      void main() {
        outColor = texture(tDiffuse, vUv);
      }
    `
  });
}

export class VolumetricPass extends Pass {
  constructor(camera, params, volumetricState) {
    super();
    this.camera = camera;
    this.params = params;
    this.volumetricState = volumetricState;

    this.needsSwap = true;
    this.clear = false;

    this.raymarchMaterial = makeRaymarchMaterial();
    this.overlayMaterial = makeOverlayMaterial();
    this.copyMaterial = makeCopyMaterial();

    this.raymarchQuad = new FullScreenQuad(this.raymarchMaterial);
    this.overlayQuad = new FullScreenQuad(this.overlayMaterial);
    this.copyQuad = new FullScreenQuad(this.copyMaterial);

    this.raymarchTarget = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      stencilBuffer: false,
      // Keep HDR range through the post chain so final tone mapping behaves correctly.
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter
    });

    this._size = new THREE.Vector2(1, 1);
    this._currentScale = 0;
  }

  setSize(width, height) {
    this._size.set(Math.max(1, width), Math.max(1, height));
    const scale = qualityScale(this.params.volumetrics.reducedResolutionMode);
    this._currentScale = scale;
    const targetW = Math.max(1, Math.floor(this._size.x * scale));
    const targetH = Math.max(1, Math.floor(this._size.y * scale));
    this.raymarchTarget.setSize(targetW, targetH);
  }

  render(renderer, writeBuffer, readBuffer) {
    this.copyMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    const mode = debugModeToInt(this.params.volumetrics.debugRenderMode);
    const target = this.renderToScreen ? null : writeBuffer;
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    try {
      if (!this.params.volumetrics.enabled || !this.volumetricState.volumeTexture) {
        renderer.setRenderTarget(target);
        this.copyQuad.render(renderer);
        return;
      }

      // Always lay down the scene first unless explicitly requesting volumetric-only mode.
      if (mode !== 1) {
        renderer.setRenderTarget(target);
        this.copyQuad.render(renderer);
        if (mode === 2) return;
      }

      const scale = qualityScale(this.params.volumetrics.reducedResolutionMode);
      if (Math.abs(scale - this._currentScale) > 1e-6) {
        this.setSize(this._size.x, this._size.y);
      }

      const uniforms = this.raymarchMaterial.uniforms;
      uniforms.uVolumeTexture.value = this.volumetricState.volumeTexture;
      uniforms.uBoundsMin.value.copy(this.volumetricState.boundsMin);
      uniforms.uBoundsMax.value.copy(this.volumetricState.boundsMax);
      uniforms.uCameraPos.value.copy(this.camera.position);
      uniforms.uInvProjection.value.copy(this.camera.projectionMatrixInverse);
      uniforms.uCameraMatrixWorld.value.copy(this.camera.matrixWorld);
      uniforms.uRaymarchStepCount.value = Math.max(1, Math.floor(this.params.volumetrics.raymarchStepCount));
      uniforms.uRaymarchMaxDistance.value = Math.max(0.1, this.params.volumetrics.raymarchMaxDistance);
      uniforms.uHazeDensity.value = Math.max(0, this.params.volumetrics.hazeDensity);
      uniforms.uScatteringCoeff.value = Math.max(0, this.params.volumetrics.scatteringCoeff);
      uniforms.uExtinctionCoeff.value = Math.max(0, this.params.volumetrics.extinctionCoeff);
      uniforms.uAnisotropy.value = this.params.volumetrics.anisotropy;
      uniforms.uForwardScatterBias.value = this.params.volumetrics.forwardScatterBias;
      uniforms.uIntensity.value = Math.max(0, this.params.volumetrics.intensity);
      uniforms.uJitter.value = ((this.volumetricState.frameIndex * 0.75487766) % 1 + 1) % 1;

      renderer.setRenderTarget(this.raymarchTarget);
      renderer.clear();
      this.raymarchQuad.render(renderer);

      const overlayUniforms = this.overlayMaterial.uniforms;
      overlayUniforms.tVolumetric.value = this.raymarchTarget.texture;
      overlayUniforms.uCompositeOpacity.value = Math.max(0, this.params.volumetrics.compositeOpacity);

      if (mode === 1) {
        overlayUniforms.uVolumetricOnly.value = 1;
        this.overlayMaterial.blending = THREE.NormalBlending;
        renderer.setRenderTarget(target);
        renderer.clear();
        this.overlayQuad.render(renderer);
        return;
      }

      overlayUniforms.uVolumetricOnly.value = 0;
      this.overlayMaterial.blending = THREE.AdditiveBlending;
      renderer.setRenderTarget(target);
      this.overlayQuad.render(renderer);
    } finally {
      renderer.autoClear = previousAutoClear;
    }
  }

  dispose() {
    this.raymarchQuad.dispose();
    this.overlayQuad.dispose();
    this.copyQuad.dispose();
    this.raymarchMaterial.dispose();
    this.overlayMaterial.dispose();
    this.copyMaterial.dispose();
    this.raymarchTarget.dispose();
  }
}
