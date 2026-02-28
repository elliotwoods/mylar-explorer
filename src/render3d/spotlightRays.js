import * as THREE from "three";

function makeLineSegments(color, opacity) {
  const geom = new THREE.BufferGeometry();
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  return new THREE.LineSegments(geom, mat);
}

function setLinePositions(line, positions) {
  line.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  line.geometry.computeBoundingSphere();
}

export function createSpotlightRays(scene, params) {
  const group = new THREE.Group();
  group.name = "spotlight-rays";
  scene.add(group);

  const sourceGroup = new THREE.Group();
  const sourceMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xfff7a0, emissive: 0x332a00, metalness: 0.1, roughness: 0.35 })
  );
  sourceGroup.add(sourceMarker);
  group.add(sourceGroup);

  const incidentLine = makeLineSegments(0x6dd5ff, params.optics.incidentOpacity);
  const reflectedLine = makeLineSegments(0xffdc8a, params.optics.reflectedOpacity);
  const missLine = makeLineSegments(0xff7777, params.optics.missOpacity);
  group.add(incidentLine, reflectedLine, missLine);

  const hitGeom = new THREE.BufferGeometry();
  const hitMat = new THREE.PointsMaterial({
    color: 0xfff6d0,
    size: 0.03,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9
  });
  const hitPoints = new THREE.Points(hitGeom, hitMat);
  group.add(hitPoints);
  let debugMode = "default";

  function updateVisibility() {
    if (debugMode === "hidden") {
      group.visible = false;
      return;
    }
    group.visible = params.optics.enabled;
    if (debugMode === "reflected-only") {
      sourceGroup.visible = false;
      incidentLine.visible = false;
      reflectedLine.visible = true;
      missLine.visible = false;
      hitPoints.visible = false;
      return;
    }
    sourceGroup.visible = params.optics.sourceVisible;
    incidentLine.visible = params.optics.incidentVisible;
    reflectedLine.visible = params.optics.reflectedVisible;
    missLine.visible = params.optics.missVisible;
    hitPoints.visible = params.optics.hitPointVisible;
  }

  function updateMaterials() {
    incidentLine.material.opacity = params.optics.incidentOpacity * params.optics.rayOpacity;
    reflectedLine.material.opacity = params.optics.reflectedOpacity * params.optics.rayOpacity;
    missLine.material.opacity = params.optics.missOpacity * params.optics.rayOpacity;
    incidentLine.material.transparent = incidentLine.material.opacity < 1;
    reflectedLine.material.transparent = reflectedLine.material.opacity < 1;
    missLine.material.transparent = missLine.material.opacity < 1;
    incidentLine.material.needsUpdate = true;
    reflectedLine.material.needsUpdate = true;
    missLine.material.needsUpdate = true;
  }

  function updateFromState(opticsState) {
    sourceGroup.position.set(params.optics.sourceX, params.optics.sourceY, params.optics.sourceZ);
    const r = opticsState.runtime;
    setLinePositions(incidentLine, r.incidentPositions);
    setLinePositions(reflectedLine, r.reflectedPositions);
    setLinePositions(missLine, r.missPositions);
    hitGeom.setAttribute("position", new THREE.BufferAttribute(r.hitPointPositions, 3));
    hitGeom.computeBoundingSphere();
    updateVisibility();
    updateMaterials();
  }

  return {
    updateFromState,
    updateVisibility,
    updateMaterials,
    setDebugMode(mode) {
      debugMode = mode || "default";
      updateVisibility();
    },
    dispose() {
      incidentLine.geometry.dispose();
      reflectedLine.geometry.dispose();
      missLine.geometry.dispose();
      hitGeom.dispose();
      incidentLine.material.dispose();
      reflectedLine.material.dispose();
      missLine.material.dispose();
      hitMat.dispose();
      sourceMarker.geometry.dispose();
      sourceMarker.material.dispose();
      scene.remove(group);
    }
  };
}
