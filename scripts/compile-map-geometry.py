#!/usr/bin/env python3
"""Compile a decompiled CS2 map glTF/GLB into a compact JTs-Hud LOS artifact.

Development-only dependencies: numpy and trimesh. Raw map assets remain local and
must not be committed. The output contains triangle coordinates only, no textures,
materials, game logic, or original Source 2 resources.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

import numpy as np
import trimesh

SCHEMA_VERSION = 1
GLTF_METERS_TO_SOURCE_UNITS = 1.0 / 0.0254


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def transformed_meshes(
    scene: trimesh.Scene, include: re.Pattern[str] | None, exclude: re.Pattern[str] | None
) -> list[trimesh.Trimesh]:
    result: list[trimesh.Trimesh] = []
    for node_name in scene.graph.nodes_geometry:
        transform, geometry_name = scene.graph[node_name]
        searchable = f"{node_name}/{geometry_name}"
        if include and not include.search(searchable):
            continue
        if exclude and exclude.search(searchable):
            continue
        geometry = scene.geometry[geometry_name]
        if not isinstance(geometry, trimesh.Trimesh) or not len(geometry.faces):
            continue
        mesh = geometry.copy()
        mesh.apply_transform(transform)
        result.append(mesh)
    return result


def triangle_values(meshes: list[trimesh.Trimesh], decimals: int) -> tuple[list[float], int]:
    output: list[float] = []
    removed = 0
    for mesh in meshes:
        vertices = np.asarray(mesh.vertices, dtype=np.float64)
        faces = np.asarray(mesh.faces, dtype=np.int64)
        triangles = vertices[faces]
        edge_a = triangles[:, 1] - triangles[:, 0]
        edge_b = triangles[:, 2] - triangles[:, 0]
        valid = np.linalg.norm(np.cross(edge_a, edge_b), axis=1) > 1e-6
        removed += int((~valid).sum())
        # Source 2 Viewer converts Source (Z-up, inches) into glTF (Y-up, meters)
        # as glTF XYZ = Source YZX * 0.0254. Convert it back so live GSI and
        # offline demo positions can query the artifact without a serving-time transform.
        triangles = triangles[valid][..., [2, 0, 1]] * GLTF_METERS_TO_SOURCE_UNITS
        triangles = np.round(triangles, decimals=decimals)
        flattened = triangles.reshape(-1)
        if not np.isfinite(flattened).all():
            raise ValueError("Map geometry contains non-finite coordinates")
        output.extend(float(value) for value in flattened)
    return output, removed


def simplify_meshes(
    meshes: list[trimesh.Trimesh], target_triangles: int | None, aggression: int
) -> tuple[list[trimesh.Trimesh], int]:
    source_triangles = sum(len(mesh.faces) for mesh in meshes)
    if target_triangles is None or source_triangles <= target_triangles:
        return meshes, source_triangles

    combined = trimesh.util.concatenate(meshes)
    combined.merge_vertices()
    simplified = combined.simplify_quadric_decimation(
        face_count=target_triangles,
        aggression=aggression,
    )
    if not isinstance(simplified, trimesh.Trimesh) or not len(simplified.faces):
        raise ValueError("Map geometry simplification produced no triangles")
    return [simplified], source_triangles


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="VRF-exported .gltf or .glb map")
    parser.add_argument("output", type=Path, help="Output .jgeo.json.gz artifact")
    parser.add_argument("--map-name", required=True, help="Canonical GSI map name, e.g. de_inferno")
    parser.add_argument("--include", help="Only include scene nodes matching this regex")
    parser.add_argument(
        "--exclude",
        default=(
            r"(?i)(skybox|water|decal|particle|"
            r"physics_(?:[^/]*(?:playerclip|grenadeclip|passbullets|glass)|window_))"
        ),
        help="Exclude scene nodes matching this regex",
    )
    parser.add_argument("--decimals", type=int, default=3, choices=range(0, 7))
    parser.add_argument(
        "--target-triangles",
        type=int,
        help="Simplify exports larger than this triangle count before serialization",
    )
    parser.add_argument(
        "--simplification-aggression",
        type=int,
        default=10,
        choices=range(0, 11),
        help="Quadric decimation aggression (0 preserves shape, 10 reaches target faster)",
    )
    args = parser.parse_args()

    if not args.input.is_file():
        raise SystemExit(f"Input map export not found: {args.input}")
    if not re.fullmatch(r"de_[a-z0-9_]+", args.map_name, flags=re.IGNORECASE):
        raise SystemExit("--map-name must be a canonical de_* GSI map name")
    if args.target_triangles is not None and args.target_triangles < 1000:
        raise SystemExit("--target-triangles must be at least 1000")

    loaded: Any = trimesh.load(args.input, force="scene", process=False)
    scene = loaded if isinstance(loaded, trimesh.Scene) else trimesh.Scene(loaded)
    include = re.compile(args.include) if args.include else None
    exclude = re.compile(args.exclude) if args.exclude else None
    meshes = transformed_meshes(scene, include, exclude)
    if not meshes:
        raise SystemExit("No triangle meshes remained after filtering")

    meshes, source_triangle_count = simplify_meshes(
        meshes, args.target_triangles, args.simplification_aggression
    )
    triangles, removed = triangle_values(meshes, args.decimals)
    artifact = {
        "schemaVersion": SCHEMA_VERSION,
        "mapName": args.map_name.lower(),
        "sourceSha256": sha256(args.input),
        "coordinateSystem": "source2-hammer-units",
        "sourceTriangleCount": source_triangle_count,
        "triangles": triangles,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(artifact, separators=(",", ":"), allow_nan=False).encode("utf-8")
    with gzip.GzipFile(filename=str(args.output), mode="wb", compresslevel=9, mtime=0) as target:
        target.write(encoded)

    triangle_count = len(triangles) // 9
    if not triangle_count or not math.isfinite(triangle_count):
        raise SystemExit("Compiler produced no valid triangles")
    print(
        json.dumps(
            {
                "map": artifact["mapName"],
                "sceneMeshes": len(meshes),
                "sourceTriangles": source_triangle_count,
                "triangles": triangle_count,
                "degenerateTrianglesRemoved": removed,
                "sourceSha256": artifact["sourceSha256"],
                "uncompressedBytes": len(encoded),
                "artifactBytes": args.output.stat().st_size,
                "output": str(args.output.resolve()),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
