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
  ui/
    controls.js
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
