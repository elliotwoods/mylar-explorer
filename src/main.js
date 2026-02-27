import { cloneParams } from "./simulation/params.js";
import { SimulationModel } from "./simulation/model.js";
import { create2DRenderer } from "./render2d/render2d.js";
import { create3DScene } from "./render3d/scene3d.js";
import { createControls } from "./ui/controls.js";
import { createPlots } from "./ui/plots.js";

const params = cloneParams();
const model = new SimulationModel(params);

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

const hooks = {
  reset: () => model.reset(),
  singleStep: () => model.singleStep(),
  resetCamera: () => scene3d.resetCamera(),
  startScan: () => model.startFrequencyScan(),
  onMajorReset: () => {
    model.reset();
    scene3d.rebuildRigGeometry();
    scene3d.rebuildSheetGeometry();
  },
  onGeometryChange: () => {
    scene3d.rebuildRigGeometry();
    scene3d.rebuildSheetGeometry();
  },
  onMaterialChange: () => scene3d.updateMaterialParams(),
  onEnvironmentChange: async () => {
    await scene3d.refreshEnvironment();
    scene3d.updateMaterialParams();
  },
  onDisplayChange: () => updateDisplayLayout()
};

createControls(params, hooks);

window.mylarDebug = {
  environment: () => scene3d.getEnvironmentDiagnostics()
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
let accumulator = 0;
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
  const maxSteps = 10;
  if (!params.display.paused) {
    while (accumulator >= fixedDt && steps < maxSteps) {
      model.step(fixedDt);
      accumulator -= fixedDt;
      steps += 1;
    }
    if (steps === maxSteps) accumulator = 0;
  }
  lastStepCount = steps;

  renderer2d.draw(model.state);
  scene3d.update(model.state);
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
