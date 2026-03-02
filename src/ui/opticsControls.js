function add(folder, obj, key, label, hint, min, max, step) {
  const c = min == null ? folder.add(obj, key) : folder.add(obj, key, min, max, step);
  c.name(label);
  c.domElement.title = hint;
  return c;
}

export function createOpticsControls(gui, params, hooks, statsModel) {
  const optics = gui.addFolder("Spotlight / Optics");
  add(optics, params.optics, "enabled", "Optics Enabled", "Enable/disable spotlight ray subsystem.");
  add(optics, params.optics, "sourceX", "Source X (m)", "Spotlight point-source X position.", -6, 6, 0.01).onFinishChange(hooks.onOpticsRebuild);
  add(optics, params.optics, "sourceY", "Source Y (m)", "Spotlight point-source Y position.", -8, 2, 0.01).onFinishChange(hooks.onOpticsRebuild);
  add(optics, params.optics, "sourceZ", "Source Z (m)", "Spotlight point-source Z position.", -8, 8, 0.01).onFinishChange(hooks.onOpticsRebuild);
  add(optics, params.optics, "sampleCountU", "Samples U (Width)", "Beam samples across sheet width.", 2, 90, 1).onFinishChange(hooks.onOpticsRebuild);
  add(optics, params.optics, "sampleCountV", "Samples V (Height)", "Beam samples along sheet height.", 2, 1024, 1).onFinishChange(hooks.onOpticsRebuild);
  add(
    optics,
    params.optics,
    "coveragePercent",
    "Lit Coverage (%)",
    "Bottom-up coverage of the sheet lit by the source rays. 0% = bottom edge only, 100% = full sheet height.",
    0,
    100,
    1
  ).onFinishChange(hooks.onOpticsRebuild);
  add(optics, params.optics, "randomizeWithinCell", "Randomize Within Cell", "Jitter each UV sample inside its grid cell.").onFinishChange(hooks.onOpticsRebuild);
  add(optics, params.optics, "randomJitterAmount", "Random Amount", "Jitter amount from 0 (off) to 1 (full cell).", 0, 1, 0.01).onFinishChange(hooks.onOpticsRebuild);
  add(optics, params.optics, "randomSeed", "Random Seed", "Deterministic seed for random sampling.", 1, 999999, 1).onFinishChange(hooks.onOpticsRebuild);
  add(optics, params.optics, "reflectedLength", "Reflected Length (m)", "Length of reflected segment visualization.", 0.2, 20, 0.1);
  add(optics, params.optics, "missLength", "Max Miss Distance (m)", "Maximum length when ray misses sheet.", 0.2, 40, 0.1);
  add(optics, params.optics, "missToFloorEnabled", "Miss Rays to Floor", "Clip misses at floor plane if they intersect.");
  add(optics, params.optics, "fastIntersectionEnabled", "Fast Intersections", "Use optimized strip intersection path.");
  add(optics, params.optics, "incidentVisible", "Show Incident Rays", "Show source-to-sheet incident segments.");
  add(optics, params.optics, "reflectedVisible", "Show Reflected Rays", "Show specular reflected segments.");
  add(optics, params.optics, "missVisible", "Show Miss Rays", "Show rays that do not hit the sheet.");
  add(optics, params.optics, "hitPointVisible", "Show Hit Points", "Show hit markers on sheet surface.");
  add(optics, params.optics, "sourceVisible", "Show Source Marker", "Show source marker sphere.");
  add(optics, params.optics, "show2DOverlay", "Show 2D Overlay", "Draw optics overlay in 2D engineering view.");
  add(optics, params.optics, "centerSliceOnlyIn2D", "2D Center Slice Only", "Only draw near-center-width rays in 2D.");
  add(optics, params.optics, "rayOpacity", "Global Ray Opacity", "Overall opacity multiplier for all rays.", 0.05, 1, 0.01);
  add(optics, params.optics, "incidentOpacity", "Incident Opacity", "Relative opacity for incident rays.", 0.05, 1, 0.01);
  add(optics, params.optics, "reflectedOpacity", "Reflected Opacity", "Relative opacity for reflected rays.", 0.05, 1, 0.01);
  add(optics, params.optics, "missOpacity", "Miss Opacity", "Relative opacity for miss rays.", 0.01, 1, 0.01);
  add(optics, params.optics, "maxRenderedRays", "Max Rendered Rays", "Cap of rays actually drawn each frame.", 20, 5000, 1);
  add(optics, params.optics, "maxTracedRays", "Max Traced Rays", "Cap of rays intersected each frame.", 20, 8000, 1);
  add(optics, params.optics, "freeze", "Freeze Optics", "Freeze ray update for inspection.");
  add(optics, params.optics, "restStatePreview", "Rest-state Preview", "Intersect against rest sheet plane only.");
  const rebuildBtn = optics.add(hooks, "rebuildBeam").name("Rebuild Beam");
  rebuildBtn.domElement.title = "Recompute fixed source-ray directions from rest-state UV sampling.";
  const logBtn = optics.add(hooks, "logOptics").name("Log Optics");
  logBtn.domElement.title = "Log optics stats and sample ray data to console.";

  const statsFolder = optics.addFolder("Optics Stats");
  statsFolder.add(statsModel, "totalRays").name("Total Rays").listen();
  statsFolder.add(statsModel, "hitCount").name("Hit Count").listen();
  statsFolder.add(statsModel, "missCount").name("Miss Count").listen();
  statsFolder.add(statsModel, "hitFraction").name("Hit Fraction").listen();
}
