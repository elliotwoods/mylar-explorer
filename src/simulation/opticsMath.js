import * as THREE from "three/webgpu";

export function reflectDirection(incomingDir, surfaceNormal) {
  // r = d - 2 * dot(d, n) * n
  const dot = incomingDir.dot(surfaceNormal);
  return incomingDir.clone().addScaledVector(surfaceNormal, -2 * dot).normalize();
}

export function orientNormalAgainstIncoming(normal, incomingDir) {
  return normal.dot(incomingDir) > 0 ? normal.clone().multiplyScalar(-1) : normal.clone();
}

// Minimal runtime sanity check for sign conventions.
export function runOpticsMathSelfTest() {
  const d = new THREE.Vector3(0, -1, 0);
  const n = new THREE.Vector3(0, 1, 0);
  const r = reflectDirection(d, n);
  const ok = Math.abs(r.x - 0) < 1e-6 && Math.abs(r.y - 1) < 1e-6 && Math.abs(r.z - 0) < 1e-6;
  if (!ok) {
    console.warn("[optics] reflection self-test failed", r);
  }
}
