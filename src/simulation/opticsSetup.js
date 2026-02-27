import * as THREE from "three";

function sourceFromParams(params) {
  return new THREE.Vector3(
    params.optics.sourceX,
    params.optics.sourceY,
    params.optics.sourceZ
  );
}

export function rebuildRestBeam(params, opticsState) {
  const source = sourceFromParams(params);
  const w = params.geometry.sheetWidth;
  const h = params.geometry.sheetHeight;
  const uCount = Math.max(2, Math.floor(params.optics.sampleCountU));
  const vCount = Math.max(2, Math.floor(params.optics.sampleCountV));

  const centerU = Math.floor((uCount - 1) * 0.5);
  const rays = [];
  for (let j = 0; j < vCount; j += 1) {
    const v = vCount === 1 ? 0 : j / (vCount - 1);
    for (let i = 0; i < uCount; i += 1) {
      const u = uCount === 1 ? 0.5 : i / (uCount - 1);
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
