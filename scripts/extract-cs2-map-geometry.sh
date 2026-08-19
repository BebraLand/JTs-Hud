#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 4 || $# -gt 5 ]]; then
  echo "Usage: $0 <Source2Viewer-CLI> <map.vpk> <de_map> <python> [output.jgeo.json.gz]" >&2
  exit 2
fi

vrf_cli=$1
map_vpk=$2
map_name=$3
python=$4
output=${5:-"resources/auto-director/geometry/${map_name}.jgeo.json.gz"}

if [[ ! $map_name =~ ^de_[a-z0-9_]+$ ]]; then
  echo "Map name must be a canonical de_* GSI map name" >&2
  exit 2
fi
if [[ ! -x $vrf_cli ]]; then
  echo "Source2Viewer-CLI is not executable: $vrf_cli" >&2
  exit 2
fi
if [[ ! -f $map_vpk ]]; then
  echo "CS2 map VPK not found: $map_vpk" >&2
  exit 2
fi
if [[ ! -x $python ]]; then
  echo "Python interpreter is not executable: $python" >&2
  exit 2
fi

workdir=$(mktemp -d "${TMPDIR:-/tmp}/jts-map-geometry.XXXXXX")
trap 'rm -rf "$workdir"' EXIT

"$vrf_cli" \
  --input "$map_vpk" \
  --output "$workdir" \
  --decompile \
  --vpk_filepath "maps/${map_name}/world_physics.vmdl_c" \
  --gltf_export_format glb \
  --gltf_export_extras

physics_glb="$workdir/maps/${map_name}/world_physics_physics.glb"
if [[ ! -f $physics_glb ]]; then
  echo "Source 2 Viewer did not produce expected world physics export: $physics_glb" >&2
  exit 1
fi

"$python" scripts/compile-map-geometry.py \
  "$physics_glb" \
  "$output" \
  --map-name "$map_name" \
  --target-triangles 200000 \
  --decimals 2
