const STORAGE_KEYS = {
  defaultConfig: "mylar.sim.defaultConfig.v1",
  presetMap: "mylar.sim.presetMap.v1",
  defaultCamera: "mylar.sim.defaultCamera.v1",
  lastSession: "mylar.sim.lastSession.v1"
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

export function createToolbar({ mount, getSnapshot, applySnapshot, getCameraPose, setCameraPose, refreshGui }) {
  const container = mount;
  const presetSelect = document.createElement("select");
  const saveDefaultBtn = document.createElement("button");
  const loadDefaultBtn = document.createElement("button");
  const savePresetBtn = document.createElement("button");
  const loadPresetBtn = document.createElement("button");
  const deletePresetBtn = document.createElement("button");
  const saveDefaultCamBtn = document.createElement("button");
  const loadDefaultCamBtn = document.createElement("button");
  const resetCamBtn = document.createElement("button");

  saveDefaultBtn.textContent = "Save Default";
  loadDefaultBtn.textContent = "Load Default";
  savePresetBtn.textContent = "Save Preset";
  loadPresetBtn.textContent = "Load Preset";
  deletePresetBtn.textContent = "Delete Preset";
  saveDefaultCamBtn.textContent = "Save Default Camera";
  loadDefaultCamBtn.textContent = "Load Default Camera";
  resetCamBtn.textContent = "Reset Camera";

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

  saveDefaultBtn.addEventListener("click", saveDefault);
  loadDefaultBtn.addEventListener("click", loadDefault);
  savePresetBtn.addEventListener("click", savePreset);
  loadPresetBtn.addEventListener("click", loadPreset);
  deletePresetBtn.addEventListener("click", deletePreset);
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
