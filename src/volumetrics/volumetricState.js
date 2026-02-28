import * as THREE from "three";
import { getVolumetricResolution } from "./volumetricBounds.js";
import { createVolumeTexture, disposeVolumeTexture } from "./volumeTextures.js";

function makeStats() {
  return {
    enabled: true,
    webgl2Ready: true,
    validReflectedRays: 0,
    injectedRays: 0,
    averageHitFraction: "0.0%",
    volumeResolution: "120x68x48",
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
  return true;
}

export function resetVolumetricHistory(state) {
  state.volumeData.fill(0);
  state.historyData.fill(0);
  if (state.volumeTexture) state.volumeTexture.needsUpdate = true;
}

export function disposeVolumetricState(state) {
  disposeVolumeTexture(state.volumeTexture);
}

