import * as THREE from "three";
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

export function updateOptics(params, opticsState, targetMesh) {
  if (!params.optics.enabled || !targetMesh) {
    const runtime = opticsState.runtime;
    runtime.hitCount = 0;
    runtime.missCount = 0;
    runtime.hitFraction = 0;
    runtime.incidentPositions = new Float32Array();
    runtime.reflectedPositions = new Float32Array();
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
  if (params.optics.freeze && opticsState.runtime.totalRays > 0) return;

  const source = sourceFromParams(params);
  const rays = opticsState.rays;
  const totalRays = rays.length;
  if (!totalRays) return;

  const traceStride = Math.max(1, Math.ceil(totalRays / Math.max(1, params.optics.maxTracedRays)));
  const drawStride = Math.max(1, Math.ceil(totalRays / Math.max(1, params.optics.maxRenderedRays)));
  const inc = [];
  const refl = [];
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
  const doRestPreview = params.optics.restStatePreview;

  targetMesh.updateMatrixWorld(true);
  for (let idx = 0; idx < totalRays; idx += traceStride) {
    const ray = rays[idx];
    const origin = source;
    const dir = ray.direction;
    tracedCount += 1;

    let hit = null;
    if (doRestPreview) {
      hit = intersectRestPlaneRect(origin, dir, params);
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

    const inDrawSet = idx % drawStride === 0;
    const for2D = !params.optics.centerSliceOnlyIn2D || ray.isCenterSlice;

    if (hit) {
      hitCount += 1;
      _point.copy(hit.point);
      _incoming.copy(dir).normalize();
      const n = orientNormalAgainstIncoming(hit.normal, _incoming);
      _ref.copy(reflectDirection(_incoming, n));
      _vA.copy(_point).addScaledVector(_ref, params.optics.reflectedLength);

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
      _vB.copy(origin).addScaledVector(dir, params.optics.missLength);
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
  runtime.reflectedPositions = new Float32Array(refl);
  runtime.missPositions = new Float32Array(miss);
  runtime.hitPointPositions = new Float32Array(hitPts);
  runtime.overlay2d = overlay;
}
