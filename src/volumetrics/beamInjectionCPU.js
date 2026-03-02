import * as THREE from "three/webgpu";
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
const _kernelCoordsX = new Int16Array(5);
const _kernelCoordsY = new Int16Array(5);
const _kernelCoordsZ = new Int16Array(5);
const _kernelWeightsX = new Float32Array(5);
const _kernelWeightsY = new Float32Array(5);
const _kernelWeightsZ = new Float32Array(5);

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

  let xCount = 0;
  let yCount = 0;
  let zCount = 0;
  let xWeightSum = 0;
  let yWeightSum = 0;
  let zWeightSum = 0;

  for (let x = centerX - rx; x <= centerX + rx; x += 1) {
    if (x < 0 || x >= resolution.x) continue;
    const dx = (x - gx) / sigmaX;
    const w = Math.exp(-0.5 * dx * dx);
    _kernelCoordsX[xCount] = x;
    _kernelWeightsX[xCount] = w;
    xWeightSum += w;
    xCount += 1;
  }

  for (let y = centerY - ry; y <= centerY + ry; y += 1) {
    if (y < 0 || y >= resolution.y) continue;
    const dy = (y - gy) / sigmaY;
    const w = Math.exp(-0.5 * dy * dy);
    _kernelCoordsY[yCount] = y;
    _kernelWeightsY[yCount] = w;
    yWeightSum += w;
    yCount += 1;
  }

  for (let z = centerZ - rz; z <= centerZ + rz; z += 1) {
    if (z < 0 || z >= resolution.z) continue;
    const dz = (z - gz) / sigmaZ;
    const w = Math.exp(-0.5 * dz * dz);
    _kernelCoordsZ[zCount] = z;
    _kernelWeightsZ[zCount] = w;
    zWeightSum += w;
    zCount += 1;
  }

  const weightSum = xWeightSum * yWeightSum * zWeightSum;
  if (weightSum < 1e-8 || !xCount || !yCount || !zCount) {
    depositTrilinear(volumeData, resolution, gx, gy, gz, energy);
    return;
  }

  const scale = energy / weightSum;
  const strideX = resolution.x;
  const strideY = resolution.x * resolution.y;

  for (let zi = 0; zi < zCount; zi += 1) {
    const zCoord = _kernelCoordsZ[zi];
    const wz = _kernelWeightsZ[zi];
    const zBase = zCoord * strideY;

    for (let yi = 0; yi < yCount; yi += 1) {
      const yCoord = _kernelCoordsY[yi];
      const wyz = _kernelWeightsY[yi] * wz;
      const yzBase = zBase + yCoord * strideX;

      for (let xi = 0; xi < xCount; xi += 1) {
        const index = yzBase + _kernelCoordsX[xi];
        volumeData[index] += scale * _kernelWeightsX[xi] * wyz;
      }
    }
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

  const reflectedSamples = opticsState.runtime.reflectedRaySamples;
  const reflectedCount = opticsState.runtime.reflectedRayCount || 0;
  const incidentSamples = opticsState.runtime.incidentRaySamples;
  const incidentLengths = opticsState.runtime.incidentRayLengths;
  const incidentCount = opticsState.runtime.incidentRayCount || 0;
  const includeIncident = !!params.volumetrics.injectIncidentRays;

  if ((!reflectedSamples || !reflectedCount) && (!includeIncident || !incidentSamples || !incidentCount)) {
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

  function injectRaySet(samples, rayCount, lengths) {
    for (let i = 0; i < rayCount; i += 1) {
      const base = i * 6;
      _pos.set(samples[base], samples[base + 1], samples[base + 2]);
      const dirX = samples[base + 3];
      const dirY = samples[base + 4];
      const dirZ = samples[base + 5];

      const isect = rayAabbIntersection(_pos, { x: dirX, y: dirY, z: dirZ }, boundsMin, boundsMax, _isect);
      if (!isect) continue;

      const rayLengthLimit = lengths ? Math.max(0, lengths[i] || 0) : maxBeamDistance;
      const tEntry = Math.max(0, isect.tMin);
      const tExit = Math.min(maxBeamDistance, rayLengthLimit, isect.tMax);
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
  }

  injectRaySet(reflectedSamples, reflectedCount, null);
  if (includeIncident) {
    injectRaySet(incidentSamples, incidentCount, incidentLengths);
  }

  if (stats) {
    stats.validReflectedRays = reflectedCount;
    stats.injectedRays = injectedRays;
  }
}
