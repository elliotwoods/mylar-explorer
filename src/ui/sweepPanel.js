export function createSweepPanel(container) {
  const el = document.createElement("div");
  el.className = "sweep-panel";
  el.style.display = "none";

  const canvas = document.createElement("canvas");
  canvas.className = "sweep-chart";
  canvas.width = 340;
  canvas.height = 160;

  el.innerHTML = `
    <div class="sweep-header">
      <i class="fa-solid fa-chart-line"></i> Frequency Sweep
    </div>
    <div class="sweep-status"></div>
    <div class="sweep-progress-track"><div class="sweep-progress-fill"></div></div>
    <div class="sweep-details"></div>
    <div class="sweep-chart-wrap"></div>
    <div class="sweep-actions"></div>
    <div class="sweep-results" style="display:none"></div>
  `;

  el.querySelector(".sweep-chart-wrap").appendChild(canvas);
  container.appendChild(el);

  const statusEl = el.querySelector(".sweep-status");
  const fillEl = el.querySelector(".sweep-progress-fill");
  const detailsEl = el.querySelector(".sweep-details");
  const actionsEl = el.querySelector(".sweep-actions");
  const resultsEl = el.querySelector(".sweep-results");
  const ctx = canvas.getContext("2d");

  let onCancel = null;
  let onDismiss = null;
  let sweepStartTime = 0;
  let hoverIndex = -1;
  let lastData = null;
  let lastFMin = 0;
  let lastFMax = 3;

  function updateHover(e) {
    if (!lastData || lastData.length === 0) { hoverIndex = -1; return; }
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const w = canvas.clientWidth;
    const pad = { left: 40, right: 12 };
    const cw = w - pad.left - pad.right;
    const fRange = Math.max(0.01, lastFMax - lastFMin);
    const hoverF = lastFMin + ((mx - pad.left) / cw) * fRange;

    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < lastData.length; i++) {
      const d = Math.abs(lastData[i].f - hoverF);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx >= 0) {
      const ptX = pad.left + ((lastData[bestIdx].f - lastFMin) / fRange) * cw;
      hoverIndex = Math.abs(mx - ptX) < 20 ? bestIdx : -1;
    } else {
      hoverIndex = -1;
    }
    // Redraw chart immediately for hover feedback when sweep is not actively running
    if (lastData) drawChart(lastData, lastFMin, lastFMax);
  }

  canvas.addEventListener("mousemove", updateHover);
  canvas.addEventListener("mouseleave", () => {
    hoverIndex = -1;
    if (lastData) drawChart(lastData, lastFMin, lastFMax);
  });

  function show(callbacks) {
    onCancel = callbacks.onCancel;
    onDismiss = callbacks.onDismiss;
    sweepStartTime = performance.now();
    resultsEl.style.display = "none";
    el.style.display = "";
    actionsEl.innerHTML = `<button class="sweep-btn sweep-cancel"><i class="fa-solid fa-stop"></i> Cancel</button>`;
    actionsEl.querySelector(".sweep-cancel").addEventListener("click", () => onCancel && onCancel());
  }

  function hide() {
    el.style.display = "none";
  }

  function update(scan, params) {
    if (!scan.running && scan.phase !== "complete" && scan.phase !== "cancelled") return;

    const { fMin, fMax, settleSeconds, dwellSeconds, stepHz } = params.scan;
    const totalSteps = scan.totalSteps || 1;
    const stepProgress = scan.elapsedAtFreq / Math.max(0.001, settleSeconds + dwellSeconds);
    const overallProgress = (scan.stepIndex + stepProgress) / totalSteps;

    fillEl.style.width = `${(overallProgress * 100).toFixed(1)}%`;

    if (scan.running) {
      const phaseLabel = scan.phase === "settling" ? "Settling" : "Measuring";
      const phaseTime = scan.phase === "settling" ? settleSeconds : dwellSeconds;
      const phaseElapsed = scan.phase === "settling"
        ? scan.elapsedAtFreq
        : scan.elapsedAtFreq - settleSeconds;

      statusEl.innerHTML = `<span class="sweep-phase-${scan.phase}">${phaseLabel}</span> at <strong>${scan.currentFreq.toFixed(2)} Hz</strong>`;

      const elapsed = (performance.now() - sweepStartTime) / 1000;
      const estTotal = overallProgress > 0.01 ? elapsed / overallProgress : 0;
      const remaining = Math.max(0, estTotal - elapsed);

      detailsEl.innerHTML = [
        `Step ${scan.stepIndex + 1} / ${totalSteps}`,
        `Phase: ${phaseElapsed.toFixed(1)}s / ${phaseTime.toFixed(1)}s`,
        `Elapsed: ${formatTime(elapsed)}`,
        remaining > 0 ? `Remaining: ~${formatTime(remaining)}` : ""
      ].filter(Boolean).join(" &middot; ");
    }

    drawChart(scan.data, fMin, fMax);

    if (scan.phase === "complete" || scan.phase === "cancelled") {
      showResults(scan);
    }
  }

  function showResults(scan) {
    fillEl.style.width = scan.phase === "complete" ? "100%" : fillEl.style.width;
    statusEl.innerHTML = scan.phase === "complete"
      ? `<span class="sweep-phase-complete">Sweep Complete</span> &mdash; ${scan.data.length} points`
      : `<span class="sweep-phase-cancelled">Sweep Cancelled</span> &mdash; ${scan.data.length} points`;

    const elapsed = (performance.now() - sweepStartTime) / 1000;
    detailsEl.innerHTML = `Total time: ${formatTime(elapsed)}`;

    // Find peaks
    const peaks = findPeaks(scan.data);
    let peakHtml = "";
    if (peaks.length > 0) {
      peakHtml = `<div class="sweep-peaks-title">Resonance Peaks</div><table class="sweep-peaks-table">
        <tr><th>Frequency</th><th>Mid Amp</th><th>Bottom Amp</th><th>Weight Amp</th></tr>
        ${peaks.map((p) => `<tr>
          <td>${p.f.toFixed(2)} Hz</td>
          <td>${p.ampMid.toFixed(4)} m</td>
          <td>${p.ampBottom.toFixed(4)} m</td>
          <td>${p.ampWeight.toFixed(4)} m</td>
        </tr>`).join("")}
      </table>`;
    }

    resultsEl.innerHTML = peakHtml;
    resultsEl.style.display = "";

    actionsEl.innerHTML = `<button class="sweep-btn sweep-dismiss"><i class="fa-solid fa-check"></i> Done</button>`;
    actionsEl.querySelector(".sweep-dismiss").addEventListener("click", () => onDismiss && onDismiss());
  }

  function drawChart(data, fMin, fMax) {
    lastData = data;
    lastFMin = fMin;
    lastFMax = fMax;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0d1420";
    ctx.fillRect(0, 0, w, h);

    if (!data || data.length === 0) {
      ctx.fillStyle = "#556680";
      ctx.font = "12px Segoe UI";
      ctx.fillText("Waiting for data...", w / 2 - 50, h / 2);
      return;
    }

    const pad = { top: 22, right: 12, bottom: 24, left: 40 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;

    const maxA = Math.max(0.001, ...data.map((p) => Math.max(p.ampMid, p.ampBottom, p.ampWeight)));
    const fRange = Math.max(0.01, fMax - fMin);

    // Grid lines
    ctx.strokeStyle = "#1e2a3d";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gy = pad.top + (i / 4) * ch;
      ctx.beginPath();
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(pad.left + cw, gy);
      ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = "#667a96";
    ctx.font = "10px Segoe UI";
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const val = maxA * (1 - i / 4);
      ctx.fillText(val.toFixed(3), pad.left - 4, pad.top + (i / 4) * ch + 3);
    }
    ctx.textAlign = "center";
    for (let f = Math.ceil(fMin * 10) / 10; f <= fMax; f += Math.max(0.1, Math.round(fRange / 6 * 10) / 10)) {
      const fx = pad.left + ((f - fMin) / fRange) * cw;
      ctx.fillText(f.toFixed(1), fx, h - 4);
    }
    ctx.fillText("Hz", pad.left + cw + 6, h - 4);

    // Data lines
    const series = [
      { key: "ampMid", color: "#77ddff", label: "Mid" },
      { key: "ampBottom", color: "#f8ca74", label: "Bottom" },
      { key: "ampWeight", color: "#9be998", label: "Weight" }
    ];

    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = pad.left + ((data[i].f - fMin) / fRange) * cw;
        const y = pad.top + ch - (data[i][s.key] / maxA) * ch;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Dot at last point
      if (data.length > 0) {
        const last = data[data.length - 1];
        const lx = pad.left + ((last.f - fMin) / fRange) * cw;
        const ly = pad.top + ch - (last[s.key] / maxA) * ch;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(lx, ly, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Hover crosshair and tooltip
    if (hoverIndex >= 0 && hoverIndex < data.length) {
      const pt = data[hoverIndex];
      const hx = pad.left + ((pt.f - fMin) / fRange) * cw;

      // Vertical crosshair line
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, pad.top);
      ctx.lineTo(hx, pad.top + ch);
      ctx.stroke();
      ctx.setLineDash([]);

      // Dots on each series at this point
      for (const s of series) {
        const dy = pad.top + ch - (pt[s.key] / maxA) * ch;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(hx, dy, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#0d1420";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Tooltip background
      ctx.font = "11px Segoe UI";
      const lines = [
        `${pt.f.toFixed(2)} Hz`,
        `Mid:    ${pt.ampMid.toFixed(4)} m`,
        `Bottom: ${pt.ampBottom.toFixed(4)} m`,
        `Weight: ${pt.ampWeight.toFixed(4)} m`
      ];
      const lineH = 15;
      const tooltipW = 140;
      const tooltipH = lines.length * lineH + 8;

      // Position tooltip: prefer right of crosshair, flip if near edge
      let tx = hx + 10;
      if (tx + tooltipW > w - 4) tx = hx - tooltipW - 10;
      let ty = pad.top + 6;

      ctx.fillStyle = "rgba(13,20,32,0.92)";
      ctx.strokeStyle = "#2a3c58";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(tx, ty, tooltipW, tooltipH, 4);
      ctx.fill();
      ctx.stroke();

      // Tooltip text
      ctx.textAlign = "left";
      const colors = ["#d9e2f2", "#77ddff", "#f8ca74", "#9be998"];
      for (let i = 0; i < lines.length; i++) {
        ctx.fillStyle = colors[i];
        ctx.fillText(lines[i], tx + 8, ty + 14 + i * lineH);
      }
    }

    // Legend (draw last so it's on top)
    ctx.font = "11px Segoe UI";
    ctx.textAlign = "left";
    let lx = pad.left + 4;
    for (const s of series) {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, 6, 12, 3);
      ctx.fillText(s.label, lx + 16, 13);
      lx += ctx.measureText(s.label).width + 30;
    }
  }

  function findPeaks(data) {
    if (data.length < 3) return data.length > 0 ? [data.reduce((a, b) => b.ampMid > a.ampMid ? b : a)] : [];

    const peaks = [];
    for (let i = 1; i < data.length - 1; i++) {
      const prev = data[i - 1];
      const curr = data[i];
      const next = data[i + 1];
      // A peak in any of the three amplitude channels
      if (
        (curr.ampMid > prev.ampMid && curr.ampMid > next.ampMid) ||
        (curr.ampBottom > prev.ampBottom && curr.ampBottom > next.ampBottom) ||
        (curr.ampWeight > prev.ampWeight && curr.ampWeight > next.ampWeight)
      ) {
        peaks.push(curr);
      }
    }
    // If no local peaks found, return the global max
    if (peaks.length === 0 && data.length > 0) {
      peaks.push(data.reduce((a, b) => b.ampMid > a.ampMid ? b : a));
    }
    return peaks;
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  return { show, hide, update, el };
}
