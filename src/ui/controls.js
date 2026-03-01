import GUI from "lil-gui";
import { createOpticsControls } from "./opticsControls.js";
import { createVolumetricControls } from "./volumetricControls.js";
import { sheetMassFromThickness, PET_DENSITY } from "../simulation/material.js";

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

function add(container, obj, key, label, hint, min, max, step, iconClass) {
  const c = min == null ? container.add(obj, key) : container.add(obj, key, min, max, step);
  c.name(label);
  c.domElement.title = hint;
  iconizeController(c, iconClass);
  return c;
}

function addColor(container, obj, key, label, hint, iconClass) {
  const c = container.addColor(obj, key);
  c.name(label);
  c.domElement.title = hint;
  iconizeController(c, iconClass);
  return c;
}

function createQuickControls(params, hooks, mount) {
  const state = {};
  const quick = document.createElement("div");
  quick.className = "controls-quick";
  quick.innerHTML = `
    <button class="quick-btn" data-action="pause">Pause</button>
    <button class="quick-btn" data-action="reset">Reset</button>
    <button class="quick-btn" data-action="step">Step</button>
    <div class="quick-field">
      <label>View</label>
      <select data-field="viewMode">
        <option value="split">Split</option>
        <option value="view2d">2D</option>
        <option value="view3d">3D</option>
      </select>
    </div>
    <div class="quick-field">
      <label>Speed</label>
      <input data-field="simSpeed" type="range" min="0.25" max="4" step="0.05" />
      <span data-field="simSpeedLabel">1.00x</span>
    </div>
    <label class="quick-toggle">
      <input data-field="volumetricsEnabled" type="checkbox" />
      <span>Volumetrics</span>
    </label>
    <label class="quick-toggle">
      <input data-field="showRays" type="checkbox" />
      <span>Show Rays</span>
    </label>
  `;
  mount.appendChild(quick);

  const pauseBtn = quick.querySelector('[data-action="pause"]');
  const resetBtn = quick.querySelector('[data-action="reset"]');
  const stepBtn = quick.querySelector('[data-action="step"]');
  const viewModeSelect = quick.querySelector('[data-field="viewMode"]');
  const simSpeedSlider = quick.querySelector('[data-field="simSpeed"]');
  const simSpeedLabel = quick.querySelector('[data-field="simSpeedLabel"]');
  const volumetricsToggle = quick.querySelector('[data-field="volumetricsEnabled"]');
  const showRaysToggle = quick.querySelector('[data-field="showRays"]');

  pauseBtn.addEventListener("click", () => {
    params.display.paused = !params.display.paused;
    refresh();
  });
  resetBtn.addEventListener("click", () => hooks.reset());
  stepBtn.addEventListener("click", () => hooks.singleStep());
  viewModeSelect.addEventListener("change", () => {
    params.display.viewMode = viewModeSelect.value;
    hooks.onDisplayChange();
  });
  simSpeedSlider.addEventListener("input", () => {
    params.display.simSpeed = Number(simSpeedSlider.value);
    refresh();
  });
  volumetricsToggle.addEventListener("change", () => {
    params.volumetrics.enabled = volumetricsToggle.checked;
    hooks.onVolumetricConfigChange();
  });
  showRaysToggle.addEventListener("change", () => {
    params.volumetrics.showRays = showRaysToggle.checked;
    hooks.onVolumetricConfigChange();
  });

  function refresh() {
    pauseBtn.textContent = params.display.paused ? "Play" : "Pause";
    viewModeSelect.value = params.display.viewMode;
    simSpeedSlider.value = `${params.display.simSpeed}`;
    simSpeedLabel.textContent = `${params.display.simSpeed.toFixed(2)}x`;
    volumetricsToggle.checked = !!params.volumetrics.enabled;
    showRaysToggle.checked = !!params.volumetrics.showRays;
  }

  refresh();
  state.refresh = refresh;
  return state;
}

