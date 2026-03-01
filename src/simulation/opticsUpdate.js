import * as THREE from "three/webgpu";
import { orientNormalAgainstIncoming, reflectDirection } from "./opticsMath.js";

const _raycaster = new THREE.Raycaster();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _normalMatrix = new THREE.Matrix3();
const _incoming = new THREE.Vector3();
const _point = new THREE.Vector3();
const _ref = new THREE.Vector3();
const _world = new THREE.Vector3();
const _sheetPoint = new THREE.Vector3();
const _sheetNormal = new THREE.Vector3();

function sourceFromParams(params) {
  return new THREE.Vector3(
    params.optics.sourceX,
    params.optics.sourceY,
    params.optics.sourceZ
  );
}

function intersectRestPlaneRect(origin, dir, params) {
  const eps = 1e-7;
  if (Math.abs(dir.z) < eps) return null;
  const t = (0 - origin.z) / dir.z;
  if (t <= 0) return null;
  const p = origin.clone().addScaledVector(dir, t);
  const halfW = params.geometry.sheetWidth * 0.5;
  const h = params.geometry.sheetHeight;
  if (p.x < -halfW || p.x > halfW) return null;
  if (p.y < -h || p.y > 0) return null;
  return {
    point: p,
    normal: new THREE.Vector3(0, 0, 1),
    distance: t
  };
}

function getIntersectionNormal(intersection, targetMesh) {
  if (intersection.normal) return intersection.normal.clone().normalize();
  if (!intersection.face || intersection.face.a == null) return new THREE.Vector3(0, 0, 1);

  const pos = targetMesh.geometry.attributes.position;
  _vA.fromBufferAttribute(pos, intersection.face.a);
  _vB.fromBufferAttribute(pos, intersection.face.b);
  _vC.fromBufferAttribute(pos, intersection.face.c);
  _normal.subVectors(_vC, _vB).cross(_vA.clone().sub(_vB)).normalize();
  _normalMatrix.getNormalMatrix(targetMesh.matrixWorld);
  return _normal.applyMatrix3(_normalMatrix).normalize();
}

function pushSeg(arr, a, b) {
  arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
}

function pushPoint(arr, p) {
  arr.push(p.x, p.y, p.z);
}

function missEndpoint(origin, dir, params) {
  const maxDist = Math.max(0.05, params.optics.missLength);
  let t = maxDist;

  if (params.optics.missToFloorEnabled) {
    const eps = 1e-7;
    if (Math.abs(dir.y) > eps) {
      const floorT = (params.optics.floorY - origin.y) / dir.y;
      if (floorT > 0) t = Math.min(maxDist, floorT);
    }
  }

  return origin.clone().addScaledVector(dir, t);
}

function buildFastProfile(targetMesh, params) {
  const pos = targetMesh.geometry?.attributes?.position;
  if (!pos || pos.count < 4) return null;
  const cols = targetMesh.userData?.sheetCols || 13;
  const rows = Math.max(2, Math.floor(pos.count / cols));
  if (rows * cols > pos.count) return null;
  const midCol = Math.floor(cols * 0.5);
  const profile = [];

  for (let row = 0; row < rows; row += 1) {
    const idx = row * cols + midCol;
    _world.fromBufferAttribute(pos, idx).applyMatrix4(targetMesh.matrixWorld);
    profile.push({ y: _world.y, z: _world.z });
  }
  return profile;
}

function fastIntersectStrip(origin, dir, halfWidth, profile) {
  const eps = 1e-7;
  let bestT = Infinity;
  let bestRow = -1;
  let hit = false;

  for (let row = 0; row < profile.length - 1; row += 1) {
    const y0 = profile[row].y;
    const z0 = profile[row].z;
    const y1 = profile[row + 1].y;
    const z1 = profile[row + 1].z;
    const dySeg = y1 - y0;
    const dzSeg = z1 - z0;
    if (Math.abs(dySeg) < eps) continue;

    const k = dzSeg / dySeg;
    const denom = dir.z - k * dir.y;
    if (Math.abs(denom) < eps) continue;

    const t = (z0 + k * (origin.y - y0) - origin.z) / denom;
    if (t <= 1e-6 || t >= bestT) continue;

    const yHit = origin.y + t * dir.y;
    const yMin = Math.min(y0, y1) - 1e-6;
    const yMax = Math.max(y0, y1) + 1e-6;
    if (yHit < yMin || yHit > yMax) continue;

    const xHit = origin.x + t * dir.x;
    if (Math.abs(xHit) > halfWidth + 1e-6) continue;

    bestT = t;
    bestRow = row;
    hit = true;
  }

  if (!hit) return null;
  _sheetPoint.copy(origin).addScaledVector(dir, bestT);
  const dy = profile[bestRow + 1].y - profile[bestRow].y;
  const dz = profile[bestRow + 1].z - profile[bestRow].z;
  _sheetNormal.set(0, -dz, dy).normalize();
  return {
    point: _sheetPoint.clone(),
    normal: _sheetNormal.clone(),
    distance: bestT
  };
}

