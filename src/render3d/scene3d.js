import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createSheetMesh } from "./sheetMesh.js";
import { createRigMeshes } from "./rigMeshes.js";
import { setupEnvironment } from "./environment.js";
import { createSpotlightRays } from "./spotlightRays.js";

export function create3DScene(canvas, params) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x101720);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 80);
  camera.position.set(3.7, -2.2, 4.2);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, -2.8, 0);
  controls.enableDamping = true;
  controls.update();

  const ambient = new THREE.HemisphereLight(0xc6d7ff, 0x334055, 0.45);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(4, 4, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  scene.add(key);

  let sheet = createSheetMesh(params);
  const rig = createRigMeshes(scene, params);
  scene.add(sheet.mesh);

  const env = setupEnvironment(renderer, scene, params);
  const spotlight = createSpotlightRays(scene, params);

  function setMaterialIntensity() {
    sheet.updateMaterial();
    for (const mat of rig.materials) {
      mat.envMapIntensity = params.display.envIntensity;
      mat.needsUpdate = true;
    }
  }
  setMaterialIntensity();

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  function syncState(state) {
    sheet.updateFromState(state);
    rig.updateFromState(state);
  }

  function update(state, opticsState) {
    if (state) syncState(state);
    if (opticsState) spotlight.updateFromState(opticsState);
    controls.update();
    renderer.render(scene, camera);
  }

  return {
    resize,
    syncState,
    update,
    async refreshEnvironment() {
      await env.refresh();
      setMaterialIntensity();
    },
    getEnvironmentDiagnostics() {
      return env.getDiagnostics();
    },
    updateMaterialParams() {
      setMaterialIntensity();
    },
    rebuildRigGeometry() {
      rig.rebuildGeometry();
    },
    rebuildSheetGeometry() {
      scene.remove(sheet.mesh);
      sheet.dispose();
      sheet = createSheetMesh(params);
      scene.add(sheet.mesh);
      setMaterialIntensity();
    },
    getSheetMesh() {
      return sheet.mesh;
    },
    updateOpticsStyle() {
      spotlight.updateMaterials();
      spotlight.updateVisibility();
    },
    resetCamera() {
      camera.position.set(3.7, -2.2, 4.2);
      controls.target.set(0, -2.8, 0);
      controls.update();
    },
    dispose() {
      env.dispose();
      spotlight.dispose();
      sheet.dispose();
      renderer.dispose();
    }
  };
}
