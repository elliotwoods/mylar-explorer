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
  ui/
    controls.js
    opticsControls.js
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
- No volumetric beam rendering.
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
