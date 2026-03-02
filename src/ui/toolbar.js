import { createPresetBundle, normalizePresetBundle } from "./presetBundle.js";

const STORAGE_KEYS = {
  defaultConfig: "mylar.sim.defaultConfig.v1",
  presetMap: "mylar.sim.presetMap.v1",
  defaultCamera: "mylar.sim.defaultCamera.v1",
  lastSession: "mylar.sim.lastSession.v1",
  appDefaultsFingerprint: "mylar.sim.appDefaultsFingerprint.v1"
};

function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function loadPresetMap() {
  return safeParse(localStorage.getItem(STORAGE_KEYS.presetMap) || "{}", {});
}

function savePresetMap(map) {
  localStorage.setItem(STORAGE_KEYS.presetMap, JSON.stringify(map));
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function triggerJsonDownload(filename, data) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function readJsonFromUserFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const [file] = input.files || [];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(safeParse(String(reader.result || ""), null));
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    });
    input.click();
  });
}

export function createToolbar({
  mount,
  getSnapshot,
  applySnapshot,
  getCameraPose,
  setCameraPose,
  refreshGui,
  appDefaultsBundle = null
}) {
  const container = mount;
  const presetSelect = document.createElement("select");
  const saveDefaultBtn = document.createElement("button");
  const loadDefaultBtn = document.createElement("button");
  const savePresetBtn = document.createElement("button");
  const loadPresetBtn = document.createElement("button");
  const deletePresetBtn = document.createElement("button");
  const downloadPresetsBtn = document.createElement("button");
  const uploadPresetsBtn = document.createElement("button");
  const downloadDefaultsBtn = document.createElement("button");
  const uploadDefaultsBtn = document.createElement("button");
  const clearStorageBtn = document.createElement("button");
  const saveDefaultCamBtn = document.createElement("button");
  const loadDefaultCamBtn = document.createElement("button");
  const resetCamBtn = document.createElement("button");

  const initialBundle = normalizePresetBundle(appDefaultsBundle);

  saveDefaultBtn.textContent = "Save Default";
  loadDefaultBtn.textContent = "Load Default";
  savePresetBtn.textContent = "Save Preset";
  loadPresetBtn.textContent = "Load Preset";
  deletePresetBtn.textContent = "Delete Preset";
  downloadPresetsBtn.textContent = "Download Presets";
  uploadPresetsBtn.textContent = "Upload Presets";
  downloadDefaultsBtn.textContent = "Download App Defaults";
  uploadDefaultsBtn.textContent = "Upload App Defaults";
  clearStorageBtn.textContent = "Clear Browser Saves";
  saveDefaultCamBtn.textContent = "Save Default Camera";
  loadDefaultCamBtn.textContent = "Load Default Camera";
  resetCamBtn.textContent = "Reset Camera";

  const bundleJson = JSON.stringify(createPresetBundle(initialBundle.defaultSnapshot, initialBundle.presets));
  const bundleFingerprint = hashString(bundleJson);
  const previousFingerprint = localStorage.getItem(STORAGE_KEYS.appDefaultsFingerprint);
  const bundleChanged = !!previousFingerprint && previousFingerprint !== bundleFingerprint;

  if ((bundleChanged || !localStorage.getItem(STORAGE_KEYS.defaultConfig)) && initialBundle.defaultSnapshot) {
    localStorage.setItem(STORAGE_KEYS.defaultConfig, JSON.stringify(initialBundle.defaultSnapshot));
  }
  if (bundleChanged || !localStorage.getItem(STORAGE_KEYS.presetMap)) {
    savePresetMap(initialBundle.presets);
  }
  if (bundleChanged) {
    // New app defaults should take effect immediately instead of stale session state.
    localStorage.removeItem(STORAGE_KEYS.lastSession);
    if (initialBundle.defaultSnapshot?.cameraPose) {
      localStorage.setItem(STORAGE_KEYS.defaultCamera, JSON.stringify(initialBundle.defaultSnapshot.cameraPose));
    } else {
      localStorage.removeItem(STORAGE_KEYS.defaultCamera);
    }
  }
  localStorage.setItem(STORAGE_KEYS.appDefaultsFingerprint, bundleFingerprint);

  function updatePresetOptions() {
    const map = loadPresetMap();
    const names = Object.keys(map).sort((a, b) => a.localeCompare(b));
    presetSelect.innerHTML = "";
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Presets...";
    presetSelect.appendChild(blank);
    for (const name of names) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      presetSelect.appendChild(opt);
    }
  }

  function saveLastSession() {
    localStorage.setItem(STORAGE_KEYS.lastSession, JSON.stringify(getSnapshot()));
  }

  function restoreLastSession() {
    const raw = localStorage.getItem(STORAGE_KEYS.lastSession);
    if (!raw) return false;
    const data = safeParse(raw, null);
    if (!data) return false;
    applySnapshot(data);
    refreshGui();
    return true;
  }

  function saveDefault() {
    localStorage.setItem(STORAGE_KEYS.defaultConfig, JSON.stringify(getSnapshot()));
  }

  function loadDefault() {
    const raw = localStorage.getItem(STORAGE_KEYS.defaultConfig);
    if (!raw) return;
    const data = safeParse(raw, null);
    if (!data) return;
    applySnapshot(data);
    refreshGui();
  }

  function savePreset() {
    const name = window.prompt("Preset name");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const map = loadPresetMap();
    map[trimmed] = getSnapshot();
    savePresetMap(map);
    updatePresetOptions();
    presetSelect.value = trimmed;
  }

  function loadPreset() {
    const name = presetSelect.value;
    if (!name) return;
    const map = loadPresetMap();
    if (!map[name]) return;
    applySnapshot(map[name]);
    refreshGui();
  }

  function deletePreset() {
    const name = presetSelect.value;
    if (!name) return;
    const map = loadPresetMap();
    delete map[name];
    savePresetMap(map);
    updatePresetOptions();
  }

  function exportPresetBundle(filename) {
    const map = loadPresetMap();
    const rawDefault = localStorage.getItem(STORAGE_KEYS.defaultConfig);
    const defaultSnapshot = rawDefault ? safeParse(rawDefault, null) : null;
    triggerJsonDownload(filename, createPresetBundle(defaultSnapshot, map));
  }

  async function importPresetsOnly() {
    const data = await readJsonFromUserFile();
    if (!data) return;
    const bundle = normalizePresetBundle(data);
    savePresetMap(bundle.presets);
    updatePresetOptions();
  }

  async function importDefaultsBundle() {
    const data = await readJsonFromUserFile();
    if (!data) return;
    const bundle = normalizePresetBundle(data);
    if (bundle.defaultSnapshot) {
      localStorage.setItem(STORAGE_KEYS.defaultConfig, JSON.stringify(bundle.defaultSnapshot));
      applySnapshot(bundle.defaultSnapshot);
      refreshGui();
    }
    savePresetMap(bundle.presets);
    updatePresetOptions();
  }

  function saveDefaultCamera() {
    const pose = getCameraPose();
    localStorage.setItem(STORAGE_KEYS.defaultCamera, JSON.stringify(pose));

    // Keep next refresh consistent even when last-session restore is enabled.
    const last = safeParse(localStorage.getItem(STORAGE_KEYS.lastSession) || "{}", {});
    last.cameraPose = pose;
    localStorage.setItem(STORAGE_KEYS.lastSession, JSON.stringify(last));
  }

  function loadDefaultCamera() {
    const raw = localStorage.getItem(STORAGE_KEYS.defaultCamera);
    if (!raw) return false;
    const pose = safeParse(raw, null);
    if (!pose) return false;
    setCameraPose(pose);
    return true;
  }

  function clearSavedBrowserState() {
    const confirmed = window.confirm(
      "Clear saved presets, defaults, camera pose, and last session from this browser?"
    );
    if (!confirmed) return;
    for (const key of Object.values(STORAGE_KEYS)) {
      localStorage.removeItem(key);
    }
    location.reload();
  }

  saveDefaultBtn.addEventListener("click", saveDefault);
  loadDefaultBtn.addEventListener("click", loadDefault);
  savePresetBtn.addEventListener("click", savePreset);
  loadPresetBtn.addEventListener("click", loadPreset);
  deletePresetBtn.addEventListener("click", deletePreset);
  downloadPresetsBtn.addEventListener("click", () => exportPresetBundle("mylar-presets.json"));
  uploadPresetsBtn.addEventListener("click", () => {
    void importPresetsOnly();
  });
  downloadDefaultsBtn.addEventListener("click", () => exportPresetBundle("app-defaults.json"));
  uploadDefaultsBtn.addEventListener("click", () => {
    void importDefaultsBundle();
  });
  clearStorageBtn.addEventListener("click", clearSavedBrowserState);
  saveDefaultCamBtn.addEventListener("click", saveDefaultCamera);
  loadDefaultCamBtn.addEventListener("click", () => {
    loadDefaultCamera();
  });
  resetCamBtn.addEventListener("click", () => setCameraPose(null));

  const spacerA = document.createElement("span");
  spacerA.className = "spacer";
  const spacerB = document.createElement("span");
  spacerB.className = "spacer";
  container.append(
    saveDefaultBtn,
    loadDefaultBtn,
    spacerA,
    presetSelect,
    savePresetBtn,
    loadPresetBtn,
    deletePresetBtn,
    downloadPresetsBtn,
    uploadPresetsBtn,
    downloadDefaultsBtn,
    uploadDefaultsBtn,
    clearStorageBtn,
    spacerB,
    saveDefaultCamBtn,
    loadDefaultCamBtn,
    resetCamBtn
  );

  updatePresetOptions();

  if (!restoreLastSession()) loadDefault();
  loadDefaultCamera();

  window.setInterval(saveLastSession, 3000);
  window.addEventListener("beforeunload", saveLastSession);

  return {
    refresh: updatePresetOptions,
    saveLastSession
  };
}
