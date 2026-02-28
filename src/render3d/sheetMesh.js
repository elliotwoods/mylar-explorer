import * as THREE from "three";

export function createSheetMesh(params, options = {}) {
  const widthSegments = 24;
  const heightSegments = Math.max(2, Math.floor(options.heightSegments ?? params.geometry.segments));
  const cols = widthSegments + 1;
  const geom = new THREE.PlaneGeometry(
    params.geometry.sheetWidth,
    params.geometry.sheetHeight,
    widthSegments,
    heightSegments
  );
  geom.rotateY(Math.PI);
  geom.translate(0, -params.geometry.sheetHeight * 0.5, 0);

  const material = new THREE.MeshStandardMaterial({
    color: 0xc8d2e0,
    metalness: params.display.metalness,
    roughness: params.display.roughness,
    side: THREE.DoubleSide,
    flatShading: false
  });
  const mesh = new THREE.Mesh(geom, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.sheetCols = cols;
  mesh.userData.sheetRows = heightSegments + 1;

  return {
    mesh,
    material,
    heightSegments,
    updateFromState(state) {
      if (!state?.nodes?.length) return;
      const pos = geom.attributes.position;
      const rows = Math.floor(pos.count / cols);
      const simRows = state.nodes.length;
      if (simRows < 2) return;

      const last = simRows - 1;
      for (let iy = 0; iy < rows; iy += 1) {
        const t = (iy / Math.max(1, rows - 1)) * last;
        const i0 = Math.floor(t);
        const i1 = Math.min(last, i0 + 1);
        const a = t - i0;
        const n0 = state.nodes[i0];
        const n1 = state.nodes[i1];
        const x = n0.x + (n1.x - n0.x) * a;
        const y = n0.y + (n1.y - n0.y) * a;
        for (let ix = 0; ix < cols; ix += 1) {
          const idx = iy * cols + ix;
          pos.setY(idx, -y);
          pos.setZ(idx, x);
        }
      }
      pos.needsUpdate = true;
      geom.computeVertexNormals();
    },
    updateMaterial() {
      material.roughness = params.display.roughness;
      material.metalness = params.display.metalness;
      material.envMapIntensity = params.display.envIntensity;
      material.wireframe = !!params.display.wireframeView;
      material.needsUpdate = true;
    },
    dispose() {
      geom.dispose();
      material.dispose();
    }
  };
}
