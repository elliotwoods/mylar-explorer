import * as THREE from "three";

export function createVolumeTexture(data, resolution) {
  const texture = new THREE.Data3DTexture(data, resolution.x, resolution.y, resolution.z);
  texture.type = THREE.FloatType;
  texture.format = THREE.RedFormat;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function disposeVolumeTexture(texture) {
  if (texture) texture.dispose();
}

