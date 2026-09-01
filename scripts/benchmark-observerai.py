"""Benchmark the public OBSERVERai selector on the JTs-Hud replay corpus.

This is an offline adapter: it feeds the same GSI-like timeline snapshots to
OBSERVERai's CS2DuelDetector and simulates its configured cooldown/hold before
accepting a new target. No keyboard input or CS2 process is touched.
"""
from __future__ import annotations

import argparse
import bisect
import gzip
import json
import os
import sys
from pathlib import Path
from typing import Any


def load_timeline(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    return json.loads(gzip.decompress(data) if path.suffix == ".gz" else data)


def sample_at(samples: list[dict[str, Any]], at_ms: int) -> dict[str, Any] | None:
    if not samples:
        return None
    index = bisect.bisect_right([sample["atMs"] for sample in samples], at_ms) - 1
    return samples[index] if index >= 0 else None


def percentage(hits: int, total: int) -> float:
    return round((hits * 100.0 / total), 1) if total else 0.0


def benchmark_timeline(path: Path, observer_root: Path) -> dict[str, Any]:
    sys.path.insert(0, str(observer_root / "KeylessOBS"))
    from cs2_duel_detector import CS2DuelDetector  # type: ignore

    timeline = load_timeline(path)
    detector = CS2DuelDetector(str(observer_root / "KeylessOBS" / "config.json"))
    cooldown_ms = int(float(detector.switch_cooldown) * 1000)
    hold_ms = int(float(detector.min_hold_time) * 1000)
    samples: list[dict[str, Any]] = []
    switches: list[int] = []
    current: str | None = None
    current_score = 0.0
    last_switch_at = -10**12
    last_round: int | None = None

    for frame in timeline["frames"]:
        at_ms = int(frame["atMs"])
        payload = frame["payload"]
        round_id = int(frame.get("round", -1))
        if round_id != last_round:
            last_round = round_id
            current = None
            current_score = 0.0
            last_switch_at = at_ms - cooldown_ms
            detector.current_target_sid = None
            detector.active_duel_participants = None
            detector.locked_duel_participants = None

        detector.current_target_sid = current
        try:
            candidate, score, _, _ = detector.choose_best_player(payload)
        except Exception:
            candidate, score = None, 0.0

        players = payload.get("allplayers", {}) or {}
        candidate_alive = bool(candidate and players.get(candidate, {}).get("state", {}).get("health", 0) > 0)
        if candidate_alive:
            dead_current = bool(current and players.get(current, {}).get("state", {}).get("health", 0) <= 0)
            enough_time = at_ms - last_switch_at >= max(cooldown_ms, hold_ms)
            better = score >= max(0.28, current_score * 1.1)
            if current is None or dead_current or (candidate != current and enough_time and better):
                if current != candidate:
                    switches.append(at_ms)
                    last_switch_at = at_ms
                current = candidate
                current_score = float(score)
        elif current and players.get(current, {}).get("state", {}).get("health", 0) <= 0:
            current = None
            current_score = 0.0

        target = players.get(current, {}) if current else {}
        samples.append({"atMs": at_ms, "round": round_id, "target": current, "alive": bool(target.get("state", {}).get("health", 0) > 0)})

    kills = [kill for kill in timeline.get("kills", []) if kill.get("attackerSteamId") and kill.get("victimSteamId")]

    def captures(offset_ms: int, attacker_only: bool) -> int:
        hits = 0
        for kill in kills:
            sample = sample_at(samples, int(kill["atMs"]) - offset_ms)
            if not sample:
                continue
            expected = {kill["attackerSteamId"]} if attacker_only else {kill["attackerSteamId"], kill["victimSteamId"]}
            hits += int(sample["target"] in expected)
        return hits

    dwell = [right - left for left, right in zip(switches, switches[1:]) if right - left < 60_000]
    return {
        "source": timeline["metadata"],
        "mode": "observerai-default",
        "cooldownMs": cooldown_ms,
        "holdMs": hold_ms,
        "rounds": timeline["metadata"]["rounds"],
        "frames": len(samples),
        "killEvents": len(kills),
        "switches": len(switches),
        "switchesPerRound": round(len(switches) / max(1, timeline["metadata"]["rounds"]), 2),
        "meanDwellMs": round(sum(dwell) / len(dwell)) if dwell else 0,
        "thrashUnderOneSecond": sum(duration < 1000 for duration in dwell),
        "deadTargetFrames": sum(sample["target"] is not None and not sample["alive"] for sample in samples),
        "participantT-2s": percentage(captures(2000, False), len(kills)),
        "participantT-1s": percentage(captures(1000, False), len(kills)),
        "participantT-0.5s": percentage(captures(500, False), len(kills)),
        "participantAtKill": percentage(captures(0, False), len(kills)),
        "killerT-2s": percentage(captures(2000, True), len(kills)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("corpus_dir", type=Path)
    parser.add_argument("observer_root", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    os.environ.setdefault("APPDATA", str(Path("out/observerai-appdata").resolve()))
    paths = sorted(args.corpus_dir.glob("*.timeline.json.gz"))
    if args.limit:
        paths = paths[: args.limit]
    reports = [benchmark_timeline(path, args.observer_root) for path in paths]
    output = {"schemaVersion": 1, "observerCommit": "de89700fc5304df473e688692aee84fba531df99", "reports": reports}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
