import { clamp, DEG2RAD, TAU, smoothStep01 } from "../utils/math.js";

function applyDrag(v, coeff, mode) {
  if (mode === "quadratic") return -coeff * v * Math.abs(v);
  return -coeff * v;
}

function computeBaseDriveShape(state, params) {
  const phase = params.drive.phaseDeg * DEG2RAD;
  const w = TAU * params.drive.frequencyHz;
  const wt = w * state.t + phase;
  const base = Math.sin(wt);

  const shapingEnabled = params.drive.waveformMode === "shaped" || params.drive.jerkyEnabled;
  if (!shapingEnabled) {
    return { shape: base, wt, w };
  }

  // "Jerky" shaping is now tunable as a nonlinear blend of harmonics.
  const k = Math.max(1, params.drive.jerkHarmonic);
  const primaryAmp = Math.max(0, params.drive.jerkAmplitude ?? 0.35);
  const secondaryAmp = Math.max(0, params.drive.jerkSecondaryAmplitude ?? 0.22);
  const mixed =
    Math.sin(wt) +
    primaryAmp * Math.sin(k * wt + 0.5) +
    secondaryAmp * Math.sin((k + 2) * wt + 1.15);

  const legacySharpness = clamp(params.drive.jerkiness ?? 0.45, 0, 1);
  const explicitSharpness = clamp(params.drive.jerkSharpness ?? legacySharpness, 0, 1);
  const sharpness = 1 + explicitSharpness * 16;
  const shape = Math.tanh(sharpness * mixed) / Math.tanh(sharpness);
  return { shape, wt, w };
}

function computeNoiseOverlay(state, params, wt) {
  if (!params.drive.motionNoiseEnabled) return 0;

  const ampDeg = Math.max(0, params.drive.motionNoiseAmplitudeDeg);
  if (ampDeg <= 1e-6) return 0;

  const a1 = Math.max(0, params.drive.motionNoiseAmp1);
  const a2 = Math.max(0, params.drive.motionNoiseAmp2);
  const a3 = Math.max(0, params.drive.motionNoiseAmp3);
  const weightSum = Math.max(1e-6, a1 + a2 + a3);

  const p1 = (params.drive.motionNoisePhase1Deg || 0) * DEG2RAD;
  const p2 = (params.drive.motionNoisePhase2Deg || 0) * DEG2RAD;
  const p3 = (params.drive.motionNoisePhase3Deg || 0) * DEG2RAD;
  const f1 = Math.max(0.05, params.drive.motionNoiseFreq1Mul || 1);
  const f2 = Math.max(0.05, params.drive.motionNoiseFreq2Mul || 2);
  const f3 = Math.max(0.05, params.drive.motionNoiseFreq3Mul || 3);

  const noiseUnit =
    (a1 * Math.sin(wt * f1 + p1) + a2 * Math.sin(wt * f2 + p2) + a3 * Math.sin(wt * f3 + p3)) / weightSum;
  return noiseUnit * ampDeg * DEG2RAD;
}

function updateTargetMotion(state, params, dt) {
  const amp = params.drive.amplitudeDeg * DEG2RAD;
  let ramp = 1;
  if (params.drive.startupRampDuration > 0) {
    ramp = smoothStep01(state.t / params.drive.startupRampDuration);
  }
  if (!params.drive.enabled) ramp = 0;

  const { shape, wt } = computeBaseDriveShape(state, params);
  let targetTheta = amp * ramp * shape;

  if (params.drive.manualOverrideEnabled) {
    targetTheta = params.drive.manualOverrideDeg * DEG2RAD;
  } else {
    targetTheta += ramp * computeNoiseOverlay(state, params, wt);
  }

  const drive = state.drive;
  drive.ramp = ramp;
  drive.targetTheta = targetTheta;
  drive.targetThetaDot = (drive.targetTheta - drive.prevTargetTheta) / Math.max(dt, 1e-6);
  drive.targetThetaDDot = (drive.targetThetaDot - drive.prevTargetThetaDot) / Math.max(dt, 1e-6);
  drive.prevTargetTheta = drive.targetTheta;
  drive.prevTargetThetaDot = drive.targetThetaDot;
}

