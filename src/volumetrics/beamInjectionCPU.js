import * as THREE from "three";
import {
  clamp,
  computeVoxelSize,
  rayAabbIntersection,
  volumeGridToLinearIndex,
  worldToVolumeGrid
} from "./volumetricMath.js";

const _pos = new THREE.Vector3();
const _grid = new THREE.Vector3();
const _isect = { tMin: 0, tMax: 0 };
const _voxel = new THREE.Vector3();

function clearVolume(volumeData) {
  volumeData.fill(0);
}

function depositNearest(volumeData, resolution, gx, gy, gz, energy) {
  const ix = clamp(Math.round(gx), 0, resolution.x - 1);
  const iy = clamp(Math.round(gy), 0, resolution.y - 1);
  const iz = clamp(Math.round(gz), 0, resolution.z - 1);
  volumeData[volumeGridToLinearIndex(ix, iy, iz, resolution)] += energy;
}

function depositTrilinear(volumeData, resolution, gx, gy, gz, energy) {
  const x0 = clamp(Math.floor(gx), 0, resolution.x - 1);
  const y0 = clamp(Math.floor(gy), 0, resolution.y - 1);
  const z0 = clamp(Math.floor(gz), 0, resolution.z - 1);
  const x1 = Math.min(resolution.x - 1, x0 + 1);
  const y1 = Math.min(resolution.y - 1, y0 + 1);
  const z1 = Math.min(resolution.z - 1, z0 + 1);

  const fx = clamp(gx - x0, 0, 1);
  const fy = clamp(gy - y0, 0, 1);
  const fz = clamp(gz - z0, 0, 1);

  const wx0 = 1 - fx;
  const wy0 = 1 - fy;
  const wz0 = 1 - fz;
  const wx1 = fx;
  const wy1 = fy;
  const wz1 = fz;

  volumeData[volumeGridToLinearIndex(x0, y0, z0, resolution)] += energy * wx0 * wy0 * wz0;
  volumeData[volumeGridToLinearIndex(x1, y0, z0, resolution)] += energy * wx1 * wy0 * wz0;
  volumeData[volumeGridToLinearIndex(x0, y1, z0, resolution)] += energy * wx0 * wy1 * wz0;
  volumeData[volumeGridToLinearIndex(x1, y1, z0, resolution)] += energy * wx1 * wy1 * wz0;
  volumeData[volumeGridToLinearIndex(x0, y0, z1, resolution)] += energy * wx0 * wy0 * wz1;
  volumeData[volumeGridToLinearIndex(x1, y0, z1, resolution)] += energy * wx1 * wy0 * wz1;
  volumeData[volumeGridToLinearIndex(x0, y1, z1, resolution)] += energy * wx0 * wy1 * wz1;
  volumeData[volumeGridToLinearIndex(x1, y1, z1, resolution)] += energy * wx1 * wy1 * wz1;
}

function depositSoftKernel(volumeData, resolution, gx, gy, gz, radiusCells, energy) {
  const centerX = Math.floor(gx);
  const centerY = Math.floor(gy);
  const centerZ = Math.floor(gz);

  const rx = Math.max(1, Math.min(2, Math.ceil(radiusCells.x)));
  const ry = Math.max(1, Math.min(2, Math.ceil(radiusCells.y)));
  const rz = Math.max(1, Math.min(2, Math.ceil(radiusCells.z)));

  const sigmaX = Math.max(0.5, radiusCells.x);
  const sigmaY = Math.max(0.5, radiusCells.y);
  const sigmaZ = Math.max(0.5, radiusCells.z);

  let weightSum = 0;
  const contributions = [];

  for (let z = centerZ - rz; z <= centerZ + rz; z += 1) {
    if (z < 0 || z >= resolution.z) continue;
    for (let y = centerY - ry; y <= centerY + ry; y += 1) {
      if (y < 0 || y >= resolution.y) continue;
      for (let x = centerX - rx; x <= centerX + rx; x += 1) {
        if (x < 0 || x >= resolution.x) continue;
        const dx = (x - gx) / sigmaX;
        const dy = (y - gy) / sigmaY;
        const dz = (z - gz) / sigmaZ;
        const w = Math.exp(-0.5 * (dx * dx + dy * dy + dz * dz));
        weightSum += w;
        contributions.push({
          index: volumeGridToLinearIndex(x, y, z, resolution),
          weight: w
        });
      }
    }
  }

  if (weightSum < 1e-8) {
    depositTrilinear(volumeData, resolution, gx, gy, gz, energy);
    return;
  }
  const inv = 1 / weightSum;
  for (let i = 0; i < contributions.length; i += 1) {
    const c = contributions[i];
    volumeData[c.index] += energy * c.weight * inv;
  }
}

