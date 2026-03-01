import * as THREE from "three/webgpu";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export function setupEnvironment(renderer, scene, params) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTexture = null;
  let activeSource = "none";
  const diagnostics = {
    attempts: [],
    activeSource: "none"
  };

  function setEnvironmentTexture(texture, sourceTag) {
    if (envTexture && envTexture !== texture) envTexture.dispose();
    envTexture = texture;
    activeSource = sourceTag;
    diagnostics.activeSource = sourceTag;
    scene.environment = envTexture;
    scene.background = null;
  }

  async function loadEquirect(url, type) {
    const started = performance.now();
    const loader = new RGBELoader();
    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (tex) => {
          tex.mapping = THREE.EquirectangularReflectionMapping;
          const rt = pmrem.fromEquirectangular(tex);
          tex.dispose();
          resolve({
            texture: rt.texture,
            ms: performance.now() - started
          });
        },
        undefined,
        (err) => reject(err)
      );
    });
  }

  function applyFallbackIfEnabled() {
    if (!params.display.fallbackEnvironmentEnabled) return;
    const room = new RoomEnvironment();
    setEnvironmentTexture(pmrem.fromScene(room).texture, "RoomEnvironment");
  }

  async function refresh() {
    diagnostics.attempts = [];

    if (params.display.hdriEnabled) {
      // Place custom files here for quick swaps:
      // /public/hdr/theater_01.hdr
      // /public/hdr/theater_02.hdr
      const candidates = [
        { url: "/hdr/theater_01_2k.hdr", type: "hdr", label: "public theater_01_2k.hdr" },
        { url: "/hdr/theater_01_1k.hdr", type: "hdr", label: "public theater_01_1k.hdr" },
        { url: "/hdr/theater_01.hdr", type: "hdr" },
        { url: "/hdr/theater_02.hdr", type: "hdr" }
      ];

      for (const candidate of candidates) {
        try {
          const loaded = await loadEquirect(candidate.url, candidate.type);
          setEnvironmentTexture(loaded.texture, candidate.label || candidate.url);
          diagnostics.attempts.push({
            source: candidate.label || candidate.url,
            ok: true,
            ms: Number(loaded.ms.toFixed(1))
          });
          console.log(
            `[env] loaded ${candidate.label || candidate.url} in ${loaded.ms.toFixed(1)} ms`
          );
          break;
        } catch (error) {
          diagnostics.attempts.push({
            source: candidate.label || candidate.url,
            ok: false,
            message: String(error)
          });
          // Try next environment candidate.
        }
      }
    }

    if (!envTexture) {
      applyFallbackIfEnabled();
    }
  }

  // Fast startup: never block first render on HDRI network/decode/PMREM time.
  applyFallbackIfEnabled();
  void refresh();

  return {
    refresh,
    getDiagnostics() {
      return {
        ...diagnostics,
        activeSource
      };
    },
    dispose() {
      if (envTexture) envTexture.dispose();
      pmrem.dispose();
    }
  };
}
