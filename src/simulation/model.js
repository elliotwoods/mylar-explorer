import { applyExternalForces, updateDriveSignal } from "./forces.js";
import { solveConstraints } from "./constraints.js";
import { integrateVerlet, updateVelocitiesFromPositions } from "./integrator.js";
import { createInitialState } from "./state.js";
import { DEG2RAD, estimateFrequencyFromZeroCrossings, rms } from "../utils/math.js";

const HISTORY_SECONDS = 18;
const TRAIL_POINTS = 420;

function pushFixed(arr, value, max) {
  arr.push(value);
  if (arr.length > max) arr.shift();
}

function crossCorrelationPhaseDeg(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 16) return 0;
  let bestLag = 0;
  let best = -Infinity;
  const maxLag = Math.min(80, Math.floor(n / 2));
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = maxLag; i < n - maxLag; i += 1) {
      const j = i + lag;
      if (j >= 0 && j < n) sum += a[i] * b[j];
    }
    if (sum > best) {
      best = sum;
      bestLag = lag;
    }
  }
  return (bestLag / n) * 360;
}

export class SimulationModel {
  constructor(params) {
    this.params = params;
    this.state = createInitialState(params);
  }

  reset() {
    this.state = createInitialState(this.params);
  }

  singleStep() {
    this.step(this.params.physics.fixedDt);
  }

  startFrequencyScan() {
    this.state.scan.running = true;
    this.state.scan.currentFreq = this.params.scan.fMin;
    this.state.scan.elapsedAtFreq = 0;
    this.state.scan.data = [];
    this.params.drive.frequencyHz = this.state.scan.currentFreq;
    this.reset();
  }

  step(dt) {
    const s = this.state;

    updateDriveSignal(s, this.params, dt);
    applyExternalForces(s, this.params, dt);
    integrateVerlet(s, dt);
    solveConstraints(s, this.params);
    updateVelocitiesFromPositions(s, dt);
    if (!this.isStateFinite()) {
      console.warn("[sim] state became unstable; auto-resetting");
      this.reset();
      return;
    }
    this.updateMetrics(dt);
    this.updateScan(dt);
  }

  isStateFinite() {
    for (let i = 0; i < this.state.nodes.length; i += 1) {
      const n = this.state.nodes[i];
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.vx) || !Number.isFinite(n.vy)) {
        return false;
      }
      if (Math.abs(n.x) > 1e5 || Math.abs(n.y) > 1e5) return false;
    }
    return true;
  }

  updateScan(dt) {
    const scan = this.state.scan;
    if (!scan.running) return;

    scan.elapsedAtFreq += dt;
    const total = this.params.scan.settleSeconds + this.params.scan.dwellSeconds;
    if (scan.elapsedAtFreq < total) return;

    scan.data.push({
      f: scan.currentFreq,
      ampMid: this.state.metrics.responseAmplitudeMid,
      ampBottom: this.state.metrics.responseAmplitudeBottom,
      ampWeight: this.state.metrics.responseAmplitudeWeight
    });

    const stepHz = 0.1;
    scan.currentFreq += stepHz;
    if (scan.currentFreq > this.params.scan.fMax + 1e-6) {
      scan.running = false;
      return;
    }

    this.params.drive.frequencyHz = scan.currentFreq;
    scan.elapsedAtFreq = 0;
    this.reset();
    this.state.scan.running = true;
    this.state.scan.currentFreq = scan.currentFreq;
    this.state.scan.data = scan.data;
  }

  updateMetrics(dt) {
    const s = this.state;
    const n = s.nodes.length;
    const bottom = s.nodes[n - 1];
    const mid = s.nodes[Math.floor(n * 0.5)];
    const top = s.nodes[0];
    const weight = s.lowerWeight;

    const timeWindowCount = Math.max(40, Math.round(HISTORY_SECONDS / dt));

    pushFixed(s.history.time, s.t, timeWindowCount);
    pushFixed(s.history.bottomX, bottom.x, timeWindowCount);
    pushFixed(s.history.midX, mid.x, timeWindowCount);
    pushFixed(s.history.driveTheta, s.drive.theta / DEG2RAD, timeWindowCount);
    pushFixed(s.history.phaseDeg, s.metrics.phaseEstimateDeg, timeWindowCount);

    pushFixed(s.trails.bottom, { x: bottom.x, y: bottom.y }, TRAIL_POINTS);
    pushFixed(s.trails.weight, { x: weight.x, y: weight.y }, TRAIL_POINTS);

    s.metrics.responseAmplitudeMid = Math.sqrt(2) * rms(s.history.midX);
    s.metrics.responseAmplitudeBottom = Math.sqrt(2) * rms(s.history.bottomX);
    s.metrics.responseAmplitudeWeight = Math.sqrt(2) * rms(s.trails.weight.map((p) => p.x));

    const dominant = estimateFrequencyFromZeroCrossings(s.history.midX, dt);
    s.metrics.dominantHz = dominant;
    s.metrics.maxDeflection = Math.max(...s.nodes.map((node) => Math.abs(node.x)));
    s.metrics.mainSwingAngleDeg = Math.atan2(bottom.x - top.x, bottom.y - top.y) / DEG2RAD;

    let energy = 0;
    for (let i = 0; i < s.nodes.length; i += 1) {
      const node = s.nodes[i];
      energy += 0.5 * node.mass * (node.vx * node.vx + node.vy * node.vy);
      energy += node.mass * this.params.physics.gravity * node.y;
    }
    energy += 0.5 * this.params.geometry.lowerWeightMass * (weight.vx * weight.vx + weight.vy * weight.vy);
    s.metrics.energyProxy = energy;

    s.metrics.phaseEstimateDeg = crossCorrelationPhaseDeg(s.history.driveTheta, s.history.midX);
  }
}
