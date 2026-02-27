export function logOpticsState(opticsState) {
  const r = opticsState.runtime;
  const summary = {
    totalRays: r.totalRays,
    hitCount: r.hitCount,
    missCount: r.missCount,
    hitFraction: Number(r.hitFraction.toFixed(2))
  };
  console.log("[optics] summary", summary);
  console.log("[optics] sample incident points", Array.from(r.incidentPositions.slice(0, 12)));
  console.log("[optics] sample reflected points", Array.from(r.reflectedPositions.slice(0, 12)));
  return summary;
}
