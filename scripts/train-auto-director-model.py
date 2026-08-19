#!/usr/bin/env python3
"""Train match-separated Auto Director ranking baselines and LightGBM."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

META_COLUMNS = {
    "split",
    "match",
    "map",
    "round",
    "tick",
    "at_ms",
    "time_to_kill_ms",
    "steam_id",
    "label",
}
GROUP_COLUMNS = ["match", "round", "tick"]


def ordered(data: pd.DataFrame) -> pd.DataFrame:
    return data.sort_values([*GROUP_COLUMNS, "steam_id"], kind="stable").reset_index(drop=True)


def group_sizes(data: pd.DataFrame) -> list[int]:
    return data.groupby(GROUP_COLUMNS, sort=False).size().astype(int).tolist()


def ranking_metrics(data: pd.DataFrame, scores: np.ndarray) -> dict[str, Any]:
    ranked = data[[*GROUP_COLUMNS, "time_to_kill_ms", "label"]].copy()
    ranked["prediction"] = scores
    top_indices = ranked.groupby(GROUP_COLUMNS, sort=False)["prediction"].idxmax()
    top = ranked.loc[top_indices]

    def metrics_for_horizon(horizon: int) -> dict[str, Any]:
        subset = top[top["time_to_kill_ms"] <= horizon]
        return {
            "groups": int(len(subset)),
            "participantTop1Percent": round(float((subset["label"] > 0).mean() * 100), 1),
            "killerTop1Percent": round(float((subset["label"] == 3).mean() * 100), 1),
        }

    return {
        "all": metrics_for_horizon(3_000),
        "at250ms": metrics_for_horizon(250),
        "at500ms": metrics_for_horizon(500),
        "at1000ms": metrics_for_horizon(1_000),
        "at2000ms": metrics_for_horizon(2_000),
    }


def feature_importance(model: lgb.LGBMRanker, features: list[str]) -> list[dict[str, Any]]:
    gain = model.booster_.feature_importance(importance_type="gain")
    total = max(float(gain.sum()), 1.0)
    return sorted(
        [
            {"feature": feature, "gainPercent": round(float(value / total * 100), 2)}
            for feature, value in zip(features, gain, strict=True)
        ],
        key=lambda row: row["gainPercent"],
        reverse=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    data = pd.read_csv(args.dataset)
    features = [column for column in data.columns if column not in META_COLUMNS]
    splits = {name: ordered(data[data["split"] == name]) for name in ("train", "validation", "test")}
    if any(split.empty for split in splits.values()):
        raise SystemExit("Training, validation, and test splits must all be non-empty")

    train = splits["train"]
    validation = splits["validation"]
    test = splits["test"]
    x_train = train[features]
    x_validation = validation[features]
    y_train = train["label"].astype(int)
    y_validation = validation["label"].astype(int)

    rule_metrics = {
        name: ranking_metrics(split, split["rule_score"].to_numpy())
        for name, split in splits.items()
    }

    logistic = make_pipeline(
        StandardScaler(),
        LogisticRegression(
            C=0.5,
            class_weight="balanced",
            max_iter=2_000,
            random_state=42,
        ),
    )
    logistic.fit(x_train, (y_train > 0).astype(int))
    logistic_metrics = {
        name: ranking_metrics(split, logistic.predict_proba(split[features])[:, 1])
        for name, split in splits.items()
    }

    candidates = [
        {"num_leaves": 15, "min_child_samples": 40, "feature_fraction": 0.85},
        {"num_leaves": 31, "min_child_samples": 40, "feature_fraction": 0.85},
        {"num_leaves": 31, "min_child_samples": 80, "feature_fraction": 1.0},
        {"num_leaves": 63, "min_child_samples": 80, "feature_fraction": 0.85},
    ]
    trained: list[tuple[float, dict[str, Any], lgb.LGBMRanker, dict[str, Any]]] = []
    for candidate in candidates:
        model = lgb.LGBMRanker(
            objective="lambdarank",
            metric="ndcg",
            n_estimators=500,
            learning_rate=0.04,
            max_depth=-1,
            reg_alpha=0.1,
            reg_lambda=1.0,
            subsample=0.9,
            subsample_freq=1,
            random_state=42,
            n_jobs=-1,
            verbosity=-1,
            **candidate,
        )
        model.fit(
            x_train,
            y_train,
            group=group_sizes(train),
            eval_set=[(x_validation, y_validation)],
            eval_group=[group_sizes(validation)],
            eval_at=[1, 2],
            callbacks=[lgb.early_stopping(40, verbose=False)],
        )
        validation_scores = model.predict(x_validation, num_iteration=model.best_iteration_)
        metrics = ranking_metrics(validation, validation_scores)
        selection_score = metrics["at1000ms"]["participantTop1Percent"]
        trained.append((selection_score, candidate, model, metrics))
        print(json.dumps({"candidate": candidate, "bestIteration": model.best_iteration_, "validation": metrics}))

    _, selected_parameters, selected, selected_validation_metrics = max(
        trained, key=lambda result: result[0]
    )
    lightgbm_metrics = {
        "train": ranking_metrics(
            train, selected.predict(train[features], num_iteration=selected.best_iteration_)
        ),
        "validation": selected_validation_metrics,
        "test": ranking_metrics(
            test, selected.predict(test[features], num_iteration=selected.best_iteration_)
        ),
    }

    model_payload = {
        "schemaVersion": 1,
        "kind": "lightgbm-lambdarank",
        "featureNames": features,
        "horizonMs": 3_000,
        "bestIteration": selected.best_iteration_,
        "parameters": selected_parameters,
        "model": selected.booster_.dump_model(num_iteration=selected.best_iteration_),
    }
    model_path = args.output / "auto-director-lightgbm.json"
    model_path.write_text(json.dumps(model_payload, separators=(",", ":")), encoding="utf-8")

    coefficients = logistic.named_steps["logisticregression"].coef_[0]
    report = {
        "schemaVersion": 1,
        "dataset": str(args.dataset),
        "rows": {name: int(len(split)) for name, split in splits.items()},
        "matches": {name: int(split["match"].nunique()) for name, split in splits.items()},
        "maps": {name: sorted(split["map"].unique().tolist()) for name, split in splits.items()},
        "features": features,
        "selectionMetric": "validation participant top-1 at <=1000ms",
        "ruleBaseline": rule_metrics,
        "logisticBaseline": logistic_metrics,
        "logisticCoefficients": sorted(
            [
                {"feature": feature, "coefficient": round(float(coefficient), 5)}
                for feature, coefficient in zip(features, coefficients, strict=True)
            ],
            key=lambda row: abs(row["coefficient"]),
            reverse=True,
        ),
        "lightgbm": lightgbm_metrics,
        "lightgbmParameters": selected_parameters,
        "bestIteration": selected.best_iteration_,
        "featureImportance": feature_importance(selected, features),
        "modelBytes": model_path.stat().st_size,
    }
    report_path = args.output / "training-report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Model: {model_path.resolve()}")
    print(f"Report: {report_path.resolve()}")


if __name__ == "__main__":
    main()
