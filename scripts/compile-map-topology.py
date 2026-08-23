#!/usr/bin/env python3
"""Compile normalized navigation/callout data into a runtime topology artifact.

The source nav/callout exports are generated offline from official CS2 map data.
The runtime artifact contains only walkable area metadata, graph portals, and
semantic callout labels. It does not contain Valve assets or raw map files.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
EDGE_EPSILON = 2.0
MIN_PORTAL_WIDTH = 24.0


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def bounds(corners: list[dict[str, float]]) -> tuple[float, float, float, float, float, float]:
    xs = [corner["x"] for corner in corners]
    ys = [corner["y"] for corner in corners]
    zs = [corner["z"] for corner in corners]
    return min(xs), min(ys), max(xs), max(ys), min(zs), max(zs)


def center(corners: list[dict[str, float]]) -> tuple[float, float, float]:
    count = max(1, len(corners))
    return (
        sum(corner["x"] for corner in corners) / count,
        sum(corner["y"] for corner in corners) / count,
        sum(corner["z"] for corner in corners) / count,
    )


def route_classes(label: str | None) -> list[str]:
    if not label:
        return []
    normalized = label.lower().replace("_", "")
    classes: list[str] = []
    if "bombsitea" in normalized:
        classes.append("site_a")
    if "bombsiteb" in normalized:
        classes.append("site_b")
    if normalized in {"ctspawn", "tspawn"}:
        classes.append("spawn")
    if "mid" in normalized or normalized in {"connector", "mainhall"}:
        classes.append("mid")
    if "long" in normalized or normalized in {"outside", "upperpark", "street"}:
        classes.append("long")
    if "short" in normalized or normalized in {"catwalk", "topofmid", "sideentrance"}:
        classes.append("short")
    if any(token in normalized for token in ("ramp", "stairs", "stair", "banana", "alley", "walkway", "bridge")):
        classes.append("lane")
    if any(token in normalized for token in ("tunnel", "underpass", "undera", "lower")):
        classes.append("tunnel")
    if any(token in normalized for token in ("heaven", "rafters", "roof", "upper")):
        classes.append("elevated")
    if not classes:
        classes.append("area")
    return sorted(set(classes))


def shared_portal(
    left: tuple[float, float, float, float, float, float],
    right: tuple[float, float, float, float, float, float],
    left_center: tuple[float, float, float],
    right_center: tuple[float, float, float],
) -> tuple[tuple[float, float, float], float, str] | None:
    lmin_x, lmin_y, lmax_x, lmax_y, lmin_z, lmax_z = left
    rmin_x, rmin_y, rmax_x, rmax_y, rmin_z, rmax_z = right
    overlap_y = min(lmax_y, rmax_y) - max(lmin_y, rmin_y)
    overlap_x = min(lmax_x, rmax_x) - max(lmin_x, rmin_x)
    if abs(lmax_x - rmin_x) <= EDGE_EPSILON or abs(rmax_x - lmin_x) <= EDGE_EPSILON:
        if overlap_y >= MIN_PORTAL_WIDTH:
            return (
                ((max(lmin_x, rmin_x) + min(lmax_x, rmax_x)) / 2, (max(lmin_y, rmin_y) + min(lmax_y, rmax_y)) / 2, (left_center[2] + right_center[2]) / 2),
                overlap_y,
                "horizontal",
            )
    if abs(lmax_y - rmin_y) <= EDGE_EPSILON or abs(rmax_y - lmin_y) <= EDGE_EPSILON:
        if overlap_x >= MIN_PORTAL_WIDTH:
            return (
                ((max(lmin_x, rmin_x) + min(lmax_x, rmax_x)) / 2, (max(lmin_y, rmin_y) + min(lmax_y, rmax_y)) / 2, (left_center[2] + right_center[2]) / 2),
                overlap_x,
                "vertical",
            )
    vertical_gap = max(rmin_z - lmax_z, lmin_z - rmax_z, 0.0)
    if vertical_gap > EDGE_EPSILON or abs(left_center[2] - right_center[2]) > 96:
        width = min(lmax_x - lmin_x, lmax_y - lmin_y, rmax_x - rmin_x, rmax_y - rmin_y)
        if width >= MIN_PORTAL_WIDTH:
            return (
                ((left_center[0] + right_center[0]) / 2, (left_center[1] + right_center[1]) / 2, (left_center[2] + right_center[2]) / 2),
                max(MIN_PORTAL_WIDTH, min(width, 256.0)),
                "vertical",
            )
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("nav", type=Path)
    parser.add_argument("callouts", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--map-name", required=True)
    args = parser.parse_args()
    if not args.map_name.startswith("de_"):
        raise SystemExit("--map-name must be a canonical de_* map name")

    nav = json.loads(args.nav.read_text(encoding="utf-8"))
    callouts = json.loads(args.callouts.read_text(encoding="utf-8"))
    if nav.get("mapName") != args.map_name or callouts.get("mapName") != args.map_name:
        raise SystemExit("nav/callout map names must match --map-name")

    labels_by_area: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    vocabulary = callouts.get("vocabulary", [])
    for key, value in callouts.get("cells", {}).items():
        try:
            area_id = int(value[2])
            label = vocabulary[int(value[0])]
            confidence = float(value[1])
        except (IndexError, KeyError, TypeError, ValueError):
            continue
        labels_by_area[area_id][label] += confidence

    areas_by_id = {int(area["id"]): area for area in nav.get("areas", [])}
    area_records: list[dict[str, Any]] = []
    for area_id, area in sorted(areas_by_id.items()):
        corners = area.get("corners", [])
        if len(corners) < 3:
            continue
        area_bounds = bounds(corners)
        area_center = center(corners)
        votes = labels_by_area.get(area_id, {})
        label = max(votes, key=lambda current_label: votes[current_label]) if votes else None
        total_votes = sum(votes.values())
        label_confidence = votes.get(label, 0.0) / total_votes if label and total_votes else 0.0
        area_records.append(
            {
                "id": area_id,
                "center": [round(value, 3) for value in area_center],
                "bounds": [round(value, 3) for value in area_bounds],
                "neighbors": sorted({int(neighbor) for neighbor in area.get("neighbors", []) if int(neighbor) in areas_by_id}),
                "callout": label,
                "calloutConfidence": round(label_confidence, 3),
                "routeClasses": route_classes(label),
            }
        )

    record_by_id = {record["id"]: record for record in area_records}
    portals: list[dict[str, Any]] = []
    seen: set[tuple[int, int]] = set()
    for record in area_records:
        for neighbor_id in record["neighbors"]:
            key = tuple(sorted((record["id"], neighbor_id)))
            if key in seen or neighbor_id not in record_by_id:
                continue
            seen.add(key)
            neighbor = record_by_id[neighbor_id]
            shared = shared_portal(tuple(record["bounds"]), tuple(neighbor["bounds"]), tuple(record["center"]), tuple(neighbor["center"]))
            if not shared:
                continue
            portal_center, width, orientation = shared
            dx = neighbor["center"][0] - record["center"][0]
            dy = neighbor["center"][1] - record["center"][1]
            length = math.hypot(dx, dy)
            portals.append(
                {
                    "id": f"{key[0]}:{key[1]}",
                    "from": key[0],
                    "to": key[1],
                    "center": [round(value, 3) for value in portal_center],
                    "width": round(width, 3),
                    "orientation": orientation,
                    "normal": [round(dx / length, 3), round(dy / length, 3)] if length else [0, 0],
                    "vertical": abs(neighbor["center"][2] - record["center"][2]) > 96,
                }
            )

    all_bounds = [record["bounds"] for record in area_records]
    artifact = {
        "schemaVersion": SCHEMA_VERSION,
        "mapName": args.map_name,
        "coordinateSystem": "source2-hammer-units",
        "source": {
            "navigationSha256": sha256(args.nav),
            "calloutSha256": sha256(args.callouts),
            "navigationBuildId": nav.get("buildId"),
            "sourceFormat": nav.get("sourceFormat"),
        },
        "bounds": [
            min(bound[0] for bound in all_bounds),
            min(bound[1] for bound in all_bounds),
            max(bound[2] for bound in all_bounds),
            max(bound[3] for bound in all_bounds),
            min(bound[4] for bound in all_bounds),
            max(bound[5] for bound in all_bounds),
        ],
        "areas": area_records,
        "portals": portals,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(artifact, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    with gzip.GzipFile(filename=str(args.output), mode="wb", compresslevel=9, mtime=0) as target:
        target.write(encoded)
    print(json.dumps({"map": args.map_name, "areas": len(area_records), "portals": len(portals), "bytes": args.output.stat().st_size, "output": str(args.output.resolve())}, indent=2))


if __name__ == "__main__":
    main()
