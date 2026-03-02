import { clamp, estimateFrequencyFromZeroCrossings } from "../utils/math.js";

const OSC_WINDOW_SECONDS_DEFAULT = 2.0;
const OSC_WINDOW_SECONDS_MIN = 0.2;
const OSC_WINDOW_SECONDS_MAX = 18.0;
const TOP_ROW_SPLIT = 0.78;

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(digits);
}

function formatSigned(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function drawBadge(ctx, text, x, y, align = "left") {
  const padX = 5;
  const width = ctx.measureText(text).width;
  const boxW = width + padX * 2;
  const boxH = 14;
  const bx = align === "right" ? x - boxW : x;
  const by = y;
  ctx.fillStyle = "rgba(6,10,16,0.72)";
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.fillStyle = "#dbe7f8";
  ctx.fillText(text, bx + padX, by + 11);
  return { x: bx, y: by, w: boxW, h: boxH };
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function niceStep(rawStep) {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const power = Math.floor(Math.log10(rawStep));
  const base = 10 ** power;
  const scaled = rawStep / base;
  if (scaled <= 1) return base;
  if (scaled <= 2) return 2 * base;
  if (scaled <= 5) return 5 * base;
  return 10 * base;
}

function computeWindowMetrics(times, values, windowSeconds) {
  if (!times.length || times.length !== values.length || values.length < 3) {
    return { amplitude: null, hz: null, tStart: null };
  }
  const tEnd = times[times.length - 1];
  const tStart = tEnd - windowSeconds;
  let startIndex = times.length - 1;
  while (startIndex > 0 && times[startIndex] > tStart) startIndex -= 1;

  const windowValues = values.slice(startIndex);
  const windowTimes = times.slice(startIndex);
  if (windowValues.length < 3) return { amplitude: null, hz: null, tStart: windowTimes[0] ?? tStart };

  let minV = Infinity;
  let maxV = -Infinity;
  let mean = 0;
  for (let i = 0; i < windowValues.length; i += 1) {
    const v = windowValues[i];
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
    mean += v;
  }
  mean /= windowValues.length;

  const centered = windowValues.map((v) => v - mean);
  const dt = Math.max(1e-6, (windowTimes[windowTimes.length - 1] - windowTimes[0]) / Math.max(1, windowTimes.length - 1));
  const hz = estimateFrequencyFromZeroCrossings(centered, dt);
  const amplitude = (maxV - minV) * 0.5;
  return { amplitude, hz, tStart: windowTimes[0] ?? tStart };
}

function drawAxes(ctx, rect, xMin, xMax, yMin, yMax, xSuffix = "s", ySuffix = "") {
  const { x, y, w, h } = rect;

  ctx.strokeStyle = "#2a3a4f";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);

  const xSpan = Math.max(1e-6, xMax - xMin);
  const xStep = niceStep(xSpan / 4);
  const xTickStart = Math.ceil(xMin / xStep) * xStep;
  ctx.fillStyle = "#8fa2bb";
  ctx.strokeStyle = "#33465f";
  for (let t = xTickStart; t <= xMax + xStep * 0.25; t += xStep) {
    const p = clamp((t - xMin) / xSpan, 0, 1);
    const xx = x + p * w;
    ctx.beginPath();
    ctx.moveTo(xx, y + h);
    ctx.lineTo(xx, y + h + 4);
    ctx.stroke();
    ctx.fillText(`${formatNumber(t, 1)}${xSuffix}`, xx - 12, y + h + 12);
  }

  const ySpan = Math.max(1e-6, yMax - yMin);
  const yStep = niceStep(ySpan / 4);
  const yTickStart = Math.ceil(yMin / yStep) * yStep;
  for (let v = yTickStart; v <= yMax + yStep * 0.25; v += yStep) {
    const p = clamp((v - yMin) / ySpan, 0, 1);
    const yy = y + h - p * h;
    ctx.beginPath();
    ctx.moveTo(x - 5, yy);
    ctx.lineTo(x, yy);
    ctx.stroke();
    ctx.fillText(`${formatSigned(v, 2)}${ySuffix}`, x - 40, yy + 3);
  }
}

function drawSeries(ctx, x, y, w, h, times, values, color, label, unit, showMetrics, windowSeconds, emphasizeWindow) {
  if (values.length < 2 || !times.length || times.length !== values.length) return;
  const leftPad = 38;
  const rightPad = 6;
  const topPad = 2;
  const bottomPad = 10;
  const plot = {
    x: x + leftPad,
    y: y + topPad,
    w: Math.max(10, w - leftPad - rightPad),
    h: Math.max(10, h - topPad - bottomPad)
  };

  const tMin = times[0];
  const tMax = times[times.length - 1];
  const windowMetrics = computeWindowMetrics(times, values, windowSeconds);
  const maxAbs = Math.max(1e-4, ...values.map((v) => Math.abs(v)));
  const yMin = -maxAbs;
  const yMax = maxAbs;

  drawAxes(ctx, plot, tMin, tMax, yMin, yMax, "s", unit ? ` ${unit}` : "");

  if (showMetrics && windowMetrics.tStart != null) {
    const tSpan = Math.max(1e-6, tMax - tMin);
    const shadeStart = clamp((windowMetrics.tStart - tMin) / tSpan, 0, 1);
    const sx = plot.x + shadeStart * plot.w;
    ctx.fillStyle = emphasizeWindow ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.07)";
    ctx.fillRect(sx, plot.y, plot.x + plot.w - sx, plot.h);
    // Draggable window boundary marker.
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, plot.y);
    ctx.lineTo(sx, plot.y + plot.h);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.moveTo(sx - 4, plot.y + 2);
    ctx.lineTo(sx + 4, plot.y + 2);
    ctx.lineTo(sx, plot.y + 8);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const tSpan = Math.max(1e-6, tMax - tMin);
  for (let i = 0; i < values.length; i += 1) {
    const px = plot.x + ((times[i] - tMin) / tSpan) * plot.w;
    const py = plot.y + plot.h * 0.5 - (values[i] / maxAbs) * plot.h * 0.495;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  const titleRect = (() => {
    ctx.fillStyle = color;
    return drawBadge(ctx, label, x + 4, y + 2, "left");
  })();
  if (showMetrics) {
    const metricText = `A ${formatNumber(windowMetrics.amplitude, 3)}${unit}  f ${formatNumber(windowMetrics.hz, 2)}Hz`;
    ctx.fillStyle = "#c7d3e3";
    let metricRect = drawBadge(ctx, metricText, x + w - 4, y + 2, "right");
    if (overlaps(metricRect, titleRect)) {
      metricRect = drawBadge(ctx, metricText, x + w - 4, y + 18, "right");
      if (overlaps(metricRect, titleRect)) {
        drawBadge(ctx, metricText, x + w - 4, y + h - 18, "right");
      }
    }
  }
}

function drawScan(ctx, x, y, w, h, points) {
  if (!points.length) return;
  const leftPad = 38;
  const rightPad = 10;
  const topPad = 16;
  const bottomPad = 22;
  const plot = {
    x: x + leftPad,
    y: y + topPad,
    w: Math.max(10, w - leftPad - rightPad),
    h: Math.max(10, h - topPad - bottomPad)
  };

  const maxF = Math.max(...points.map((p) => p.f));
  const minF = Math.min(...points.map((p) => p.f));
  const maxA = Math.max(0.001, ...points.map((p) => Math.max(p.ampMid, p.ampBottom, p.ampWeight)));
  drawAxes(ctx, plot, minF, maxF, 0, maxA, "Hz", " m");

  const draw = (key, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let i = 0; i < points.length; i += 1) {
      const tx = (points[i].f - minF) / Math.max(1e-6, maxF - minF);
      const ty = clamp(points[i][key] / maxA, 0, 1);
      const xx = plot.x + tx * plot.w;
      const yy = plot.y + plot.h - ty * plot.h;
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
  };

  draw("ampMid", "#77ddff");
  draw("ampBottom", "#f8ca74");
  draw("ampWeight", "#9be998");
  ctx.fillStyle = "#90a4bf";
  ctx.fillText("scan: midpoint / bottom / weight amplitude", x + 8, y + 14);
}

export function createPlots(canvas, params) {
  const ctx = canvas.getContext("2d");
  const interaction = {
    windowSeconds: OSC_WINDOW_SECONDS_DEFAULT,
    dragging: false,
    activePanelIndex: -1,
    hoverPanelIndex: -1,
    latestPanels: [],
    latestTimes: []
  };

  function panelAtPointer(px, py) {
    for (let i = 0; i < interaction.latestPanels.length; i += 1) {
      const panel = interaction.latestPanels[i];
      if (px >= panel.x && px <= panel.x + panel.w && py >= panel.y && py <= panel.y + panel.h) return panel;
    }
    return null;
  }

  function updateWindowFromPointer(panel, px) {
    if (!panel || !interaction.latestTimes.length) return;
    const tMin = interaction.latestTimes[0];
    const tMax = interaction.latestTimes[interaction.latestTimes.length - 1];
    const p = clamp((px - panel.plotX) / Math.max(1e-6, panel.plotW), 0, 1);
    const tAtPointer = tMin + (tMax - tMin) * p;
    const requestedWindow = tMax - tAtPointer;
    interaction.windowSeconds = clamp(requestedWindow, OSC_WINDOW_SECONDS_MIN, OSC_WINDOW_SECONDS_MAX);
  }

  canvas.addEventListener("pointerdown", (event) => {
    const r = canvas.getBoundingClientRect();
    const px = event.clientX - r.left;
    const py = event.clientY - r.top;
    const panel = panelAtPointer(px, py);
    if (!panel || !panel.showWindowHandle) return;
    const nearHandle = Math.abs(px - panel.handleX) <= 10;
    if (!nearHandle) return;
    interaction.dragging = true;
    interaction.activePanelIndex = panel.index;
    canvas.setPointerCapture?.(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    const r = canvas.getBoundingClientRect();
    const px = event.clientX - r.left;
    const py = event.clientY - r.top;
    if (interaction.dragging) {
      const panel = interaction.latestPanels.find((pnl) => pnl.index === interaction.activePanelIndex) || panelAtPointer(px, py);
      updateWindowFromPointer(panel, px);
      interaction.hoverPanelIndex = panel?.index ?? -1;
      canvas.style.cursor = "ew-resize";
      return;
    }
    const panel = panelAtPointer(px, py);
    if (panel && panel.showWindowHandle && Math.abs(px - panel.handleX) <= 10) {
      interaction.hoverPanelIndex = panel.index;
      canvas.style.cursor = "ew-resize";
    } else {
      interaction.hoverPanelIndex = -1;
      canvas.style.cursor = "";
    }
  });

  function endDrag(event) {
    if (!interaction.dragging) return;
    interaction.dragging = false;
    interaction.activePanelIndex = -1;
    interaction.hoverPanelIndex = -1;
    canvas.style.cursor = "";
    if (event?.pointerId != null) canvas.releasePointerCapture?.(event.pointerId);
  }

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => {
    if (!interaction.dragging) {
      interaction.hoverPanelIndex = -1;
      canvas.style.cursor = "";
    }
  });

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = "11px Segoe UI";
  }

  function draw(state) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#101723";
    ctx.fillRect(0, 0, w, h);

    interaction.latestTimes = state.history.time || [];
    interaction.latestPanels = [];

    const topH = Math.max(90, Math.floor(h * TOP_ROW_SPLIT));
    const bottomH = Math.max(40, h - topH);
    const seriesDefs = [
      { key: "bottomX", color: "#83d8ff", label: "bottom x", unit: "m", showMetrics: true },
      { key: "midX", color: "#9ee9a2", label: "midpoint x", unit: "m", showMetrics: true },
      { key: "driveTheta", color: "#ffc97d", label: "drive angle", unit: "deg", showMetrics: true },
      { key: "phaseDeg", color: "#f8a3dd", label: "phase est", unit: "deg", showMetrics: false }
    ];
    for (let i = 0; i < seriesDefs.length; i += 1) {
      const def = seriesDefs[i];
      const x = w * 0.25 * i;
      const seriesTimes = state.history.time;
      const seriesValues = state.history[def.key];
      const emphasizeWindow = def.showMetrics && (interaction.dragging ? interaction.activePanelIndex === i : interaction.hoverPanelIndex === i);
      drawSeries(
        ctx,
        x,
        0,
        w * 0.25,
        topH,
        seriesTimes,
        seriesValues,
        def.color,
        def.label,
        def.unit,
        def.showMetrics,
        interaction.windowSeconds,
        emphasizeWindow
      );

      if (seriesTimes.length >= 2) {
        const leftPad = 38;
        const rightPad = 8;
        const topPad = 4;
        const bottomPad = 12;
        const plotX = x + leftPad;
        const plotY = topPad;
        const plotW = Math.max(10, w * 0.25 - leftPad - rightPad);
        const plotH = Math.max(10, topH - topPad - bottomPad);
        const tMin = seriesTimes[0];
        const tMax = seriesTimes[seriesTimes.length - 1];
        const tStart = tMax - interaction.windowSeconds;
        const shadeStart = clamp((tStart - tMin) / Math.max(1e-6, tMax - tMin), 0, 1);
        const handleX = plotX + shadeStart * plotW;
        interaction.latestPanels.push({
          index: i,
          x,
          y: 0,
          w: w * 0.25,
          h: topH,
          plotX,
          plotW,
          handleX,
          showWindowHandle: def.showMetrics
        });
      }
    }
    if (interaction.hoverPanelIndex >= 0 || interaction.dragging) {
      const idx = interaction.dragging ? interaction.activePanelIndex : interaction.hoverPanelIndex;
      const panel = interaction.latestPanels.find((p) => p.index === idx && p.showWindowHandle);
      if (panel) {
        const msg = `window ${interaction.windowSeconds.toFixed(2)}s`;
        ctx.font = "12px Segoe UI";
        const tw = ctx.measureText(msg).width;
        const bx = panel.x + panel.w - tw - 12;
        const by = panel.y + 18;
        ctx.fillStyle = "rgba(6,10,16,0.75)";
        ctx.fillRect(bx - 6, by - 11, tw + 12, 16);
        ctx.fillStyle = "#dbe7f8";
        ctx.fillText(msg, bx, by);
      }
    }
    drawScan(ctx, 0, topH, w, bottomH, state.scan.data);

    if (state.scan.running) {
      ctx.fillStyle = "#ffde95";
      ctx.fillText(`scan running @ ${state.scan.currentFreq.toFixed(2)} Hz`, 10, h - 10);
    }
  }

  function setVisible() {
    document.getElementById("graphsPanel").classList.toggle("hidden", !params.display.showGraphs);
  }

  return { resize, draw, setVisible };
}
