"""
GodsView v2 — XGBoost signal trainer.

Target variable: TP-before-SL (binary classification)
  y = 1 if price hits take-profit before stop-loss
  y = 0 if price hits stop-loss first

Training pipeline:
  1. Fetch historical bars via market data service
  2. Build feature matrix via feature service
  3. Label each signal: TP hit = 1, SL hit = 0
  4. Time-based train/test split (no lookahead)
  5. Train XGBoostClassifier with Platt calibration
  6. Log metrics + model to MLflow
  7. Return TrainingResult
"""
from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services.shared.config import cfg
from services.shared.logging import get_logger
from services.feature_service.builder import build_features, FEATURE_NAMES

log = get_logger(__name__)

_MODEL_DIR = Path("./data/models")
_MODEL_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class TrainingResult:
    run_id:           str
    model_id:         str
    symbol:           str | None
    timeframe:        str
    train_rows:       int
    test_rows:        int
    train_accuracy:   float
    test_accuracy:    float
    roc_auc:          float
    log_loss:         float
    precision:        float
    recall:           float
    f1_score:         float
    feature_importance: dict[str, float] = field(default_factory=dict)
    model_path:       str = ""
    mlflow_run_id:    str = ""
    trained_at:       str = ""
    meta:             dict[str, Any] = field(default_factory=dict)


def label_bars(
    bars: list[Any],
    direction_long: bool,
    stop_pct:   float,
    target_pct: float,
    max_forward: int = 20,
) -> list[int]:
    """
    Forward-label each bar: 1 if TP hit before SL, 0 otherwise.

    Labels the bar at index i by looking forward up to max_forward bars.
    """
    labels: list[int] = []
    n = len(bars)

    for i in range(n):
        entry = bars[i].close
        if entry <= 0:
            labels.append(-1)
            continue

        if direction_long:
            stop   = entry * (1 - stop_pct)
            target = entry * (1 + target_pct)
        else:
            stop   = entry * (1 + stop_pct)
            target = entry * (1 - target_pct)

        label = -1   # unknown (reached max_forward without hitting)
        for j in range(i + 1, min(i + max_forward + 1, n)):
            b = bars[j]
            if direction_long:
                if b.high >= target:
                    label = 1
                    break
                if b.low  <= stop:
                    label = 0
                    break
            else:
                if b.low  <= target:
                    label = 1
                    break
                if b.high >= stop:
                    label = 0
                    break
        labels.append(label)

    return labels


