import * as THREE from "three";

function makeCylinder(diameter, width, color) {
  const g = new THREE.CylinderGeometry(diameter * 0.5, diameter * 0.5, width, 28);
  g.rotateZ(Math.PI * 0.5);
  const m = new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.35 });
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createRigMeshes(scene, params) {
  const support = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.08, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x7488a3, metalness: 0.3, roughness: 0.6 })
  );
  support.position.set(0, 0.08, 0);
  scene.add(support);

  const topBatten = makeCylinder(params.geometry.topBattenDiameter, params.geometry.sheetWidth, 0xd7b676);
  scene.add(topBatten);
  const bottomBatten = makeCylinder(params.geometry.bottomBattenDiameter, params.geometry.sheetWidth, 0x93d093);
  scene.add(bottomBatten);
  const weight = makeCylinder(params.geometry.lowerWeightDiameter, params.geometry.sheetWidth, 0xe6e2c8);
  scene.add(weight);

  const linkMaterial = new THREE.MeshStandardMaterial({ color: 0xd4b47e, roughness: 0.45, metalness: 0.5 });
  const linkA = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 12), linkMaterial);
  const linkB = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 12), linkMaterial);
  scene.add(linkA, linkB);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.MeshStandardMaterial({ color: 0x1f2430, roughness: 0.9, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI * 0.5;
  floor.position.y = -6.4;
  floor.receiveShadow = true;
  scene.add(floor);

  function updateLink(mesh, ax, ay, az, bx, by, bz) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1e-6;
    mesh.scale.set(1, len, 1);
    mesh.position.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
  }

  return {
    materials: [topBatten.material, bottomBatten.material, weight.material, linkMaterial],
    meshes: [support, topBatten, bottomBatten, weight, linkA, linkB, floor],
    updateFromState(state) {
      const top = state.nodes[0];
      const bottom = state.nodes[state.nodes.length - 1];
      const w = state.lowerWeight;

      topBatten.position.set(0, -top.y, top.x);
      bottomBatten.position.set(0, -bottom.y, bottom.x);
      weight.position.set(0, -w.y, w.x);

      const halfW = params.geometry.sheetWidth * 0.5;
      updateLink(linkA, -halfW, -bottom.y, bottom.x, -halfW, -w.y, w.x);
      updateLink(linkB, halfW, -bottom.y, bottom.x, halfW, -w.y, w.x);
    },
    rebuildGeometry() {
      topBatten.geometry.dispose();
      topBatten.geometry = new THREE.CylinderGeometry(
        params.geometry.topBattenDiameter * 0.5,
        params.geometry.topBattenDiameter * 0.5,
        params.geometry.sheetWidth,
        28
      );
      topBatten.geometry.rotateZ(Math.PI * 0.5);

      bottomBatten.geometry.dispose();
      bottomBatten.geometry = new THREE.CylinderGeometry(
        params.geometry.bottomBattenDiameter * 0.5,
        params.geometry.bottomBattenDiameter * 0.5,
        params.geometry.sheetWidth,
        28
      );
      bottomBatten.geometry.rotateZ(Math.PI * 0.5);

      weight.geometry.dispose();
      weight.geometry = new THREE.CylinderGeometry(
        params.geometry.lowerWeightDiameter * 0.5,
        params.geometry.lowerWeightDiameter * 0.5,
        params.geometry.sheetWidth,
        28
      );
      weight.geometry.rotateZ(Math.PI * 0.5);
    },
    setVisible(visible) {
      support.visible = visible;
      topBatten.visible = visible;
      bottomBatten.visible = visible;
      weight.visible = visible;
      linkA.visible = visible;
      linkB.visible = visible;
      floor.visible = visible;
    }
  };
}
