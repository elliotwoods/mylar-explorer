import { sheetMassFromThickness } from "./material.js";

export function createInitialState(params) {
  const segments = Math.max(8, Math.floor(params.geometry.segments));
  const nodeCount = segments + 1;
  const segmentLength = params.geometry.sheetHeight / segments;
  const sheetMassTotal = sheetMassFromThickness(params);
  const sheetNodeMass = sheetMassTotal / nodeCount;

  const nodes = [];
  for (let i = 0; i < nodeCount; i += 1) {
    const y = i * segmentLength;
    let mass = sheetNodeMass;
    if (i === 0) mass += params.geometry.topBattenMass;
    if (i === nodeCount - 1) mass += params.geometry.bottomBattenMass;
    nodes.push({
      x: 0,
      y,
      px: 0,
      py: y,
      vx: 0,
      vy: 0,
      fx: 0,
      fy: 0,
      mass,
      invMass: mass > 0 ? 1 / mass : 0,
      pinned: i === 0
    });
  }

  return {
    t: 0,
    nodes,
    segmentLength,
    rideUpAmount: 0,
    drive: {
      theta: 0,
      thetaDot: 0,
      thetaDDot: 0,
      ramp: 0,
      prevTheta: 0,
      prevThetaDot: 0,
      targetTheta: 0,
      prevTargetTheta: 0,
      prevTargetThetaDot: 0,
      targetThetaDot: 0,
      targetThetaDDot: 0,
      motorTorqueCmd: 0,
      motorTorqueApplied: 0,
      motorSaturatedByTorque: false,
      motorSaturatedBySpeed: false
    },
    lowerWeight: {
      x: 0,
      y: params.geometry.sheetHeight + params.geometry.linkageLength,
      vx: 0,
      vy: 0
    },
    trails: {
      bottom: [],
      weight: []
    },
    metrics: {
      mainSwingAngleDeg: 0,
      maxDeflection: 0,
      energyProxy: 0,
      dominantHz: 0,
      responseAmplitudeMid: 0,
      responseAmplitudeBottom: 0,
      responseAmplitudeWeight: 0,
      phaseEstimateDeg: 0
    },
    history: {
      time: [],
      bottomX: [],
      midX: [],
      driveTheta: [],
      phaseDeg: []
    },
    scan: {
      running: false,
      currentFreq: 0,
      elapsedAtFreq: 0,
      data: [],
      phase: "idle",
      stepIndex: 0,
      totalSteps: 0
    }
  };
}
