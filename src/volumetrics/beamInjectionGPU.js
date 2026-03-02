import * as THREE from "three/webgpu";
import {
  Fn,
  Loop,
  If,
  Break,
  Return,
  uniform,
  float,
  int,
  uint,
  vec3,
  vec4,
  uvec3,
  instanceIndex,
  attributeArray,
  textureStore,
  atomicAdd,
  atomicStore,
  atomicLoad,
  min,
  max,
  abs,
  floor,
  ceil,
  round,
  clamp,
  reciprocal,
  select
} from "three/tsl";

const INJECTOR_BY_RENDERER = new WeakMap();
const ATOMIC_SCALE = 8192;
const MAX_DDA_STEPS = 512;

function formatMs(ms) {
  return `${Math.max(0, ms).toFixed(2)}`;
}

function nextPow2(value) {
  let v = Math.max(1, value | 0);
  v -= 1;
  v |= v >> 1;
  v |= v >> 2;
  v |= v >> 4;
  v |= v >> 8;
  v |= v >> 16;
  return v + 1;
}

function supportsGPUInjection(renderer) {
  return !!renderer?.backend?.isWebGPUBackend;
}

function getPairScope(params) {
  return params?.volumetrics?.pairInjectionScope === "reflected+incident"
    ? "reflected+incident"
    : "reflected";
}

