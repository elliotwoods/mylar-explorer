import GUI from "lil-gui";
import { createOpticsControls } from "./opticsControls.js";

function withIcon(text, iconClass) {
  return iconClass ? `<i class="fa-solid ${iconClass}"></i> ${text}` : text;
}

function iconizeFolder(folder, iconClass) {
  const titleEl = folder.domElement.querySelector(".title");
  if (titleEl && iconClass) titleEl.innerHTML = withIcon(titleEl.textContent, iconClass);
  return folder;
}

function iconizeController(controller, iconClass) {
  const nameEl = controller.domElement.querySelector(".name");
  if (nameEl && iconClass) nameEl.innerHTML = withIcon(nameEl.textContent, iconClass);
  return controller;
}

function add(folder, obj, key, label, hint, min, max, step, iconClass) {
  const c = min == null ? folder.add(obj, key) : folder.add(obj, key, min, max, step);
  c.name(label);
  c.domElement.title = hint;
  iconizeController(c, iconClass);
  return c;
}

export function createControls(params, hooks, mounts) {
  const leftGui = new GUI({ title: "Simulation & Mechanics", container: mounts.left, width: 360 });
  const rightGui = new GUI({ title: "Optics & View", container: mounts.right, width: 360 });

  const sim = iconizeFolder(leftGui.addFolder("Simulation"), "fa-play");
  add(sim, params.display, "paused", "Pause", "Pause/resume simulation stepping.", null, null, null, "fa-pause");
  const resetBtn = sim.add(hooks, "reset").name("Reset Simulation");
  resetBtn.domElement.title = "Reset all dynamic state and rebuild geometry/beam.";
  iconizeController(resetBtn, "fa-rotate-left");
  const stepBtn = sim.add(hooks, "singleStep").name("Single Step");
  stepBtn.domElement.title = "Advance simulation by one fixed timestep.";
  iconizeController(stepBtn, "fa-forward-step");

  const geom = iconizeFolder(leftGui.addFolder("Geometry & Masses"), "fa-ruler-combined");
  add(geom, params.geometry, "sheetHeight", "Sheet Height (m)", "Vertical sheet length.", 2, 10, 0.1, "fa-arrow-up-long").onFinishChange(hooks.onMajorReset);
  add(geom, params.geometry, "sheetWidth", "Sheet Width (m)", "Sheet width used for optics/drag/3D strip.", 0.2, 2.5, 0.01, "fa-arrows-left-right").onFinishChange(hooks.onGeometryChange);
  add(geom, params.geometry, "sheetMassTotal", "Sheet Total Mass (kg)", "Total mass distributed along sheet nodes.", 0.2, 8, 0.01, "fa-weight-hanging").onFinishChange(hooks.onMajorReset);
  add(geom, params.geometry, "segments", "Segment Count", "Number of chain segments along sheet height.", 20, 400, 1, "fa-grip-lines").onFinishChange(hooks.onMajorReset);
  add(geom, params.geometry, "topBattenMass", "Top Batten Mass (kg)", "Mass lumped at upper sheet node.", 0.5, 15, 0.1).onFinishChange(hooks.onMajorReset);
  add(geom, params.geometry, "topBattenDiameter", "Top Batten Diameter (m)", "Visual/drag diameter of top batten.", 0.01, 0.2, 0.005).onFinishChange(hooks.onGeometryChange);
  add(geom, params.geometry, "bottomBattenMass", "Bottom Batten Mass (kg)", "Mass lumped at lower sheet node.", 0.5, 15, 0.1).onFinishChange(hooks.onMajorReset);
  add(geom, params.geometry, "bottomBattenDiameter", "Bottom Batten Diameter (m)", "Visual/drag diameter and ride-up radius.", 0.01, 0.2, 0.005).onFinishChange(hooks.onGeometryChange);
  add(geom, params.geometry, "lowerWeightMass", "Lower Weight Mass (kg)", "Driven lower assembly equivalent mass.", 0.1, 30, 0.1).onFinishChange(hooks.onMajorReset);
  add(geom, params.geometry, "lowerWeightDiameter", "Lower Weight Diameter (m)", "Visual/drag diameter of lower weight.", 0.02, 0.4, 0.005).onFinishChange(hooks.onGeometryChange);
  add(geom, params.geometry, "linkageLength", "Linkage Length (m)", "Hinge-to-weight offset length.", 0.05, 1, 0.01).onFinishChange(hooks.onMajorReset);

  const drive = iconizeFolder(leftGui.addFolder("Drive"), "fa-gear");
  add(drive, params.drive, "enabled", "Drive Enabled", "Enable/disable motor drive.", null, null, null, "fa-toggle-on");
  add(drive, params.drive, "amplitudeDeg", "Amplitude (deg)", "Drive angle amplitude.", 0, 25, 0.1);
  add(drive, params.drive, "frequencyHz", "Frequency (Hz)", "Drive frequency.", 0.05, 4, 0.01, "fa-wave-square");
  add(drive, params.drive, "phaseDeg", "Phase (deg)", "Drive phase offset.", -180, 180, 1);
  add(drive, params.drive, "startupRampDuration", "Startup Ramp (s)", "Smoothly ramps drive at startup.", 0, 8, 0.1);
  add(drive, params.drive, "jerkyEnabled", "Jerky Mode", "Injects sharper nonsinusoidal motion.", null, null, null, "fa-bolt");
  add(drive, params.drive, "jerkiness", "Jerkiness", "Higher values create sharper motion transitions.", 0, 1, 0.01);
  add(drive, params.drive, "jerkHarmonic", "Jerky Harmonic", "Harmonic used for jerky waveform shaping.", 2, 10, 1);

  const phys = iconizeFolder(leftGui.addFolder("Physics"), "fa-atom");
  add(phys, params.physics, "gravity", "Gravity (m/s²)", "Gravity acceleration.", 0, 20, 0.01, "fa-arrow-down");
  add(phys, params.physics, "internalDamping", "Internal Damping", "Velocity-proportional internal damping.", 0, 0.25, 0.001);
  add(phys, params.physics, "dragEnabled", "Air Drag Enabled", "Enable/disable aerodynamic drag.", null, null, null, "fa-wind");
  add(phys, params.physics, "dragMode", "Drag Mode", "Linear is stable; quadratic is more realistic.");
  add(phys, params.physics, "sheetDragCoefficient", "Sheet Drag Coefficient", "Drag scaling for sheet nodes.", 0, 4, 0.01);
  add(phys, params.physics, "battenDragCoefficient", "Batten Drag Coefficient", "Drag scaling for batten nodes.", 0, 4, 0.01);
  add(phys, params.physics, "lowerWeightDragCoefficient", "Lower Weight Drag Coefficient", "Drag scaling for lower weight.", 0, 4, 0.01);
  add(phys, params.physics, "rideUpEnabled", "Ride-up Enabled", "Enable geometric ride-up approximation.");
  add(phys, params.physics, "rideUpCoefficient", "Ride-up Coefficient", "Strength of ride-up effect.", 0, 2, 0.01);
  add(phys, params.physics, "solverIterations", "Solver Iterations", "Constraint solver iteration count.", 2, 60, 1);
  add(phys, params.physics, "fixedDt", "Fixed Timestep (s)", "Simulation substep size.", 1 / 1000, 1 / 60, 1 / 1000);
  add(phys, params.physics, "maxSubStepsPerFrame", "Max Substeps / Frame", "Caps steps per frame to avoid stalls.", 1, 30, 1);

  const scan = iconizeFolder(leftGui.addFolder("Frequency Response Scan"), "fa-chart-line");
  add(scan, params.scan, "fMin", "Min Frequency (Hz)", "Scan start frequency.", 0.05, 3, 0.05);
  add(scan, params.scan, "fMax", "Max Frequency (Hz)", "Scan end frequency.", 0.2, 5, 0.05);
  add(scan, params.scan, "settleSeconds", "Settle Time (s)", "Discard transient time at each frequency.", 0, 10, 0.5);
  add(scan, params.scan, "dwellSeconds", "Measure Time (s)", "Measurement time at each frequency.", 1, 15, 0.5);
  const scanBtn = scan.add(hooks, "startScan").name("Start Sweep");
  scanBtn.domElement.title = "Run frequency sweep and log response amplitudes.";
  iconizeController(scanBtn, "fa-magnifying-glass-chart");

  const display = iconizeFolder(rightGui.addFolder("Display"), "fa-display");
  add(display, params.display, "showTrails", "Show Trails", "Show motion trail lines.", null, null, null, "fa-draw-polygon");
  add(display, params.display, "showVectors", "Show Vectors", "Show velocity vectors on 2D nodes.");
  add(display, params.display, "showGraphs", "Show Graphs", "Toggle lower plots panel.", null, null, null, "fa-chart-area").onChange(hooks.onDisplayChange);
  add(display, params.display, "showNodeMarkers", "Show Node Markers", "Show chain node markers in 2D.");
  add(display, params.display, "renderSubdivision", "Render Subdivision", "Visual sheet subdivision multiplier (render-only).", 1, 4, 1);
  add(display, params.display, "wireframeView", "Wireframe View", "Render mylar sheet as wireframe for debug.", null, null, null, "fa-border-all").onChange(hooks.onMaterialChange);
  add(display, params.display, "viewMode", "View Mode", "Switch between split/2D-only/3D-only.").onChange(hooks.onDisplayChange);
  const resetCamBtn = display.add(hooks, "resetCamera").name("Reset Camera");
  resetCamBtn.domElement.title = "Reset camera to default view pose.";
  iconizeController(resetCamBtn, "fa-camera-rotate");
  add(display, params.display, "envIntensity", "Environment Intensity", "Reflection environment strength.", 0, 3, 0.01);
  add(display, params.display, "roughness", "Mylar Roughness", "Lower values give mirror-like reflection.", 0, 1, 0.01);
  add(display, params.display, "metalness", "Mylar Metalness", "Higher values emphasize specular reflection.", 0, 1, 0.01);
  add(display, params.display, "hdriEnabled", "HDRI Enabled", "Use HDR environment map if available.");
  add(display, params.display, "fallbackEnvironmentEnabled", "Fallback Environment", "Use RoomEnvironment when HDRI unavailable.").onChange(hooks.onEnvironmentChange);

  createOpticsControls(rightGui, params, hooks, hooks.opticsStats);

  return {
    guiLeft: leftGui,
    guiRight: rightGui,
    refresh() {
      leftGui.controllersRecursive().forEach((c) => c.updateDisplay());
      rightGui.controllersRecursive().forEach((c) => c.updateDisplay());
    }
  };
}