def train(
    bars: list[Any],
    symbol: str,
    timeframe: str = "15min",
    test_split_pct: float = 0.2,
    stop_pct: float = 0.01,
    target_pct: float = 0.02,
    max_forward: int = 20,
    direction_long: bool = True,
) -> TrainingResult | None:
    """Train an XGBoost classifier on the provided bars."""
    try:
        import xgboost as xgb  # type: ignore[import]
    except ImportError:
        log.error("xgboost_not_installed")
        return None

    try:
        from sklearn.calibration import CalibratedClassifierCV  # type: ignore[import]
        from sklearn.metrics import accuracy_score, roc_auc_score, log_loss, precision_recall_fscore_support  # type: ignore[import]
        from sklearn.model_selection import train_test_split  # type: ignore[import]
    except ImportError:
        log.error("sklearn_not_installed")
        return None

    run_id  = str(uuid.uuid4())[:8]
    model_id = f"{symbol}_{timeframe}_{run_id}"

    # ── Build feature matrix ──────────────────────────────────────────────────
    features = build_features(bars)
    if not features:
        log.warning("training_no_features", symbol=symbol)
        return None

    # ── Label ─────────────────────────────────────────────────────────────────
    # Features start at bar min_lookback (55), align labels
    start_idx = int(features[0].get("__bar_index", 55))
    labels = label_bars(bars, direction_long, stop_pct, target_pct, max_forward)
    aligned_labels = labels[start_idx : start_idx + len(features)]

    # Keep only labelled rows (y != -1)
    valid = [(f, y) for f, y in zip(features, aligned_labels) if y != -1]
    if len(valid) < 50:
        log.warning("training_too_few_samples", symbol=symbol, count=len(valid))
        return None

    # Exclude metadata columns
    feat_keys = [k for k in FEATURE_NAMES if k in valid[0][0]]

    X = [[row[k] for k in feat_keys] for row, _ in valid]
    y = [label for _, label in valid]

    # ── Time-based split (no random shuffle) ─────────────────────────────────
    split = int(len(X) * (1 - test_split_pct))
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]

    if len(X_train) < 30 or len(X_test) < 10:
        log.warning("training_split_too_small", train=len(X_train), test=len(X_test))
        return None

    # ── Train XGBoost ─────────────────────────────────────────────────────────
    clf = xgb.XGBClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        use_label_encoder=False,
        eval_metric="logloss",
        random_state=42,
        verbosity=0,
    )

    # Calibrate probabilities with Platt scaling
    calibrated = CalibratedClassifierCV(clf, cv=3, method="sigmoid")
    calibrated.fit(X_train, y_train)

    # ── Evaluate ─────────────────────────────────────────────────────────────
    y_pred  = calibrated.predict(X_test)
    y_proba = calibrated.predict_proba(X_test)[:, 1]

    train_acc = accuracy_score(y_train, calibrated.predict(X_train))
    test_acc  = accuracy_score(y_test, y_pred)
    roc_auc   = roc_auc_score(y_test, y_proba) if len(set(y_test)) > 1 else 0.5
    ll        = log_loss(y_test, y_proba)
    prec, rec, f1, _ = precision_recall_fscore_support(y_test, y_pred, average="binary", zero_division=0)

    # ── Feature importance ────────────────────────────────────────────────────
    try:
        raw_xgb = calibrated.calibrated_classifiers_[0].estimator
        fi_raw  = raw_xgb.feature_importances_
        importance = {feat_keys[i]: round(float(fi_raw[i]), 5) for i in range(len(feat_keys))}
    except Exception:
        log.debug("failed_to_extract_feature_importance", exc_info=True)
        importance = {}

    # ── Save model ────────────────────────────────────────────────────────────
    import pickle
    model_path = _MODEL_DIR / f"{model_id}.pkl"
    with open(model_path, "wb") as f:
        pickle.dump({
            "model":       calibrated,
            "feature_keys": feat_keys,
            "symbol":      symbol,
            "timeframe":   timeframe,
            "trained_at":  datetime.now(timezone.utc).isoformat(),
            "metrics": {
                "test_accuracy": test_acc,
                "roc_auc": roc_auc,
                "train_rows": len(X_train),
                "test_rows":  len(X_test),
            },
        }, f)

    # ── MLflow tracking ───────────────────────────────────────────────────────
    mlflow_run_id = _log_to_mlflow(
        model_id=model_id,
        symbol=symbol,
        timeframe=timeframe,
        metrics={
            "train_accuracy": train_acc,
            "test_accuracy":  test_acc,
            "roc_auc":        roc_auc,
            "log_loss":       ll,
            "precision":      float(prec),
            "recall":         float(rec),
            "f1_score":       float(f1),
        },
        params={
            "n_estimators": 200,
            "max_depth":    4,
            "learning_rate": 0.05,
            "stop_pct":     stop_pct,
            "target_pct":   target_pct,
            "train_rows":   len(X_train),
            "test_rows":    len(X_test),
        },
        model_path=str(model_path),
        importance=importance,
    )

    log.info(
        "training_complete",
        model_id=model_id,
        test_acc=f"{test_acc:.3f}",
        roc_auc=f"{roc_auc:.3f}",
        f1=f"{float(f1):.3f}",
        train_rows=len(X_train),
        test_rows=len(X_test),
    )

    return TrainingResult(
        run_id=run_id,
        model_id=model_id,
        symbol=symbol,
        timeframe=timeframe,
        train_rows=len(X_train),
        test_rows=len(X_test),
        train_accuracy=round(train_acc, 4),
        test_accuracy=round(test_acc, 4),
        roc_auc=round(roc_auc, 4),
        log_loss=round(ll, 4),
        precision=round(float(prec), 4),
        recall=round(float(rec), 4),
        f1_score=round(float(f1), 4),
        feature_importance=importance,
        model_path=str(model_path),
        mlflow_run_id=mlflow_run_id,
        trained_at=datetime.now(timezone.utc).isoformat(),
    )


def _log_to_mlflow(
    model_id: str,
    symbol: str,
    timeframe: str,
    metrics: dict[str, float],
    params: dict[str, Any],
    model_path: str,
    importance: dict[str, float],
) -> str:
    """Log training run to MLflow; returns mlflow run_id or empty string."""
    try:
        import mlflow  # type: ignore[import]
        mlflow.set_tracking_uri(cfg.mlflow_tracking_uri)
        mlflow.set_experiment(cfg.mlflow_experiment)

        with mlflow.start_run(run_name=model_id) as run:
            mlflow.log_param("symbol",    symbol)
            mlflow.log_param("timeframe", timeframe)
            for k, v in params.items():
                mlflow.log_param(k, v)
            for k, v in metrics.items():
                mlflow.log_metric(k, v)
            for k, v in importance.items():
                mlflow.log_metric(f"fi_{k}", v)
            try:
                mlflow.log_artifact(model_path)
            except Exception:
                log.warning("failed_to_log_artifact_to_mlflow", exc_info=True)
            return run.info.run_id
    except ImportError:
        log.warning("mlflow_not_installed")
    except Exception as exc:
        log.warning("mlflow_log_failed", err=str(exc))
    return ""
