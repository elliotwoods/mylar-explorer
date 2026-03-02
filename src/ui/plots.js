import { clamp, estimateFrequencyFromZeroCrossings } from "../utils/math.js";

const OSC_WINDOW_SECONDS = 1.0;

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(digits);
}

function formatSigned(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
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

function drawSeries(ctx, x, y, w, h, times, values, color, label, unit, showMetrics) {
  if (values.length < 2 || !times.length || times.length !== values.length) return;
  const leftPad = 38;
  const rightPad = 8;
  const topPad = 4;
  const bottomPad = 12;
  const plot = {
    x: x + leftPad,
    y: y + topPad,
    w: Math.max(10, w - leftPad - rightPad),
    h: Math.max(10, h - topPad - bottomPad)
  };

  const tMin = times[0];
  const tMax = times[times.length - 1];
  const windowMetrics = computeWindowMetrics(times, values, OSC_WINDOW_SECONDS);
  const maxAbs = Math.max(1e-4, ...values.map((v) => Math.abs(v)));
  const yMin = -maxAbs;
  const yMax = maxAbs;

  drawAxes(ctx, plot, tMin, tMax, yMin, yMax, "s", unit ? ` ${unit}` : "");

  if (showMetrics && windowMetrics.tStart != null) {
    const tSpan = Math.max(1e-6, tMax - tMin);
    const shadeStart = clamp((windowMetrics.tStart - tMin) / tSpan, 0, 1);
    const sx = plot.x + shadeStart * plot.w;
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(sx, plot.y, plot.x + plot.w - sx, plot.h);
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

  ctx.fillStyle = color;
  ctx.fillText(label, x + 6, y + 13);
  if (showMetrics) {
    const metricText = `A=${formatNumber(windowMetrics.amplitude, 3)} ${unit}  f=${formatNumber(windowMetrics.hz, 2)} Hz`;
    ctx.fillStyle = "#c7d3e3";
    const textWidth = ctx.measureText(metricText).width;
    ctx.fillText(metricText, x + w - textWidth - 8, y + 13);
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

    const split = 0.68; // Give the top oscilloscope row more vertical space.
    const topH = Math.max(80, Math.floor(h * split));
    const bottomH = Math.max(40, h - topH);
    drawSeries(ctx, 0, 0, w * 0.25, topH, state.history.time, state.history.bottomX, "#83d8ff", "bottom x", "m", true);
    drawSeries(ctx, w * 0.25, 0, w * 0.25, topH, state.history.time, state.history.midX, "#9ee9a2", "midpoint x", "m", true);
    drawSeries(ctx, w * 0.5, 0, w * 0.25, topH, state.history.time, state.history.driveTheta, "#ffc97d", "drive angle", "deg", true);
    drawSeries(ctx, w * 0.75, 0, w * 0.25, topH, state.history.time, state.history.phaseDeg, "#f8a3dd", "phase est", "deg", false);
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
