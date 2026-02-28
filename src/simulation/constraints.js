function solveDistance(a, b, restLength, stiffness = 1) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  const err = d - restLength;
  const nx = dx / d;
  const ny = dy / d;

  const w = a.invMass + b.invMass;
  if (w <= 0) return;
  const corr = err / w * stiffness;

  if (!a.pinned) {
    a.x += nx * corr * a.invMass;
    a.y += ny * corr * a.invMass;
  }
  if (!b.pinned) {
    b.x -= nx * corr * b.invMass;
    b.y -= ny * corr * b.invMass;
  }
}

export function solveConstraints(state, params) {
  const nodes = state.nodes;
  const segmentCount = Math.max(1, nodes.length - 1);
  const baseIters = Math.max(2, Math.floor(params.physics.solverIterations));
  // Keep apparent stretch stiffness roughly consistent as segment count grows.
  const segScale = Math.sqrt(segmentCount / 60);
  const iters = Math.min(180, Math.max(2, Math.floor(baseIters * segScale)));
  const baseLength = params.geometry.sheetHeight / segmentCount;
  const effectiveLength = Math.max(0.6 * params.geometry.sheetHeight, params.geometry.sheetHeight - state.rideUpAmount);
  const restLength = effectiveLength / segmentCount;

  for (let iter = 0; iter < iters; iter += 1) {
    nodes[0].x = 0;
    nodes[0].y = 0;

    // Refinement hook: add bending constraints / nonlinear strain model here.
    for (let i = 0; i < nodes.length - 1; i += 1) {
      solveDistance(nodes[i], nodes[i + 1], restLength);
    }
    for (let i = nodes.length - 2; i >= 0; i -= 1) {
      solveDistance(nodes[i], nodes[i + 1], restLength);
    }

    // Mild stabilizer against abrupt global stretch when controls are changed.
    const longRangeStep = Math.max(6, Math.floor(segmentCount / 18));
    const longRangeStiffness = 0.05;
    for (let i = 0; i < nodes.length - 1; i += longRangeStep) {
      const j = Math.min(nodes.length - 1, i + longRangeStep);
      solveDistance(nodes[i], nodes[j], baseLength * (j - i), longRangeStiffness);
    }
  }
}
