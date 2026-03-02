import { clamp } from "./volumetricMath.js";

/**
 * Combined decay + temporal accumulation in a single pass.
 * When temporal accumulation is disabled, applies simple decay and copies to history.
 * When enabled, blends injected data with decayed history in one loop.
 *
 * @param {boolean} preDecayed - true if the caller already applied decay before
 *   injection (legacy path). When false, decay is folded into this pass.
 */
export function applyTemporalAccumulation(volumeData, historyData, params, { preDecayed = false } = {}) {
  if (!volumeData || !historyData || volumeData.length !== historyData.length) return;

  const len = volumeData.length;
  const decay = clamp(params.volumetrics.temporalDecay, 0, 0.9999);

  if (!params.volumetrics.temporalAccumulation) {
    // Simple decay path — no blending with history
    if (preDecayed) {
      // Caller already decayed; just mirror to history
      historyData.set(volumeData);
    } else {
      // Apply decay to any existing energy, add freshly injected energy
      for (let i = 0; i < len; i++) {
        const v = historyData[i] * decay + volumeData[i];
        historyData[i] = v;
        volumeData[i] = v;
      }
    }
    return;
  }

  // Full temporal accumulation: blend decayed history with injected data
  const blend = clamp(params.volumetrics.temporalBlend, 0, 1);
  const oneMinusBlend = 1 - blend;

  for (let i = 0; i < len; i++) {
    const accumulated = historyData[i] * decay;
    const injected = volumeData[i];
    const mixed = accumulated * oneMinusBlend + injected * blend;
    historyData[i] = mixed;
    volumeData[i] = mixed;
  }
}
