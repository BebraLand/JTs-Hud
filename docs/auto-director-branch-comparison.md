# Auto Director branch comparison

All local columns use the same held-out corpus: 8 match-separated demos, 166 rounds and 1,105 kills. The primary metric is whether the camera shows either kill participant before the event; the `T-0.5s` column is the most useful pre-action signal.

Branch references: Dev `8a8750f`; requested Smarter Auto Director control `0d6ddd23eef2d80e1b75ad22097d5ee27cd02494`. OBSERVERai was cloned at `de89700fc5304df473e688692aee84fba531df99`.

| Mode / metric | Dev branch | Smart Auto Director | OBSERVERai | Smarter Auto Director + plan |
| --- | ---: | ---: | ---: | ---: |
| Balanced participant T-2s | 46.6% | 48.1% | 35.0% | **49.3%** |
| Balanced participant T-1s | 52.3% | 55.8% | 36.4% | **58.6%** |
| Balanced participant T-0.5s | 58.7% | 64.7% | 37.5% | **66.8%** |
| Balanced participant at kill | 66.1% | 76.0% | 36.4% | **77.7%** |
| Reactive participant T-0.5s | 62.0% | 67.2% | 37.5% | **68.0%** |
| Reactive participant at kill | 73.1% | 79.0% | 36.4% | **78.3%** |
| Calm participant T-0.5s | 55.8% | 64.7% | 37.5% | **66.3%** |
| Calm participant at kill | 62.3% | 75.2% | 36.4% | **75.7%** |

The local tuned result improves Balanced T-0.5s by **+8.1 percentage points** versus Dev (58.7% → 66.8%). OBSERVERai is measured here with its public default selector and the same 8-match corpus: 37.5% at T-0.5s and 36.4% at kill. It has one default configuration, so its value is repeated only for row-level comparison; this is not three separate OBSERVERai presets.

The OBSERVERai result is a selector-level offline adapter (`scripts/benchmark-observerai.py`) using the cloned commit `de89700fc5304df473e688692aee84fba531df99`, configured cooldown/hold, and no keyboard or CS2 process. Its README's 85%+ statement is not a matching held-out evaluator/model protocol and is therefore not used as a benchmark number.

The requested Broadcast Intent & Story Planner is implemented in `src/main/server/domains/auto-director/autoDirector.story.ts` and integrated into the engine. It derives setup/approach/pre-peek/fight/trade/rotate/post-plant phases, a team fallback, event probability, trade probability and camera utility from existing scene/geometry/topology features. The engine keeps a stable reservation and exposes its target/phase/confidence/utility in each decision for pre-arm integration; the reservation does not override objective locks or force an unvalidated switch. A forced-switch ablation was rejected because it regressed the held-out Mirage control.

Planner ablation (same Mirage demo, geometry + ML, 170 kills): forced early-switch variant reached 67.6% participant T-0.5s; the conservative advisory variant reached 68.8%. The previously accepted tuned control remains 71.8% on that demo, so the new planner is shipped as advisory telemetry rather than being allowed to lower camera accuracy. This is the honest result: more aggressive prediction is not automatically better without additional labeled demos.

Sources: [OBSERVERai README](https://github.com/dualitycsgo1/OBSERVERai/tree/main/KeylessOBS), [duel detector](https://github.com/dualitycsgo1/OBSERVERai/blob/main/KeylessOBS/cs2_duel_detector.py), [predictive observer](https://github.com/dualitycsgo1/OBSERVERai/blob/main/KeylessOBS/predictive_observer.py).
