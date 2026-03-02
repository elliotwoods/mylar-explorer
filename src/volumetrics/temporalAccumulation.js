import { clamp } from "./volumetricMath.js";

/**
 * Compose per-frame injected volume with persistent history.
 *
 * Rules:
 * - clearEachFrame=true  => frame base starts from 0
 * - clearEachFrame=false => frame base starts from previous history
 * - temporalAccumulation=true  => blend frame value with decayed history
 * - temporalAccumulation=false => use frame value directly
 */
export function applyTemporalAccumulation(volumeData, historyData, params) {
  if (!volumeData || !historyData || volumeData.length !== historyData.length) return;

  const len = volumeData.length;
  const clearEachFrame = !!params.volumetrics.clearEachFrame;
  const temporalAccumulation = !!params.volumetrics.temporalAccumulation;
  const decay = clamp(params.volumetrics.temporalDecay, 0, 0.9999);
  const blend = clamp(params.volumetrics.temporalBlend, 0, 1);
  const oneMinusBlend = 1 - blend;

  for (let i = 0; i < len; i += 1) {
    const injected = volumeData[i];
    const previous = historyData[i];
    const base = clearEachFrame ? 0 : previous;
    const frameValue = base + injected;

    const nextValue = temporalAccumulation
      ? previous * decay * oneMinusBlend + frameValue * blend
      : frameValue;

    historyData[i] = nextValue;
    volumeData[i] = nextValue;
  }
}
