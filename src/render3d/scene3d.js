import * as THREE from "three/webgpu";
import { pass, texture, float, vec4, mix, uniform } from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createSheetMesh } from "./sheetMesh.js";
import { createRigMeshes } from "./rigMeshes.js";
import { createPersonActor } from "./personActor.js";
import { setupEnvironment } from "./environment.js";
import { createSpotlightRays } from "./spotlightRays.js";
import { createVolumetricDebug } from "./volumetricDebug.js";
import { injectReflectedBeamsGPU, disposeBeamInjectionGPU } from "../volumetrics/beamInjectionGPU.js";
import { getVolumetricBounds } from "../volumetrics/volumetricBounds.js";
import {
  createVolumetricState,
  disposeVolumetricState,
  ensureVolumetricBuffers,
  resetVolumetricHistory
} from "../volumetrics/volumetricState.js";
import { VolumetricRenderer } from "../volumetrics/volumetricPass.js";
import { RasterizedVolumetricRenderer } from "../volumetrics/rasterizedVolumetrics.js";

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

function detectHDRSupport() {
  if (typeof navigator === "undefined" || !navigator.gpu) return false;
  if (typeof matchMedia === "function") {
    return matchMedia("(dynamic-range: high)").matches;
  }
  return false;
}

async function createRendererPipeline(canvas, params, scene, camera, volumetricState) {
  const hdrDisplay = params.display.hdrOutputEnabled && detectHDRSupport();

  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    ...(hdrDisplay ? { outputType: THREE.HalfFloatType } : {})
  });
  await renderer.init();

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  _backgroundColor.set(params.display.backgroundColor ?? "#101720");
  _backgroundColor.multiplyScalar(Math.max(0, Math.min(1, params.display.backgroundIntensity ?? 1)));
  renderer.setClearColor(_backgroundColor);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  if (hdrDisplay) {
    console.log("[render] HDR display detected — using extended-range output");
  }
  console.log("[render] WebGPU renderer initialized");

  const env = setupEnvironment(renderer, scene, params);
  const raymarchedRenderer = new VolumetricRenderer(camera, params, volumetricState);
  const rasterizedRenderer = new RasterizedVolumetricRenderer(camera, params);

  // Compositing uniforms controlling how scene and volumetric mix
  const uShowScene = uniform(1.0);
  const uShowVolumetric = uniform(1.0);
  const uCompositeOpacity = uniform(0.75);

  const postProcessing = new THREE.PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode("output");
  // Start with the raymarched texture; .value is swapped at render-time
  // when the active mode changes.
  const volumetricTexNode = texture(raymarchedRenderer.texture);

  const composited = sceneColor.mul(uShowScene).add(
    volumetricTexNode.mul(uCompositeOpacity).mul(uShowVolumetric)
  );
  postProcessing.outputNode = composited;

  return {
    renderer,
    env,
    raymarchedRenderer,
    rasterizedRenderer,
    volumetricTexNode,
    postProcessing,
    uShowScene,
    uShowVolumetric,
    uCompositeOpacity,
    hdrActive: hdrDisplay,
    dispose() {
      env.dispose();
      raymarchedRenderer.dispose();
      rasterizedRenderer.dispose();
      renderer.dispose();
    }
  };
}

