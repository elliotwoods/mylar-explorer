export function createOpticsState() {
  return {
    beamVersion: 0,
    rays: [],
    runtime: {
      totalRays: 0,
      hitCount: 0,
      missCount: 0,
      hitFraction: 0,
      incidentPositions: new Float32Array(),
      reflectedPositions: new Float32Array(),
      reflectedRaySamples: new Float32Array(),
      reflectedRayCount: 0,
      missPositions: new Float32Array(),
      hitPointPositions: new Float32Array(),
      overlay2d: {
        incident: [],
        reflected: [],
        misses: [],
        source: { x: 0, y: 0 }
      }
    }
  };
}
