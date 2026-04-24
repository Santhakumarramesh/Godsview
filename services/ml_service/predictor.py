"""
GodsView v2 — ML predictor (inference).

Loads the active model and returns win_probability + approved flag
for a given signal + feature vector.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from services.shared.logging import get_logger
from services.shared.types import MLPrediction, Signal
from services.ml_service.models.registry import registry

log = get_logger(__name__)

# Minimum confidence threshold to approve a signal
_APPROVAL_THRESHOLD = 0.60


def predict(signal: Signal, features: dict[str, float]) -> MLPrediction:
    """
    Run inference for a signal using the active model.

    Falls back to a rule-based fallback if no model is loaded.
    """
    model_entry = registry.get_active(signal.symbol, signal.timeframe)

    if model_entry is None:
        # Rule-based fallback: approve if confidence + structure are strong
        win_prob   = _rule_based_probability(signal, features)
        approved   = win_prob >= _APPROVAL_THRESHOLD
        return MLPrediction(
            signal_id=signal.id,
            symbol=signal.symbol,
            timestamp=signal.timestamp,
            win_probability=round(win_prob, 4),
            confidence=round(win_prob, 4),
            approved=approved,
            model_version="rule_based",
            meta={"fallback": True},
        )

    loaded = registry.load_model(model_entry.model_id)
    if loaded is None:
        win_prob = _rule_based_probability(signal, features)
        approved = win_prob >= _APPROVAL_THRESHOLD
        return MLPrediction(
            signal_id=signal.id,
            symbol=signal.symbol,
            timestamp=signal.timestamp,
            win_probability=round(win_prob, 4),
            confidence=round(win_prob, 4),
            approved=approved,
            model_version="rule_based_fallback",
            model_accuracy=model_entry.test_accuracy,
            meta={"error": "model_load_failed"},
        )

    model, feat_keys = loaded

    # Build feature row in the correct column order
    X = [[features.get(k, 0.0) for k in feat_keys]]

    try:
        proba = model.predict_proba(X)[0][1]   # P(TP-hit)
    except Exception as exc:
        log.error("inference_failed", signal_id=signal.id, err=str(exc))
        proba = _rule_based_probability(signal, features)

    win_prob = float(proba)
    approved = win_prob >= _APPROVAL_THRESHOLD

    # Feature importance × actual feature value → shap-style attribution
    fi = {}
    try:
        raw_model = model.calibrated_classifiers_[0].estimator
        importances = raw_model.feature_importances_
        fi = {feat_keys[i]: round(float(importances[i]) * features.get(feat_keys[i], 0.0), 5)
              for i in range(len(feat_keys))}
    except Exception:
        pass

    return MLPrediction(
        signal_id=signal.id,
        symbol=signal.symbol,
        timestamp=signal.timestamp,
        win_probability=round(win_prob, 4),
        confidence=round(win_prob, 4),
        approved=approved,
        model_version=model_entry.model_id,
        model_accuracy=model_entry.test_accuracy,
        shap_values=fi,
        meta={
            "roc_auc":    model_entry.roc_auc,
            "train_rows": model_entry.train_rows,
            "test_rows":  model_entry.test_rows,
        },
    )


def _rule_based_probability(signal: Signal, features: dict[str, float]) -> float:
    """
    Fallback probability estimate from signal quality features.
    Used when no ML model is trained yet.
    """
    score = 0.0
    score += signal.structure_score       * 0.30
    score += signal.volume_score          * 0.20
    score += signal.order_flow_score      * 0.20
    score += signal.confidence            * 0.20
    score += min(signal.risk_reward / 3.0, 1.0) * 0.10
    return min(max(score, 0.0), 1.0)