export async function create3DScene(canvas, params) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 80);
  const defaultCameraPose = {
    position: { x: -12.973421089882091, y: -3.8598089797104045, z: -14.437106376675164 },
    target: { x: -0.5832840573753933, y: -2.7802966359892887, z: -3.549007859284771 }
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

  const spotlight = createSpotlightRays(scene, params);

  const volumetricState = createVolumetricState(params);
  const volumetricDebug = createVolumetricDebug(scene);

  // --- Renderer pipeline (mutable — recreated when HDR setting changes) ---
  const pipe = await createRendererPipeline(canvas, params, scene, camera, volumetricState);

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
      pipe.renderer.toneMapping = getToneMappingConstant(mode);
      pipe.renderer.toneMappingExposure = exposure;
      toneMappingState.mode = mode;
      toneMappingState.exposure = exposure;
    }
    if (
      backgroundColor !== toneMappingState.backgroundColor ||
      backgroundIntensity !== toneMappingState.backgroundIntensity
    ) {
      _backgroundColor.set(backgroundColor);
      _backgroundColor.multiplyScalar(backgroundIntensity);
      pipe.renderer.setClearColor(_backgroundColor);
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
    pipe.renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    const pw = w * pipe.renderer.getPixelRatio();
    const ph = h * pipe.renderer.getPixelRatio();
    pipe.raymarchedRenderer.setSize(pw, ph);
    pipe.rasterizedRenderer.setSize(pw, ph);
  }

  function updateStageSpotFromOptics() {
    const source = new THREE.Vector3(params.optics.sourceX, params.optics.sourceY, params.optics.sourceZ);
    const center = new THREE.Vector3(0, -params.geometry.sheetHeight * 0.5, 0);
    spotlightTarget.position.copy(center);
    stageSpot.position.copy(source);

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
    const needsVolumetric =
      params.volumetrics.enabled &&
      !reflectedOnly &&
      !sceneOnly;

    sheet.mesh.visible = !reflectedOnly;
    rig.setVisible(!reflectedOnly);
    stageSpot.visible = params.optics.enabled && !reflectedOnly;
    spotlight.setDebugMode(reflectedOnly ? "reflected-only" : hideRayDebug ? "hidden" : "default");

    // Control compositing via uniforms (avoids node graph recompilation)
    if (params.volumetrics.debugRenderMode === "volumetric-only") {
      pipe.uShowScene.value = 0;
      pipe.uShowVolumetric.value = 1;
    } else if (sceneOnly || reflectedOnly) {
      pipe.uShowScene.value = 1;
      pipe.uShowVolumetric.value = 0;
    } else {
      pipe.uShowScene.value = 1;
      pipe.uShowVolumetric.value = needsVolumetric ? 1 : 0;
    }
  }

  function updatePrimaryLightDirection() {
    _source.set(params.optics.sourceX, params.optics.sourceY, params.optics.sourceZ);
    _volumeCenter.copy(volumetricState.boundsMin).add(volumetricState.boundsMax).multiplyScalar(0.5);
    _primaryLightDir.subVectors(_volumeCenter, _source);
    if (_primaryLightDir.lengthSq() < 1e-8) _primaryLightDir.set(0, -0.4, 1);
    _primaryLightDir.normalize();
    pipe.raymarchedRenderer.uniforms.primaryLightDir.value.copy(_primaryLightDir);
  }

  function updateVolumetrics(opticsState, frameDt) {
    const isRasterized = params.volumetrics.volumetricMode === "rasterized";
    const stats = volumetricState.stats;
    stats.enabled = !!params.volumetrics.enabled;
    stats.averageHitFraction = `${(opticsState?.runtime?.hitFraction ?? 0).toFixed(1)}%`;
    stats.raymarchSteps = isRasterized ? "n/a" : Math.max(1, Math.floor(params.volumetrics.raymarchStepCount));
    stats.frameMs = `${(Math.max(0, frameDt) * 1000).toFixed(1)}`;
    stats.fps = `${(1 / Math.max(1e-4, frameDt)).toFixed(1)}`;
    stats.webgl2Ready = !!pipe.renderer?.backend?.isWebGPUBackend;

    const resized = ensureVolumetricBuffers(volumetricState, params);
    if (resized) {
      resetVolumetricHistory(volumetricState);
    }

    getVolumetricBounds(params, volumetricState.boundsMin, volumetricState.boundsMax);
    stats.volumeResolution = isRasterized
      ? "rasterized"
      : `${volumetricState.resolution.x}x${volumetricState.resolution.y}x${volumetricState.resolution.z}`;

    volumetricDebug.updateBounds(volumetricState.boundsMin, volumetricState.boundsMax, params.volumetrics.showBounds);

    if (!params.volumetrics.enabled) {
      stats.injectionBackend = "Disabled";
      stats.cpuFallbackActive = false;
      stats.validReflectedRays = 0;
      stats.injectedRays = 0;
      stats.pairCountReflected = 0;
      stats.pairCountIncident = 0;
      stats.pairCountInjected = 0;
      stats.computeClearMs = "0.00";
      stats.computeInjectMs = "0.00";
      stats.computeResolveMs = "0.00";
      stats.computeCopyMs = "0.00";
      stats.computeTotalMs = "0.00";
      volumetricDebug.updateSlice(params, volumetricState.boundsMin, volumetricState.boundsMax, null);
      return;
    }

    // Rasterized mode skips beam injection and 3D texture entirely
    if (!isRasterized) {
      const usedGpuInjection = injectReflectedBeamsGPU({
        renderer: pipe.renderer,
        params,
        opticsState,
        volumetricState,
        resolution: volumetricState.resolution,
        boundsMin: volumetricState.boundsMin,
        boundsMax: volumetricState.boundsMax,
        stats
      });
      if (!usedGpuInjection) {
        stats.injectionBackend = "WebGPU (unavailable)";
        stats.cpuFallbackActive = false;
        stats.validReflectedRays = opticsState?.runtime?.reflectedRayCount ?? 0;
        stats.injectedRays = 0;
        stats.pairCountReflected = 0;
        stats.pairCountIncident = 0;
        stats.pairCountInjected = 0;
      }

      volumetricState.frameIndex += 1;
      updatePrimaryLightDirection();
    } else {
      // For rasterized, still report reflected ray count for diagnostics
      stats.injectionBackend = "Rasterized";
      stats.cpuFallbackActive = false;
      stats.validReflectedRays = opticsState?.runtime?.reflectedRayCount ?? 0;
      stats.injectedRays = stats.validReflectedRays;
      stats.pairCountReflected = 0;
      stats.pairCountIncident = 0;
      stats.pairCountInjected = 0;
      stats.computeClearMs = "n/a";
      stats.computeInjectMs = "n/a";
      stats.computeResolveMs = "n/a";
      stats.computeCopyMs = "n/a";
      stats.computeTotalMs = "n/a";
    }

    volumetricDebug.updateSlice(
      params,
      volumetricState.boundsMin,
      volumetricState.boundsMax,
      isRasterized ? null : volumetricState.volumeTexture
    );
  }

  function update(state, opticsState, frameInfo = {}) {
    if (state) syncState(state);
    if (opticsState) spotlight.updateFromState(opticsState);
    person.syncFromParams();
    updateToneMapping();
    updateRenderMode();
    updateVolumetrics(opticsState, frameInfo.frameDt ?? 1 / 60);

    pipe.uCompositeOpacity.value = Math.max(0, params.volumetrics.compositeOpacity);

    // Update controls first so camera matrices are current for both
    // the volumetric render and the scene pass.
    controls.update();
    camera.updateMatrixWorld();

    // Render volumetric to its reduced-res target (before PostProcessing)
    const isRasterized = params.volumetrics.volumetricMode === "rasterized";
    if (pipe.uShowVolumetric.value > 0 && params.volumetrics.enabled) {
      if (isRasterized) {
        pipe.volumetricTexNode.value = pipe.rasterizedRenderer.texture;
        pipe.rasterizedRenderer.render(pipe.renderer, opticsState, scene);
      } else if (volumetricState.volumeTexture) {
        pipe.volumetricTexNode.value = pipe.raymarchedRenderer.texture;
        pipe.raymarchedRenderer.render(pipe.renderer);
      }
    }

    pipe.postProcessing.render();
  }

  return {
    resize,
    syncState,
    update,
    async refreshEnvironment() {
      await pipe.env.refresh();
      setMaterialIntensity();
    },
    getEnvironmentDiagnostics() {
      return pipe.env.getDiagnostics();
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
      spotlight.dispose();
      sheet.dispose();
      person.dispose();
      volumetricDebug.dispose();
      disposeBeamInjectionGPU(pipe.renderer);
      disposeVolumetricState(volumetricState);
      pipe.dispose();
    }
  };
}
