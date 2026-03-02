export const VOLUMETRIC_RESOLUTION_PRESETS = {
  low: { x: 80, y: 45, z: 32 },
  medium: { x: 120, y: 68, z: 48 },
  high: { x: 160, y: 90, z: 64 }
};

export const VOLUMETRIC_QUALITY_MODES = {
  quarter: 0.25,
  half: 0.5,
  full: 1
};

export const VOLUMETRIC_LOOK_PRESETS = {
  "Subtle haze": (params) => {
    params.intensity = 0.9;
    params.compositeOpacity = 0.4;
    params.injectionIntensity = 0.65;
    params.hazeDensity = 0.75;
    params.scatteringCoeff = 0.7;
    params.extinctionCoeff = 0.25;
    params.anisotropy = 0.2;
    params.beamStepSize = 0.45;
    params.depositionRadius = 0.2;
    params.raymarchStepCount = 56;
  },
  "Strong theatrical haze": (params) => {
    params.intensity = 2.3;
    params.compositeOpacity = 0.95;
    params.injectionIntensity = 1.4;
    params.hazeDensity = 1.6;
    params.scatteringCoeff = 1.2;
    params.extinctionCoeff = 0.65;
    params.anisotropy = 0.58;
    params.beamStepSize = 0.3;
    params.depositionRadius = 0.32;
    params.raymarchStepCount = 88;
  },
  "Tight concentrated beams": (params) => {
    params.injectionIntensity = 1.25;
    params.beamStepSize = 0.28;
    params.depositionRadius = 0.08;
    params.scatteringCoeff = 1.05;
    params.extinctionCoeff = 0.4;
    params.anisotropy = 0.65;
    params.raymarchStepCount = 84;
  },
  "Soft dispersed beams": (params) => {
    params.injectionIntensity = 0.85;
    params.beamStepSize = 0.45;
    params.depositionRadius = 0.38;
    params.scatteringCoeff = 0.8;
    params.extinctionCoeff = 0.25;
    params.anisotropy = 0.28;
    params.raymarchStepCount = 64;
  },
  "Performance mode": (params) => {
    applyResolutionPreset(params, "low");
    params.reducedResolutionMode = "quarter";
    params.raymarchStepCount = 40;
    params.beamStepSize = 0.55;
    params.depositionRadius = 0.18;
    params.temporalAccumulation = true;
    params.temporalDecay = 0.95;
    params.temporalBlend = 0.35;
  },
  "Quality mode": (params) => {
    applyResolutionPreset(params, "high");
    params.reducedResolutionMode = "half";
    params.raymarchStepCount = 108;
    params.beamStepSize = 0.26;
    params.depositionRadius = 0.28;
    params.temporalAccumulation = true;
    params.temporalDecay = 0.97;
    params.temporalBlend = 0.45;
  }
};

export const defaultVolumetricParams = {
  enabled: true,
  volumetricMode: "raymarched",
  debugRenderMode: "scene+volumetrics",
  showRays: false,

  boundsCenterX: -0.699999999999999,
  boundsCenterY: -1.4,
  boundsCenterZ: -5.7,
  boundsWidth: 10,
  boundsHeight: 10,
  boundsDepth: 15,

  resolutionPreset: "medium",
  resolutionX: 61,
  resolutionY: 32,
  resolutionZ: 64,

  reducedResolutionMode: "half",

  clearEachFrame: true,
  temporalAccumulation: true,
  temporalDecay: 0.75,
  temporalBlend: 0.05,

  beamStepSize: 0.12,
  depositionRadius: 0.08,
  depositionCountX: 1,
  depositionCountY: 1,
  depositionCountZ: 1,
  injectionIntensity: 4,
  injectIncidentRays: true,
  maxBeamDistance: 18,

  raymarchStepCount: 83,
  raymarchMaxDistance: 32.6,

  hazeDensity: 0.19,
  scatteringCoeff: 0.63,
  extinctionCoeff: 0.13,
  anisotropy: 0.7,
  forwardScatterBias: 0.7,
  intensity: 7.5,
  compositeOpacity: 1.5,

  showBounds: false,
  showSlice: false,
  sliceAxis: "xz",
  slicePosition: 0.5,
  sliceOpacity: 0.52
};

export function applyResolutionPreset(volumetricParams, presetName) {
  const preset = VOLUMETRIC_RESOLUTION_PRESETS[presetName];
  if (!preset) return;
  volumetricParams.resolutionPreset = presetName;
  volumetricParams.resolutionX = preset.x;
  volumetricParams.resolutionY = preset.y;
  volumetricParams.resolutionZ = preset.z;
}
