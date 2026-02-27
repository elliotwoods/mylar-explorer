export function createOpticsControls(gui, params, hooks, statsModel) {
  const optics = gui.addFolder("Spotlight / Optics");
  optics.add(params.optics, "enabled");
  optics.add(params.optics, "sourceX", -6, 6, 0.01).onFinishChange(hooks.onOpticsRebuild);
  optics.add(params.optics, "sourceY", -8, 2, 0.01).onFinishChange(hooks.onOpticsRebuild);
  optics.add(params.optics, "sourceZ", -8, 8, 0.01).onFinishChange(hooks.onOpticsRebuild);
  optics.add(params.optics, "sampleCountU", 2, 90, 1).onFinishChange(hooks.onOpticsRebuild);
  optics.add(params.optics, "sampleCountV", 2, 140, 1).onFinishChange(hooks.onOpticsRebuild);
  optics.add(params.optics, "reflectedLength", 0.2, 20, 0.1);
  optics.add(params.optics, "incidentVisible");
  optics.add(params.optics, "reflectedVisible");
  optics.add(params.optics, "missVisible");
  optics.add(params.optics, "hitPointVisible");
  optics.add(params.optics, "sourceVisible");
  optics.add(params.optics, "show2DOverlay");
  optics.add(params.optics, "centerSliceOnlyIn2D");
  optics.add(params.optics, "rayOpacity", 0.05, 1, 0.01);
  optics.add(params.optics, "incidentOpacity", 0.05, 1, 0.01);
  optics.add(params.optics, "reflectedOpacity", 0.05, 1, 0.01);
  optics.add(params.optics, "missOpacity", 0.01, 1, 0.01);
  optics.add(params.optics, "maxRenderedRays", 20, 5000, 1);
  optics.add(params.optics, "maxTracedRays", 20, 8000, 1);
  optics.add(params.optics, "freeze");
  optics.add(params.optics, "restStatePreview");
  optics.add(hooks, "rebuildBeam").name("rebuild beam");
  optics.add(hooks, "logOptics").name("log optics");

  const statsFolder = optics.addFolder("Stats");
  statsFolder.add(statsModel, "totalRays").listen();
  statsFolder.add(statsModel, "hitCount").listen();
  statsFolder.add(statsModel, "missCount").listen();
  statsFolder.add(statsModel, "hitFraction").listen();
}
