import GUI from "lil-gui";
import { createOpticsControls } from "./opticsControls.js";

export function createControls(params, hooks) {
  const gui = new GUI({ title: "Simulation Controls", width: 350 });

  const sim = gui.addFolder("Simulation");
  sim.add(params.display, "paused").name("pause");
  sim.add(hooks, "reset").name("reset simulation");
  sim.add(hooks, "singleStep").name("single-step");

  const geom = gui.addFolder("Geometry / Masses");
  geom.add(params.geometry, "sheetHeight", 2, 10, 0.1).onFinishChange(hooks.onMajorReset);
  geom.add(params.geometry, "sheetWidth", 0.2, 2.5, 0.01).onFinishChange(hooks.onGeometryChange);
  geom.add(params.geometry, "sheetMassTotal", 0.2, 8, 0.01).onFinishChange(hooks.onMajorReset);
  geom.add(params.geometry, "segments", 20, 100, 1).onFinishChange(hooks.onMajorReset);
  geom.add(params.geometry, "topBattenMass", 0.5, 15, 0.1).onFinishChange(hooks.onMajorReset);
  geom.add(params.geometry, "topBattenDiameter", 0.01, 0.2, 0.005).onFinishChange(hooks.onGeometryChange);
  geom.add(params.geometry, "bottomBattenMass", 0.5, 15, 0.1).onFinishChange(hooks.onMajorReset);
  geom.add(params.geometry, "bottomBattenDiameter", 0.01, 0.2, 0.005).onFinishChange(hooks.onGeometryChange);
  geom.add(params.geometry, "lowerWeightMass", 0.1, 30, 0.1).onFinishChange(hooks.onMajorReset);
  geom.add(params.geometry, "lowerWeightDiameter", 0.02, 0.4, 0.005).onFinishChange(hooks.onGeometryChange);
  geom.add(params.geometry, "linkageLength", 0.05, 1, 0.01).onFinishChange(hooks.onMajorReset);

  const drive = gui.addFolder("Drive");
  drive.add(params.drive, "enabled");
  drive.add(params.drive, "amplitudeDeg", 0, 25, 0.1);
  drive.add(params.drive, "frequencyHz", 0.05, 4, 0.01);
  drive.add(params.drive, "phaseDeg", -180, 180, 1);
  drive.add(params.drive, "startupRampDuration", 0, 8, 0.1);
  drive.add(params.drive, "jerkyEnabled").name("jerky mode");
  drive.add(params.drive, "jerkiness", 0, 1, 0.01);
  drive.add(params.drive, "jerkHarmonic", 2, 10, 1);

  const phys = gui.addFolder("Physics");
  phys.add(params.physics, "gravity", 0, 20, 0.01);
  phys.add(params.physics, "internalDamping", 0, 0.25, 0.001);
  phys.add(params.physics, "dragEnabled");
  phys.add(params.physics, "dragMode", ["linear", "quadratic"]);
  phys.add(params.physics, "sheetDragCoefficient", 0, 4, 0.01);
  phys.add(params.physics, "battenDragCoefficient", 0, 4, 0.01);
  phys.add(params.physics, "lowerWeightDragCoefficient", 0, 4, 0.01);
  phys.add(params.physics, "rideUpEnabled");
  phys.add(params.physics, "rideUpCoefficient", 0, 2, 0.01);
  phys.add(params.physics, "solverIterations", 2, 60, 1);
  phys.add(params.physics, "fixedDt", 1 / 1000, 1 / 60, 1 / 1000);
  phys.add(params.physics, "maxSubStepsPerFrame", 1, 30, 1);

  const display = gui.addFolder("Display");
  display.add(params.display, "showTrails");
  display.add(params.display, "showVectors");
  display.add(params.display, "showGraphs").onChange(hooks.onDisplayChange);
  display.add(params.display, "showNodeMarkers");
  display.add(params.display, "viewMode", ["split", "view2d", "view3d"]).onChange(hooks.onDisplayChange);
  display.add(hooks, "resetCamera").name("camera reset");
  display.add(params.display, "envIntensity", 0, 3, 0.01).onChange(hooks.onMaterialChange);
  display.add(params.display, "roughness", 0, 1, 0.01).onChange(hooks.onMaterialChange);
  display.add(params.display, "metalness", 0, 1, 0.01).onChange(hooks.onMaterialChange);
  display.add(params.display, "hdriEnabled").onChange(hooks.onEnvironmentChange);
  display.add(params.display, "fallbackEnvironmentEnabled").onChange(hooks.onEnvironmentChange);

  const scan = gui.addFolder("Frequency response scan");
  scan.add(params.scan, "fMin", 0.05, 3, 0.05);
  scan.add(params.scan, "fMax", 0.2, 5, 0.05);
  scan.add(params.scan, "settleSeconds", 0, 10, 0.5);
  scan.add(params.scan, "dwellSeconds", 1, 15, 0.5);
  scan.add(hooks, "startScan").name("sweep + log");

  createOpticsControls(gui, params, hooks, hooks.opticsStats);

  return {
    gui,
    refresh() {
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    }
  };
}
