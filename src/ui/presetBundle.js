export const PRESET_BUNDLE_FORMAT = "mylar.sim.bundle.v1";

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizePresetBundle(input) {
  if (!isObject(input)) {
    return { defaultSnapshot: null, presets: {} };
  }

  // Legacy compatibility: plain map of presetName -> snapshot.
  if (!("format" in input) && !("presets" in input) && !("defaultSnapshot" in input)) {
    return { defaultSnapshot: null, presets: { ...input } };
  }

  const presets = isObject(input.presets) ? { ...input.presets } : {};
  const defaultSnapshot = isObject(input.defaultSnapshot) ? input.defaultSnapshot : null;
  return { defaultSnapshot, presets };
}

export function createPresetBundle(defaultSnapshot, presets) {
  return {
    format: PRESET_BUNDLE_FORMAT,
    defaultSnapshot: isObject(defaultSnapshot) ? defaultSnapshot : null,
    presets: isObject(presets) ? { ...presets } : {}
  };
}
