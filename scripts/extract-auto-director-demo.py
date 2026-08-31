#!/usr/bin/env python3
"""Extract a compact GSI-like replay timeline from an authorized CS2 demo.

Requires: python -m pip install demoparser2
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
from typing import Any

from demoparser2 import DemoParser

TICK_RATE = 64
PLAYER_PROPS = [
    "X",
    "Y",
    "Z",
    "pitch",
    "yaw",
    "health",
    "armor_value",
    "flash_duration",
    "is_alive",
    "team_name",
    "inventory",
    "active_weapon_name",
    "active_weapon_ammo",
    "kills_total",
    "damage_total",
]
BOMB_EVENTS = [
    "bomb_beginplant",
    "bomb_abortplant",
    "bomb_planted",
    "bomb_begindefuse",
    "bomb_abortdefuse",
    "bomb_defused",
    "bomb_exploded",
]


def finite_number(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def integer(value: Any, fallback: int = 0) -> int:
    return int(finite_number(value, fallback))


def forward_vector(pitch: Any, yaw: Any) -> str:
    pitch_radians = math.radians(finite_number(pitch))
    yaw_radians = math.radians(finite_number(yaw))
    planar = math.cos(pitch_radians)
    return ", ".join(
        f"{component:.6f}"
        for component in (
            planar * math.cos(yaw_radians),
            planar * math.sin(yaw_radians),
            -math.sin(pitch_radians),
        )
    )


def weapon_type(name: str) -> str:
    normalized = name.lower()
    if any(token in normalized for token in ("awp", "ssg", "scar", "g3sg1")):
        return "SniperRifle"
    if any(token in normalized for token in ("glock", "usp", "p2000", "p250", "deagle", "revolver", "fiveseven", "tec9", "cz75", "elite")):
        return "Pistol"
    if any(token in normalized for token in ("mac10", "mp9", "mp7", "mp5", "ump", "p90", "bizon")):
        return "Submachine Gun"
    if any(token in normalized for token in ("nova", "xm1014", "mag7", "sawedoff")):
        return "Shotgun"
    if any(token in normalized for token in ("m249", "negev")):
        return "Machine Gun"
    if "knife" in normalized:
        return "Knife"
    if any(token in normalized for token in ("grenade", "flashbang", "molotov", "incendiary", "smoke", "decoy")):
        return "Grenade"
    if "c4" in normalized:
        return "C4"
    return "Rifle"


def safe_event(parser: DemoParser, name: str) -> list[dict[str, Any]]:
    result = parser.parse_event(name)
    if not hasattr(result, "to_dict"):
        return []
    return result.to_dict("records")


def event_steam_id(event: dict[str, Any], prefix: str) -> str | None:
    value = event.get(f"{prefix}_steamid")
    if value is None or str(value).lower() == "nan":
        return None
    return str(value)


def bomb_state(events: list[dict[str, Any]], tick: int, round_start: int) -> dict[str, Any] | None:
    latest: dict[str, Any] | None = None
    for event in events:
        event_tick = integer(event.get("tick"))
        if event_tick < round_start or event_tick > tick:
            continue
        latest = event
    if latest is None:
        return None

    event_name = str(latest["event"])
    actor = event_steam_id(latest, "user")
    states = {
        "bomb_beginplant": "planting",
        "bomb_abortplant": "carried",
        "bomb_planted": "planted",
        "bomb_begindefuse": "defusing",
        "bomb_abortdefuse": "planted",
        "bomb_defused": "defused",
        "bomb_exploded": "exploded",
    }
    return {"state": states[event_name], "player": actor}


def main() -> None:
    argument_parser = argparse.ArgumentParser()
    argument_parser.add_argument("demo", type=Path)
    argument_parser.add_argument("output", type=Path)
    argument_parser.add_argument("--sample-ticks", type=int, default=32)
    args = argument_parser.parse_args()

    if args.sample_ticks < 1:
        raise SystemExit("--sample-ticks must be positive")
    if not args.demo.is_file():
        raise SystemExit(f"Demo not found: {args.demo}")

    parser = DemoParser(str(args.demo))
    header = parser.parse_header()
    freeze_ends = [integer(row["tick"]) for row in safe_event(parser, "round_freeze_end")]
    round_ends = [integer(row["tick"]) for row in safe_event(parser, "round_end")]
    if not freeze_ends or not round_ends:
        raise SystemExit("Demo has no complete live rounds")

    rounds: list[tuple[int, int, int]] = []
    for index, start_tick in enumerate(freeze_ends, start=1):
        end_tick = next((tick for tick in round_ends if tick > start_tick), None)
        if end_tick is not None:
            rounds.append((index, start_tick, end_tick))

    wanted_ticks = sorted(
        {
            tick
            for _, start_tick, end_tick in rounds
            for tick in range(start_tick, end_tick + 1, args.sample_ticks)
        }
    )
    tick_rows = parser.parse_ticks(PLAYER_PROPS, ticks=wanted_ticks).to_dict("records")
    rows_by_tick: dict[int, list[dict[str, Any]]] = {}
    for row in tick_rows:
        rows_by_tick.setdefault(integer(row["tick"]), []).append(row)

    bomb_events = [
        {**event, "event": event_name}
        for event_name in BOMB_EVENTS
        for event in safe_event(parser, event_name)
    ]
    has_beginplant = any(event["event"] == "bomb_beginplant" for event in bomb_events)
    has_begindefuse = any(event["event"] == "bomb_begindefuse" for event in bomb_events)
    if not has_beginplant:
        bomb_events.extend(
            {
                **event,
                "event": "bomb_beginplant",
                "tick": max(0, integer(event["tick"]) - round(3.2 * TICK_RATE)),
            }
            for event in bomb_events.copy()
            if event["event"] == "bomb_planted"
        )
    if not has_begindefuse:
        bomb_events.extend(
            {
                **event,
                "event": "bomb_begindefuse",
                "tick": max(0, integer(event["tick"]) - round(5 * TICK_RATE)),
            }
            for event in bomb_events.copy()
            if event["event"] == "bomb_defused"
        )
    bomb_events.sort(key=lambda event: integer(event["tick"]))

    frames: list[dict[str, Any]] = []
    for round_number, start_tick, end_tick in rounds:
        round_counter_baselines: dict[str, tuple[int, int]] = {}
        for tick in range(start_tick, end_tick + 1, args.sample_ticks):
            rows = rows_by_tick.get(tick, [])
            team_rows = {
                "CT": sorted(
                    (row for row in rows if row.get("team_name") == "CT"),
                    key=lambda row: str(row.get("steamid")),
                ),
                "T": sorted(
                    (row for row in rows if row.get("team_name") == "TERRORIST"),
                    key=lambda row: str(row.get("steamid")),
                ),
            }
            all_players: dict[str, Any] = {}
            for team, members in team_rows.items():
                for team_index, row in enumerate(members[:5]):
                    steam_id = str(row["steamid"])
                    total_kills = integer(row.get("kills_total"))
                    total_damage = integer(row.get("damage_total"))
                    baseline_kills, baseline_damage = round_counter_baselines.setdefault(
                        steam_id, (total_kills, total_damage)
                    )
                    slot = team_index + 1 if team == "CT" else team_index + 6
                    active_weapon = str(row.get("active_weapon_name") or "unknown")
                    inventory = row.get("inventory")
                    has_bomb = isinstance(inventory, list) and any(
                        "c4" in str(item).lower()
                        for item in inventory
                    )
                    weapons = {
                        "weapon_active": {
                            "name": active_weapon,
                            "type": weapon_type(active_weapon),
                            "state": "active",
                            "ammo_clip": integer(row.get("active_weapon_ammo")),
                        }
                    }
                    if has_bomb:
                        weapons["weapon_c4"] = {
                            "name": "weapon_c4",
                            "type": "C4",
                            "state": "holstered",
                        }
                    all_players[steam_id] = {
                        "name": str(row.get("name") or steam_id),
                        "team": team,
                        "observer_slot": slot,
                        "position": ", ".join(
                            f"{finite_number(row.get(axis)):.3f}" for axis in ("X", "Y", "Z")
                        ),
                        "forward": forward_vector(row.get("pitch"), row.get("yaw")),
                        "state": {
                            "health": integer(row.get("health")),
                            "armor": integer(row.get("armor_value")),
                            "flashed": finite_number(row.get("flash_duration")),
                            "round_kills": max(0, total_kills - baseline_kills),
                            "round_totaldmg": max(0, total_damage - baseline_damage),
                        },
                        "match_stats": {"kills": total_kills},
                        "weapons": weapons,
                    }

            payload: dict[str, Any] = {
                "map": {"round": round_number, "phase": "live"},
                "round": {"phase": "live"},
                "phase_countdowns": {"phase": "live"},
                "allplayers": all_players,
            }
            current_bomb = bomb_state(bomb_events, tick, start_tick)
            if current_bomb is not None:
                payload["bomb"] = current_bomb
            frames.append(
                {
                    "tick": tick,
                    "atMs": round(tick * 1000 / TICK_RATE),
                    "round": round_number,
                    "payload": payload,
                }
            )

    kills = []
    for event in safe_event(parser, "player_death"):
        event_tick = integer(event["tick"])
        if not any(start_tick <= event_tick <= end_tick for _, start_tick, end_tick in rounds):
            continue
        kills.append(
            {
                "tick": event_tick,
                "atMs": round(event_tick * 1000 / TICK_RATE),
                "attackerSteamId": event_steam_id(event, "attacker"),
                "victimSteamId": event_steam_id(event, "user"),
            }
        )

    digest = hashlib.sha256(args.demo.read_bytes()).hexdigest()
    output = {
        "metadata": {
            "sourceFile": args.demo.name,
            "sourceSha256": digest,
            "map": header.get("map_name"),
            "tickRate": TICK_RATE,
            "sampleTicks": args.sample_ticks,
            "sampleIntervalMs": round(args.sample_ticks * 1000 / TICK_RATE),
            "rounds": len(rounds),
            "objectiveWindowsInferred": {
                "plant": not has_beginplant,
                "defuse": not has_begindefuse,
            },
        },
        "frames": frames,
        "kills": kills,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(output, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if args.output.suffix == ".gz":
        with gzip.GzipFile(filename=str(args.output), mode="wb", compresslevel=9, mtime=0) as target:
            target.write(encoded)
    else:
        args.output.write_bytes(encoded)
    print(
        f"Extracted {len(frames)} frames, {len(kills)} kills and {len(rounds)} rounds to {args.output}"
    )


if __name__ == "__main__":
    main()
