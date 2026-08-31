# Auto Director demo evaluation

This harness replays authorized CS2 demos through the same explainable scoring engine used by the live GSI service. Demo files and generated timelines stay local under `fixtures/demos/` and are ignored by Git.

## Setup

```bash
python3 -m venv .venv-demo
.venv-demo/bin/pip install demoparser2==0.42.0
```

Geometry/ML development can instead use the shared ignored environment:

```bash
python3 -m venv .venv-ml
.venv-ml/bin/pip install -r scripts/requirements-auto-director-ml.txt
```

No demo parser is shipped in the Windows application. It is an offline development dependency only.

## Extract and evaluate

```bash
.venv-demo/bin/python scripts/extract-auto-director-demo.py \
  fixtures/demos/match.dem \
  fixtures/demos/match.timeline.json.gz \
  --sample-ticks 16

npm run demo:evaluate -- fixtures/demos/match.timeline.json.gz

# Optional local Geometry + ML advisory comparison
npm run demo:evaluate -- \
  fixtures/demos/match.timeline.json.gz \
  artifacts/auto-director-training/geometry-v1 \
  resources/auto-director/models/auto-director-lightgbm.json
```

At the standard 64-tick demo rate, `--sample-ticks 16` produces one frame every 250 ms. A `.gz` output suffix writes deterministic gzip and is preferred for corpora. The extractor records the source filename and SHA-256 in the timeline. It converts positions, view angles, health, armor, flash duration, weapons, ammo, kills, damage and bomb events into GSI-like snapshots.

Some CSTV demos omit `bomb_beginplant` and `bomb_begindefuse`. When that happens, the extractor marks `metadata.objectiveWindowsInferred` and reconstructs only the action window from the later authoritative `bomb_planted` or `bomb_defused` event. This inference is used only by offline evaluation. Live JTs-Hud uses the bomb state delivered directly by GSI.

## Metrics

The evaluator runs Balanced, Reactive and Calm independently with immediate idealized camera confirmation. It reports:

- killer and either-participant capture at the kill tick;
- killer and either-participant capture one second before the kill;
- switches per round, mean dwell and sub-second thrash;
- frames spent on dead targets;
- plant/defuse actor coverage.

Transport latency, failed Telnet commands, Windows foreground focus and the visual quality of a cut are intentionally outside this offline score. Those require a real Windows/CS2 observer test. The optional hybrid run adds the LightGBM output and static world-geometry features as an advisory score factor; it never bypasses the Director state machine.

## Verified public pro-demo run

Source dataset:

- `skkwowee/chimera-cs2` on Hugging Face;
- path `demos/2395993/alliance-vs-wildcard-m1-inferno.dem`;
- BLAST Bounty 2026 Season 2;
- source SHA-256 `0b361ceb5d2abe7b69ce492d7394d385f8b0dd4df14276c787dc20438d3c853d`;
- map `de_inferno`, 16 complete rounds, 5,751 sampled frames and 106 evaluated kills.

Results from the 250 ms timeline:

| Mode     | Switches/round | Mean dwell | Killer at kill | Participant at kill | Participant at T-1s | Objective coverage | Dead frames |
| -------- | -------------: | ---------: | -------------: | ------------------: | ------------------: | -----------------: | ----------: |
| Balanced |          12.88 |   6,517 ms |          42.5% |               65.1% |               59.4% |               100% |           0 |
| Reactive |          23.75 |   3,626 ms |          38.7% |               68.9% |               54.7% |               100% |           0 |
| Calm     |           6.00 |  12,616 ms |          26.4% |               52.8% |               49.1% |               100% |           0 |

Interpretation: Balanced currently gives the strongest all-around result on this match. Reactive catches slightly more kill participants at the event itself but cuts much more often and does not improve pre-kill coverage. Calm behaves as intended, with much longer stories and fewer cuts at the cost of action capture. This single match validates the parser and evaluator, but it is not enough to claim universal calibration. More maps and teams are required before changing defaults solely from these numbers.

## Held-out Geometry + ML result

The pinned corpus has 30 match-separated demos (18 train, 4 validation, 8 test). Training uses 861,696 rows and four binary horizons (0.5/1/2/3 seconds). The final comparison below uses the same 8 test matches, 166 rounds and 1,105 kills before and after the predictive model/preset changes.

| Mode | Participant T-2s | Participant T-1s | Participant T-0.5s | Participant at kill | Switches/round | Thrash <1s |
| ---- | ---------------: | ---------------: | ------------------: | ------------------: | -------------: | ----------: |
| Balanced before | 46.6% | 52.3% | 58.7% | 66.1% | 22.92 | 607 |
| Balanced after | **48.1%** | **57.0%** | **65.9%** | **76.8%** | 24.08 | 608 |
| Reactive before | 47.2% | 54.8% | 62.0% | 73.1% | 37.68 | 619 |
| Reactive after | **48.1%** | **57.1%** | **67.0%** | **78.1%** | **34.30** | 799 |
| Calm before | 46.7% | 50.7% | 55.8% | 62.3% | 15.46 | 600 |
| Calm after | **49.1%** | **56.8%** | **65.4%** | **75.1%** | 17.82 | 606 |

The strongest end-to-end gain is early participant capture: +7.2 pp Balanced, +5.0 pp Reactive and +9.6 pp Calm at T-0.5s. The model's held-out top-1 action-group accuracy is 89.7% at 0.5s, 86.2% at 1s, 82.8% at 2s and 82.1% at 3s; camera capture is lower because dwell/lock/state-machine constraints and simultaneous fights still matter. Full corpus evaluation is parallelized by match; a future feature-cache can accelerate repeated runs without changing the exact benchmark.