function updateMotorTracking(state, params, dt) {
  const drive = state.drive;

  // Effective rotational inertia of the driven lower assembly.
  const r = Math.max(0.05, params.geometry.linkageLength);
  const mass = Math.max(0.05, params.geometry.lowerWeightMass);
  const inertia = mass * r * r;

  const responseHz = Math.max(0.05, params.physics.motorResponseHz);
  const zeta = Math.max(0.05, params.physics.motorDampingRatio);
  const wn = TAU * responseHz;

  // 2nd-order tracking controller in torque space.
  const kp = inertia * wn * wn;
  const kd = 2 * zeta * inertia * wn;
  const error = drive.targetTheta - drive.theta;
  const errorDot = drive.targetThetaDot - drive.thetaDot;
  const torqueCmd = kp * error + kd * errorDot;

  const maxTorque = Math.max(0.01, params.physics.motorMaxTorquePerMotorNm);
  let torqueApplied = clamp(torqueCmd, -maxTorque, maxTorque);
  let saturatedBySpeed = false;
  const maxOmega = Math.max(1, params.physics.motorMaxRpm) * TAU / 60;

  const speedGuard =
    (drive.thetaDot >= maxOmega && torqueApplied > 0) ||
    (drive.thetaDot <= -maxOmega && torqueApplied < 0);
  if (speedGuard) {
    torqueApplied = 0;
    saturatedBySpeed = true;
  }

  const thetaDDot = torqueApplied / Math.max(1e-6, inertia);
  drive.thetaDot = clamp(drive.thetaDot + thetaDDot * dt, -maxOmega, maxOmega);
  drive.theta += drive.thetaDot * dt;
  drive.thetaDDot = thetaDDot;
  drive.motorTorqueCmd = torqueCmd;
  drive.motorTorqueApplied = torqueApplied;
  drive.motorSaturatedByTorque = Math.abs(torqueCmd) > maxTorque + 1e-6;
  drive.motorSaturatedBySpeed = saturatedBySpeed;
}

export function updateDriveSignal(state, params, dt) {
  updateTargetMotion(state, params, dt);
  updateMotorTracking(state, params, dt);

  state.drive.prevTheta = state.drive.theta;
  state.drive.prevThetaDot = state.drive.thetaDot;
  state.t += dt;
}

export function applyExternalForces(state, params, dt) {
  const nodes = state.nodes;
  const gravity = params.physics.gravity;
  const damp = params.physics.internalDamping;
  const dragMode = params.physics.dragMode;
  const dragEnabled = params.physics.dragEnabled;

  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    n.fx = 0;
    n.fy = 0;
    if (n.pinned) continue;

    n.fy += n.mass * gravity;
    n.fx += -damp * n.mass * n.vx;
    n.fy += -damp * n.mass * n.vy;

    if (dragEnabled) {
      // Refinement hook: current aerodynamic model is lumped drag only.
      const coeffScale = i === 0 || i === nodes.length - 1
        ? params.physics.battenDragCoefficient
        : params.physics.sheetDragCoefficient * params.geometry.sheetWidth * state.segmentLength;
      n.fx += applyDrag(n.vx, coeffScale, dragMode);
      n.fy += applyDrag(n.vy, coeffScale * 0.15, dragMode);
    }
  }

  const bottom = nodes[nodes.length - 1];
  // Refinement hook: replace this with a full rigid-body + hinge constraint solve
  // so lower assembly inertia/gravity/drag are coupled more rigorously.
  const r = params.geometry.linkageLength;
  const theta = state.drive.theta;
  const thetaDot = state.drive.thetaDot;
  const thetaDDot = state.drive.thetaDDot;

  const relX = r * Math.sin(theta);
  const relY = r * Math.cos(theta);
  const relVX = r * thetaDot * Math.cos(theta);
  const relVY = -r * thetaDot * Math.sin(theta);
  const relAX = r * (thetaDDot * Math.cos(theta) - thetaDot * thetaDot * Math.sin(theta));
  const relAY = -r * (thetaDDot * Math.sin(theta) + thetaDot * thetaDot * Math.cos(theta));

  const weight = state.lowerWeight;
  weight.vx = bottom.vx + relVX;
  weight.vy = bottom.vy + relVY;
  weight.x = bottom.x + relX;
  weight.y = bottom.y + relY;

  const mw = params.geometry.lowerWeightMass;
  let rx = -mw * relAX;
  let ry = mw * gravity - mw * relAY;

  if (dragEnabled) {
    rx += applyDrag(weight.vx, params.physics.lowerWeightDragCoefficient, dragMode);
    ry += applyDrag(weight.vy, params.physics.lowerWeightDragCoefficient, dragMode);
  }

  bottom.fx += rx;
  bottom.fy += ry;

  if (params.physics.rideUpEnabled) {
    // Refinement hook: replace this with proper rolling/contact geometry.
    const radius = params.geometry.bottomBattenDiameter * 0.5;
    state.rideUpAmount = params.physics.rideUpCoefficient * radius * (1 - Math.cos(Math.abs(theta)));
  } else {
    state.rideUpAmount = 0;
  }
}
