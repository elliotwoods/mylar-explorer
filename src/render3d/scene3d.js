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
  // Default view from opposite side of the mylar so reflected rays travel toward camera.
  const defaultCameraPose = {
    position: { x: -3.7, y: -2.2, z: -4.2 },
    target: { x: 0, y: -2.8, z: 0 }
  };
  camera.position.set(defaultCameraPose.position.x, defaultCameraPose.position.y, defaultCameraPose.position.z);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(defaultCameraPose.target.x, defaultCameraPose.target.y, defaultCameraPose.target.z);
  controls.enableDamping = true;
  controls.update();

  const ambient = new THREE.HemisphereLight(0xc6d7ff, 0x334055, 0.45);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 0.35);
  key.position.set(4, 4, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  scene.add(key);

  const spotlightTarget = new THREE.Object3D();
  scene.add(spotlightTarget);
  const stageSpot = new THREE.SpotLight(0xffffff, 95, 60, Math.PI * 0.2, 0.35, 1.1);
  stageSpot.castShadow = false;
  stageSpot.target = spotlightTarget;
  scene.add(stageSpot);

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

  function updateStageSpotFromOptics() {
    const source = new THREE.Vector3(params.optics.sourceX, params.optics.sourceY, params.optics.sourceZ);
    const center = new THREE.Vector3(0, -params.geometry.sheetHeight * 0.5, 0);
    spotlightTarget.position.copy(center);
    stageSpot.position.copy(source);

    // Fit cone to cover the rest-state sheet footprint (rough match to ray subsystem Option B).
    const corners = [
      new THREE.Vector3(-params.geometry.sheetWidth * 0.5, 0, 0),
      new THREE.Vector3(params.geometry.sheetWidth * 0.5, 0, 0),
      new THREE.Vector3(-params.geometry.sheetWidth * 0.5, -params.geometry.sheetHeight, 0),
      new THREE.Vector3(params.geometry.sheetWidth * 0.5, -params.geometry.sheetHeight, 0)
    ];
    const centerDir = center.clone().sub(source).normalize();
    let maxAngle = 0.05;
    for (const c of corners) {
      const d = c.clone().sub(source).normalize();
      maxAngle = Math.max(maxAngle, centerDir.angleTo(d));
    }
    stageSpot.angle = Math.min(1.2, Math.max(0.06, maxAngle * 1.08));
    stageSpot.visible = params.optics.enabled;
  }

  function syncState(state) {
    const simSegments = Math.max(2, state.nodes.length - 1);
    const renderMul = Math.max(1, Math.floor(params.display.renderSubdivision || 1));
    const targetSegments = Math.max(simSegments, simSegments * renderMul);
    if (sheet.heightSegments !== targetSegments) {
      scene.remove(sheet.mesh);
      sheet.dispose();
      sheet = createSheetMesh(params, { heightSegments: targetSegments });
      scene.add(sheet.mesh);
      setMaterialIntensity();
    }
    sheet.updateFromState(state);
    rig.updateFromState(state);
    updateStageSpotFromOptics();
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
      const baseSeg = Math.max(2, Math.floor(params.geometry.segments));
      const renderMul = Math.max(1, Math.floor(params.display.renderSubdivision || 1));
      sheet = createSheetMesh(params, { heightSegments: Math.max(baseSeg, baseSeg * renderMul) });
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
      camera.position.set(defaultCameraPose.position.x, defaultCameraPose.position.y, defaultCameraPose.position.z);
      controls.target.set(defaultCameraPose.target.x, defaultCameraPose.target.y, defaultCameraPose.target.z);
      controls.update();
    },
    getCameraPose() {
      return {
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        target: { x: controls.target.x, y: controls.target.y, z: controls.target.z }
      };
    },
    setCameraPose(pose) {
      if (!pose || !pose.position || !pose.target) {
        camera.position.set(defaultCameraPose.position.x, defaultCameraPose.position.y, defaultCameraPose.position.z);
        controls.target.set(defaultCameraPose.target.x, defaultCameraPose.target.y, defaultCameraPose.target.z);
      } else {
        camera.position.set(pose.position.x, pose.position.y, pose.position.z);
        controls.target.set(pose.target.x, pose.target.y, pose.target.z);
      }
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
