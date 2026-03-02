import { cloneParams } from "./simulation/params.js";
import { SimulationModel } from "./simulation/model.js";
import { createOpticsState } from "./simulation/opticsState.js";
import { rebuildRestBeam } from "./simulation/opticsSetup.js";
import { updateOptics } from "./simulation/opticsUpdate.js";
import { runOpticsMathSelfTest } from "./simulation/opticsMath.js";
import { create2DRenderer } from "./render2d/render2d.js";
import { create3DScene } from "./render3d/scene3d.js";
import { createControls } from "./ui/controls.js";
import { createPlots } from "./ui/plots.js";
import { createSweepPanel } from "./ui/sweepPanel.js";
import { logOpticsState } from "./render3d/spotlightDebug.js";
import { createToolbar } from "./ui/toolbar.js";
import { normalizePresetBundle } from "./ui/presetBundle.js";
import appDefaultsBundleJson from "../app-defaults.json";

const params = cloneParams();
const model = new SimulationModel(params);
const opticsState = createOpticsState();
runOpticsMathSelfTest();

const canvas2d = document.getElementById("view2d");
const canvas3d = document.getElementById("view3d");
const plotsCanvas = document.getElementById("plotsCanvas");
const toolbarEl = document.getElementById("toolbar");
const widgetsLeftEl = document.getElementById("widgetsLeft");
const widgetsRightEl = document.getElementById("widgetsRight");
const btnPause = document.getElementById("btnPause");
const btnReset = document.getElementById("btnReset");
const btnStep = document.getElementById("btnStep");
const btnHalf = document.getElementById("btnHalf");
const btn1x = document.getElementById("btn1x");
const btnDouble = document.getElementById("btnDouble");
const layout = document.getElementById("layout");
const fpsLabel = document.getElementById("fpsLabel");
const stepLabel = document.getElementById("stepLabel");

const renderer2d = create2DRenderer(canvas2d, params);
const plots = createPlots(plotsCanvas, params);

const startupT0 = performance.now();

