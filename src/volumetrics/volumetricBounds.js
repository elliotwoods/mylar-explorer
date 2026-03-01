import * as THREE from "three/webgpu";

const _half = new THREE.Vector3();

export function getVolumetricBounds(params, outMin = new THREE.Vector3(), outMax = new THREE.Vector3()) {
  _half.set(
    Math.max(0.1, params.volumetrics.boundsWidth) * 0.5,
    Math.max(0.1, params.volumetrics.boundsHeight) * 0.5,
    Math.max(0.1, params.volumetrics.boundsDepth) * 0.5
  );

  outMin.set(
    params.volumetrics.boundsCenterX - _half.x,
    params.volumetrics.boundsCenterY - _half.y,
    params.volumetrics.boundsCenterZ - _half.z
  );
  outMax.set(
    params.volumetrics.boundsCenterX + _half.x,
    params.volumetrics.boundsCenterY + _half.y,
    params.volumetrics.boundsCenterZ + _half.z
  );
  return { min: outMin, max: outMax };
}

export function getVolumetricResolution(params) {
  return {
    x: Math.max(8, Math.floor(params.volumetrics.resolutionX)),
    y: Math.max(8, Math.floor(params.volumetrics.resolutionY)),
    z: Math.max(8, Math.floor(params.volumetrics.resolutionZ))
  };
}

