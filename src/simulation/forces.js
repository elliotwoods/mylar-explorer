import { DEG2RAD, TAU, smoothStep01 } from "../utils/math.js";

function applyDrag(v, coeff, mode) {
  if (mode === "quadratic") return -coeff * v * Math.abs(v);
  return -coeff * v;
}

export function updateDriveSignal(state, params, dt) {
  const amp = params.drive.amplitudeDeg * DEG2RAD;
  const phase = params.drive.phaseDeg * DEG2RAD;
  const w = TAU * params.drive.frequencyHz;

  let ramp = 1;
  if (params.drive.startupRampDuration > 0) {
    ramp = smoothStep01(state.t / params.drive.startupRampDuration);
  }
  if (!params.drive.enabled) ramp = 0;

  const s = Math.sin(w * state.t + phase);
  const c = Math.cos(w * state.t + phase);
  state.drive.ramp = ramp;
  state.drive.theta = amp * ramp * s;
  state.drive.thetaDot = amp * ramp * w * c;
  state.drive.thetaDDot = -amp * ramp * w * w * s;

  if (params.drive.startupRampDuration > 0 && state.t < params.drive.startupRampDuration) {
    const dramp = (6 * (state.t / params.drive.startupRampDuration) * (1 - state.t / params.drive.startupRampDuration)) /
      params.drive.startupRampDuration;
    state.drive.thetaDot += amp * dramp * s;
  }

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