export function updateOptics(params, opticsState, targetMesh, options = {}) {
  const force = !!options.force;
  if (!params.optics.enabled || !targetMesh) {
    const runtime = opticsState.runtime;
    runtime.totalRays = 0;
    runtime.hitCount = 0;
    runtime.missCount = 0;
    runtime.hitFraction = 0;
    runtime.incidentPositions = new Float32Array();
    runtime.incidentRaySamples = new Float32Array();
    runtime.incidentRayLengths = new Float32Array();
    runtime.incidentRayCount = 0;
    runtime.reflectedPositions = new Float32Array();
    runtime.reflectedRaySamples = new Float32Array();
    runtime.reflectedRayCount = 0;
    runtime.missPositions = new Float32Array();
    runtime.hitPointPositions = new Float32Array();
    runtime.overlay2d = {
      incident: [],
      reflected: [],
      misses: [],
      source: { x: params.optics.sourceZ, y: -params.optics.sourceY }
    };
    return;
  }
  if (!force && params.optics.freeze && opticsState.runtime.totalRays > 0) return;

  const source = sourceFromParams(params);
  const rays = opticsState.rays;
  const totalRays = rays.length;
  if (!totalRays) {
    const runtime = opticsState.runtime;
    runtime.totalRays = 0;
    runtime.hitCount = 0;
    runtime.missCount = 0;
    runtime.hitFraction = 0;
    runtime.incidentPositions = new Float32Array();
    runtime.incidentRaySamples = new Float32Array();
    runtime.incidentRayLengths = new Float32Array();
    runtime.incidentRayCount = 0;
    runtime.reflectedPositions = new Float32Array();
    runtime.reflectedRaySamples = new Float32Array();
    runtime.reflectedRayCount = 0;
    runtime.missPositions = new Float32Array();
    runtime.hitPointPositions = new Float32Array();
    return;
  }

  const traceStride = Math.max(1, Math.ceil(totalRays / Math.max(1, params.optics.maxTracedRays)));
  const estimatedTracedRays = Math.ceil(totalRays / traceStride);
  // Draw decimation should operate on the traced-ray set, not full grid index space.
  const drawStride = Math.max(1, Math.ceil(estimatedTracedRays / Math.max(1, params.optics.maxRenderedRays)));
  const inc = [];
  const incidentSamples = [];
  const incidentLengths = [];
  const refl = [];
  const reflectedSamples = [];
  const miss = [];
  const hitPts = [];
  const overlay = {
    incident: [],
    reflected: [],
    misses: [],
    source: { x: source.z, y: -source.y }
  };

  let hitCount = 0;
  let missCount = 0;
  let tracedCount = 0;
  let tracedOrdinal = 0;
  const doRestPreview = params.optics.restStatePreview;

  targetMesh.updateMatrixWorld(true);
  const useFast = params.optics.fastIntersectionEnabled && !doRestPreview;
  const fastProfile = useFast ? buildFastProfile(targetMesh, params) : null;
  const halfW = params.geometry.sheetWidth * 0.5;
  for (let idx = 0; idx < totalRays; idx += traceStride) {
    const ray = rays[idx];
    const origin = source;
    const dir = ray.direction;
    tracedCount += 1;
    tracedOrdinal += 1;

    let hit = null;
    if (doRestPreview) {
      hit = intersectRestPlaneRect(origin, dir, params);
    } else if (fastProfile) {
      hit = fastIntersectStrip(origin, dir, halfW, fastProfile);
    } else {
      _raycaster.set(origin, dir);
      _raycaster.firstHitOnly = true;
      const intersections = _raycaster.intersectObject(targetMesh, false);
      if (intersections.length) {
        const nearest = intersections[0];
        hit = {
          point: nearest.point.clone(),
          normal: getIntersectionNormal(nearest, targetMesh),
          distance: nearest.distance
        };
      }
    }

    const inDrawSet = tracedOrdinal % drawStride === 0;
    const for2D = !params.optics.centerSliceOnlyIn2D || ray.isCenterSlice;

    if (hit) {
      hitCount += 1;
      _point.copy(hit.point);
      _incoming.copy(dir).normalize();
      const n = orientNormalAgainstIncoming(hit.normal, _incoming);
      _ref.copy(reflectDirection(_incoming, n));
      _vA.copy(_point).addScaledVector(_ref, params.optics.reflectedLength);
      incidentSamples.push(origin.x, origin.y, origin.z, _incoming.x, _incoming.y, _incoming.z);
      incidentLengths.push(Math.max(0, _point.distanceTo(origin)));
      reflectedSamples.push(_point.x, _point.y, _point.z, _ref.x, _ref.y, _ref.z);

      if (inDrawSet) {
        pushSeg(inc, origin, _point);
        pushSeg(refl, _point, _vA);
        pushPoint(hitPts, _point);
      }
      if (for2D) {
        overlay.incident.push({
          from: { x: origin.z, y: -origin.y },
          to: { x: _point.z, y: -_point.y }
        });
        overlay.reflected.push({
          from: { x: _point.z, y: -_point.y },
          to: { x: _vA.z, y: -_vA.y }
        });
      }
    } else {
      missCount += 1;
      _vB.copy(missEndpoint(origin, dir, params));
      if (inDrawSet) pushSeg(miss, origin, _vB);
      if (for2D) {
        overlay.misses.push({
          from: { x: origin.z, y: -origin.y },
          to: { x: _vB.z, y: -_vB.y }
        });
      }
    }
  }

  const runtime = opticsState.runtime;
  runtime.totalRays = tracedCount;
  runtime.hitCount = hitCount;
  runtime.missCount = missCount;
  runtime.hitFraction = tracedCount > 0 ? (hitCount / tracedCount) * 100 : 0;
  runtime.incidentPositions = new Float32Array(inc);
  runtime.incidentRaySamples = new Float32Array(incidentSamples);
  runtime.incidentRayLengths = new Float32Array(incidentLengths);
  runtime.incidentRayCount = incidentLengths.length;
  runtime.reflectedPositions = new Float32Array(refl);
  runtime.reflectedRaySamples = new Float32Array(reflectedSamples);
  runtime.reflectedRayCount = hitCount;
  runtime.missPositions = new Float32Array(miss);
  runtime.hitPointPositions = new Float32Array(hitPts);
  runtime.overlay2d = overlay;
}
