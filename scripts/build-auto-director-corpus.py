#!/usr/bin/env python3
"""Download, verify, extract, and discard a pinned real-demo corpus."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

CHUNK_SIZE = 4 * 1024 * 1024


def download(entry: dict[str, Any], repository: str, revision: str, target: Path) -> None:
    encoded_path = urllib.parse.quote(entry["path"], safe="/")
    url = f"https://huggingface.co/datasets/{repository}/resolve/{revision}/{encoded_path}"
    digest = hashlib.sha256()
    received = 0
    request = urllib.request.Request(url, headers={"User-Agent": "jts-hud-auto-director-corpus/1"})
    with urllib.request.urlopen(request, timeout=120) as response, target.open("wb") as output:
        while chunk := response.read(CHUNK_SIZE):
            output.write(chunk)
            digest.update(chunk)
            received += len(chunk)
            if received % (64 * 1024 * 1024) < CHUNK_SIZE:
                print(f"  downloaded {received / 1024 / 1024:.0f} MiB", flush=True)
    if received != entry["size"]:
        raise ValueError(f"size mismatch: expected {entry['size']}, received {received}")
    if digest.hexdigest() != entry["sha256"]:
        raise ValueError(f"SHA-256 mismatch for {entry['path']}")


def read_timeline_metadata(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as source:
        timeline = json.load(source)
    metadata = timeline["metadata"]
    frame_count = len(timeline["frames"])
    kill_count = len(timeline["kills"])
    if metadata["rounds"] < 10 or frame_count < 1_000 or kill_count < 40:
        raise ValueError(
            f"implausibly small extraction: {metadata['rounds']} rounds, "
            f"{frame_count} frames, {kill_count} kills"
        )
    return {
        **metadata,
        "frames": frame_count,
        "kills": kill_count,
        "timelineBytes": path.stat().st_size,
    }


def write_index(path: Path, manifest: dict[str, Any], completed: list[dict[str, Any]]) -> None:
    output = {
        "schemaVersion": 1,
        "name": manifest["name"],
        "repository": manifest["repository"],
        "revision": manifest["revision"],
        "sampleTicks": manifest["sampleTicks"],
        "entries": completed,
    }
    path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--extractor",
        type=Path,
        default=Path(__file__).with_name("extract-auto-director-demo.py"),
    )
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1 or not manifest.get("entries"):
        raise SystemExit("Invalid or empty corpus manifest")
    args.output.mkdir(parents=True, exist_ok=True)
    index_path = args.output / "corpus-index.json"
    completed: list[dict[str, Any]] = []
    failures: list[str] = []

    with tempfile.TemporaryDirectory(prefix="jts-demo-corpus-") as temporary:
        temporary_directory = Path(temporary)
        for number, entry in enumerate(manifest["entries"], start=1):
            stem = Path(entry["path"]).stem
            output_path = args.output / entry["split"] / f"{stem}.timeline.json.gz"
            output_path.parent.mkdir(parents=True, exist_ok=True)
            print(f"[{number}/{len(manifest['entries'])}] {entry['split']}: {entry['path']}", flush=True)
            try:
                if output_path.exists():
                    metadata = read_timeline_metadata(output_path)
                    if metadata["sourceSha256"] != entry["sha256"]:
                        raise ValueError("existing timeline source SHA-256 does not match manifest")
                else:
                    demo_path = temporary_directory / f"{number:03d}-{stem}.dem"
                    download(entry, manifest["repository"], manifest["revision"], demo_path)
                    subprocess.run(
                        [
                            sys.executable,
                            str(args.extractor),
                            str(demo_path),
                            str(output_path),
                            "--sample-ticks",
                            str(manifest["sampleTicks"]),
                        ],
                        check=True,
                    )
                    metadata = read_timeline_metadata(output_path)
                    demo_path.unlink(missing_ok=True)
                completed.append(
                    {
                        "split": entry["split"],
                        "sourcePath": entry["path"],
                        "sourceSize": entry["size"],
                        "sourceSha256": entry["sha256"],
                        "timeline": str(output_path.relative_to(args.output)),
                        **metadata,
                    }
                )
                write_index(index_path, manifest, completed)
            except Exception as error:
                output_path.unlink(missing_ok=True)
                message = f"{entry['path']}: {error}"
                failures.append(message)
                print(f"  FAILED: {message}", file=sys.stderr, flush=True)

    split_counts = {
        split: sum(entry["split"] == split for entry in completed)
        for split in ("train", "validation", "test")
    }
    print(json.dumps({"completed": len(completed), "splits": split_counts, "failures": failures}, indent=2))
    if failures:
        raise SystemExit(f"Corpus extraction completed with {len(failures)} failure(s)")


if __name__ == "__main__":
    main()
