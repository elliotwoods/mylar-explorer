export function integrateVerlet(state, dt) {
  const nodes = state.nodes;
  const dt2 = dt * dt;

  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (n.pinned) continue;

    const vx = n.x - n.px;
    const vy = n.y - n.py;
    n.px = n.x;
    n.py = n.y;
    n.x += vx + n.fx * n.invMass * dt2;
    n.y += vy + n.fy * n.invMass * dt2;
  }
}

export function updateVelocitiesFromPositions(state, dt) {
  const invDt = 1 / dt;
  for (let i = 0; i < state.nodes.length; i += 1) {
    const n = state.nodes[i];
    n.vx = (n.x - n.px) * invDt;
    n.vy = (n.y - n.py) * invDt;
  }
}
