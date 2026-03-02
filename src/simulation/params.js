import { defaultOpticsParams } from "./opticsParams.js";
import { defaultVolumetricParams } from "../volumetrics/volumetricParams.js";

export const defaultParams = {
  geometry: {
    sheetHeight: 6,
    sheetWidth: 1.2,
    segments: 37,
    sheetThicknessMm: 0.2,
    topBattenMass: 5,
    topBattenDiameter: 0.05,
    bottomBattenMass: 2,
    bottomBattenDiameter: 0.05,
    lowerWeightMass: 6,
    lowerWeightDiameter: 0.1,
    linkageLength: 0.3
  },
  drive: {
    enabled: true,
    amplitudeDeg: 1.9,
    frequencyHz: 1.14,
    phaseDeg: 0,
    startupRampDuration: 1.5,
    waveformMode: "sine",
    jerkyEnabled: false,
    jerkiness: 0,
    jerkHarmonic: 11,
    jerkAmplitude: 0.8,
    jerkSecondaryAmplitude: 0.85,
    jerkSharpness: 0.45,
    motionNoiseEnabled: true,
    motionNoiseAmplitudeDeg: 4.12,
    motionNoiseFreq1Mul: 2.2,
    motionNoiseFreq2Mul: 3.7,
    motionNoiseFreq3Mul: 6.1,
    motionNoiseAmp1: 1,
    motionNoiseAmp2: 0.6,
    motionNoiseAmp3: 0.35,
    motionNoisePhase1Deg: 0,
    motionNoisePhase2Deg: 47,
    motionNoisePhase3Deg: 113,
    manualOverrideEnabled: true,
    manualOverrideDeg: -19.7114045944517,
    manualDecaySeconds: 5
  },
  physics: {
    gravity: 9.81,
    internalDamping: 0.015,
    dragEnabled: true,
    dragMode: "linear",
    sheetDragCoefficient: 0.95,
    battenDragCoefficient: 0.4,
    lowerWeightDragCoefficient: 0.25,
    rideUpEnabled: true,
    rideUpCoefficient: 0.25,
    motorMaxRpm: 90,
    motorMaxTorquePerMotorNm: 13.4,
    motorResponseHz: 20,
    motorDampingRatio: 0.05,
    solverIterations: 18,
    fixedDt: 1 / 240,
    maxSubStepsPerFrame: 10
  },
  display: {
    paused: false,
    showTrails: true,
    showVectors: false,
    showGraphs: true,
    showNodeMarkers: true,
    renderSubdivision: 2,
    wireframeView: false,
    simSpeed: 1,
    viewMode: "split",
    envIntensity: 2.2,
    roughness: 0.01,
    metalness: 1,
    hdriEnabled: true,
    fallbackEnvironmentEnabled: true,
    hdrOutputEnabled: true,
    toneMappingMode: "linear",
    toneMappingExposure: 1.1,
    backgroundColor: "#050505",
    backgroundIntensity: 0.26,
    floorVisible: true,
    floorY: -6.4,
    floorSize: 30,
    floorColor: "#1f2430",
    floorAlbedo: 1,
    personVisible: true,
    personX: -0.35,
    personZ: -6.66,
    personYawDeg: -138,
    personScale: 1,
    personFloorOffsetY: 0
  },
  scan: {
    active: false,
    fMin: 0.1,
    fMax: 3,
    stepHz: 0.1,
    dwellSeconds: 5,
    settleSeconds: 2
  },
  optics: { ...defaultOpticsParams },
  volumetrics: { ...defaultVolumetricParams }
};

export const presets = {
  "Gentle swing": (params) => {
    params.drive.amplitudeDeg = 3;
    params.drive.frequencyHz = 0.7;
    params.physics.internalDamping = 0.02;
    params.physics.sheetDragCoefficient = 1.0;
    params.physics.dragEnabled = true;
  },
  "Near resonance sweep candidate": (params) => {
    params.drive.amplitudeDeg = 6;
    params.drive.frequencyHz = 1.1;
    params.physics.internalDamping = 0.012;
    params.physics.dragEnabled = true;
    params.physics.sheetDragCoefficient = 0.75;
  },
  "High damping": (params) => {
    params.physics.internalDamping = 0.07;
    params.physics.sheetDragCoefficient = 1.4;
    params.physics.battenDragCoefficient = 1.1;
  },
  "Low damping": (params) => {
    params.physics.internalDamping = 0.004;
    params.physics.sheetDragCoefficient = 0.4;
    params.physics.battenDragCoefficient = 0.2;
  },
  "Ride-up exaggerated": (params) => {
    params.physics.rideUpEnabled = true;
    params.physics.rideUpCoefficient = 1.0;
    params.geometry.bottomBattenDiameter = 0.09;
  },
  "Drag off": (params) => {
    params.physics.dragEnabled = false;
  }
};

export function cloneParams() {
  return structuredClone(defaultParams);
}