// create3DScene is async (WebGPU init). Wrap all dependent code in an async IIFE.
(async () => {
const appDefaultsBundle = normalizePresetBundle(appDefaultsBundleJson);
const scene3d = await create3DScene(canvas3d, params);
rebuildRestBeam(params, opticsState);

const opticsStats = {
  totalRays: 0,
  hitCount: 0,
  missCount: 0,
  hitFraction: "0.0%"
};

function opticsOptions(extra = {}) {
  if (params.volumetrics.volumetricMode === "rasterized") extra.forceFullTrace = true;
  return extra;
}

function syncOpticsStats() {
  opticsStats.totalRays = opticsState.runtime.totalRays;
  opticsStats.hitCount = opticsState.runtime.hitCount;
  opticsStats.missCount = opticsState.runtime.missCount;
  opticsStats.hitFraction = `${opticsState.runtime.hitFraction.toFixed(1)}%`;
}

function rebuildBeam() {
  rebuildRestBeam(params, opticsState);
  scene3d.syncState(model.state);
  updateOptics(params, opticsState, scene3d.getSheetMesh(), opticsOptions({ force: true }));
  syncOpticsStats();
}

let accumulator = 0;
const manualMouse = {
  hasPrev: false,
  prevX: 0,
  lastMotionMs: performance.now(),
  wasEnabled: false
};
let manualDriveUiDirty = false;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function onManualPointerMove(event) {
  if (!params.drive.manualOverrideEnabled) {
    manualMouse.prevX = event.clientX;
    manualMouse.hasPrev = true;
    return;
  }
  if (!manualMouse.hasPrev) {
    manualMouse.prevX = event.clientX;
    manualMouse.hasPrev = true;
    return;
  }

  const dx = event.clientX - manualMouse.prevX;
  manualMouse.prevX = event.clientX;
  if (Math.abs(dx) < 1e-6) return;

  // Quarter-window normalization: moving by 1/4 width corresponds to ~30 degrees change.
  const normWidth = Math.max(120, window.innerWidth * 0.25);
  const deltaDeg = (dx / normWidth) * 30;
  const next = clamp(params.drive.manualOverrideDeg + deltaDeg, -30, 30);
  if (Math.abs(next - params.drive.manualOverrideDeg) > 1e-6) {
    params.drive.manualOverrideDeg = next;
    manualDriveUiDirty = true;
  }
  manualMouse.lastMotionMs = performance.now();
}

window.addEventListener("pointermove", onManualPointerMove);

function updateManualOverrideDecay(frameDt, nowMs) {
  const enabled = !!params.drive.manualOverrideEnabled;
  if (enabled && !manualMouse.wasEnabled) {
    manualMouse.wasEnabled = true;
    manualMouse.hasPrev = false;
    manualMouse.lastMotionMs = nowMs;
  } else if (!enabled && manualMouse.wasEnabled) {
    manualMouse.wasEnabled = false;
    manualMouse.hasPrev = false;
    manualDriveUiDirty = true;
    return;
  }
  if (!enabled) return;

  const idleSeconds = (nowMs - manualMouse.lastMotionMs) / 1000;
  if (idleSeconds <= frameDt * 1.5) return;

  const returnTime = Math.max(0.05, params.drive.manualDecaySeconds || 5);
  // Exponential return reaching ~2% of previous value after ~returnTime seconds.
  const decay = Math.exp((-4 * frameDt) / returnTime);
  const prev = params.drive.manualOverrideDeg;
  params.drive.manualOverrideDeg *= decay;
  if (Math.abs(params.drive.manualOverrideDeg) < 1e-4) params.drive.manualOverrideDeg = 0;
  if (Math.abs(params.drive.manualOverrideDeg - prev) > 1e-6) manualDriveUiDirty = true;
}

function hardResetSimulation() {
  model.reset();
  scene3d.rebuildRigGeometry();
  scene3d.rebuildSheetGeometry();
  rebuildBeam();
  accumulator = 0;
}

function updatePauseButtonLabel() {
  btnPause.textContent = params.display.paused ? "Play" : "Pause";
}

function setSpeed(value) {
  params.display.simSpeed = Math.max(0.0625, Math.min(16, value));
  controls.refresh();
}

const hooks = {
  reset: () => hardResetSimulation(),
  singleStep: () => {
    model.singleStep();
    scene3d.syncState(model.state);
    updateOptics(params, opticsState, scene3d.getSheetMesh(), opticsOptions());
    syncOpticsStats();
  },
  resetCamera: () => scene3d.resetCamera(),
  startScan: () => startSweep(),
  stopScan: () => stopSweep(),
  onMajorReset: () => {
    hardResetSimulation();
  },
  onGeometryChange: () => {
    hardResetSimulation();
  },
  onMaterialChange: () => scene3d.updateMaterialParams(),
  onRenderGeometryChange: () => {
    scene3d.rebuildSheetGeometry();
    scene3d.syncState(model.state);
  },
  onOpticsRebuild: () => rebuildBeam(),
  onEnvironmentChange: async () => {
    await scene3d.refreshEnvironment();
    scene3d.updateMaterialParams();
  },
  onDisplayChange: () => updateDisplayLayout(),
  onHdrOutputChange: () => {
    // Save full state and reload — WebGPU renderer canvas format can't change at runtime
    toolbar.saveLastSession();
    location.reload();
  },
  onVolumetricConfigChange: () => scene3d.invalidateVolumetrics(),
  rebuildBeam,
  logOptics: () => logOpticsState(opticsState),
  opticsStats,
  volumetricStats: scene3d.getVolumetricStats()
};

const controls = createControls(params, hooks, { left: widgetsLeftEl, right: widgetsRightEl });
const sweepPanel = createSweepPanel(widgetsRightEl);

let savedRightPanelState = null;
let savedFrequency = null;

function startSweep() {
  savedFrequency = params.drive.frequencyHz;
  savedRightPanelState = controls.collapseRightPanels();
  sweepPanel.show({
    onCancel: () => stopSweep(),
    onDismiss: () => dismissSweep()
  });
  model.startFrequencyScan();
}

function stopSweep() {
  model.stopFrequencyScan();
  // Let the panel show cancelled state; user clicks Done to dismiss
}

function dismissSweep() {
  sweepPanel.hide();
  model.state.scan.phase = "idle";
  if (savedRightPanelState) {
    controls.restoreRightPanels(savedRightPanelState);
    savedRightPanelState = null;
  }
  if (savedFrequency != null) {
    params.drive.frequencyHz = savedFrequency;
    savedFrequency = null;
  }
  controls.refresh();
}

function applyParamSnapshot(snapshot) {
  if (!snapshot) return;
  const displaySnapshot = snapshot.display ? { ...snapshot.display } : null;
  const opticsSnapshot = snapshot.optics ? { ...snapshot.optics } : null;
  if (opticsSnapshot?.floorY != null && (displaySnapshot?.floorY == null)) {
    displaySnapshot.floorY = opticsSnapshot.floorY;
  }
  if (opticsSnapshot) delete opticsSnapshot.floorY;

  if (snapshot.geometry) Object.assign(params.geometry, snapshot.geometry);
  if (snapshot.drive) Object.assign(params.drive, snapshot.drive);
  if (snapshot.physics) Object.assign(params.physics, snapshot.physics);
  if (displaySnapshot) Object.assign(params.display, displaySnapshot);
  if (snapshot.scan) Object.assign(params.scan, snapshot.scan);
  if (opticsSnapshot) Object.assign(params.optics, opticsSnapshot);
  if (snapshot.volumetrics) Object.assign(params.volumetrics, snapshot.volumetrics);

  hardResetSimulation();
  scene3d.updateMaterialParams();
  scene3d.updateOpticsStyle();
  void scene3d.refreshEnvironment();
  updateDisplayLayout();
}

const toolbar = createToolbar({
  mount: toolbarEl,
  getSnapshot: () => ({
    geometry: structuredClone(params.geometry),
    drive: structuredClone(params.drive),
    physics: structuredClone(params.physics),
    display: structuredClone(params.display),
    scan: structuredClone(params.scan),
    optics: (() => {
      const optics = structuredClone(params.optics);
      delete optics.floorY;
      return optics;
    })(),
    volumetrics: structuredClone(params.volumetrics),
    cameraPose: scene3d.getCameraPose()
  }),
  applySnapshot: (snapshot) => {
    applyParamSnapshot(snapshot);
    if (snapshot.cameraPose) scene3d.setCameraPose(snapshot.cameraPose);
  },
  getCameraPose: () => scene3d.getCameraPose(),
  setCameraPose: (pose) => scene3d.setCameraPose(pose),
  refreshGui: () => controls.refresh(),
  appDefaultsBundle
});

btnPause.addEventListener("click", () => {
  params.display.paused = !params.display.paused;
  updatePauseButtonLabel();
  controls.refresh();
});
btnReset.addEventListener("click", () => hardResetSimulation());
btnStep.addEventListener("click", () => {
  hooks.singleStep();
  controls.refresh();
});
btnHalf.addEventListener("click", () => setSpeed(params.display.simSpeed * 0.5));
btn1x.addEventListener("click", () => setSpeed(1));
btnDouble.addEventListener("click", () => setSpeed(params.display.simSpeed * 2));
updatePauseButtonLabel();

window.mylarDebug = {
  environment: () => scene3d.getEnvironmentDiagnostics(),
  optics: () => logOpticsState(opticsState)
};

function updateDisplayLayout() {
  layout.className = params.display.viewMode;
  plots.setVisible();
}

function resizeAll() {
  renderer2d.resize();
  scene3d.resize();
  plots.resize();
}
window.addEventListener("resize", resizeAll);
updateDisplayLayout();
resizeAll();

let lastTime = performance.now();
let fpsFrames = 0;
let fpsClock = 0;
let lastStepCount = 0;

function frame(now) {
  if (!frame._didLogStartup) {
    frame._didLogStartup = true;
    console.log(`[startup] first frame in ${(performance.now() - startupT0).toFixed(1)} ms`);
    setTimeout(() => {
      console.log("[startup] environment diagnostics", scene3d.getEnvironmentDiagnostics());
    }, 2500);
  }
  const frameDt = Math.min(0.08, (now - lastTime) / 1000);
  lastTime = now;
  updateManualOverrideDecay(frameDt, now);
  if (manualDriveUiDirty) {
    controls.refresh();
    manualDriveUiDirty = false;
  }
  accumulator += frameDt * params.display.simSpeed;
  updatePauseButtonLabel();

  const fixedDt = params.physics.fixedDt;
  let steps = 0;
  const maxSteps = Math.max(1, Math.min(30, Math.floor(params.physics.maxSubStepsPerFrame || 10)));
  if (!params.display.paused) {
    while (accumulator >= fixedDt && steps < maxSteps) {
      model.step(fixedDt);
      accumulator -= fixedDt;
      steps += 1;
    }
    if (steps === maxSteps) accumulator = 0;
  }
  lastStepCount = steps;

  scene3d.syncState(model.state);
  updateOptics(params, opticsState, scene3d.getSheetMesh(), opticsOptions());
  syncOpticsStats();

  renderer2d.draw(model.state, opticsState);
  scene3d.update(null, opticsState, { frameDt });
  scene3d.updateOpticsStyle();
  if (params.display.showGraphs) plots.draw(model.state);

  // Update sweep panel
  const scan = model.state.scan;
  if (scan.running || scan.phase === "complete" || scan.phase === "cancelled") {
    sweepPanel.update(scan, params);
    controls.refresh();
  }

  fpsFrames += 1;
  fpsClock += frameDt;
  if (fpsClock >= 0.4) {
    const fps = fpsFrames / fpsClock;
    fpsLabel.textContent = `FPS: ${fps.toFixed(1)}`;
    stepLabel.textContent = `Sim: ${(lastStepCount / Math.max(frameDt, 1e-4)).toFixed(0)} Hz`;
    fpsFrames = 0;
    fpsClock = 0;
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
})();
