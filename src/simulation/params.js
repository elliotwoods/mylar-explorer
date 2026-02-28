import { defaultOpticsParams } from "./opticsParams.js";
import { defaultVolumetricParams } from "../volumetrics/volumetricParams.js";

export const defaultParams = {
  geometry: {
    sheetHeight: 6,
    sheetWidth: 1.2,
    segments: 256,
    sheetThicknessMm: 0.051,
    topBattenMass: 5,
    topBattenDiameter: 0.05,
    bottomBattenMass: 4,
    bottomBattenDiameter: 0.05,
    lowerWeightMass: 10,
    lowerWeightDiameter: 0.1,
    linkageLength: 0.3
  },
  drive: {
    enabled: true,
    amplitudeDeg: 5,
    frequencyHz: 1,
    phaseDeg: 0,
    startupRampDuration: 1.5,
    jerkyEnabled: false,
    jerkiness: 0.45,
    jerkHarmonic: 4,
    manualOverrideEnabled: false,
    manualOverrideDeg: 0
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
    motorMaxTorquePerMotorNm: 8,
    motorResponseHz: 4,
    motorDampingRatio: 1.0,
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
    roughness: 0.02,
    metalness: 1,
    hdriEnabled: true,
    fallbackEnvironmentEnabled: true
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
