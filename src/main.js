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
import { logOpticsState } from "./render3d/spotlightDebug.js";

const params = cloneParams();
const model = new SimulationModel(params);
const opticsState = createOpticsState();
runOpticsMathSelfTest();

const canvas2d = document.getElementById("view2d");
const canvas3d = document.getElementById("view3d");
const plotsCanvas = document.getElementById("plotsCanvas");
const layout = document.getElementById("layout");
const fpsLabel = document.getElementById("fpsLabel");
const stepLabel = document.getElementById("stepLabel");

const renderer2d = create2DRenderer(canvas2d, params);
const plots = createPlots(plotsCanvas, params);

const startupT0 = performance.now();
const scene3d = create3DScene(canvas3d, params);
rebuildRestBeam(params, opticsState);

const opticsStats = {
  totalRays: 0,
  hitCount: 0,
  missCount: 0,
  hitFraction: "0.0%"
};

function syncOpticsStats() {
  opticsStats.totalRays = opticsState.runtime.totalRays;
  opticsStats.hitCount = opticsState.runtime.hitCount;
  opticsStats.missCount = opticsState.runtime.missCount;
  opticsStats.hitFraction = `${opticsState.runtime.hitFraction.toFixed(1)}%`;
}

function rebuildBeam() {
  rebuildRestBeam(params, opticsState);
  scene3d.syncState(model.state);
  updateOptics(params, opticsState, scene3d.getSheetMesh());
  syncOpticsStats();
}

let accumulator = 0;
function hardResetSimulation() {
  model.reset();
  scene3d.rebuildRigGeometry();
  scene3d.rebuildSheetGeometry();
  rebuildBeam();
  accumulator = 0;
}

const hooks = {
  reset: () => hardResetSimulation(),
  singleStep: () => {
    model.singleStep();
    scene3d.syncState(model.state);
    updateOptics(params, opticsState, scene3d.getSheetMesh());
    syncOpticsStats();
  },
  resetCamera: () => scene3d.resetCamera(),
  startScan: () => model.startFrequencyScan(),
  onMajorReset: () => {
    hardResetSimulation();
  },
  onGeometryChange: () => {
    hardResetSimulation();
  },
  onMaterialChange: () => scene3d.updateMaterialParams(),
  onOpticsRebuild: () => rebuildBeam(),
  onEnvironmentChange: async () => {
    await scene3d.refreshEnvironment();
    scene3d.updateMaterialParams();
  },
  onDisplayChange: () => updateDisplayLayout(),
  rebuildBeam,
  logOptics: () => logOpticsState(opticsState),
  opticsStats
};

createControls(params, hooks);

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
  accumulator += frameDt;

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
  updateOptics(params, opticsState, scene3d.getSheetMesh());
  syncOpticsStats();

  renderer2d.draw(model.state, opticsState);
  scene3d.update(null, opticsState);
  scene3d.updateOpticsStyle();
  if (params.display.showGraphs) plots.draw(model.state);

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
