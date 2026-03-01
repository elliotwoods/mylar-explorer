import * as THREE from "three/webgpu";
import {
  Fn, If,
  uniform, float, int, vec3, vec4,
  uv, texture3D, clamp
} from "three/tsl";

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

function axisToInt(axis) {
  if (axis === "xy") return 0;
  if (axis === "yz") return 2;
  return 1; // xz
}

function makeSliceMaterial() {
  const uAxis = uniform(1);
  const uSlice = uniform(0.5);
  const uOpacity = uniform(0.85);
  const placeholder = createPlaceholder3DTexture();

  // Capture the texture3D node created inside Fn so we can update its .value later
  let volumeTexNode = null;

  const sliceColorFn = Fn(() => {
    const _uv = uv();

    // Default: xz (axis=1) -> uvw = (u, slice, v)
    const uvw = vec3(_uv.x, uSlice, _uv.y).toVar();

    // axis=0 (xy) -> uvw = (u, v, slice)
    If(uAxis.equal(int(0)), () => {
      uvw.assign(vec3(_uv.x, _uv.y, uSlice));
    });

    // axis=2 (yz) -> uvw = (slice, u, v)
    If(uAxis.equal(int(2)), () => {
      uvw.assign(vec3(uSlice, _uv.x, _uv.y));
    });

    const sampleNode = texture3D(placeholder, clamp(uvw, float(0.0), float(1.0)));
    volumeTexNode = sampleNode;
    const e = sampleNode.r;

    const c = vec3(e.mul(4.0), e.mul(1.8), e.mul(0.65));
    const a = clamp(e.mul(uOpacity).mul(2.0), float(0.0), float(0.95));
    return vec4(c, a);
  });

  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.blending = THREE.AdditiveBlending;
  material.fragmentNode = sliceColorFn();

  return { material, uAxis, uSlice, uOpacity, volumeTexNode: { get node() { return volumeTexNode; } } };
}

export function createVolumetricDebug(scene) {
  const box = new THREE.Box3();
  const boundsHelper = new THREE.Box3Helper(box, 0x66d7ff);
  boundsHelper.visible = false;
  scene.add(boundsHelper);

  const sliceState = makeSliceMaterial();
  const sliceMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sliceState.material);
  sliceMesh.visible = false;
  scene.add(sliceMesh);

  function updateBounds(boundsMin, boundsMax, visible) {
    box.min.copy(boundsMin);
    box.max.copy(boundsMax);
    boundsHelper.visible = !!visible;
    boundsHelper.updateMatrixWorld(true);
  }

  function updateSlice(params, boundsMin, boundsMax, volumeTexture) {
    const show = !!params.volumetrics.showSlice && !!volumeTexture;
    sliceMesh.visible = show;
    if (!show) return;

    const axis = params.volumetrics.sliceAxis;
    const slicePosition = Math.max(0, Math.min(1, params.volumetrics.slicePosition));
    const opacity = Math.max(0, Math.min(1, params.volumetrics.sliceOpacity));

    const sizeX = boundsMax.x - boundsMin.x;
    const sizeY = boundsMax.y - boundsMin.y;
    const sizeZ = boundsMax.z - boundsMin.z;
    const centerX = (boundsMin.x + boundsMax.x) * 0.5;
    const centerY = (boundsMin.y + boundsMax.y) * 0.5;
    const centerZ = (boundsMin.z + boundsMax.z) * 0.5;

    sliceMesh.rotation.set(0, 0, 0);
    if (axis === "xy") {
      sliceMesh.scale.set(sizeX, sizeY, 1);
      sliceMesh.position.set(centerX, centerY, boundsMin.z + sizeZ * slicePosition);
    } else if (axis === "yz") {
      sliceMesh.scale.set(sizeZ, sizeY, 1);
      sliceMesh.position.set(boundsMin.x + sizeX * slicePosition, centerY, centerZ);
      sliceMesh.rotation.y = Math.PI * 0.5;
    } else {
      sliceMesh.scale.set(sizeX, sizeZ, 1);
      sliceMesh.position.set(centerX, boundsMin.y + sizeY * slicePosition, centerZ);
      sliceMesh.rotation.x = -Math.PI * 0.5;
    }

    const texNode = sliceState.volumeTexNode.node;
    if (texNode && volumeTexture) {
      texNode.value = volumeTexture;
    }
    sliceState.uAxis.value = axisToInt(axis);
    sliceState.uSlice.value = slicePosition;
    sliceState.uOpacity.value = opacity;
  }

  function dispose() {
    scene.remove(boundsHelper);
    scene.remove(sliceMesh);
    boundsHelper.geometry.dispose();
    boundsHelper.material.dispose();
    sliceMesh.geometry.dispose();
    sliceMesh.material.dispose();
  }

  return {
    updateBounds,
    updateSlice,
    dispose
  };
}
