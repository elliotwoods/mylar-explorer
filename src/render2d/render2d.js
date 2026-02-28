import { DEG2RAD } from "../utils/math.js";

export function create2DRenderer(canvas, params) {
  const ctx = canvas.getContext("2d");

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function worldToScreen(x, y, scale, ox, oy) {
    return { sx: ox + x * scale, sy: oy + y * scale };
  }

  function drawOpticsOverlay(opticsState, scale, ox, oy) {
    const overlay = opticsState.runtime.overlay2d;
    const sourceP = worldToScreen(overlay.source.x, overlay.source.y, scale, ox, oy);
    ctx.fillStyle = "#fff1a8";
    ctx.beginPath();
    ctx.arc(sourceP.sx, sourceP.sy, 4, 0, Math.PI * 2);
    ctx.fill();

    if (params.optics.incidentVisible) {
      ctx.strokeStyle = `rgba(109, 213, 255, ${params.optics.incidentOpacity * params.optics.rayOpacity})`;
      ctx.lineWidth = 1.05;
      for (let i = 0; i < overlay.incident.length; i += 1) {
        const a = worldToScreen(overlay.incident[i].from.x, overlay.incident[i].from.y, scale, ox, oy);
        const b = worldToScreen(overlay.incident[i].to.x, overlay.incident[i].to.y, scale, ox, oy);
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }
    }
    if (params.optics.reflectedVisible) {
      ctx.strokeStyle = `rgba(255, 220, 138, ${params.optics.reflectedOpacity * params.optics.rayOpacity})`;
      ctx.lineWidth = 1.1;
      for (let i = 0; i < overlay.reflected.length; i += 1) {
        const a = worldToScreen(overlay.reflected[i].from.x, overlay.reflected[i].from.y, scale, ox, oy);
        const b = worldToScreen(overlay.reflected[i].to.x, overlay.reflected[i].to.y, scale, ox, oy);
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }
    }
    if (params.optics.missVisible) {
      ctx.strokeStyle = `rgba(255, 100, 100, ${params.optics.missOpacity * params.optics.rayOpacity})`;
      ctx.lineWidth = 0.95;
      for (let i = 0; i < overlay.misses.length; i += 1) {
        const a = worldToScreen(overlay.misses[i].from.x, overlay.misses[i].from.y, scale, ox, oy);
        const b = worldToScreen(overlay.misses[i].to.x, overlay.misses[i].to.y, scale, ox, oy);
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }
    }
  }

  function draw(state, opticsState) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const margin = 28;
    // Keep a mostly fixed engineering scale so changing sheet height is visually obvious.
    const referenceMeters = 8.5;
    const neededMeters = params.geometry.sheetHeight + 1.2;
    const worldMeters = Math.max(referenceMeters, neededMeters);
    const scale = (h - margin * 2) / worldMeters;
    const ox = w * 0.5;
    const oy = margin;

    ctx.strokeStyle = "#36465d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(30, oy);
    ctx.lineTo(w - 30, oy);
    ctx.stroke();

    const nodes = state.nodes;
    ctx.strokeStyle = "#d5e6ff";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = 0; i < nodes.length; i += 1) {
      const p = worldToScreen(nodes[i].x, nodes[i].y, scale, ox, oy);
      if (i === 0) ctx.moveTo(p.sx, p.sy);
      else ctx.lineTo(p.sx, p.sy);
    }
    ctx.stroke();

    if (params.display.showNodeMarkers) {
      ctx.fillStyle = "#66d4ff";
      for (let i = 0; i < nodes.length; i += 1) {
        const p = worldToScreen(nodes[i].x, nodes[i].y, scale, ox, oy);
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const top = nodes[0];
    const bottom = nodes[nodes.length - 1];
    const wt = state.lowerWeight;
    const topP = worldToScreen(top.x, top.y, scale, ox, oy);
    const bottomP = worldToScreen(bottom.x, bottom.y, scale, ox, oy);
    const weightP = worldToScreen(wt.x, wt.y, scale, ox, oy);

    // Edge-on 2D cross-section: width-axis geometry collapses to centerline.
    // Battens are represented by circular cross-sections, and linkage by centerline.
    ctx.fillStyle = "#e3b56a";
    const topR = Math.max(2, params.geometry.topBattenDiameter * scale * 0.5);
    ctx.beginPath();
    ctx.arc(topP.sx, topP.sy, topR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#9cd89f";
    const bottomR = Math.max(2, params.geometry.bottomBattenDiameter * scale * 0.5);
    ctx.beginPath();
    ctx.arc(bottomP.sx, bottomP.sy, bottomR, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#ffd280";
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(bottomP.sx, bottomP.sy);
    ctx.lineTo(weightP.sx, weightP.sy);
    ctx.stroke();

    ctx.fillStyle = "#f5f3cb";
    const wr = Math.max(5, params.geometry.lowerWeightDiameter * scale * 0.7);
    ctx.beginPath();
    ctx.arc(weightP.sx, weightP.sy, wr, 0, Math.PI * 2);
    ctx.fill();

    if (params.display.showTrails) {
      ctx.strokeStyle = "rgba(109, 201, 255, 0.45)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < state.trails.bottom.length; i += 1) {
        const p = worldToScreen(state.trails.bottom[i].x, state.trails.bottom[i].y, scale, ox, oy);
        if (i === 0) ctx.moveTo(p.sx, p.sy);
        else ctx.lineTo(p.sx, p.sy);
      }
      ctx.stroke();
    }

    if (params.display.showVectors) {
      const scaleVec = 0.03;
      for (let i = 0; i < nodes.length; i += 6) {
        const n = nodes[i];
        const p = worldToScreen(n.x, n.y, scale, ox, oy);
        ctx.strokeStyle = "#5fe0a5";
        ctx.beginPath();
        ctx.moveTo(p.sx, p.sy);
        ctx.lineTo(p.sx + n.vx * scale / scaleVec, p.sy + n.vy * scale / scaleVec);
        ctx.stroke();
      }
    }

    if (params.optics.enabled && params.optics.show2DOverlay && opticsState) {
      drawOpticsOverlay(opticsState, scale, ox, oy);
    }

    ctx.fillStyle = "#9bb0cc";
    ctx.font = "12px Segoe UI";
    const m = state.metrics;
    const lines = [
      `drive theta: ${(state.drive.theta / DEG2RAD).toFixed(2)} deg`,
      `main swing: ${m.mainSwingAngleDeg.toFixed(2)} deg`,
      `dominant f: ${m.dominantHz.toFixed(2)} Hz`,
      `mid amp: ${m.responseAmplitudeMid.toFixed(3)} m`,
      `bottom amp: ${m.responseAmplitudeBottom.toFixed(3)} m`,
      `max deflection: ${m.maxDeflection.toFixed(3)} m`,
      `sheet height: ${params.geometry.sheetHeight.toFixed(2)} m`,
      `segments: ${Math.floor(params.geometry.segments)} (${state.nodes.length - 1} active)`,
      `energy proxy: ${m.energyProxy.toFixed(1)}`,
      `ride-up: ${state.rideUpAmount.toFixed(4)} m`,
      `phase est: ${m.phaseEstimateDeg.toFixed(1)} deg`
    ];
    if (params.optics.enabled && opticsState) {
      const r = opticsState.runtime;
      lines.push(`optics hits: ${r.hitCount}/${r.totalRays} (${r.hitFraction.toFixed(1)}%)`);
    }
    for (let i = 0; i < lines.length; i += 1) ctx.fillText(lines[i], 14, 20 + i * 15);
  }

  return { resize, draw };
}
