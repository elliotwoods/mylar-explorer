import {
  applyResolutionPreset,
  VOLUMETRIC_LOOK_PRESETS,
  VOLUMETRIC_RESOLUTION_PRESETS
} from "../volumetrics/volumetricParams.js";

function add(folder, obj, key, label, hint, min, max, step) {
  const c = min == null ? folder.add(obj, key) : folder.add(obj, key, min, max, step);
  c.name(label);
  c.domElement.title = hint;
  return c;
}

export function createVolumetricControls(gui, params, hooks, statsModel) {
  const folder = gui.addFolder("Volumetric Haze / God Rays");
  const modeOptions = {
    "Scene + Volumetrics": "scene+volumetrics",
    "Volumetric Only": "volumetric-only",
    "Scene Only": "scene-only",
    "Reflected Rays Only": "reflected-rays-only"
  };

  // ── Top-level controls (always visible) ──────────────────────────
  add(folder, params.volumetrics, "enabled", "Volumetrics Enabled", "Master toggle for volumetric haze rendering.");
  const volModeController = folder.add(
    params.volumetrics,
    "volumetricMode",
    { Raymarched: "raymarched", "Rasterized Pipes": "rasterized" }
  );
  volModeController.name("Volume Method");
  volModeController.domElement.title = "Raymarched: classic 3D texture + raymarch.\nRasterized: prism geometry along ray bundles.";
  add(folder, params.volumetrics, "showRays", "Show Rays", "Toggle ray-line debug overlay while volumetrics are enabled.");
  const modeController = folder.add(params.volumetrics, "debugRenderMode", modeOptions);
  modeController.name("Render Mode");
  modeController.domElement.title = "Toggle scene/rays/volumetric debug view.";
  modeController.onChange(hooks.onVolumetricConfigChange);

  // ── Look / resolution presets (raymarched only) ──────────────────
  const presets = {
    selectedLook: "Strong theatrical haze",
    selectedResolution: "medium",
    applyLookPreset: () => {
      const preset = VOLUMETRIC_LOOK_PRESETS[presets.selectedLook];
      if (preset) preset(params.volumetrics);
      hooks.onVolumetricConfigChange();
    },
    applyResolutionPreset: () => {
      applyResolutionPreset(params.volumetrics, presets.selectedResolution);
      hooks.onVolumetricConfigChange();
    }
  };

  const presetsFolder = folder.addFolder("Presets");
  presetsFolder.add(presets, "selectedLook", Object.keys(VOLUMETRIC_LOOK_PRESETS)).name("Look Preset");
  presetsFolder.add(presets, "applyLookPreset").name("Apply Look Preset");
  presetsFolder.add(presets, "selectedResolution", Object.keys(VOLUMETRIC_RESOLUTION_PRESETS)).name("Resolution Preset");
  presetsFolder.add(presets, "applyResolutionPreset").name("Apply Resolution Preset");

  // ── Stage-space bounds (raymarched only — rasterized uses beam geometry directly) ──
  const bounds = folder.addFolder("Stage-Space Bounds");
  add(bounds, params.volumetrics, "showBounds", "Show Bounds Box", "Show world-space bounds of the froxel volume.");
  add(bounds, params.volumetrics, "boundsCenterX", "Center X (m)", "Volume center X in world space.", -20, 20, 0.05).onFinishChange(hooks.onVolumetricConfigChange);
  add(bounds, params.volumetrics, "boundsCenterY", "Center Y (m)", "Volume center Y in world space.", -20, 20, 0.05).onFinishChange(hooks.onVolumetricConfigChange);
  add(bounds, params.volumetrics, "boundsCenterZ", "Center Z (m)", "Volume center Z in world space.", -20, 20, 0.05).onFinishChange(hooks.onVolumetricConfigChange);
  add(bounds, params.volumetrics, "boundsWidth", "Width (m)", "Volume width in world meters.", 2, 40, 0.1).onFinishChange(hooks.onVolumetricConfigChange);
  add(bounds, params.volumetrics, "boundsHeight", "Height (m)", "Volume height in world meters.", 2, 30, 0.1).onFinishChange(hooks.onVolumetricConfigChange);
  add(bounds, params.volumetrics, "boundsDepth", "Depth (m)", "Volume depth in world meters.", 2, 40, 0.1).onFinishChange(hooks.onVolumetricConfigChange);

  // ── Froxel grid (raymarched only) ────────────────────────────────
  const volume = folder.addFolder("Froxel Grid");
  add(volume, params.volumetrics, "resolutionX", "Resolution X", "Froxel resolution in X.", 32, 192, 1).onFinishChange(hooks.onVolumetricConfigChange);
  add(volume, params.volumetrics, "resolutionY", "Resolution Y", "Froxel resolution in Y.", 24, 128, 1).onFinishChange(hooks.onVolumetricConfigChange);
  add(volume, params.volumetrics, "resolutionZ", "Resolution Z", "Froxel resolution in Z.", 16, 96, 1).onFinishChange(hooks.onVolumetricConfigChange);
  add(volume, params.volumetrics, "clearEachFrame", "Clear Every Frame", "Clears volume prior to each injection pass.");
  add(volume, params.volumetrics, "temporalAccumulation", "Temporal Accumulation", "Blend current volume with previous history.");
  add(volume, params.volumetrics, "temporalDecay", "Temporal Decay", "History decay factor per frame.", 0.75, 0.999, 0.001);
  add(volume, params.volumetrics, "temporalBlend", "Temporal Blend", "Blend factor of newly injected volume.", 0.05, 1, 0.01);

  // ── Beam injection (raymarched only) ─────────────────────────────
  const inject = folder.addFolder("Beam Injection");
  add(inject, params.volumetrics, "beamStepSize", "Beam Step Size (m)", "Ray step length during CPU beam injection.", 0.05, 1.2, 0.01);
  add(inject, params.volumetrics, "depositionRadius", "Deposition Radius (m)", "Energy splat radius in meters.", 0, 1.2, 0.01);
  add(inject, params.volumetrics, "injectionIntensity", "Injection Intensity", "Per-ray deposited energy / beam power scale.", 0, 4, 0.01);
  add(inject, params.volumetrics, "injectIncidentRays", "Inject Incident Rays", "Include source-to-mirror incoming rays in volumetric energy injection.");
  add(inject, params.volumetrics, "maxBeamDistance", "Max Beam Distance (m)", "Max reflected ray travel distance in volume.", 1, 40, 0.1);

  // ── Raymarch settings (raymarched only) ──────────────────────────
  const march = folder.addFolder("Raymarch");
  add(march, params.volumetrics, "raymarchStepCount", "Raymarch Steps", "Samples taken through the volume per pixel.", 8, 160, 1);
  add(march, params.volumetrics, "raymarchMaxDistance", "Max March Distance (m)", "Caps volumetric marching distance.", 2, 80, 0.1);
  const resolutionModeController = march.add(
    params.volumetrics,
    "reducedResolutionMode",
    { Quarter: "quarter", Half: "half", Full: "full" }
  );
  resolutionModeController.name("Pass Resolution");
  resolutionModeController.domElement.title = "Resolution scale for volumetric pass.";
  resolutionModeController.onChange(hooks.onVolumetricConfigChange);

  // ── Shared optical parameters (both modes) ───────────────────────
  const optics = folder.addFolder("Scattering & Appearance");
  add(optics, params.volumetrics, "hazeDensity", "Haze Density", "Global participating-media density scale.", 0, 3, 0.01);
  add(optics, params.volumetrics, "scatteringCoeff", "Scattering Coeff", "Single-scattering strength.", 0, 3, 0.01);
  add(optics, params.volumetrics, "extinctionCoeff", "Extinction Coeff", "Beer-Lambert attenuation coefficient.", 0, 3, 0.01);
  add(optics, params.volumetrics, "anisotropy", "Anisotropy g", "Forward scattering anisotropy term.", -0.2, 0.8, 0.01);
  add(optics, params.volumetrics, "forwardScatterBias", "Forward Bias", "Blend between isotropic and directional phase.", 0, 1, 0.01);
  add(optics, params.volumetrics, "intensity", "Volumetric Intensity", "Final volumetric brightness multiplier.", 0, 20, 0.01);
  add(optics, params.volumetrics, "compositeOpacity", "Composite Opacity", "Composite strength over scene color.", 0, 1.5, 0.01);

  // ── Slice viewer (raymarched only) ───────────────────────────────
  const slice = folder.addFolder("Slice Viewer");
  add(slice, params.volumetrics, "showSlice", "Show Slice", "Show a debug slice through the froxel volume.");
  const sliceAxisController = slice.add(params.volumetrics, "sliceAxis", { XY: "xy", XZ: "xz", YZ: "yz" });
  sliceAxisController.name("Slice Axis");
  sliceAxisController.domElement.title = "Axis orientation for debug slice.";
  add(slice, params.volumetrics, "slicePosition", "Slice Position", "Slice position from 0..1 in selected axis.", 0, 1, 0.001);
  add(slice, params.volumetrics, "sliceOpacity", "Slice Opacity", "Debug slice opacity.", 0.05, 1, 0.01);

  // ── Stats ────────────────────────────────────────────────────────
  const stats = folder.addFolder("Volumetric Stats");
  stats.add(statsModel, "enabled").name("Enabled").listen();
  stats.add(statsModel, "webgl2Ready").name("GPU Ready").listen();
  stats.add(statsModel, "injectionBackend").name("Injection Backend").listen();
  stats.add(statsModel, "cpuFallbackActive").name("CPU Fallback").listen();
  stats.add(statsModel, "validReflectedRays").name("Valid Reflected Rays").listen();
  stats.add(statsModel, "injectedRays").name("Injected Rays").listen();
  stats.add(statsModel, "averageHitFraction").name("Avg Hit Fraction").listen();
  stats.add(statsModel, "volumeResolution").name("Volume Resolution").listen();
  stats.add(statsModel, "computeClearMs").name("Clear Dispatch ms").listen();
  stats.add(statsModel, "computeInjectMs").name("Inject Dispatch ms").listen();
  stats.add(statsModel, "computeResolveMs").name("Resolve Dispatch ms").listen();
  stats.add(statsModel, "computeCopyMs").name("Copy Dispatch ms").listen();
  stats.add(statsModel, "computeTotalMs").name("Total Dispatch ms").listen();
  stats.add(statsModel, "raymarchSteps").name("Raymarch Steps").listen();
  stats.add(statsModel, "frameMs").name("Frame ms").listen();
  stats.add(statsModel, "fps").name("FPS").listen();
  stats.open();

  // ── Mode-dependent visibility ────────────────────────────────────
  // Folders that only apply to one mode are shown/hidden when
  // the volume method changes.
  const raymarchOnlyFolders = [presetsFolder, bounds, volume, inject, march, slice];

  function syncModeVisibility() {
    const isRasterized = params.volumetrics.volumetricMode === "rasterized";
    for (const f of raymarchOnlyFolders) {
      f.domElement.style.display = isRasterized ? "none" : "";
    }
    hooks.onVolumetricConfigChange();
  }

  volModeController.onChange(syncModeVisibility);
  // Apply on first build
  syncModeVisibility();
}