export function createControls(params, hooks, mounts) {
  mounts.left.style.display = "none";
  mounts.right.innerHTML = "";
  mounts.right.classList.add("controls-panel");

  const shell = document.createElement("div");
  shell.className = "controls-shell";
  mounts.right.appendChild(shell);

  const quick = createQuickControls(params, hooks, shell);

  const tabs = document.createElement("div");
  tabs.className = "controls-tabs";
  shell.appendChild(tabs);

  const content = document.createElement("div");
  content.className = "controls-tab-content";
  shell.appendChild(content);

  const guis = [];
  const tabButtons = [];
  const tabPanes = [];
  let activeTabId = "geometry";
  let massInfo = null;

  function createTab(id, label, iconClass, build) {
    const btn = document.createElement("button");
    btn.className = "controls-tab-button";
    btn.type = "button";
    btn.dataset.tab = id;
    btn.innerHTML = withIcon(label, iconClass);
    tabs.appendChild(btn);

    const pane = document.createElement("div");
    pane.className = "controls-tab-pane";
    pane.dataset.tab = id;
    content.appendChild(pane);

    const gui = new GUI({ title: label, container: pane, width: 360 });
    guis.push(gui);
    build(gui);

    btn.addEventListener("click", () => setActiveTab(id));
    tabButtons.push(btn);
    tabPanes.push(pane);
  }

  function setActiveTab(tabId) {
    activeTabId = tabId;
    for (const btn of tabButtons) btn.classList.toggle("active", btn.dataset.tab === tabId);
    for (const pane of tabPanes) pane.classList.toggle("active", pane.dataset.tab === tabId);
  }

  createTab("geometry", "Geometry", "fa-ruler-combined", (gui) => {
    add(gui, params.geometry, "sheetHeight", "Sheet Height (m)", "Vertical sheet length.", 2, 10, 0.1, "fa-arrow-up-long").onFinishChange(hooks.onMajorReset);
    add(gui, params.geometry, "sheetWidth", "Sheet Width (m)", "Sheet width used for optics/drag/3D strip.", 0.2, 2.5, 0.01, "fa-arrows-left-right").onFinishChange(hooks.onGeometryChange);
    add(gui, params.geometry, "sheetThicknessMm", "Sheet Thickness (mm)", "Mylar film thickness. Standard farming mylar is 0.051 mm (2 mil).", 0.01, 1.0, 0.001, "fa-layer-group").onFinishChange(hooks.onMajorReset);
    massInfo = { derivedMass: `${sheetMassFromThickness(params).toFixed(3)} kg` };
    const massDisplay = gui.add(massInfo, "derivedMass").name("Sheet Mass (derived)").disable();
    massDisplay.domElement.title = `Computed from PET density (${PET_DENSITY} kg/m^3) x thickness x area.`;
    iconizeController(massDisplay, "fa-weight-hanging");
    add(gui, params.geometry, "segments", "Segment Count", "Number of chain segments along sheet height.", 20, 400, 1, "fa-grip-lines").onFinishChange(hooks.onMajorReset);
    add(gui, params.geometry, "topBattenMass", "Top Batten Mass (kg)", "Mass lumped at upper sheet node.", 0.5, 15, 0.1).onFinishChange(hooks.onMajorReset);
    add(gui, params.geometry, "topBattenDiameter", "Top Batten Diameter (m)", "Visual/drag diameter of top batten.", 0.01, 0.2, 0.005).onFinishChange(hooks.onGeometryChange);
    add(gui, params.geometry, "bottomBattenMass", "Bottom Batten Mass (kg)", "Mass lumped at lower sheet node.", 0.5, 15, 0.1).onFinishChange(hooks.onMajorReset);
    add(gui, params.geometry, "bottomBattenDiameter", "Bottom Batten Diameter (m)", "Visual/drag diameter and ride-up radius.", 0.01, 0.2, 0.005).onFinishChange(hooks.onGeometryChange);
    add(gui, params.geometry, "lowerWeightMass", "Lower Weight Mass (kg)", "Driven lower assembly equivalent mass.", 0.1, 30, 0.1).onFinishChange(hooks.onMajorReset);
    add(gui, params.geometry, "lowerWeightDiameter", "Lower Weight Diameter (m)", "Visual/drag diameter of lower weight.", 0.02, 0.4, 0.005).onFinishChange(hooks.onGeometryChange);
    add(gui, params.geometry, "linkageLength", "Linkage Length (m)", "Hinge-to-weight offset length.", 0.05, 1, 0.01).onFinishChange(hooks.onMajorReset);
  });

  createTab("drive", "Drive", "fa-gear", (gui) => {
    add(gui, params.drive, "enabled", "Drive Enabled", "Enable/disable motor drive.", null, null, null, "fa-toggle-on");

    const targetFolder = iconizeFolder(gui.addFolder("Target Motion"), "fa-wave-square");
    add(targetFolder, params.drive, "amplitudeDeg", "Amplitude (deg)", "Target drive angle amplitude.", 0, 25, 0.1);
    add(targetFolder, params.drive, "frequencyHz", "Base Frequency (Hz)", "Base drive frequency.", 0.05, 12, 0.01);
    add(targetFolder, params.drive, "phaseDeg", "Phase (deg)", "Drive phase offset.", -180, 180, 1);
    const waveformController = targetFolder.add(params.drive, "waveformMode", { Sine: "sine", Shaped: "shaped" });
    waveformController.name("Waveform Mode");
    waveformController.domElement.title = "Primary switch for waveform shaping.";
    add(targetFolder, params.drive, "startupRampDuration", "Startup Ramp (s)", "Smoothly ramps target at startup.", 0, 8, 0.1);
    add(targetFolder, params.drive, "manualOverrideEnabled", "Manual Override", "Ignore waveform and use fixed angle.");
    add(targetFolder, params.drive, "manualOverrideDeg", "Manual Angle (deg)", "Current manual target angle (updated by mouse movement).", -30, 30, 0.1);
    add(targetFolder, params.drive, "manualDecaySeconds", "Manual Return Time (s)", "Time constant for manual input returning toward 0 when idle.", 0.5, 20, 0.1);

    const shapeFolder = iconizeFolder(gui.addFolder("Wave Shaping"), "fa-bolt");
    add(shapeFolder, params.drive, "jerkyEnabled", "Legacy Shape Toggle", "Extra compatibility toggle; shaping also activates when Waveform Mode = Shaped.");
    add(shapeFolder, params.drive, "jerkHarmonic", "Primary Harmonic", "Main harmonic multiplier for shaping.", 1, 12, 1);
    add(shapeFolder, params.drive, "jerkAmplitude", "Primary Harmonic Amp", "Amplitude of primary shaping harmonic.", 0, 1.5, 0.01);
    add(shapeFolder, params.drive, "jerkSecondaryAmplitude", "Secondary Harmonic Amp", "Amplitude of secondary shaping harmonic.", 0, 1.5, 0.01);
    add(shapeFolder, params.drive, "jerkSharpness", "Shape Sharpness", "Nonlinear sharpness of shaped waveform.", 0, 1, 0.01);
    // Legacy compatibility control kept visible to tune previous projects.
    add(shapeFolder, params.drive, "jerkiness", "Legacy Sharpness", "Legacy sharpness control used for older snapshots.", 0, 1, 0.01);

    const noiseFolder = iconizeFolder(gui.addFolder("Motion Noise / Overlays"), "fa-chart-line");
    add(noiseFolder, params.drive, "motionNoiseEnabled", "Noise Enabled", "Enable overlaid frequency components.");
    add(noiseFolder, params.drive, "motionNoiseAmplitudeDeg", "Noise Amplitude (deg)", "Global overlay amplitude in degrees.", 0, 10, 0.01);
    add(noiseFolder, params.drive, "motionNoiseFreq1Mul", "Freq 1 Mult", "Overlay frequency multiplier #1.", 0.1, 20, 0.01);
    add(noiseFolder, params.drive, "motionNoiseFreq2Mul", "Freq 2 Mult", "Overlay frequency multiplier #2.", 0.1, 20, 0.01);
    add(noiseFolder, params.drive, "motionNoiseFreq3Mul", "Freq 3 Mult", "Overlay frequency multiplier #3.", 0.1, 20, 0.01);
    add(noiseFolder, params.drive, "motionNoiseAmp1", "Overlay 1 Amp", "Relative amplitude for overlay #1.", 0, 2, 0.01);
    add(noiseFolder, params.drive, "motionNoiseAmp2", "Overlay 2 Amp", "Relative amplitude for overlay #2.", 0, 2, 0.01);
    add(noiseFolder, params.drive, "motionNoiseAmp3", "Overlay 3 Amp", "Relative amplitude for overlay #3.", 0, 2, 0.01);
    add(noiseFolder, params.drive, "motionNoisePhase1Deg", "Overlay 1 Phase", "Phase in degrees for overlay #1.", -180, 180, 1);
    add(noiseFolder, params.drive, "motionNoisePhase2Deg", "Overlay 2 Phase", "Phase in degrees for overlay #2.", -180, 180, 1);
    add(noiseFolder, params.drive, "motionNoisePhase3Deg", "Overlay 3 Phase", "Phase in degrees for overlay #3.", -180, 180, 1);

    const motorFolder = iconizeFolder(gui.addFolder("Motor Limits"), "fa-gauge-high");
    add(motorFolder, params.physics, "motorMaxTorquePerMotorNm", "Max Torque (Nm)", "Hard motor torque limit.", 0.1, 30, 0.1);
    add(motorFolder, params.physics, "motorMaxRpm", "Max Speed (RPM)", "Hard motor speed limit.", 5, 250, 1);
    add(motorFolder, params.physics, "motorResponseHz", "Response (Hz)", "Closed-loop response speed of motor tracking.", 0.05, 20, 0.05);
    add(motorFolder, params.physics, "motorDampingRatio", "Damping Ratio", "Tracking damping ratio (critical ~= 1).", 0.05, 3, 0.01);
  });

  createTab("physics", "Physics", "fa-atom", (gui) => {
    add(gui, params.physics, "gravity", "Gravity (m/s^2)", "Gravity acceleration.", 0, 20, 0.01, "fa-arrow-down");
    add(gui, params.physics, "internalDamping", "Internal Damping", "Velocity-proportional internal damping.", 0, 0.25, 0.001);
    add(gui, params.physics, "dragEnabled", "Air Drag Enabled", "Enable/disable aerodynamic drag.", null, null, null, "fa-wind");
    add(gui, params.physics, "dragMode", "Drag Mode", "Linear is stable; quadratic is more realistic.");
    add(gui, params.physics, "sheetDragCoefficient", "Sheet Drag Coefficient", "Drag scaling for sheet nodes.", 0, 4, 0.01);
    add(gui, params.physics, "battenDragCoefficient", "Batten Drag Coefficient", "Drag scaling for batten nodes.", 0, 4, 0.01);
    add(gui, params.physics, "lowerWeightDragCoefficient", "Lower Weight Drag Coefficient", "Drag scaling for lower weight.", 0, 4, 0.01);
    add(gui, params.physics, "rideUpEnabled", "Ride-up Enabled", "Enable geometric ride-up approximation.");
    add(gui, params.physics, "rideUpCoefficient", "Ride-up Coefficient", "Strength of ride-up effect.", 0, 2, 0.01);
    add(gui, params.physics, "solverIterations", "Solver Iterations", "Constraint solver iteration count.", 2, 60, 1);
    add(gui, params.physics, "fixedDt", "Fixed Timestep (s)", "Simulation substep size.", 1 / 1000, 1 / 60, 1 / 1000);
    add(gui, params.physics, "maxSubStepsPerFrame", "Max Substeps / Frame", "Caps steps per frame to avoid stalls.", 1, 30, 1);
  });

  createTab("scan", "Scan", "fa-chart-line", (gui) => {
    add(gui, params.scan, "fMin", "Min Frequency (Hz)", "Scan start frequency.", 0.05, 3, 0.05);
    add(gui, params.scan, "fMax", "Max Frequency (Hz)", "Scan end frequency.", 0.2, 5, 0.05);
    add(gui, params.scan, "stepHz", "Step Size (Hz)", "Frequency increment per step.", 0.01, 0.5, 0.01);
    add(gui, params.scan, "settleSeconds", "Settle Time (s)", "Discard transient time at each frequency.", 0, 10, 0.5);
    add(gui, params.scan, "dwellSeconds", "Measure Time (s)", "Measurement time at each frequency.", 1, 15, 0.5);
    const scanBtn = gui.add(hooks, "startScan").name("Start Sweep");
    scanBtn.domElement.title = "Run frequency sweep and log response amplitudes.";
    iconizeController(scanBtn, "fa-magnifying-glass-chart");
  });

  createTab("display", "Display", "fa-display", (gui) => {
    add(gui, params.display, "showTrails", "Show Trails", "Show motion trail lines.", null, null, null, "fa-draw-polygon");
    add(gui, params.display, "showVectors", "Show Vectors", "Show velocity vectors on 2D nodes.");
    add(gui, params.display, "showGraphs", "Show Graphs", "Toggle lower plots panel.", null, null, null, "fa-chart-area").onChange(hooks.onDisplayChange);
    add(gui, params.display, "showNodeMarkers", "Show Node Markers", "Show chain node markers in 2D.");
    add(gui, params.display, "renderSubdivision", "Render Subdivision", "Visual sheet subdivision multiplier (render-only).", 1, 4, 1);
    add(gui, params.display, "wireframeView", "Wireframe View", "Render mylar sheet as wireframe for debug.", null, null, null, "fa-border-all").onChange(hooks.onMaterialChange);
    add(gui, params.display, "viewMode", "View Mode", "Switch between split/2D-only/3D-only.").onChange(hooks.onDisplayChange);
    const resetCamBtn = gui.add(hooks, "resetCamera").name("Reset Camera");
    resetCamBtn.domElement.title = "Reset camera to default view pose.";
    iconizeController(resetCamBtn, "fa-camera-rotate");
    add(gui, params.display, "envIntensity", "Environment Intensity", "Reflection environment strength.", 0, 3, 0.01);
    add(gui, params.display, "roughness", "Mylar Roughness", "Lower values give mirror-like reflection.", 0, 1, 0.01);
    add(gui, params.display, "metalness", "Mylar Metalness", "Higher values emphasize specular reflection.", 0, 1, 0.01);
    add(gui, params.display, "hdriEnabled", "HDRI Enabled", "Use HDR environment map if available.");
    add(gui, params.display, "fallbackEnvironmentEnabled", "Fallback Environment", "Use RoomEnvironment when HDRI unavailable.").onChange(hooks.onEnvironmentChange);

    add(gui, params.display, "hdrOutputEnabled", "HDR Output", "Enable extended-range output on HDR displays (requires WebGPU + HDR monitor).").onChange(hooks.onHdrOutputChange);

    const tone = iconizeFolder(gui.addFolder("Tone Mapping"), "fa-sun");
    const toneMode = tone.add(params.display, "toneMappingMode", {
      ACES: "aces",
      AgX: "agx",
      Neutral: "neutral",
      Reinhard: "reinhard",
      Cineon: "cineon",
      Linear: "linear",
      None: "none"
    });
    toneMode.name("Operator");
    toneMode.domElement.title = "Final output tone-mapping operator.";
    add(tone, params.display, "toneMappingExposure", "Exposure", "Final tone-map exposure multiplier.", 0.1, 4, 0.01, "fa-circle-half-stroke");
  });

  createTab("scene", "Scene", "fa-cubes", (gui) => {
    addColor(gui, params.display, "backgroundColor", "Background Color", "3D renderer clear/background color.", "fa-image");
    add(gui, params.display, "backgroundIntensity", "Background Intensity", "Background brightness multiplier.", 0, 1, 0.01, "fa-circle-half-stroke");

    const floor = iconizeFolder(gui.addFolder("Floor"), "fa-square");
    add(floor, params.display, "floorVisible", "Show Floor", "Toggle floor visibility.");
    add(floor, params.display, "floorY", "Floor Y (m)", "World-space floor height.", -20, 5, 0.01);
    add(floor, params.display, "floorSize", "Floor Size (m)", "Floor plane size in meters.", 1, 60, 0.1);
    addColor(floor, params.display, "floorColor", "Floor Color", "Base floor albedo tint.");
    add(floor, params.display, "floorAlbedo", "Floor Albedo", "Brightness multiplier for floor material albedo.", 0, 3, 0.01);

    const person = iconizeFolder(gui.addFolder("Person Actor"), "fa-person");
    add(person, params.display, "personVisible", "Show Person", "Toggle person actor visibility.");
    add(person, params.display, "personX", "Position X (m)", "World X position of person.", -12, 12, 0.01);
    add(person, params.display, "personZ", "Position Z (m)", "World Z position of person.", -12, 12, 0.01);
    add(person, params.display, "personYawDeg", "Yaw (deg)", "Rotation around vertical axis.", -180, 180, 1);
    add(person, params.display, "personScale", "Scale Factor", "Global scale multiplier. Useful for unit mismatches (e.g. 10x or 0.1x).", 0.01, 20, 0.01);
    add(person, params.display, "personFloorOffsetY", "Floor Offset Y (m)", "Additional vertical offset from floor contact.", -2, 2, 0.01);
  });

  createTab("optics", "Optics", "fa-lightbulb", (gui) => {
    createOpticsControls(gui, params, hooks, hooks.opticsStats);
  });

  createTab("volumetrics", "Volumetrics", "fa-cloud", (gui) => {
    createVolumetricControls(gui, params, hooks, hooks.volumetricStats);
  });

  setActiveTab(activeTabId);

  return {
    guiLeft: null,
    guiRight: null,
    refresh() {
      if (massInfo) {
        massInfo.derivedMass = `${sheetMassFromThickness(params).toFixed(3)} kg`;
      }
      quick.refresh();
      for (const gui of guis) {
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
      }
    },
    collapseRightPanels() {
      const saved = { activeTabId };
      shell.style.display = "none";
      return saved;
    },
    restoreRightPanels(saved) {
      shell.style.display = "";
      if (saved?.activeTabId) setActiveTab(saved.activeTabId);
    }
  };
}
