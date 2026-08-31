#!/usr/bin/env python3
"""Train one future-action classifier per prediction horizon."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import lightgbm as lgb
import numpy as np
import pandas as pd

HORIZONS_MS = (500, 1_000, 2_000, 3_000)
META_COLUMNS = {
    "split",
    "match",
    "map",
    "round",
    "tick",
    "at_ms",
    "time_to_kill_ms",
    "steam_id",
    *(f"label_{horizon}" for horizon in HORIZONS_MS),
}
GROUP_COLUMNS = ["match", "round", "tick"]


def ordered(data: pd.DataFrame) -> pd.DataFrame:
    return data.sort_values([*GROUP_COLUMNS, "steam_id"], kind="stable").reset_index(drop=True)


def top1_metrics(data: pd.DataFrame, scores: np.ndarray, label: str) -> dict[str, Any]:
    ranked = data[[*GROUP_COLUMNS, label]].copy()
    ranked["prediction"] = scores
    positive_groups = (
        ranked.groupby(GROUP_COLUMNS, sort=False, observed=True)[label].transform("max") > 0
    )
    action = ranked[positive_groups]
    quiet = ranked[~positive_groups]
    top = action.loc[
        action.groupby(GROUP_COLUMNS, sort=False, observed=True)["prediction"].idxmax()
    ]
    quiet_max = quiet.groupby(GROUP_COLUMNS, sort=False, observed=True)["prediction"].max()
    return {
        "actionGroups": int(len(top)),
        "participantTop1Percent": round(float(top[label].mean() * 100), 1),
        "actionTopP25": round(float(top["prediction"].quantile(0.25)), 4) if len(top) else 0,
        "actionTopMedian": round(float(top["prediction"].median()), 4) if len(top) else 0,
        "quietGroups": int(len(quiet_max)),
        "quietP95": round(float(quiet_max.quantile(0.95)), 4) if len(quiet_max) else 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    columns = pd.read_csv(args.dataset, nrows=0).columns.tolist()
    numeric_columns = [column for column in columns if column not in META_COLUMNS]
    features = [
        column
        for column in numeric_columns
        if column != "rule_score" and not column.startswith("factor_")
    ]
    dtypes = {
        **{column: "float32" for column in numeric_columns},
        **{f"label_{horizon}": "int8" for horizon in HORIZONS_MS},
        "split": "category",
        "match": "category",
        "map": "category",
        "steam_id": "category",
    }
    data = pd.read_csv(args.dataset, dtype=dtypes)
    leaked_matches = data.groupby("match", observed=True)["split"].nunique()
    if (leaked_matches > 1).any():
        raise SystemExit("A match appears in more than one split")
    labels = [f"label_{horizon}" for horizon in HORIZONS_MS]
    if any((data[labels[index]] > data[labels[index + 1]]).any() for index in range(3)):
        raise SystemExit("Prediction-horizon labels are not monotonic")
    splits = {
        name: ordered(data[data["split"] == name])
        for name in ("train", "validation", "test")
    }
    del data
    if any(split.empty for split in splits.values()):
        raise SystemExit("Training, validation, and test splits must all be non-empty")

    trained: list[tuple[int, lgb.LGBMClassifier]] = []
    metrics: dict[str, dict[str, Any]] = {name: {} for name in splits}
    rule_metrics = {
        split_name: {
            str(horizon): top1_metrics(split, split["rule_score"].to_numpy(), f"label_{horizon}")
            for horizon in HORIZONS_MS
        }
        for split_name, split in splits.items()
    }
    importances = np.zeros(len(features), dtype=float)

    for horizon in HORIZONS_MS:
        label = f"label_{horizon}"
        model = lgb.LGBMClassifier(
            objective="binary",
            metric="binary_logloss",
            n_estimators=500,
            learning_rate=0.04,
            num_leaves=31,
            min_child_samples=80,
            feature_fraction=0.85,
            reg_alpha=0.1,
            reg_lambda=1.0,
            random_state=42,
            n_jobs=-1,
            verbosity=-1,
        )
        model.fit(
            splits["train"][features],
            splits["train"][label].astype(int),
            eval_set=[
                (
                    splits["validation"][features],
                    splits["validation"][label].astype(int),
                )
            ],
            callbacks=[lgb.early_stopping(40, verbose=False)],
        )
        for split_name, split in splits.items():
            scores = model.predict_proba(
                split[features], num_iteration=model.best_iteration_
            )[:, 1]
            metrics[split_name][str(horizon)] = top1_metrics(split, scores, label)
        importances += model.booster_.feature_importance(importance_type="gain")
        trained.append((horizon, model))
        print(
            json.dumps(
                {
                    "horizonMs": horizon,
                    "bestIteration": model.best_iteration_,
                    "validation": metrics["validation"][str(horizon)],
                }
            )
        )

    model_payload = {
        "schemaVersion": 2,
        "kind": "lightgbm-multihorizon-binary",
        "featureNames": features,
        "horizonsMs": HORIZONS_MS,
        "models": [
            {
                "horizonMs": horizon,
                "bestIteration": model.best_iteration_,
                "model": model.booster_.dump_model(num_iteration=model.best_iteration_),
            }
            for horizon, model in trained
        ],
    }
    model_path = args.output / "auto-director-lightgbm.json"
    model_path.write_text(
        json.dumps(model_payload, separators=(",", ":")), encoding="utf-8"
    )

    total_importance = max(float(importances.sum()), 1.0)
    report = {
        "schemaVersion": 2,
        "dataset": str(args.dataset),
        "rows": {name: int(len(split)) for name, split in splits.items()},
        "matches": {name: int(split["match"].nunique()) for name, split in splits.items()},
        "maps": {
            name: sorted(split["map"].unique().tolist())
            for name, split in splits.items()
        },
        "features": features,
        "ruleBaseline": rule_metrics,
        "metrics": metrics,
        "bestIterations": {
            str(horizon): model.best_iteration_ for horizon, model in trained
        },
        "featureImportance": sorted(
            [
                {
                    "feature": feature,
                    "gainPercent": round(float(gain / total_importance * 100), 2),
                }
                for feature, gain in zip(features, importances, strict=True)
            ],
            key=lambda row: row["gainPercent"],
            reverse=True,
        ),
        "modelBytes": model_path.stat().st_size,
    }
    report_path = args.output / "training-report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Model: {model_path.resolve()}")
    print(f"Report: {report_path.resolve()}")


if __name__ == "__main__":
    main()
