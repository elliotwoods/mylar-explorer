import * as THREE from "three/webgpu";

function sourceFromParams(params) {
  return new THREE.Vector3(
    params.optics.sourceX,
    params.optics.sourceY,
    params.optics.sourceZ
  );
}

function makeSeededRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function rebuildRestBeam(params, opticsState) {
  const source = sourceFromParams(params);
  const w = params.geometry.sheetWidth;
  const h = params.geometry.sheetHeight;
  const uCount = Math.max(2, Math.floor(params.optics.sampleCountU));
  const vCount = Math.max(2, Math.floor(params.optics.sampleCountV));
  const randomize = !!params.optics.randomizeWithinCell;
  const jitterAmount = Math.max(0, Math.min(1, params.optics.randomJitterAmount ?? 1));
  const coverage = Math.max(0, Math.min(1, (params.optics.coveragePercent ?? 100) / 100));
  // Coverage is measured bottom-up: 0% = only the bottom edge, 100% = full sheet to the top.
  const vMin = 1 - coverage;
  const vMax = 1;
  const rand = makeSeededRng(Math.floor(params.optics.randomSeed || 1));

  const centerU = Math.floor((uCount - 1) * 0.5);
  const rays = [];
  for (let j = 0; j < vCount; j += 1) {
    const dv = vCount > 1 ? 1 / (vCount - 1) : 1;
    for (let i = 0; i < uCount; i += 1) {
      const du = uCount > 1 ? 1 / (uCount - 1) : 1;
      let u = uCount === 1 ? 0.5 : i / (uCount - 1);
      const v01 = vCount === 1 ? 1 : j / (vCount - 1);
      let v = vMin + v01 * (vMax - vMin);
      if (randomize) {
        const ju = (rand() - 0.5) * du * jitterAmount;
        const jv = (rand() - 0.5) * dv * jitterAmount;
        u = Math.max(0, Math.min(1, u + ju));
        v = Math.max(vMin, Math.min(vMax, v + jv));
      }
      const x = -w * 0.5 + u * w;
      const y = -v * h;
      const z = 0;
      const target = new THREE.Vector3(x, y, z);
      const dir = target.clone().sub(source).normalize();
      rays.push({
        i,
        j,
        u,
        v,
        isCenterSlice: i === centerU,
        origin: source.clone(),
        direction: dir
      });
    }
  }

  opticsState.rays = rays;
  opticsState.beamVersion += 1;
  opticsState.runtime.totalRays = rays.length;
}