class WebGPUBeamInjector {
  constructor(renderer) {
    this.renderer = renderer;
    this.failed = false;
    this.pairCapacity = 0;
    this.voxelCount = 0;
    this.resolution = { x: 0, y: 0, z: 0 };
    this.volumeStorageTexture = null;

    this.pair0A = null;
    this.pair0B = null;
    this.pair1A = null;
    this.pair1B = null;
    this.accum = null;
    this.history = null;
    this.volume = null;

    this.computeClearAccum = null;
    this.computeInject = null;
    this.computeResolve = null;
    this.computeClearHistory = null;

    this.scratchPair0A = new Float32Array(4);
    this.scratchPair0B = new Float32Array(4);
    this.scratchPair1A = new Float32Array(4);
    this.scratchPair1B = new Float32Array(4);
    this.gridMap = null;
    this.clearHistoryRequested = true;
    this.copyRegion = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1));

    this.uniforms = {
      pairCount: uniform(0, "int"),
      dispatchSteps: uniform(1, "int"),
      voxelCount: uniform(1, "int"),
      resX: uniform(1, "int"),
      resY: uniform(1, "int"),
      resZ: uniform(1, "int"),
      boundsMin: uniform(new THREE.Vector3()),
      boundsMax: uniform(new THREE.Vector3()),
      stepSize: uniform(0.2),
      maxBeamDistance: uniform(12.0),
      injectionIntensity: uniform(1.0),
      temporalAccum: uniform(1, "int"),
      temporalDecay: uniform(0.9),
      temporalBlend: uniform(0.4),
      clearEachFrame: uniform(1, "int"),
      atomicScale: uniform(ATOMIC_SCALE),
      invAtomicScale: uniform(1 / ATOMIC_SCALE)
    };
  }

  _createStorageTexture(resolution) {
    const texture = new THREE.Storage3DTexture(resolution.x, resolution.y, resolution.z);
    texture.type = THREE.FloatType;
    texture.format = THREE.RedFormat;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    return texture;
  }

  _disposeComputeNodes() {
    if (this.computeClearAccum) this.computeClearAccum.dispose();
    if (this.computeInject) this.computeInject.dispose();
    if (this.computeResolve) this.computeResolve.dispose();
    if (this.computeClearHistory) this.computeClearHistory.dispose();
    this.computeClearAccum = null;
    this.computeInject = null;
    this.computeResolve = null;
    this.computeClearHistory = null;
  }

  _ensureBuffers(pairCapacity, resolution) {
    let rebuild = false;

    if (
      pairCapacity > this.pairCapacity ||
      this.pair0A === null ||
      this.pair0B === null ||
      this.pair1A === null ||
      this.pair1B === null
    ) {
      this.pairCapacity = nextPow2(Math.max(1, pairCapacity));
      this.pair0A = attributeArray(this.pairCapacity, "vec4").toReadOnly();
      this.pair0B = attributeArray(this.pairCapacity, "vec4").toReadOnly();
      this.pair1A = attributeArray(this.pairCapacity, "vec4").toReadOnly();
      this.pair1B = attributeArray(this.pairCapacity, "vec4").toReadOnly();
      this.scratchPair0A = this.pair0A.value.array;
      this.scratchPair0B = this.pair0B.value.array;
      this.scratchPair1A = this.pair1A.value.array;
      this.scratchPair1B = this.pair1B.value.array;
      rebuild = true;
    }

    const voxelCount = resolution.x * resolution.y * resolution.z;
    if (
      voxelCount !== this.voxelCount ||
      resolution.x !== this.resolution.x ||
      resolution.y !== this.resolution.y ||
      resolution.z !== this.resolution.z
    ) {
      this.voxelCount = voxelCount;
      this.resolution = { ...resolution };
      this.accum = attributeArray(voxelCount, "uint").toAtomic();
      this.history = attributeArray(voxelCount, "float");
      this.volume = attributeArray(voxelCount, "float");
      if (this.volumeStorageTexture) this.volumeStorageTexture.dispose();
      this.volumeStorageTexture = this._createStorageTexture(resolution);
      this.clearHistoryRequested = true;
      rebuild = true;
    }

    if (rebuild) {
      this._disposeComputeNodes();
      this._buildComputeNodes();
    }
  }

  _buildComputeNodes() {
    if (
      !this.pair0A ||
      !this.pair0B ||
      !this.pair1A ||
      !this.pair1B ||
      !this.accum ||
      !this.history ||
      !this.volume ||
      !this.volumeStorageTexture
    ) {
      return;
    }

    const u = this.uniforms;

    const clearAccumFn = Fn(() => {
      const idx = int(instanceIndex);
      If(idx.greaterThanEqual(u.voxelCount), () => { Return(); });
      atomicStore(this.accum.element(idx), uint(0));
    });

    const clearHistoryFn = Fn(() => {
      const idx = int(instanceIndex);
      If(idx.greaterThanEqual(u.voxelCount), () => { Return(); });

      atomicStore(this.accum.element(idx), uint(0));
      this.history.element(idx).assign(float(0));
      this.volume.element(idx).assign(float(0));

      const resX = u.resX;
      const resY = u.resY;
      const strideY = resX.mul(resY);
      const z = idx.div(strideY);
      const yz = idx.sub(z.mul(strideY));
      const y = yz.div(resX);
      const x = yz.sub(y.mul(resX));

      textureStore(
        this.volumeStorageTexture,
        uvec3(uint(x), uint(y), uint(z)),
        vec4(float(0), float(0), float(0), float(1))
      );
    });

    const injectFn = Fn(() => {
      const idx = int(instanceIndex);
      const dispatchSteps = max(u.dispatchSteps, int(1));
      const pairIndex = idx.div(dispatchSteps);
      const stepIndex = idx.sub(pairIndex.mul(dispatchSteps));

      If(pairIndex.greaterThanEqual(u.pairCount), () => { Return(); });

      const pair0A = this.pair0A.element(pairIndex);
      const pair0B = this.pair0B.element(pairIndex);
      const pair1A = this.pair1A.element(pairIndex);
      const pair1B = this.pair1B.element(pairIndex);

      const origin0 = pair0A.xyz;
      const origin1 = pair1A.xyz;
      const dir0 = vec3(pair0A.w, pair0B.x, pair0B.y);
      const dir1 = vec3(pair1A.w, pair1B.x, pair1B.y);
      const rayLength0 = max(float(0), pair0B.z);
      const rayLength1 = max(float(0), pair1B.z);

      const safe0x = select(
        abs(dir0.x).lessThan(float(1e-6)),
        select(dir0.x.greaterThanEqual(float(0)), float(1e-6), float(-1e-6)),
        dir0.x
      );
      const safe0y = select(
        abs(dir0.y).lessThan(float(1e-6)),
        select(dir0.y.greaterThanEqual(float(0)), float(1e-6), float(-1e-6)),
        dir0.y
      );
      const safe0z = select(
        abs(dir0.z).lessThan(float(1e-6)),
        select(dir0.z.greaterThanEqual(float(0)), float(1e-6), float(-1e-6)),
        dir0.z
      );
      const safe1x = select(
        abs(dir1.x).lessThan(float(1e-6)),
        select(dir1.x.greaterThanEqual(float(0)), float(1e-6), float(-1e-6)),
        dir1.x
      );
      const safe1y = select(
        abs(dir1.y).lessThan(float(1e-6)),
        select(dir1.y.greaterThanEqual(float(0)), float(1e-6), float(-1e-6)),
        dir1.y
      );
      const safe1z = select(
        abs(dir1.z).lessThan(float(1e-6)),
        select(dir1.z.greaterThanEqual(float(0)), float(1e-6), float(-1e-6)),
        dir1.z
      );

      const invDir0 = reciprocal(vec3(safe0x, safe0y, safe0z));
      const invDir1 = reciprocal(vec3(safe1x, safe1y, safe1z));

      const t00 = u.boundsMin.sub(origin0).mul(invDir0);
      const t01 = u.boundsMax.sub(origin0).mul(invDir0);
      const t10 = u.boundsMin.sub(origin1).mul(invDir1);
      const t11 = u.boundsMax.sub(origin1).mul(invDir1);
      const t0Small = min(t00, t01);
      const t0Big = max(t00, t01);
      const t1Small = min(t10, t11);
      const t1Big = max(t10, t11);

      const t0Near = max(max(t0Small.x, t0Small.y), t0Small.z);
      const t0Far = min(min(t0Big.x, t0Big.y), t0Big.z);
      const t1Near = max(max(t1Small.x, t1Small.y), t1Small.z);
      const t1Far = min(min(t1Big.x, t1Big.y), t1Big.z);

      const t0Entry = max(t0Near, float(0));
      const t1Entry = max(t1Near, float(0));
      const t0Exit = min(min(t0Far, u.maxBeamDistance), rayLength0);
      const t1Exit = min(min(t1Far, u.maxBeamDistance), rayLength1);

      const tStart = max(t0Entry, t1Entry);
      const tEnd = min(t0Exit, t1Exit);
      If(tEnd.lessThanEqual(tStart), () => { Return(); });

      const segmentLength = tEnd.sub(tStart);
      const rawSteps = max(int(1), int(ceil(segmentLength.div(max(u.stepSize, float(1e-4))))));
      const pairSteps = min(rawSteps, dispatchSteps);
      If(stepIndex.greaterThanEqual(pairSteps), () => { Return(); });

      const t = tStart.add(
        float(stepIndex).add(float(0.5)).div(float(pairSteps)).mul(segmentLength)
      );
      const world0 = origin0.add(dir0.mul(t));
      const world1 = origin1.add(dir1.mul(t));

      const boundsSize = max(u.boundsMax.sub(u.boundsMin), vec3(1e-6));
      const resX = u.resX;
      const resY = u.resY;
      const resZ = u.resZ;
      const resXm1 = max(int(1), resX.sub(int(1)));
      const resYm1 = max(int(1), resY.sub(int(1)));
      const resZm1 = max(int(1), resZ.sub(int(1)));

      const grid0 = world0
        .sub(u.boundsMin)
        .div(boundsSize)
        .mul(vec3(float(resXm1), float(resYm1), float(resZm1)));
      const grid1 = world1
        .sub(u.boundsMin)
        .div(boundsSize)
        .mul(vec3(float(resXm1), float(resYm1), float(resZm1)));

      If(
        grid0.x.lessThan(float(-0.5))
          .or(grid0.x.greaterThan(float(resX).sub(float(0.5))))
          .or(grid0.y.lessThan(float(-0.5)))
          .or(grid0.y.greaterThan(float(resY).sub(float(0.5))))
          .or(grid0.z.lessThan(float(-0.5)))
          .or(grid0.z.greaterThan(float(resZ).sub(float(0.5))))
          .or(grid1.x.lessThan(float(-0.5)))
          .or(grid1.x.greaterThan(float(resX).sub(float(0.5))))
          .or(grid1.y.lessThan(float(-0.5)))
          .or(grid1.y.greaterThan(float(resY).sub(float(0.5))))
          .or(grid1.z.lessThan(float(-0.5)))
          .or(grid1.z.greaterThan(float(resZ).sub(float(0.5)))),
        () => { Return(); }
      );

      const energyPerStep = max(float(0), u.injectionIntensity.div(float(pairSteps)));

      const half = vec3(float(0.5), float(0.5), float(0.5));
      const s0 = grid0.add(half);
      const s1 = grid1.add(half);
      const endX = int(clamp(floor(s1.x), float(0), float(resX.sub(int(1)))));
      const endY = int(clamp(floor(s1.y), float(0), float(resY.sub(int(1)))));
      const endZ = int(clamp(floor(s1.z), float(0), float(resZ.sub(int(1)))));
      const delta = s1.sub(s0);
      const bigT = float(1e20);

      // Pass A: count voxels in the supercover traversal.
      const vxA = int(clamp(floor(s0.x), float(0), float(resX.sub(int(1))))).toVar();
      const vyA = int(clamp(floor(s0.y), float(0), float(resY.sub(int(1))))).toVar();
      const vzA = int(clamp(floor(s0.z), float(0), float(resZ.sub(int(1))))).toVar();
      const stepXA = select(
        delta.x.greaterThan(float(1e-6)),
        int(1),
        select(delta.x.lessThan(float(-1e-6)), int(-1), int(0))
      );
      const stepYA = select(
        delta.y.greaterThan(float(1e-6)),
        int(1),
        select(delta.y.lessThan(float(-1e-6)), int(-1), int(0))
      );
      const stepZA = select(
        delta.z.greaterThan(float(1e-6)),
        int(1),
        select(delta.z.lessThan(float(-1e-6)), int(-1), int(0))
      );
      const tDeltaXA = select(stepXA.equal(int(0)), bigT, reciprocal(max(abs(delta.x), float(1e-6))));
      const tDeltaYA = select(stepYA.equal(int(0)), bigT, reciprocal(max(abs(delta.y), float(1e-6))));
      const tDeltaZA = select(stepZA.equal(int(0)), bigT, reciprocal(max(abs(delta.z), float(1e-6))));
      const safeDeltaXA = select(stepXA.equal(int(0)), float(1), delta.x);
      const safeDeltaYA = select(stepYA.equal(int(0)), float(1), delta.y);
      const safeDeltaZA = select(stepZA.equal(int(0)), float(1), delta.z);
      const nextBoundaryXA = select(stepXA.greaterThan(int(0)), float(vxA.add(int(1))), float(vxA));
      const nextBoundaryYA = select(stepYA.greaterThan(int(0)), float(vyA.add(int(1))), float(vyA));
      const nextBoundaryZA = select(stepZA.greaterThan(int(0)), float(vzA.add(int(1))), float(vzA));
      const tMaxXA = select(stepXA.equal(int(0)), bigT, nextBoundaryXA.sub(s0.x).div(safeDeltaXA)).toVar();
      const tMaxYA = select(stepYA.equal(int(0)), bigT, nextBoundaryYA.sub(s0.y).div(safeDeltaYA)).toVar();
      const tMaxZA = select(stepZA.equal(int(0)), bigT, nextBoundaryZA.sub(s0.z).div(safeDeltaZA)).toVar();
      const visited = int(0).toVar();

      Loop(MAX_DDA_STEPS, () => {
        If(
          vxA.lessThan(int(0))
            .or(vxA.greaterThanEqual(resX))
            .or(vyA.lessThan(int(0)))
            .or(vyA.greaterThanEqual(resY))
            .or(vzA.lessThan(int(0)))
            .or(vzA.greaterThanEqual(resZ)),
          () => { Break(); }
        );

        visited.addAssign(int(1));

        If(vxA.equal(endX).and(vyA.equal(endY)).and(vzA.equal(endZ)), () => { Break(); });

        const tNextA = min(tMaxXA, min(tMaxYA, tMaxZA));
        If(tMaxXA.lessThanEqual(tNextA), () => {
          vxA.addAssign(stepXA);
          tMaxXA.addAssign(tDeltaXA);
        });
        If(tMaxYA.lessThanEqual(tNextA), () => {
          vyA.addAssign(stepYA);
          tMaxYA.addAssign(tDeltaYA);
        });
        If(tMaxZA.lessThanEqual(tNextA), () => {
          vzA.addAssign(stepZA);
          tMaxZA.addAssign(tDeltaZA);
        });
      });

      If(visited.lessThanEqual(int(0)), () => { Return(); });

      const energyPerVoxel = energyPerStep.div(float(visited));
      const fixedPerVoxel = uint(max(float(0), round(energyPerVoxel.mul(u.atomicScale))));
      If(fixedPerVoxel.equal(uint(0)), () => { Return(); });

      // Pass B: replay traversal and deposit each crossed voxel.
      const vxB = int(clamp(floor(s0.x), float(0), float(resX.sub(int(1))))).toVar();
      const vyB = int(clamp(floor(s0.y), float(0), float(resY.sub(int(1))))).toVar();
      const vzB = int(clamp(floor(s0.z), float(0), float(resZ.sub(int(1))))).toVar();
      const stepXB = select(
        delta.x.greaterThan(float(1e-6)),
        int(1),
        select(delta.x.lessThan(float(-1e-6)), int(-1), int(0))
      );
      const stepYB = select(
        delta.y.greaterThan(float(1e-6)),
        int(1),
        select(delta.y.lessThan(float(-1e-6)), int(-1), int(0))
      );
      const stepZB = select(
        delta.z.greaterThan(float(1e-6)),
        int(1),
        select(delta.z.lessThan(float(-1e-6)), int(-1), int(0))
      );
      const tDeltaXB = select(stepXB.equal(int(0)), bigT, reciprocal(max(abs(delta.x), float(1e-6))));
      const tDeltaYB = select(stepYB.equal(int(0)), bigT, reciprocal(max(abs(delta.y), float(1e-6))));
      const tDeltaZB = select(stepZB.equal(int(0)), bigT, reciprocal(max(abs(delta.z), float(1e-6))));
      const safeDeltaXB = select(stepXB.equal(int(0)), float(1), delta.x);
      const safeDeltaYB = select(stepYB.equal(int(0)), float(1), delta.y);
      const safeDeltaZB = select(stepZB.equal(int(0)), float(1), delta.z);
      const nextBoundaryXB = select(stepXB.greaterThan(int(0)), float(vxB.add(int(1))), float(vxB));
      const nextBoundaryYB = select(stepYB.greaterThan(int(0)), float(vyB.add(int(1))), float(vyB));
      const nextBoundaryZB = select(stepZB.greaterThan(int(0)), float(vzB.add(int(1))), float(vzB));
      const tMaxXB = select(stepXB.equal(int(0)), bigT, nextBoundaryXB.sub(s0.x).div(safeDeltaXB)).toVar();
      const tMaxYB = select(stepYB.equal(int(0)), bigT, nextBoundaryYB.sub(s0.y).div(safeDeltaYB)).toVar();
      const tMaxZB = select(stepZB.equal(int(0)), bigT, nextBoundaryZB.sub(s0.z).div(safeDeltaZB)).toVar();

      Loop(MAX_DDA_STEPS, () => {
        If(
          vxB.lessThan(int(0))
            .or(vxB.greaterThanEqual(resX))
            .or(vyB.lessThan(int(0)))
            .or(vyB.greaterThanEqual(resY))
            .or(vzB.lessThan(int(0)))
            .or(vzB.greaterThanEqual(resZ)),
          () => { Break(); }
        );

        const linear = vxB.add(resX.mul(vyB.add(resY.mul(vzB))));
        atomicAdd(this.accum.element(linear), fixedPerVoxel);

        If(vxB.equal(endX).and(vyB.equal(endY)).and(vzB.equal(endZ)), () => { Break(); });

        const tNextB = min(tMaxXB, min(tMaxYB, tMaxZB));
        If(tMaxXB.lessThanEqual(tNextB), () => {
          vxB.addAssign(stepXB);
          tMaxXB.addAssign(tDeltaXB);
        });
        If(tMaxYB.lessThanEqual(tNextB), () => {
          vyB.addAssign(stepYB);
          tMaxYB.addAssign(tDeltaYB);
        });
        If(tMaxZB.lessThanEqual(tNextB), () => {
          vzB.addAssign(stepZB);
          tMaxZB.addAssign(tDeltaZB);
        });
      });
    });

    const resolveFn = Fn(() => {
      const idx = int(instanceIndex);
      If(idx.greaterThanEqual(u.voxelCount), () => { Return(); });

      const previousHistory = this.history.element(idx);
      const injected = float(atomicLoad(this.accum.element(idx))).mul(u.invAtomicScale);
      const base = select(u.clearEachFrame.equal(int(1)), float(0), previousHistory);
      const frameValue = base.add(injected);
      const mixed = float(0).toVar();
      If(u.temporalAccum.equal(int(1)), () => {
        mixed.assign(
          previousHistory
            .mul(u.temporalDecay)
            .mul(float(1).sub(u.temporalBlend))
            .add(frameValue.mul(u.temporalBlend))
        );
      }).Else(() => {
        mixed.assign(frameValue);
      });

      this.history.element(idx).assign(mixed);
      this.volume.element(idx).assign(mixed);

      const resX = u.resX;
      const resY = u.resY;
      const strideY = resX.mul(resY);
      const z = idx.div(strideY);
      const yz = idx.sub(z.mul(strideY));
      const y = yz.div(resX);
      const x = yz.sub(y.mul(resX));

      textureStore(
        this.volumeStorageTexture,
        uvec3(uint(x), uint(y), uint(z)),
        vec4(mixed, float(0), float(0), float(1))
      );
    });

    this.computeClearAccum = clearAccumFn().compute(1);
    this.computeInject = injectFn().compute(1);
    this.computeResolve = resolveFn().compute(1);
    this.computeClearHistory = clearHistoryFn().compute(1);
  }

  _buildGridMap(opticsState, uCount, vCount) {
    const runtime = opticsState?.runtime;
    const rays = opticsState?.rays || [];
    const reflectedIndices = runtime?.reflectedRayIndices || [];
    const reflectedCount = runtime?.reflectedRayCount || 0;

    const gridSize = uCount * vCount;
    if (!this.gridMap || this.gridMap.length < gridSize) {
      this.gridMap = new Int32Array(gridSize);
    }
    this.gridMap.fill(-1, 0, gridSize);

    const reflectedLimit = Math.min(reflectedCount, reflectedIndices.length);
    for (let k = 0; k < reflectedLimit; k += 1) {
      const origIdx = reflectedIndices[k];
      if (origIdx < 0 || origIdx >= rays.length) continue;
      const ray = rays[origIdx];
      if (!ray) continue;
      const i = ray.i | 0;
      const j = ray.j | 0;
      if (i < 0 || i >= uCount || j < 0 || j >= vCount) continue;
      this.gridMap[j * uCount + i] = k;
    }
  }

  _writePair(cursor, samples, lengths, k0, k1, fallbackLength) {
    const s0 = k0 * 6;
    const s1 = k1 * 6;
    if (
      s0 + 5 >= samples.length ||
      s1 + 5 >= samples.length
    ) {
      return false;
    }

    const d = cursor * 4;
    this.scratchPair0A[d] = samples[s0];
    this.scratchPair0A[d + 1] = samples[s0 + 1];
    this.scratchPair0A[d + 2] = samples[s0 + 2];
    this.scratchPair0A[d + 3] = samples[s0 + 3];
    this.scratchPair0B[d] = samples[s0 + 4];
    this.scratchPair0B[d + 1] = samples[s0 + 5];
    this.scratchPair0B[d + 2] = Math.max(0, lengths ? (lengths[k0] ?? fallbackLength) : fallbackLength);
    this.scratchPair0B[d + 3] = 0;

    this.scratchPair1A[d] = samples[s1];
    this.scratchPair1A[d + 1] = samples[s1 + 1];
    this.scratchPair1A[d + 2] = samples[s1 + 2];
    this.scratchPair1A[d + 3] = samples[s1 + 3];
    this.scratchPair1B[d] = samples[s1 + 4];
    this.scratchPair1B[d + 1] = samples[s1 + 5];
    this.scratchPair1B[d + 2] = Math.max(0, lengths ? (lengths[k1] ?? fallbackLength) : fallbackLength);
    this.scratchPair1B[d + 3] = 0;

    return true;
  }

  _uploadVerticalPairs({ params, opticsState, maxBeamDistance }) {
    const runtime = opticsState?.runtime;
    const reflectedSamples = runtime?.reflectedRaySamples;
    const reflectedCount = runtime?.reflectedRayCount || 0;
    const incidentSamples = runtime?.incidentRaySamples;
    const incidentLengths = runtime?.incidentRayLengths;
    const incidentCount = runtime?.incidentRayCount || 0;

    const uCount = Math.max(2, Math.floor(params.optics.sampleCountU || 2));
    const vCount = Math.max(2, Math.floor(params.optics.sampleCountV || 2));
    const includeIncidentPairs = getPairScope(params) === "reflected+incident";

    if (!reflectedSamples || reflectedCount <= 0) {
      if (this.pair0A && this.pair0B && this.pair1A && this.pair1B) {
        this.pair0A.value.needsUpdate = true;
        this.pair0B.value.needsUpdate = true;
        this.pair1A.value.needsUpdate = true;
        this.pair1B.value.needsUpdate = true;
      }
      return {
        pairCount: 0,
        reflectedPairs: 0,
        incidentPairs: 0,
        reflectedRays: reflectedCount
      };
    }

    this._buildGridMap(opticsState, uCount, vCount);

    const fallbackLength = Math.max(0.25, maxBeamDistance);
    let cursor = 0;
    let reflectedPairs = 0;
    let incidentPairs = 0;

    for (let i = 0; i < uCount; i += 1) {
      for (let j = 0; j < vCount - 1; j += 1) {
        const k0 = this.gridMap[j * uCount + i];
        const k1 = this.gridMap[(j + 1) * uCount + i];
        if (k0 < 0 || k1 < 0) continue;

        if (this._writePair(cursor, reflectedSamples, null, k0, k1, fallbackLength)) {
          cursor += 1;
          reflectedPairs += 1;
        }

        if (
          includeIncidentPairs &&
          incidentSamples &&
          incidentCount > 0 &&
          k0 < incidentCount &&
          k1 < incidentCount &&
          this._writePair(cursor, incidentSamples, incidentLengths, k0, k1, fallbackLength)
        ) {
          cursor += 1;
          incidentPairs += 1;
        }
      }
    }

    if (this.pair0A && this.pair0B && this.pair1A && this.pair1B) {
      this.pair0A.value.needsUpdate = true;
      this.pair0B.value.needsUpdate = true;
      this.pair1A.value.needsUpdate = true;
      this.pair1B.value.needsUpdate = true;
    }

    return {
      pairCount: cursor,
      reflectedPairs,
      incidentPairs,
      reflectedRays: reflectedCount
    };
  }

  inject({ params, opticsState, volumetricState, boundsMin, boundsMax, resolution, stats }) {
    if (this.failed) return false;
    if (!supportsGPUInjection(this.renderer)) return false;
    if (!volumetricState?.volumeTexture) return false;

    const uCount = Math.max(2, Math.floor(params.optics.sampleCountU || 2));
    const vCount = Math.max(2, Math.floor(params.optics.sampleCountV || 2));
    const includeIncidentPairs = getPairScope(params) === "reflected+incident";
    const maxPairs = uCount * Math.max(0, vCount - 1) * (includeIncidentPairs ? 2 : 1);

    try {
      this._ensureBuffers(maxPairs, resolution);
      if (!this.computeInject || !this.computeResolve || !this.computeClearAccum) return false;

      if (volumetricState.gpuResetRequested) {
        this.clearHistoryRequested = true;
        volumetricState.gpuResetRequested = false;
      }

      const maxBeamDistance = Math.max(0.25, params.volumetrics.maxBeamDistance);
      const stepSize = Math.max(0.02, params.volumetrics.beamStepSize);
      const dispatchSteps = Math.max(1, Math.ceil(maxBeamDistance / stepSize));
      const pairUpload = this._uploadVerticalPairs({ params, opticsState, maxBeamDistance });

      const u = this.uniforms;
      u.pairCount.value = pairUpload.pairCount;
      u.dispatchSteps.value = dispatchSteps;
      u.voxelCount.value = this.voxelCount;
      u.resX.value = resolution.x;
      u.resY.value = resolution.y;
      u.resZ.value = resolution.z;
      u.boundsMin.value.copy(boundsMin);
      u.boundsMax.value.copy(boundsMax);
      u.stepSize.value = stepSize;
      u.maxBeamDistance.value = maxBeamDistance;
      u.injectionIntensity.value = Math.max(0, params.volumetrics.injectionIntensity);
      u.temporalAccum.value = params.volumetrics.temporalAccumulation ? 1 : 0;
      u.temporalDecay.value = Math.max(0, Math.min(0.9999, params.volumetrics.temporalDecay));
      u.temporalBlend.value = Math.max(0, Math.min(1, params.volumetrics.temporalBlend));
      u.clearEachFrame.value = params.volumetrics.clearEachFrame ? 1 : 0;

      this.renderer.initTexture(this.volumeStorageTexture);
      this.renderer.initTexture(volumetricState.volumeTexture);

      const tStart = performance.now();
      let t0 = tStart;
      let t1 = tStart;
      let t2 = tStart;
      let t3 = tStart;
      let t4 = tStart;

      if (this.clearHistoryRequested && this.computeClearHistory) {
        this.renderer.compute(this.computeClearHistory, this.voxelCount);
        this.clearHistoryRequested = false;
      }

      this.renderer.compute(this.computeClearAccum, this.voxelCount);
      t1 = performance.now();
      if (pairUpload.pairCount > 0) {
        this.renderer.compute(this.computeInject, pairUpload.pairCount * dispatchSteps);
      }
      t2 = performance.now();
      this.renderer.compute(this.computeResolve, this.voxelCount);
      t3 = performance.now();
      this.copyRegion.max.set(resolution.x, resolution.y, resolution.z);
      this.renderer.copyTextureToTexture(this.volumeStorageTexture, volumetricState.volumeTexture, this.copyRegion);
      t4 = performance.now();

      if (stats) {
        stats.injectionBackend = "WebGPU";
        stats.cpuFallbackActive = false;
        stats.validReflectedRays = pairUpload.reflectedRays;
        stats.injectedRays = pairUpload.pairCount;
        stats.pairCountReflected = pairUpload.reflectedPairs;
        stats.pairCountIncident = pairUpload.incidentPairs;
        stats.pairCountInjected = pairUpload.pairCount;
        stats.computeClearMs = formatMs(t1 - t0);
        stats.computeInjectMs = formatMs(t2 - t1);
        stats.computeResolveMs = formatMs(t3 - t2);
        stats.computeCopyMs = formatMs(t4 - t3);
        stats.computeTotalMs = formatMs(t4 - tStart);
      }

      return true;
    } catch (error) {
      this.failed = true;
      if (stats) {
        stats.computeClearMs = "0.00";
        stats.computeInjectMs = "0.00";
        stats.computeResolveMs = "0.00";
        stats.computeCopyMs = "0.00";
        stats.computeTotalMs = "0.00";
      }
      console.warn("[volumetrics] WebGPU beam injection failed; injection unavailable.", error);
      return false;
    }
  }

  dispose() {
    this._disposeComputeNodes();
    if (this.volumeStorageTexture) this.volumeStorageTexture.dispose();
    this.volumeStorageTexture = null;
    this.pair0A = null;
    this.pair0B = null;
    this.pair1A = null;
    this.pair1B = null;
    this.accum = null;
    this.history = null;
    this.volume = null;
    this.gridMap = null;
  }
}

function getInjector(renderer) {
  let injector = INJECTOR_BY_RENDERER.get(renderer);
  if (!injector) {
    injector = new WebGPUBeamInjector(renderer);
    INJECTOR_BY_RENDERER.set(renderer, injector);
  }
  return injector;
}

export function injectReflectedBeamsGPU({
  renderer,
  params,
  opticsState,
  volumetricState,
  resolution,
  boundsMin,
  boundsMax,
  stats
}) {
  if (!renderer || !volumetricState || !resolution || !boundsMin || !boundsMax) return false;
  const injector = getInjector(renderer);
  return injector.inject({
    params,
    opticsState,
    volumetricState,
    resolution,
    boundsMin,
    boundsMax,
    stats
  });
}

export function disposeBeamInjectionGPU(renderer) {
  if (!renderer) return;
  const injector = INJECTOR_BY_RENDERER.get(renderer);
  if (!injector) return;
  injector.dispose();
  INJECTOR_BY_RENDERER.delete(renderer);
}
