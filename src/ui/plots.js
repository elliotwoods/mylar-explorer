import { clamp } from "../utils/math.js";

function drawSeries(ctx, x, y, w, h, values, color, label) {
  if (values.length < 2) return;
  const maxAbs = Math.max(1e-4, ...values.map((v) => Math.abs(v)));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < values.length; i += 1) {
    const px = x + (i / (values.length - 1)) * w;
    const py = y + h * 0.5 - (values[i] / maxAbs) * h * 0.46;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(label, x + 6, y + 14);
}

function drawScan(ctx, x, y, w, h, points) {
  if (!points.length) return;
  const maxF = Math.max(...points.map((p) => p.f));
  const minF = Math.min(...points.map((p) => p.f));
  const maxA = Math.max(0.001, ...points.map((p) => Math.max(p.ampMid, p.ampBottom, p.ampWeight)));

  const draw = (key, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let i = 0; i < points.length; i += 1) {
      const t = (points[i].f - minF) / Math.max(1e-6, maxF - minF);
      const xx = x + t * w;
      const yy = y + h - clamp(points[i][key] / maxA, 0, 1) * (h - 18);
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

    const panelH = h / 2;
    drawSeries(ctx, 0, 0, w * 0.25, panelH, state.history.bottomX, "#83d8ff", "bottom x");
    drawSeries(ctx, w * 0.25, 0, w * 0.25, panelH, state.history.midX, "#9ee9a2", "midpoint x");
    drawSeries(ctx, w * 0.5, 0, w * 0.25, panelH, state.history.driveTheta, "#ffc97d", "drive angle");
    drawSeries(ctx, w * 0.75, 0, w * 0.25, panelH, state.history.phaseDeg, "#f8a3dd", "phase est");
    drawScan(ctx, 0, panelH, w, panelH, state.scan.data);

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