export function injectReflectedBeamsCPU({
  params,
  opticsState,
  volumeData,
  resolution,
  boundsMin,
  boundsMax,
  stats
}) {
  if (!volumeData || !opticsState?.runtime) return;
  if (params.volumetrics.clearEachFrame || params.volumetrics.temporalAccumulation) clearVolume(volumeData);

  const samples = opticsState.runtime.reflectedRaySamples;
  const rayCount = opticsState.runtime.reflectedRayCount || 0;
  if (!samples || !rayCount) {
    if (stats) {
      stats.validReflectedRays = 0;
      stats.injectedRays = 0;
    }
    return;
  }

  computeVoxelSize(boundsMin, boundsMax, resolution, _voxel);

  const stepSize = Math.max(0.02, params.volumetrics.beamStepSize);
  const maxBeamDistance = Math.max(0.25, params.volumetrics.maxBeamDistance);
  const radiusMeters = Math.max(0, params.volumetrics.depositionRadius);
  const baseEnergyPerRay = Math.max(0, params.volumetrics.injectionIntensity);
  const radiusCells = new THREE.Vector3(
    radiusMeters / Math.max(1e-6, _voxel.x),
    radiusMeters / Math.max(1e-6, _voxel.y),
    radiusMeters / Math.max(1e-6, _voxel.z)
  );

  let injectedRays = 0;

  for (let i = 0; i < rayCount; i += 1) {
    const base = i * 6;
    _pos.set(samples[base], samples[base + 1], samples[base + 2]);
    const dirX = samples[base + 3];
    const dirY = samples[base + 4];
    const dirZ = samples[base + 5];

    const isect = rayAabbIntersection(_pos, { x: dirX, y: dirY, z: dirZ }, boundsMin, boundsMax, _isect);
    if (!isect) continue;

    const tEntry = Math.max(0, isect.tMin);
    const tExit = Math.min(maxBeamDistance, isect.tMax);
    if (tExit <= tEntry) continue;

    injectedRays += 1;
    const segmentLength = tExit - tEntry;
    const steps = Math.max(1, Math.ceil(segmentLength / stepSize));
    const energyPerStep = baseEnergyPerRay / steps;

    for (let s = 0; s < steps; s += 1) {
      const t = tEntry + ((s + 0.5) / steps) * segmentLength;
      _pos.set(
        samples[base] + dirX * t,
        samples[base + 1] + dirY * t,
        samples[base + 2] + dirZ * t
      );
      worldToVolumeGrid(_pos, boundsMin, boundsMax, resolution, _grid);

      if (
        _grid.x < -0.5 || _grid.x > resolution.x - 0.5 ||
        _grid.y < -0.5 || _grid.y > resolution.y - 0.5 ||
        _grid.z < -0.5 || _grid.z > resolution.z - 0.5
      ) {
        continue;
      }

      if (radiusMeters <= Math.min(_voxel.x, _voxel.y, _voxel.z) * 0.6) {
        if (radiusMeters <= 1e-4) {
          depositNearest(volumeData, resolution, _grid.x, _grid.y, _grid.z, energyPerStep);
        } else {
          depositTrilinear(volumeData, resolution, _grid.x, _grid.y, _grid.z, energyPerStep);
        }
      } else {
        depositSoftKernel(volumeData, resolution, _grid.x, _grid.y, _grid.z, radiusCells, energyPerStep);
      }
    }
  }

  if (stats) {
    stats.validReflectedRays = rayCount;
    stats.injectedRays = injectedRays;
  }
}
