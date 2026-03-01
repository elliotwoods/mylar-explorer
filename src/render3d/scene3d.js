import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createSheetMesh } from "./sheetMesh.js";
import { createRigMeshes } from "./rigMeshes.js";
import { createPersonActor } from "./personActor.js";
import { setupEnvironment } from "./environment.js";
import { createSpotlightRays } from "./spotlightRays.js";
import { createVolumetricDebug } from "./volumetricDebug.js";
import { injectReflectedBeamsGPU } from "../volumetrics/beamInjectionGPU.js";
import { injectReflectedBeamsCPU } from "../volumetrics/beamInjectionCPU.js";
import { getVolumetricBounds } from "../volumetrics/volumetricBounds.js";
import {
  createVolumetricState,
  disposeVolumetricState,
  ensureVolumetricBuffers,
  resetVolumetricHistory
} from "../volumetrics/volumetricState.js";
import { applyTemporalAccumulation } from "../volumetrics/temporalAccumulation.js";
import { VolumetricPass } from "../volumetrics/volumetricPass.js";

const _source = new THREE.Vector3();
const _volumeCenter = new THREE.Vector3();
const _primaryLightDir = new THREE.Vector3(0, -0.4, 1).normalize();
const _backgroundColor = new THREE.Color();

function getToneMappingConstant(mode) {
  switch (mode) {
    case "aces":
      return THREE.ACESFilmicToneMapping;
    case "agx":
      return THREE.AgXToneMapping;
    case "neutral":
      return THREE.NeutralToneMapping;
    case "reinhard":
      return THREE.ReinhardToneMapping;
    case "cineon":
      return THREE.CineonToneMapping;
    case "linear":
      return THREE.LinearToneMapping;
    case "none":
    default:
      return THREE.NoToneMapping;
  }
}

