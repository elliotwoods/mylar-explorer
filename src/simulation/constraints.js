function solveDistance(a, b, restLength) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  const err = d - restLength;
  const nx = dx / d;
  const ny = dy / d;

  const w = a.invMass + b.invMass;
  if (w <= 0) return;
  const corr = err / w;

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
  const iters = Math.max(2, Math.floor(params.physics.solverIterations));
  const baseLength = params.geometry.sheetHeight / params.geometry.segments;
  const effectiveLength = Math.max(0.6 * params.geometry.sheetHeight, params.geometry.sheetHeight - state.rideUpAmount);
  const restLength = effectiveLength / params.geometry.segments;

  for (let iter = 0; iter < iters; iter += 1) {
    nodes[0].x = 0;
    nodes[0].y = 0;

    // Refinement hook: add bending constraints / nonlinear strain model here.
    for (let i = 0; i < nodes.length - 1; i += 1) {
      solveDistance(nodes[i], nodes[i + 1], restLength);
    }

    // Mild stabilizer against abrupt global stretch when controls are changed.
    for (let i = 0; i < nodes.length - 1; i += 8) {
      const j = Math.min(nodes.length - 1, i + 8);
      solveDistance(nodes[i], nodes[j], baseLength * (j - i));
    }
  }
}
