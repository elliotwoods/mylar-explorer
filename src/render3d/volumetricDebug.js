import * as THREE from "three";

function axisToInt(axis) {
  if (axis === "xy") return 0;
  if (axis === "yz") return 2;
  return 1; // xz
}

function makeSliceMaterial() {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uVolumeTexture: { value: null },
      uAxis: { value: 1 },
      uSlice: { value: 0.5 },
      uOpacity: { value: 0.85 }
    },
    vertexShader: /* glsl */ `
      out vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp sampler3D;
      in vec2 vUv;
      out vec4 outColor;

      uniform sampler3D uVolumeTexture;
      uniform int uAxis;
      uniform float uSlice;
      uniform float uOpacity;

      void main() {
        vec3 uvw = vec3(vUv.x, uSlice, vUv.y);
        if (uAxis == 0) uvw = vec3(vUv.x, vUv.y, uSlice);
        else if (uAxis == 2) uvw = vec3(uSlice, vUv.x, vUv.y);

        float e = texture(uVolumeTexture, clamp(uvw, 0.0, 1.0)).r;
        vec3 c = vec3(e * 4.0, e * 1.8, e * 0.65);
        float a = clamp(e * uOpacity * 2.0, 0.0, 0.95);
        outColor = vec4(c, a);
      }
    `
  });
}

export function createVolumetricDebug(scene) {
  const box = new THREE.Box3();
  const boundsHelper = new THREE.Box3Helper(box, 0x66d7ff);
  boundsHelper.visible = false;
  scene.add(boundsHelper);

  const sliceMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), makeSliceMaterial());
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

    const uniforms = sliceMesh.material.uniforms;
    uniforms.uVolumeTexture.value = volumeTexture;
    uniforms.uAxis.value = axisToInt(axis);
    uniforms.uSlice.value = slicePosition;
    uniforms.uOpacity.value = opacity;
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