export function create3DScene(canvas, params) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  _backgroundColor.set(params.display.backgroundColor ?? "#101720");
  _backgroundColor.multiplyScalar(Math.max(0, Math.min(1, params.display.backgroundIntensity ?? 1)));
  renderer.setClearColor(_backgroundColor);
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
  const person = createPersonActor(scene, params, { floorY: -6.4 });
  scene.add(sheet.mesh);

  const env = setupEnvironment(renderer, scene, params);
  const spotlight = createSpotlightRays(scene, params);

  const webgl2Ready = renderer.capabilities.isWebGL2;
  if (!webgl2Ready) {
    console.warn("[volumetrics] WebGL2 unavailable. Volumetric pass disabled.");
  }

  const volumetricState = createVolumetricState(params);
  volumetricState.stats.webgl2Ready = webgl2Ready;
  const volumetricDebug = createVolumetricDebug(scene);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const volumetricPass = new VolumetricPass(camera, params, volumetricState);
  volumetricPass.enabled = webgl2Ready;
  composer.addPass(volumetricPass);
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  const toneMappingState = {
    mode: null,
    exposure: null,
    backgroundColor: null,
    backgroundIntensity: null
  };

  function updateToneMapping() {
    const mode = params.display.toneMappingMode || "aces";
    const exposure = Math.max(0.01, params.display.toneMappingExposure ?? 1);
    const backgroundColor = params.display.backgroundColor ?? "#101720";
    const backgroundIntensity = Math.max(0, Math.min(1, params.display.backgroundIntensity ?? 1));
    if (mode !== toneMappingState.mode || exposure !== toneMappingState.exposure) {
      renderer.toneMapping = getToneMappingConstant(mode);
      renderer.toneMappingExposure = exposure;
      toneMappingState.mode = mode;
      toneMappingState.exposure = exposure;
    }
    if (
      backgroundColor !== toneMappingState.backgroundColor ||
      backgroundIntensity !== toneMappingState.backgroundIntensity
    ) {
      _backgroundColor.set(backgroundColor);
      _backgroundColor.multiplyScalar(backgroundIntensity);
      renderer.setClearColor(_backgroundColor);
      toneMappingState.backgroundColor = backgroundColor;
      toneMappingState.backgroundIntensity = backgroundIntensity;
    }
  }

  updateToneMapping();

  function setMaterialIntensity() {
    sheet.updateMaterial();
    for (const mat of rig.materials) {
      mat.envMapIntensity = params.display.envIntensity;
      mat.needsUpdate = true;
    }
    person.updateMaterials();
  }
  setMaterialIntensity();

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
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
    person.syncFromParams();
    updateStageSpotFromOptics();
  }

  function updateRenderMode() {
    const reflectedOnly = params.volumetrics.debugRenderMode === "reflected-rays-only";
    const sceneOnly = params.volumetrics.debugRenderMode === "scene-only";
    const hideRayDebug = params.volumetrics.enabled && !params.volumetrics.showRays;
    const needsVolumetricPass =
      webgl2Ready &&
      params.volumetrics.enabled &&
      !reflectedOnly &&
      !sceneOnly;

    sheet.mesh.visible = !reflectedOnly;
    rig.setVisible(!reflectedOnly);
    stageSpot.visible = params.optics.enabled && !reflectedOnly;
    spotlight.setDebugMode(reflectedOnly ? "reflected-only" : hideRayDebug ? "hidden" : "default");
    volumetricPass.enabled = needsVolumetricPass;
  }

  function updatePrimaryLightDirection() {
    _source.set(params.optics.sourceX, params.optics.sourceY, params.optics.sourceZ);
    _volumeCenter.copy(volumetricState.boundsMin).add(volumetricState.boundsMax).multiplyScalar(0.5);
    _primaryLightDir.subVectors(_volumeCenter, _source);
    if (_primaryLightDir.lengthSq() < 1e-8) _primaryLightDir.set(0, -0.4, 1);
    _primaryLightDir.normalize();
    volumetricPass.raymarchMaterial.uniforms.uPrimaryLightDir.value.copy(_primaryLightDir);
  }

  function updateVolumetrics(opticsState, frameDt) {
    const stats = volumetricState.stats;
    stats.enabled = !!params.volumetrics.enabled;
    stats.webgl2Ready = webgl2Ready;
    stats.averageHitFraction = `${(opticsState?.runtime?.hitFraction ?? 0).toFixed(1)}%`;
    stats.raymarchSteps = Math.max(1, Math.floor(params.volumetrics.raymarchStepCount));
    stats.frameMs = `${(Math.max(0, frameDt) * 1000).toFixed(1)}`;
    stats.fps = `${(1 / Math.max(1e-4, frameDt)).toFixed(1)}`;

    const resized = ensureVolumetricBuffers(volumetricState, params);
    if (resized) {
      resetVolumetricHistory(volumetricState);
    }

    getVolumetricBounds(params, volumetricState.boundsMin, volumetricState.boundsMax);
    stats.volumeResolution = `${volumetricState.resolution.x}x${volumetricState.resolution.y}x${volumetricState.resolution.z}`;

    volumetricDebug.updateBounds(volumetricState.boundsMin, volumetricState.boundsMax, params.volumetrics.showBounds);

    if (!webgl2Ready || !params.volumetrics.enabled) {
      stats.validReflectedRays = 0;
      stats.injectedRays = 0;
      volumetricDebug.updateSlice(params, volumetricState.boundsMin, volumetricState.boundsMax, null);
      return;
    }

    if (!params.volumetrics.clearEachFrame && !params.volumetrics.temporalAccumulation) {
      const decay = Math.max(0, Math.min(0.9999, params.volumetrics.temporalDecay));
      for (let i = 0; i < volumetricState.volumeData.length; i += 1) {
        volumetricState.volumeData[i] *= decay;
      }
    }

    const usedGpuInjection = injectReflectedBeamsGPU({
      params,
      opticsState,
      volumeData: volumetricState.volumeData,
      resolution: volumetricState.resolution,
      boundsMin: volumetricState.boundsMin,
      boundsMax: volumetricState.boundsMax,
      stats
    });
    if (!usedGpuInjection) {
      injectReflectedBeamsCPU({
        params,
        opticsState,
        volumeData: volumetricState.volumeData,
        resolution: volumetricState.resolution,
        boundsMin: volumetricState.boundsMin,
        boundsMax: volumetricState.boundsMax,
        stats
      });
    }

    applyTemporalAccumulation(volumetricState.volumeData, volumetricState.historyData, params);
    volumetricState.volumeTexture.needsUpdate = true;
    volumetricState.frameIndex += 1;

    updatePrimaryLightDirection();
    volumetricDebug.updateSlice(
      params,
      volumetricState.boundsMin,
      volumetricState.boundsMax,
      volumetricState.volumeTexture
    );
  }

  function update(state, opticsState, frameInfo = {}) {
    if (state) syncState(state);
    if (opticsState) spotlight.updateFromState(opticsState);
    person.syncFromParams();
    updateToneMapping();
    updateRenderMode();
    updateVolumetrics(opticsState, frameInfo.frameDt ?? 1 / 60);
    controls.update();
    composer.render();
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
      updateRenderMode();
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
    invalidateVolumetrics() {
      resetVolumetricHistory(volumetricState);
    },
    getVolumetricStats() {
      return volumetricState.stats;
    },
    dispose() {
      env.dispose();
      spotlight.dispose();
      sheet.dispose();
      person.dispose();
      volumetricDebug.dispose();
      disposeVolumetricState(volumetricState);
      volumetricPass.dispose();
      composer.dispose();
      renderer.dispose();
    }
  };
}
