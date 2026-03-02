import * as THREE from "three/webgpu";
import { getVolumetricResolution } from "./volumetricBounds.js";
import { createVolumeTexture, disposeVolumeTexture } from "./volumeTextures.js";

function makeStats() {
  return {
    enabled: true,
    webgl2Ready: true,
    injectionBackend: "CPU",
    cpuFallbackActive: true,
    validReflectedRays: 0,
    injectedRays: 0,
    averageHitFraction: "0.0%",
    volumeResolution: "120x68x48",
    computeClearMs: "0.00",
    computeInjectMs: "0.00",
    computeResolveMs: "0.00",
    computeCopyMs: "0.00",
    computeTotalMs: "0.00",
    raymarchSteps: 0,
    frameMs: "0.0",
    fps: "0.0"
  };
}

export function createVolumetricState(params) {
  const resolution = getVolumetricResolution(params);
  const voxelCount = resolution.x * resolution.y * resolution.z;
  const volumeData = new Float32Array(voxelCount);
  const historyData = new Float32Array(voxelCount);
  const volumeTexture = createVolumeTexture(volumeData, resolution);

  return {
    resolution,
    volumeData,
    historyData,
    volumeTexture,
    gpuResetRequested: true,
    frameIndex: 0,
    boundsMin: new THREE.Vector3(),
    boundsMax: new THREE.Vector3(),
    stats: makeStats()
  };
}

export function ensureVolumetricBuffers(state, params) {
  const nextResolution = getVolumetricResolution(params);
  if (
    nextResolution.x === state.resolution.x &&
    nextResolution.y === state.resolution.y &&
    nextResolution.z === state.resolution.z
  ) {
    return false;
  }

  const voxelCount = nextResolution.x * nextResolution.y * nextResolution.z;
  state.resolution = nextResolution;
  state.volumeData = new Float32Array(voxelCount);
  state.historyData = new Float32Array(voxelCount);
  disposeVolumeTexture(state.volumeTexture);
  state.volumeTexture = createVolumeTexture(state.volumeData, nextResolution);
  state.gpuResetRequested = true;
  return true;
}

export function resetVolumetricHistory(state) {
  state.volumeData.fill(0);
  state.historyData.fill(0);
  state.gpuResetRequested = true;
  if (state.volumeTexture) {
    state.volumeTexture.dispose();
    state.volumeTexture.needsUpdate = true;
  }
}

export function disposeVolumetricState(state) {
  disposeVolumeTexture(state.volumeTexture);
}
