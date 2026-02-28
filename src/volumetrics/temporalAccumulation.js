import { clamp } from "./volumetricMath.js";

export function applyTemporalAccumulation(volumeData, historyData, params) {
  if (!volumeData || !historyData || volumeData.length !== historyData.length) return;

  if (!params.volumetrics.temporalAccumulation) {
    historyData.set(volumeData);
    return;
  }

  const decay = clamp(params.volumetrics.temporalDecay, 0, 0.9999);
  const blend = clamp(params.volumetrics.temporalBlend, 0, 1);
  const oneMinusBlend = 1 - blend;

  for (let i = 0; i < volumeData.length; i += 1) {
    const accumulated = historyData[i] * decay;
    const injected = volumeData[i];
    const mixed = accumulated * oneMinusBlend + injected * blend;
    historyData[i] = mixed;
    volumeData[i] = mixed;
  }
}

