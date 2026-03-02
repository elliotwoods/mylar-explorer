import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  Return,
  uniform,
  float,
  int,
  uint,
  vec3,
  vec4,
  uvec3,
  instanceIndex,
  attributeArray,
  textureStore,
  atomicAdd,
  atomicStore,
  atomicLoad,
  min,
  max,
  abs,
  floor,
  ceil,
  round,
  clamp,
  reciprocal,
  select
} from "three/tsl";

const INJECTOR_BY_RENDERER = new WeakMap();
const ATOMIC_SCALE = 8192;

function formatMs(ms) {
  return `${Math.max(0, ms).toFixed(2)}`;
}

function nextPow2(value) {
  let v = Math.max(1, value | 0);
  v -= 1;
  v |= v >> 1;
  v |= v >> 2;
  v |= v >> 4;
  v |= v >> 8;
  v |= v >> 16;
  return v + 1;
}

function supportsGPUInjection(renderer) {
  if (!renderer || !renderer.backend?.isWebGPUBackend) return false;
  return true;
}

function chooseDepositionMode(params, boundsMin, boundsMax, resolution) {
  const radiusMeters = Math.max(0, params.volumetrics.depositionRadius);
  const voxelX = (boundsMax.x - boundsMin.x) / Math.max(1, resolution.x);
  const voxelY = (boundsMax.y - boundsMin.y) / Math.max(1, resolution.y);
  const voxelZ = (boundsMax.z - boundsMin.z) / Math.max(1, resolution.z);
  const minVoxel = Math.max(1e-6, Math.min(voxelX, voxelY, voxelZ));

  // Soft-kernel deposition is still routed to CPU for parity with the existing kernel path.
  if (radiusMeters > minVoxel * 0.6) return -1;
  if (radiusMeters <= 1e-4) return 0;
  return 1;
}

