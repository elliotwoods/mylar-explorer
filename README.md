# Swinging Mylar Simulation (Vite + Three.js)

Interactive exploratory app for a hanging reflective mylar mechanism with:
- 2D edge-on engineering cross-section
- synchronized 3D reflective strip view
- tunable drive/physics/geometry controls
- modular simulation core for later model upgrades

## Quick Start

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm run preview
```

## Project Structure

```text
src/
  main.js
  simulation/
    params.js
    opticsParams.js
    opticsState.js
    opticsSetup.js
    opticsUpdate.js
    opticsMath.js
    state.js
    integrator.js
    forces.js
    constraints.js
    model.js
  render2d/
    render2d.js
  render3d/
    scene3d.js
    sheetMesh.js
    rigMeshes.js
    environment.js
    spotlightRays.js
    spotlightDebug.js
    volumetricDebug.js
  volumetrics/
    volumetricParams.js
    volumetricState.js
    volumetricBounds.js
    volumetricMath.js
    volumeTextures.js
    beamInjectionCPU.js
    beamInjectionGPU.js
    temporalAccumulation.js
    volumetricPass.js
  ui/
    controls.js
    opticsControls.js
    volumetricControls.js
    plots.js
  utils/
    math.js
```

## Model Summary

- Sheet is a vertical chain of lumped nodes (`segments + 1`) with distance constraints.
- Integration is Verlet-style with fixed timestep (`fixedDt`, default `1/240 s`).
- Constraint iterations enforce segment lengths and provide stability.
- Top node is pinned at the overhead support (`y = 0`).
- Top and bottom batten masses are added to first/last node masses.
- Lower driven weight is modeled as a rigid, prescribed-angle linkage around the bottom batten hinge.
- Drive law:
  - `theta(t) = A * sin(2*pi*f*t + phase)` with optional startup ramp.
- Reaction from the driven lower mass is applied back onto the bottom node (force injection into the sheet).
- Optional drag (linear or quadratic) for sheet, battens, and lower weight.
- Optional ride-up approximation shortens effective sheet length based on drive angle and bottom radius.

## Assumptions and Limitations

- This is an exploratory design model, not a high-fidelity solver.
- Sheet bending stiffness is not explicitly modeled (no curvature energy).
- Nonlinear slack/contact/wrinkling are not modeled.
- Rigid-body dynamics are simplified; drive assembly is kinematic with reaction approximation.
- Aerodynamics are simplified drag laws, not CFD.
- Ride-up is an intentionally simple geometric correction term.
- 2D dynamics are mapped into 3D for visualization only.

## Controls

GUI sections:
- Geometry / masses
- Drive
- Physics
- Display
- Frequency response scan
- Presets

Display controls include pause/play, reset, single-step, vectors/trails/graphs, view mode (`2D/3D/split`), camera reset, and environment/material tuning.

## Frequency Response Scan

- Use `sweep + log` to run a coarse scan between `fMin` and `fMax`.
- For each frequency, simulation runs for `settleSeconds + dwellSeconds`.
- App logs approximate response amplitudes at midpoint, bottom batten, and lower weight.
- Curves are shown in the lower plot panel.

## Spotlight / Optics (Option B)

The spotlight subsystem is true 3D and follows the Option B interpretation:
- Beam is defined once from the rest-state sheet footprint.
- A 3D point source emits rays to UV samples over the *rest* sheet.
- Those source ray directions are then fixed in world space.
- During runtime, the moving deformed sheet intersects this fixed ray field.
- Reflection is computed per-hit with ideal specular reflection.

Runtime steps:
1. Intersect each stored source ray with current deformed sheet mesh.
2. If hit: compute hit point, orient geometric normal against incoming ray, compute reflected direction.
3. Draw incident and reflected segments.
4. If miss: record miss statistics and optionally draw faint miss rays.

Important assumptions:
- Point source only (no lens/cone/shutter/gobo model yet).
- No intensity falloff model yet.
- First hit only (no multi-bounce).
- Both sheet sides are reflective.
- Mechanical motion remains 2D-derived; optics are evaluated in full 3D on the extruded mesh.

Controls:
- `Spotlight / Optics` folder in GUI includes source XYZ, sample density, visibility toggles, ray opacity, freeze, rest-state preview, and beam rebuild.
- Stats in the same folder show total rays, hit count, miss count, and hit fraction.

2D overlay:
- By default only center-width slice rays are shown in the 2D cross-section for readability.
- Disable `centerSliceOnlyIn2D` to show a denser projected overlay.

Debug helpers:
- `log optics` GUI button
- `window.mylarDebug.optics()` in console

## Volumetric Haze / God Rays (Froxel + Raymarch)

The app now includes a volumetric participating-media subsystem that consumes the existing reflected-ray output.

Architecture per frame:
1. `opticsUpdate` computes reflected hit points and directions from the moving sheet.
2. Reflected beam energy is injected into a bounded, low-resolution world-space froxel volume (`Data3DTexture`).
3. A custom post pass raymarches the volume from the camera.
4. The volumetric result is composited over scene color.

This preserves key behavior:
- Convergence brightness: overlapping reflected rays deposit into the same froxels and intensify.
- Dispersion dimming: rays spreading out distribute energy across more froxels.
- Additive compounding: multiple beam paths naturally add in the volume.

### Stage-space Volume

Default volume bounds:
- width: `20m`
- height: `12m`
- depth: `20m`
- centered around the sheet/beam space (adjustable in GUI)

Default froxel resolution:
- `120 x 68 x 48` (medium)

Presets:
- low: `80 x 45 x 32`
- high: `160 x 90 x 64`

### Injection + Accumulation

Current production path:
- CPU beam injection (`beamInjectionCPU.js`)
- GPU raymarch/composite (`volumetricPass.js`)

Injection details:
- Each valid reflected ray carries equal energy (scaled by `injectionIntensity`).
- Ray is clipped against volumetric AABB.
- Sampled along ray at configurable `beamStepSize`.
- Deposited into froxels via nearest/trilinear/small soft-kernel behavior (radius-controlled).

Temporal options:
- `clearEachFrame` for strict per-frame rebuild.
- Optional temporal accumulation with exponential-style blending:
  - `temporalDecay`
  - `temporalBlend`

### Raymarch + Composite

Raymarch pass:
- Reconstructs per-pixel world ray from camera matrices.
- Intersects view ray with volumetric bounds.
- Marches through volume samples with Beer-Lambert transmittance.
- Adds single-scatter contribution (with lightweight anisotropy bias).
- Early exits when transmittance is very low.

Composite:
- `scene + volumetrics` (default)
- `volumetric-only`
- `scene-only`
- dedicated `reflected-rays-only` debug mode

### Controls and Presets

New GUI section: `Volumetric Haze / God Rays`

Includes:
- enable/disable
- render debug mode
- volume bounds center/size
- froxel resolution X/Y/Z and resolution preset buttons
- beam injection step/radius/intensity/max distance
- temporal accumulation toggles and factors
- raymarch step count and max distance
- reduced-resolution pass mode (`quarter` / `half` / `full`)
- haze/scattering/extinction/anisotropy controls
- final intensity and composite opacity
- debug bounds box and slice viewer (XY/XZ/YZ + slice position)

Look presets:
- Subtle haze
- Strong theatrical haze
- Tight concentrated beams
- Soft dispersed beams
- Performance mode
- Quality mode

### Debug + Stats

Volumetric debug tools:
- world-space bounds box
- reflected-rays-only mode
- volumetric-only mode
- scene+volumetrics mode
- 3D slice plane viewer sampling the froxel field

Live stats:
- valid reflected rays
- injected rays
- average hit fraction
- volume resolution
- raymarch step count
- frame ms and FPS

### Performance Notes

- WebGL2 is required for the volumetric pass (`sampler3D`/`Data3DTexture` path).
- Main perf levers:
  - froxel resolution
  - raymarch step count
  - pass resolution scale (`quarter`/`half`/`full`)
  - beam step size
  - deposition radius
- `Performance mode` preset combines lower froxel/raymarch cost with temporal smoothing.

### Known Limitations

- Injection is CPU-based in current shipping path (GPU path scaffold exists in `beamInjectionGPU.js`).
- Single scattering only; no multiple scattering.
- No volumetric shadowing from arbitrary scene geometry.
- No depth-aware occlusion of volume by scene depth yet.
- Beam energy model is intentionally simple (equal per valid reflected ray).

### Future Improvement Path

- Move injection toward GPU segment upload + slice deposition shaders.
- Add optional RGB energy field.
- Add depth-aware scene occlusion in raymarch composite.
- Add richer per-ray weighting (distance/Fresnel/source profile).
- Add camera-stable jitter + more advanced temporal reprojection.

## HDRI / Environment

Environment loader tries in order:
1. `/public/hdr/theater_01_2k.hdr`
2. `/public/hdr/theater_01_1k.hdr`
3. `/public/hdr/theater_01.hdr`
4. `/public/hdr/theater_02.hdr`
5. Three.js `RoomEnvironment` fallback (if enabled)

To swap theater HDRI later:
- place files in `public/hdr/`
- keep names `theater_01_2k.hdr` / `theater_01_1k.hdr` (or adjust `src/render3d/environment.js`)
- keep raw source EXRs in `assets/raw-hdri/` (gitignored)

## Where To Refine Next

Code comments mark extension points, and the main upgrade targets are:
- better sheet constitutive model (bending + nonlinear tension/slack)
- better rolling/ride-up model
- better aerodynamic model (orientation, effective area, turbulence)
- proper coupled rigid-body + constraint solver
