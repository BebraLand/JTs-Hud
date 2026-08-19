# Auto Director map geometry

The Geometry/ML experiment adds static line-of-sight features without reading the CS2 process. Live inputs remain limited to Game State Integration (GSI), the shared Telnet/netcon observer controller, and map data prepared offline from a normal CS2 installation.

## Safety boundary

The geometry pipeline does not use process handles, memory offsets, DLL injection, hooks, packet interception, or anti-cheat bypasses. It reads a map VPK while CS2 is not involved and emits only a compressed list of collision triangles in Source 2 Hammer coordinates. ML inference must use features that can also be produced from live GSI plus this static artifact.

Raw Valve assets, downloaded VPKs, decompiled visual meshes, demos, datasets, and trained development checkpoints are excluded from Git. Do not commit them. Geometry artifacts record the SHA-256 of the physics GLB from which they were compiled so stale map data can be detected and reproduced.

## Tooling

Verified development versions:

- Source 2 Viewer / ValveResourceFormat CLI 20.0;
- Python 3.11;
- NumPy 2.4.6;
- trimesh 5.0.0;
- fast-simplification 0.1.13.

Source 2 Viewer is MIT-licensed, but CS2 map content remains Valve content. Prefer generating geometry from the operator's own installed CS2 files. If a Steam depot is used for a reproducible private test, download only the required map VPK through normal anonymous Steam content access and do not redistribute that VPK.

## Build one map artifact

Install the Python-only development dependencies in an ignored environment:

```bash
python3 -m venv .venv-ml
.venv-ml/bin/pip install -r scripts/requirements-auto-director-ml.txt
```

Run the checked-in wrapper with a locally downloaded Source2Viewer CLI and a map VPK from the current CS2 installation:

```bash
scripts/extract-cs2-map-geometry.sh \
  /path/to/Source2Viewer-CLI \
  "/path/to/Counter-Strike Global Offensive/game/csgo/maps/de_inferno.vpk" \
  de_inferno \
  .venv-ml/bin/python
```

The default output is:

```text
resources/auto-director/geometry/de_inferno.jgeo.json.gz
```

Source 2 Viewer exports glTF in meters with Y as the up axis. The compiler deliberately converts it back to the Source/GSI coordinate system: Hammer units with Z as the up axis. Runtime validation rejects artifacts that do not declare that coordinate system.

The wrapper exports `maps/<map>/world_physics.vmdl_c`, then compiles the resulting `world_physics_physics.glb`. Do not use the map-level `<map>_physics.glb` as world LOS geometry: it contains entity volumes such as buy zones, bomb targets, navigation blockers, triggers, and place-name volumes. Those invisible volumes produce severe false occlusion.

Official world physics can contain millions of triangles. The wrapper applies deterministic quadric decimation to a 200,000-triangle target and rounds coordinates to 0.01 Source units before gzip serialization. This is an offline build optimization; every target count must be validated against real demo contact events before release.

## Runtime behavior

`GeometryMap` builds an in-memory BVH once per loaded map. Segment/triangle tests then provide deterministic LOS queries. For player visibility, the feature extractor tests observer-eye to target-eye and target-chest rays. Missing, invalid, or stale map geometry must degrade to the existing rule-based Director rather than stop camera control.

The initial geometry features are:

- visible enemy count;
- nearest visible enemy and distance;
- whether the geometrically nearest enemy is visible;
- best aim alignment among visible enemies.

These are candidate model/rules features, not proof that a duel will occur. Smoke, dynamic doors, breakables, player models, and live grenade effects are not represented by static collision geometry and must be handled separately or treated as unknown.

The compiler also excludes non-visual collision layers whose exported node
names contain `playerclip`, `grenadeclip`, `passbullets`, `glass`, or
`physics_window_`. These layers are useful to game physics but must not be
treated as opaque world surfaces for observer line-of-sight.

## Verification

```bash
npm run typecheck
npm run test:auto-director
```

The deterministic fixture covers artifact validation, compressed registry loading, occluded/visible player features, BVH intersections, and a bounded 10,000-query LOS benchmark. A real-map validation must also compare geometry-derived visibility with held-out demo events before geometry weights are enabled in the live Director.

Run the real-demo evaluator with matching map geometry:

```bash
npm run geometry:evaluate -- \
  fixtures/demos/<match>.timeline.json \
  resources/auto-director/geometry/<map>.jgeo.json.gz
```

Raw demos and Valve map assets remain local. Compact derived geometry should also remain private/local until its redistribution status has been reviewed; the product-safe fallback is to generate it from the user's own CS2 installation.
