#!/usr/bin/env python3
"""Build ignored LOS artifacts from a pinned official CS2 depot manifest."""

from __future__ import annotations

import argparse
import gzip
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

DEFAULT_MAPS = [
    "de_mirage",
    "de_inferno",
    "de_nuke",
    "de_dust2",
    "de_ancient",
    "de_anubis",
    "de_overpass",
    "de_vertigo",
]


def validate_artifact(path: Path, expected_map: str) -> dict[str, int | str]:
    with gzip.open(path, "rt", encoding="utf-8") as source:
        artifact = json.load(source)
    triangles = len(artifact.get("triangles", [])) // 9
    if artifact.get("mapName") != expected_map or triangles < 50_000:
        raise ValueError(f"Invalid {expected_map} artifact with {triangles} triangles")
    return {
        "map": expected_map,
        "triangles": triangles,
        "sourceTriangles": int(artifact.get("sourceTriangleCount", 0)),
        "sourceSha256": artifact["sourceSha256"],
        "bytes": path.stat().st_size,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--depot-downloader", type=Path, required=True)
    parser.add_argument("--vrf-cli", type=Path, required=True)
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--manifest", default="7645176062026597595")
    parser.add_argument("--maps", nargs="+", default=DEFAULT_MAPS)
    args = parser.parse_args()

    for executable in (args.depot_downloader, args.vrf_cli, args.python):
        if not executable.is_file():
            raise SystemExit(f"Executable not found: {executable}")
    args.output.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, int | str]] = []

    for number, map_name in enumerate(args.maps, start=1):
        if not map_name.startswith("de_"):
            raise SystemExit(f"Invalid map name: {map_name}")
        artifact_path = args.output / f"{map_name}.jgeo.json.gz"
        print(f"[{number}/{len(args.maps)}] {map_name}", flush=True)
        if artifact_path.exists():
            result = validate_artifact(artifact_path, map_name)
            results.append(result)
            print(f"  existing artifact: {result['triangles']:,} triangles", flush=True)
            continue

        with tempfile.TemporaryDirectory(prefix=f"jts-{map_name}-") as temporary:
            temporary_path = Path(temporary)
            file_list = temporary_path / "file-list.txt"
            file_list.write_text(f"game/csgo/maps/{map_name}.vpk\n", encoding="utf-8")
            source = temporary_path / "depot"
            subprocess.run(
                [
                    str(args.depot_downloader),
                    "-app",
                    "730",
                    "-depot",
                    "2347770",
                    "-manifest",
                    args.manifest,
                    "-filelist",
                    str(file_list),
                    "-dir",
                    str(source),
                ],
                check=True,
            )
            vpk = source / "game" / "csgo" / "maps" / f"{map_name}.vpk"
            if not vpk.is_file():
                raise FileNotFoundError(f"DepotDownloader did not produce {vpk}")
            subprocess.run(
                [
                    "bash",
                    "scripts/extract-cs2-map-geometry.sh",
                    str(args.vrf_cli),
                    str(vpk),
                    map_name,
                    str(args.python),
                    str(artifact_path),
                ],
                check=True,
            )
            shutil.rmtree(source, ignore_errors=True)

        result = validate_artifact(artifact_path, map_name)
        results.append(result)
        artifact_bytes = int(result["bytes"])
        print(
            f"  built {result['triangles']:,} triangles, {artifact_bytes / 1024 / 1024:.1f} MiB",
            flush=True,
        )

    index = {
        "schemaVersion": 1,
        "app": 730,
        "depot": 2347770,
        "manifest": args.manifest,
        "artifacts": results,
    }
    index_path = args.output / "geometry-index.json"
    index_path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(index, indent=2))


if __name__ == "__main__":
    main()
