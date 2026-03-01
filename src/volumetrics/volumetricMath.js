import * as THREE from "three/webgpu";

const _tmpMin = new THREE.Vector3();
const _tmpMax = new THREE.Vector3();

export function clamp(v, minV, maxV) {
  return Math.max(minV, Math.min(maxV, v));
}

export function rayAabbIntersection(origin, direction, min, max, out = { tMin: 0, tMax: 0 }) {
  let tMin = -Infinity;
  let tMax = Infinity;

  for (let axis = 0; axis < 3; axis += 1) {
    const o = axis === 0 ? origin.x : axis === 1 ? origin.y : origin.z;
    const d = axis === 0 ? direction.x : axis === 1 ? direction.y : direction.z;
    const mn = axis === 0 ? min.x : axis === 1 ? min.y : min.z;
    const mx = axis === 0 ? max.x : axis === 1 ? max.y : max.z;

    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return null;
      continue;
    }

    const invD = 1 / d;
    let t0 = (mn - o) * invD;
    let t1 = (mx - o) * invD;
    if (t0 > t1) {
      const swap = t0;
      t0 = t1;
      t1 = swap;
    }

    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMax < tMin) return null;
  }

  out.tMin = tMin;
  out.tMax = tMax;
  return out;
}

export function worldToVolumeUVW(position, boundsMin, boundsMax, out = new THREE.Vector3()) {
  _tmpMax.subVectors(boundsMax, boundsMin);
  out.set(
    _tmpMax.x > 1e-8 ? (position.x - boundsMin.x) / _tmpMax.x : 0,
    _tmpMax.y > 1e-8 ? (position.y - boundsMin.y) / _tmpMax.y : 0,
    _tmpMax.z > 1e-8 ? (position.z - boundsMin.z) / _tmpMax.z : 0
  );
  return out;
}

export function worldToVolumeGrid(position, boundsMin, boundsMax, resolution, out = new THREE.Vector3()) {
  worldToVolumeUVW(position, boundsMin, boundsMax, out);
  out.x *= Math.max(1, resolution.x - 1);
  out.y *= Math.max(1, resolution.y - 1);
  out.z *= Math.max(1, resolution.z - 1);
  return out;
}

export function volumeGridToLinearIndex(x, y, z, resolution) {
  return x + resolution.x * (y + resolution.y * z);
}

export function computeVoxelSize(boundsMin, boundsMax, resolution, out = new THREE.Vector3()) {
  _tmpMin.subVectors(boundsMax, boundsMin);
  out.set(
    _tmpMin.x / Math.max(1, resolution.x),
    _tmpMin.y / Math.max(1, resolution.y),
    _tmpMin.z / Math.max(1, resolution.z)
  );
  return out;
}

