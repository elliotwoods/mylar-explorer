import * as THREE from "three";

export function createSheetMesh(params) {
  const geom = new THREE.PlaneGeometry(
    params.geometry.sheetWidth,
    params.geometry.sheetHeight,
    12,
    params.geometry.segments
  );
  geom.rotateY(Math.PI);
  geom.translate(0, -params.geometry.sheetHeight * 0.5, 0);

  const material = new THREE.MeshStandardMaterial({
    color: 0xc8d2e0,
    metalness: params.display.metalness,
    roughness: params.display.roughness,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geom, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return {
    mesh,
    material,
    updateFromState(state) {
      const pos = geom.attributes.position;
      const rows = params.geometry.segments + 1;
      const cols = 13;
      for (let iy = 0; iy < rows; iy += 1) {
        const node = state.nodes[iy];
        for (let ix = 0; ix < cols; ix += 1) {
          const idx = iy * cols + ix;
          pos.setY(idx, -node.y);
          pos.setZ(idx, node.x);
        }
      }
      pos.needsUpdate = true;
      geom.computeVertexNormals();
    },
    updateMaterial() {
      material.roughness = params.display.roughness;
      material.metalness = params.display.metalness;
      material.envMapIntensity = params.display.envIntensity;
      material.needsUpdate = true;
    },
    dispose() {
      geom.dispose();
      material.dispose();
    }
  };
}
