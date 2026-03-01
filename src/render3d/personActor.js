import * as THREE from "three";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";

const DEG2RAD = Math.PI / 180;

export function createPersonActor(scene, params, options = {}) {
  const floorY = options.floorY ?? -6.4;
  const group = new THREE.Group();
  group.name = "person-actor";
  scene.add(group);

  const loader = new ColladaLoader();
  const box = new THREE.Box3();
  const last = {
    visible: null,
    x: null,
    z: null,
    yawDeg: null,
    scale: null,
    floorOffsetY: null
  };

  let root = null;
  let loadFailed = false;

  function applyShadowFlags(object3d) {
    object3d.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      const mat = obj.material;
      if (mat && "envMapIntensity" in mat && mat.envMapIntensity != null) {
        mat.envMapIntensity = params.display.envIntensity;
      }
    });
  }

  function stripSceneNodes(object3d) {
    const toRemove = [];
    object3d.traverse((obj) => {
      // Imported DAE files can contain their own lights/cameras that override stage look.
      if (obj.isLight || obj.isCamera) toRemove.push(obj);
    });
    for (const node of toRemove) {
      if (node.parent) node.parent.remove(node);
    }
  }

  function syncFromParams(force = false) {
    if (!root) return;

    const visible = !!params.display.personVisible;
    const x = params.display.personX;
    const z = params.display.personZ;
    const yawDeg = params.display.personYawDeg;
    const scale = Math.max(0.001, params.display.personScale);
    const floorOffsetY = params.display.personFloorOffsetY;

    if (
      !force &&
      visible === last.visible &&
      x === last.x &&
      z === last.z &&
      yawDeg === last.yawDeg &&
      scale === last.scale &&
      floorOffsetY === last.floorOffsetY
    ) {
      return;
    }

    root.scale.setScalar(scale);
    group.rotation.set(0, yawDeg * DEG2RAD, 0);
    group.position.set(x, 0, z);
    group.updateMatrixWorld(true);

    box.setFromObject(root);
    if (Number.isFinite(box.min.y) && Number.isFinite(box.max.y)) {
      const targetFloorY = floorY + floorOffsetY;
      const deltaY = targetFloorY - box.min.y;
      group.position.y += deltaY;
    }

    group.visible = visible;

    last.visible = visible;
    last.x = x;
    last.z = z;
    last.yawDeg = yawDeg;
    last.scale = scale;
    last.floorOffsetY = floorOffsetY;
  }

  const daeUrl = new URL("../../assets/one person correct scale.dae", import.meta.url).href;
  loader
    .loadAsync(daeUrl)
    .then((collada) => {
      root = collada.scene;
      stripSceneNodes(root);
      applyShadowFlags(root);
      group.add(root);
      syncFromParams(true);
    })
    .catch((err) => {
      loadFailed = true;
      console.warn("[person] failed to load Collada person asset", err);
    });

  function updateMaterials() {
    if (!root) return;
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      if ("envMapIntensity" in obj.material && obj.material.envMapIntensity != null) {
        obj.material.envMapIntensity = params.display.envIntensity;
      }
      obj.material.needsUpdate = true;
    });
  }

  return {
    syncFromParams,
    updateMaterials,
    isLoaded() {
      return !!root;
    },
    hasFailed() {
      return loadFailed;
    },
    dispose() {
      scene.remove(group);
      if (!root) return;
      root.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            for (const m of obj.material) m.dispose();
          } else {
            obj.material.dispose();
          }
        }
      });
    }
  };
}