class WebGPUBeamInjector {
  constructor(renderer) {
    this.renderer = renderer;
    this.failed = false;
    this.rayCapacity = 0;
    this.voxelCount = 0;
    this.resolution = { x: 0, y: 0, z: 0 };
    this.volumeStorageTexture = null;

    this.raysA = null;
    this.raysB = null;
    this.accum = null;
    this.history = null;
    this.volume = null;

    this.computeClearAccum = null;
    this.computeInject = null;
    this.computeResolve = null;
    this.computeClearHistory = null;

    this.scratchRaysA = new Float32Array(4);
    this.scratchRaysB = new Float32Array(4);
    this.clearHistoryRequested = true;
    this.copyRegion = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1));

    this.uniforms = {
      rayCount: uniform(0, "int"),
      dispatchSteps: uniform(1, "int"),
      voxelCount: uniform(1, "int"),
      resX: uniform(1, "int"),
      resY: uniform(1, "int"),
      resZ: uniform(1, "int"),
      boundsMin: uniform(new THREE.Vector3()),
      boundsMax: uniform(new THREE.Vector3()),
      stepSize: uniform(0.2),
      maxBeamDistance: uniform(12.0),
      injectionIntensity: uniform(1.0),
      depositionMode: uniform(1, "int"),
      temporalAccum: uniform(1, "int"),
      temporalDecay: uniform(0.9),
      temporalBlend: uniform(0.4),
      clearEachFrame: uniform(1, "int"),
      atomicScale: uniform(ATOMIC_SCALE),
      invAtomicScale: uniform(1 / ATOMIC_SCALE)
    };
  }

  _createStorageTexture(resolution) {
    const texture = new THREE.Storage3DTexture(resolution.x, resolution.y, resolution.z);
    texture.type = THREE.FloatType;
    texture.format = THREE.RedFormat;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    return texture;
  }

  _disposeComputeNodes() {
    if (this.computeClearAccum) this.computeClearAccum.dispose();
    if (this.computeInject) this.computeInject.dispose();
    if (this.computeResolve) this.computeResolve.dispose();
    if (this.computeClearHistory) this.computeClearHistory.dispose();
    this.computeClearAccum = null;
    this.computeInject = null;
    this.computeResolve = null;
    this.computeClearHistory = null;
  }

  _ensureBuffers(rayCapacity, resolution) {
    let rebuild = false;

    if (rayCapacity > this.rayCapacity || this.raysA === null || this.raysB === null) {
      this.rayCapacity = nextPow2(Math.max(1, rayCapacity));
      this.raysA = attributeArray(this.rayCapacity, "vec4").toReadOnly();
      this.raysB = attributeArray(this.rayCapacity, "vec4").toReadOnly();
      this.scratchRaysA = this.raysA.value.array;
      this.scratchRaysB = this.raysB.value.array;
      rebuild = true;
    }

    const voxelCount = resolution.x * resolution.y * resolution.z;
    if (
      voxelCount !== this.voxelCount ||
      resolution.x !== this.resolution.x ||
      resolution.y !== this.resolution.y ||
      resolution.z !== this.resolution.z
    ) {
      this.voxelCount = voxelCount;
      this.resolution = { ...resolution };
      this.accum = attributeArray(voxelCount, "uint").toAtomic();
      this.history = attributeArray(voxelCount, "float");
      this.volume = attributeArray(voxelCount, "float");
      if (this.volumeStorageTexture) this.volumeStorageTexture.dispose();
      this.volumeStorageTexture = this._createStorageTexture(resolution);
      this.clearHistoryRequested = true;
      rebuild = true;
    }

    if (rebuild) {
      this._disposeComputeNodes();
      this._buildComputeNodes();
    }
  }

  _buildComputeNodes() {
    if (!this.raysA || !this.raysB || !this.accum || !this.history || !this.volume || !this.volumeStorageTexture) {
      return;
    }

    const u = this.uniforms;

    const clearAccumFn = Fn(() => {
      const idx = int(instanceIndex);
      If(idx.greaterThanEqual(u.voxelCount), () => { Return(); });
      atomicStore(this.accum.element(idx), uint(0));
    });

    const clearHistoryFn = Fn(() => {
      const idx = int(instanceIndex);
      If(idx.greaterThanEqual(u.voxelCount), () => { Return(); });

      atomicStore(this.accum.element(idx), uint(0));
      this.history.element(idx).assign(float(0));
      this.volume.element(idx).assign(float(0));

      const resX = u.resX;
      const resY = u.resY;
      const strideY = resX.mul(resY);
      const z = idx.div(strideY);
      const yz = idx.sub(z.mul(strideY));
      const y = yz.div(resX);
      const x = yz.sub(y.mul(resX));

      textureStore(
        this.volumeStorageTexture,
        uvec3(uint(x), uint(y), uint(z)),
        vec4(float(0), float(0), float(0), float(1))
      );
    });

    const injectFn = Fn(() => {
      const idx = int(instanceIndex);
      const dispatchSteps = max(u.dispatchSteps, int(1));
      const rayIndex = idx.div(dispatchSteps);
      const stepIndex = idx.sub(rayIndex.mul(dispatchSteps));

      If(rayIndex.greaterThanEqual(u.rayCount), () => { Return(); });

      const rayA = this.raysA.element(rayIndex);
      const rayB = this.raysB.element(rayIndex);
      const origin = rayA.xyz;
      const dir = vec3(rayA.w, rayB.x, rayB.y);
      const rayLength = max(float(0), rayB.z);

      const safeX = select(
        abs(dir.x).lessThan(float(1e-6)),
        select(dir.x.greaterThanEqual(float(0)), float(1e-6), float(-1e-6)),
        dir.x
      );
      const safeY = select(
        abs(dir.y).lessThan(float(1e-6)),
        select(dir.y.greaterThanEqual(float(0)), float(1e-6), float(-1e-6)),
        dir.y
      );
      const safeZ = select(
        abs(dir.z).lessThan(float(1e-6)),
        select(dir.z.greaterThanEqual(float(0)), float(1e-6), float(-1e-6)),
        dir.z
      );
      const invDir = reciprocal(vec3(safeX, safeY, safeZ));

      const t0 = u.boundsMin.sub(origin).mul(invDir);
      const t1 = u.boundsMax.sub(origin).mul(invDir);
      const tSmaller = min(t0, t1);
      const tBigger = max(t0, t1);

      const tNear = max(max(tSmaller.x, tSmaller.y), tSmaller.z);
      const tFar = min(min(tBigger.x, tBigger.y), tBigger.z);
      const tEntry = max(tNear, float(0));
      const tExit = min(min(tFar, u.maxBeamDistance), rayLength);
      If(tExit.lessThanEqual(tEntry), () => { Return(); });

      const segmentLength = tExit.sub(tEntry);
      const rawSteps = max(int(1), int(ceil(segmentLength.div(max(u.stepSize, float(1e-4))))));
      const raySteps = min(rawSteps, dispatchSteps);
      If(stepIndex.greaterThanEqual(raySteps), () => { Return(); });

      const t = tEntry.add(
        float(stepIndex).add(float(0.5)).div(float(raySteps)).mul(segmentLength)
      );
      const worldPos = origin.add(dir.mul(t));

      const boundsSize = max(u.boundsMax.sub(u.boundsMin), vec3(1e-6));
      const resX = u.resX;
      const resY = u.resY;
      const resZ = u.resZ;
      const resXm1 = max(int(1), resX.sub(int(1)));
      const resYm1 = max(int(1), resY.sub(int(1)));
      const resZm1 = max(int(1), resZ.sub(int(1)));
      const gridPos = worldPos
        .sub(u.boundsMin)
        .div(boundsSize)
        .mul(vec3(float(resXm1), float(resYm1), float(resZm1)));

      If(
        gridPos.x.lessThan(float(-0.5))
          .or(gridPos.x.greaterThan(float(resX).sub(float(0.5))))
          .or(gridPos.y.lessThan(float(-0.5)))
          .or(gridPos.y.greaterThan(float(resY).sub(float(0.5))))
          .or(gridPos.z.lessThan(float(-0.5)))
          .or(gridPos.z.greaterThan(float(resZ).sub(float(0.5)))),
        () => { Return(); }
      );

      const energyPerStep = max(float(0), u.injectionIntensity.div(float(raySteps)));

      If(u.depositionMode.equal(int(0)), () => {
        const ix = int(clamp(round(gridPos.x), float(0), float(resX.sub(int(1)))));
        const iy = int(clamp(round(gridPos.y), float(0), float(resY.sub(int(1)))));
        const iz = int(clamp(round(gridPos.z), float(0), float(resZ.sub(int(1)))));
        const linear = ix.add(resX.mul(iy.add(resY.mul(iz))));
        const nearestFixed = uint(max(float(0), round(energyPerStep.mul(u.atomicScale))));
        If(nearestFixed.greaterThan(uint(0)), () => {
          atomicAdd(this.accum.element(linear), nearestFixed);
        });
      }).Else(() => {
        const x0 = int(clamp(floor(gridPos.x), float(0), float(resX.sub(int(1)))));
        const y0 = int(clamp(floor(gridPos.y), float(0), float(resY.sub(int(1)))));
        const z0 = int(clamp(floor(gridPos.z), float(0), float(resZ.sub(int(1)))));
        const x1 = min(resX.sub(int(1)), x0.add(int(1)));
        const y1 = min(resY.sub(int(1)), y0.add(int(1)));
        const z1 = min(resZ.sub(int(1)), z0.add(int(1)));

        const fx = clamp(gridPos.x.sub(float(x0)), float(0), float(1));
        const fy = clamp(gridPos.y.sub(float(y0)), float(0), float(1));
        const fz = clamp(gridPos.z.sub(float(z0)), float(0), float(1));

        const wx0 = float(1).sub(fx);
        const wy0 = float(1).sub(fy);
        const wz0 = float(1).sub(fz);
        const wx1 = fx;
        const wy1 = fy;
        const wz1 = fz;

        const i000 = x0.add(resX.mul(y0.add(resY.mul(z0))));
        const i100 = x1.add(resX.mul(y0.add(resY.mul(z0))));
        const i010 = x0.add(resX.mul(y1.add(resY.mul(z0))));
        const i110 = x1.add(resX.mul(y1.add(resY.mul(z0))));
        const i001 = x0.add(resX.mul(y0.add(resY.mul(z1))));
        const i101 = x1.add(resX.mul(y0.add(resY.mul(z1))));
        const i011 = x0.add(resX.mul(y1.add(resY.mul(z1))));
        const i111 = x1.add(resX.mul(y1.add(resY.mul(z1))));

        const fixed000 = uint(max(float(0), round(energyPerStep.mul(wx0).mul(wy0).mul(wz0).mul(u.atomicScale))));
        const fixed100 = uint(max(float(0), round(energyPerStep.mul(wx1).mul(wy0).mul(wz0).mul(u.atomicScale))));
        const fixed010 = uint(max(float(0), round(energyPerStep.mul(wx0).mul(wy1).mul(wz0).mul(u.atomicScale))));
        const fixed110 = uint(max(float(0), round(energyPerStep.mul(wx1).mul(wy1).mul(wz0).mul(u.atomicScale))));
        const fixed001 = uint(max(float(0), round(energyPerStep.mul(wx0).mul(wy0).mul(wz1).mul(u.atomicScale))));
        const fixed101 = uint(max(float(0), round(energyPerStep.mul(wx1).mul(wy0).mul(wz1).mul(u.atomicScale))));
        const fixed011 = uint(max(float(0), round(energyPerStep.mul(wx0).mul(wy1).mul(wz1).mul(u.atomicScale))));
        const fixed111 = uint(max(float(0), round(energyPerStep.mul(wx1).mul(wy1).mul(wz1).mul(u.atomicScale))));

        If(fixed000.greaterThan(uint(0)), () => { atomicAdd(this.accum.element(i000), fixed000); });
        If(fixed100.greaterThan(uint(0)), () => { atomicAdd(this.accum.element(i100), fixed100); });
        If(fixed010.greaterThan(uint(0)), () => { atomicAdd(this.accum.element(i010), fixed010); });
        If(fixed110.greaterThan(uint(0)), () => { atomicAdd(this.accum.element(i110), fixed110); });
        If(fixed001.greaterThan(uint(0)), () => { atomicAdd(this.accum.element(i001), fixed001); });
        If(fixed101.greaterThan(uint(0)), () => { atomicAdd(this.accum.element(i101), fixed101); });
        If(fixed011.greaterThan(uint(0)), () => { atomicAdd(this.accum.element(i011), fixed011); });
        If(fixed111.greaterThan(uint(0)), () => { atomicAdd(this.accum.element(i111), fixed111); });
      });
    });

    const resolveFn = Fn(() => {
      const idx = int(instanceIndex);
      If(idx.greaterThanEqual(u.voxelCount), () => { Return(); });

      const previousHistory = this.history.element(idx);
      const injected = float(atomicLoad(this.accum.element(idx))).mul(u.invAtomicScale);
      const base = select(u.clearEachFrame.equal(int(1)), float(0), previousHistory);
      const frameValue = base.add(injected);
      const mixed = float(0).toVar();
      If(u.temporalAccum.equal(int(1)), () => {
        mixed.assign(
          previousHistory
            .mul(u.temporalDecay)
            .mul(float(1).sub(u.temporalBlend))
            .add(frameValue.mul(u.temporalBlend))
        );
      }).Else(() => {
        mixed.assign(frameValue);
      });

      this.history.element(idx).assign(mixed);
      this.volume.element(idx).assign(mixed);

      const resX = u.resX;
      const resY = u.resY;
      const strideY = resX.mul(resY);
      const z = idx.div(strideY);
      const yz = idx.sub(z.mul(strideY));
      const y = yz.div(resX);
      const x = yz.sub(y.mul(resX));

      textureStore(
        this.volumeStorageTexture,
        uvec3(uint(x), uint(y), uint(z)),
        vec4(mixed, float(0), float(0), float(1))
      );
    });

    this.computeClearAccum = clearAccumFn().compute(1);
    this.computeInject = injectFn().compute(1);
    this.computeResolve = resolveFn().compute(1);
    this.computeClearHistory = clearHistoryFn().compute(1);
  }

  _uploadRays(runtime, includeIncident, maxBeamDistance) {
    const reflectedSamples = runtime?.reflectedRaySamples;
    const reflectedCount = runtime?.reflectedRayCount || 0;
    const incidentSamples = runtime?.incidentRaySamples;
    const incidentLengths = runtime?.incidentRayLengths;
    const incidentCount = runtime?.incidentRayCount || 0;

    let cursor = 0;
    const maxDistance = Math.max(0.25, maxBeamDistance);

    if (reflectedSamples && reflectedCount > 0) {
      for (let i = 0; i < reflectedCount; i += 1) {
        const src = i * 6;
        const dst4 = cursor * 4;
        this.scratchRaysA[dst4] = reflectedSamples[src];
        this.scratchRaysA[dst4 + 1] = reflectedSamples[src + 1];
        this.scratchRaysA[dst4 + 2] = reflectedSamples[src + 2];
        this.scratchRaysA[dst4 + 3] = reflectedSamples[src + 3];
        this.scratchRaysB[dst4] = reflectedSamples[src + 4];
        this.scratchRaysB[dst4 + 1] = reflectedSamples[src + 5];
        this.scratchRaysB[dst4 + 2] = maxDistance;
        this.scratchRaysB[dst4 + 3] = 0;
        cursor += 1;
      }
    }

    if (includeIncident && incidentSamples && incidentCount > 0) {
      for (let i = 0; i < incidentCount; i += 1) {
        const src = i * 6;
        const dst4 = cursor * 4;
        this.scratchRaysA[dst4] = incidentSamples[src];
        this.scratchRaysA[dst4 + 1] = incidentSamples[src + 1];
        this.scratchRaysA[dst4 + 2] = incidentSamples[src + 2];
        this.scratchRaysA[dst4 + 3] = incidentSamples[src + 3];
        this.scratchRaysB[dst4] = incidentSamples[src + 4];
        this.scratchRaysB[dst4 + 1] = incidentSamples[src + 5];
        this.scratchRaysB[dst4 + 2] = Math.max(0, incidentLengths?.[i] ?? maxDistance);
        this.scratchRaysB[dst4 + 3] = 0;
        cursor += 1;
      }
    }

    if (this.raysA && this.raysB) {
      this.raysA.value.needsUpdate = true;
      this.raysB.value.needsUpdate = true;
    }

    return cursor;
  }

  inject({ params, opticsState, volumetricState, boundsMin, boundsMax, resolution, stats }) {
    if (this.failed) return false;
    if (!supportsGPUInjection(this.renderer)) return false;
    if (!volumetricState?.volumeTexture) return false;

    const depositionMode = chooseDepositionMode(params, boundsMin, boundsMax, resolution);
    if (depositionMode < 0) return false;

    const includeIncident = !!params.volumetrics.injectIncidentRays;
    const reflectedCount = opticsState?.runtime?.reflectedRayCount || 0;
    const incidentCount = includeIncident ? (opticsState?.runtime?.incidentRayCount || 0) : 0;
    const rayCount = reflectedCount + incidentCount;

    try {
      this._ensureBuffers(rayCount, resolution);
      if (!this.computeInject || !this.computeResolve || !this.computeClearAccum) return false;

      if (volumetricState.gpuResetRequested) {
        this.clearHistoryRequested = true;
        volumetricState.gpuResetRequested = false;
      }

      const maxBeamDistance = Math.max(0.25, params.volumetrics.maxBeamDistance);
      const stepSize = Math.max(0.02, params.volumetrics.beamStepSize);
      const dispatchSteps = Math.max(1, Math.ceil(maxBeamDistance / stepSize));

      const uploadedRayCount = this._uploadRays(opticsState?.runtime, includeIncident, maxBeamDistance);

      const u = this.uniforms;
      u.rayCount.value = uploadedRayCount;
      u.dispatchSteps.value = dispatchSteps;
      u.voxelCount.value = this.voxelCount;
      u.resX.value = resolution.x;
      u.resY.value = resolution.y;
      u.resZ.value = resolution.z;
      u.boundsMin.value.copy(boundsMin);
      u.boundsMax.value.copy(boundsMax);
      u.stepSize.value = stepSize;
      u.maxBeamDistance.value = maxBeamDistance;
      u.injectionIntensity.value = Math.max(0, params.volumetrics.injectionIntensity);
      u.depositionMode.value = depositionMode;
      u.temporalAccum.value = params.volumetrics.temporalAccumulation ? 1 : 0;
      u.temporalDecay.value = Math.max(0, Math.min(0.9999, params.volumetrics.temporalDecay));
      u.temporalBlend.value = Math.max(0, Math.min(1, params.volumetrics.temporalBlend));
      u.clearEachFrame.value = params.volumetrics.clearEachFrame ? 1 : 0;

      this.renderer.initTexture(this.volumeStorageTexture);
      this.renderer.initTexture(volumetricState.volumeTexture);

      const tStart = performance.now();
      let t0 = tStart;
      let t1 = tStart;
      let t2 = tStart;
      let t3 = tStart;
      let t4 = tStart;

      if (this.clearHistoryRequested && this.computeClearHistory) {
        this.renderer.compute(this.computeClearHistory, this.voxelCount);
        this.clearHistoryRequested = false;
      }

      this.renderer.compute(this.computeClearAccum, this.voxelCount);
      t1 = performance.now();
      if (uploadedRayCount > 0) {
        this.renderer.compute(this.computeInject, uploadedRayCount * dispatchSteps);
      }
      t2 = performance.now();
      this.renderer.compute(this.computeResolve, this.voxelCount);
      t3 = performance.now();
      this.copyRegion.max.set(resolution.x, resolution.y, resolution.z);
      this.renderer.copyTextureToTexture(this.volumeStorageTexture, volumetricState.volumeTexture, this.copyRegion);
      t4 = performance.now();

      if (stats) {
        stats.injectionBackend = "WebGPU";
        stats.cpuFallbackActive = false;
        stats.validReflectedRays = reflectedCount;
        stats.injectedRays = uploadedRayCount;
        stats.computeClearMs = formatMs(t1 - t0);
        stats.computeInjectMs = formatMs(t2 - t1);
        stats.computeResolveMs = formatMs(t3 - t2);
        stats.computeCopyMs = formatMs(t4 - t3);
        stats.computeTotalMs = formatMs(t4 - tStart);
      }

      return true;
    } catch (error) {
      this.failed = true;
      if (stats) {
        stats.computeClearMs = "0.00";
        stats.computeInjectMs = "0.00";
        stats.computeResolveMs = "0.00";
        stats.computeCopyMs = "0.00";
        stats.computeTotalMs = "0.00";
      }
      console.warn("[volumetrics] WebGPU beam injection failed; falling back to CPU.", error);
      return false;
    }
  }

  dispose() {
    this._disposeComputeNodes();
    if (this.volumeStorageTexture) this.volumeStorageTexture.dispose();
    this.volumeStorageTexture = null;
    this.raysA = null;
    this.raysB = null;
    this.accum = null;
    this.history = null;
    this.volume = null;
  }
}

function getInjector(renderer) {
  let injector = INJECTOR_BY_RENDERER.get(renderer);
  if (!injector) {
    injector = new WebGPUBeamInjector(renderer);
    INJECTOR_BY_RENDERER.set(renderer, injector);
  }
  return injector;
}

export function injectReflectedBeamsGPU({
  renderer,
  params,
  opticsState,
  volumetricState,
  resolution,
  boundsMin,
  boundsMax,
  stats
}) {
  if (!renderer || !volumetricState || !resolution || !boundsMin || !boundsMax) return false;
  const injector = getInjector(renderer);
  return injector.inject({
    params,
    opticsState,
    volumetricState,
    resolution,
    boundsMin,
    boundsMax,
    stats
  });
}

export function disposeBeamInjectionGPU(renderer) {
  if (!renderer) return;
  const injector = INJECTOR_BY_RENDERER.get(renderer);
  if (!injector) return;
  injector.dispose();
  INJECTOR_BY_RENDERER.delete(renderer);
}
