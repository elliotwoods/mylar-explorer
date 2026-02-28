import { flexuralRigidity } from "./material.js";

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
  const segmentCount = Math.max(1, nodes.length - 1);
  const iters = Math.max(2, Math.floor(params.physics.solverIterations));
  const baseLength = params.geometry.sheetHeight / segmentCount;
  const effectiveLength = Math.max(0.6 * params.geometry.sheetHeight, params.geometry.sheetHeight - state.rideUpAmount);
  const restLength = effectiveLength / segmentCount;

  // Bending stiffness from material flexural rigidity
  const D = flexuralRigidity(params);
  const dt = params.physics.fixedDt;
  const avgMass = nodes.length > 2 ? nodes[1].mass : 1;
  const bendAlpha = Math.min(0.5, D * dt * dt / (avgMass * baseLength * baseLength * iters));

  const top = nodes[0];

  for (let iter = 0; iter < iters; iter += 1) {
    nodes[0].x = 0;
    nodes[0].y = 0;

    // Fine level: adjacent distance constraints (forward + backward)
    for (let i = 0; i < nodes.length - 1; i += 1) {
      solveDistance(nodes[i], nodes[i + 1], restLength);
    }
    for (let i = nodes.length - 2; i >= 0; i -= 1) {
      solveDistance(nodes[i], nodes[i + 1], restLength);
    }

    // Long-Range Attachments (LRA): prevent cumulative stretch by
    // constraining every node's distance from the pinned top to at most
    // its arc-length along the chain.  This is an inequality constraint
    // (compress-only) so it never fights natural curvature, and because
    // every node has its own independent constraint back to the anchor
    // there are no preferred positions that could cause creases.
    for (let i = 2; i < nodes.length; i += 1) {
      const n = nodes[i];
      const maxDist = restLength * i;
      const dx = n.x - top.x;
      const dy = n.y - top.y;
      const d = Math.hypot(dx, dy);
      if (d > maxDist) {
        const correction = (d - maxDist) / d;
        n.x -= dx * correction;
        n.y -= dy * correction;
      }
    }

    // Bending constraint: push each interior node toward the midpoint of its
    // neighbours, weighted by the material flexural rigidity.
    if (bendAlpha > 1e-10) {
      for (let i = 1; i < nodes.length - 1; i += 1) {
        const a = nodes[i - 1];
        const b = nodes[i];
        const c = nodes[i + 1];
        if (b.pinned) continue;
        const midX = (a.x + c.x) * 0.5;
        const midY = (a.y + c.y) * 0.5;
        b.x += (midX - b.x) * bendAlpha;
        b.y += (midY - b.y) * bendAlpha;
      }
    }
  }
}
