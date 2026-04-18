from __future__ import annotations

import math
from datetime import datetime, timezone

import joblib

from app.config import ROOT_DIR, settings
from app.data_fetch import fetch_price_history
from app.features import FEATURE_COLUMNS, add_features
from app.utils import read_json, write_json


def _resolve_action(prob_up: float) -> str:
    if prob_up >= settings.model_threshold_buy:
        return "buy"
    if prob_up <= settings.model_threshold_sell:
        return "sell"
    return "skip"


def _heuristic_prob(feature_row) -> float:
    ret_5 = float(feature_row.get("ret_5", 0.0))
    mom_20 = float(feature_row.get("mom_20", 0.0))
    vol_20 = float(feature_row.get("vol_20", 0.0))
    volume_z = float(feature_row.get("volume_z", 0.0))
    score = 14.0 * ret_5 + 8.0 * mom_20 - 2.0 * vol_20 + 0.6 * volume_z
    score = max(min(score, 8.0), -8.0)
    return 1.0 / (1.0 + math.exp(-score))


def get_latest_signal() -> dict[str, object]:
    model_path = ROOT_DIR / "models" / "signal_model.joblib"
    df = fetch_price_history(settings.symbol, settings.timeframe)
    feature_df = add_features(df)
    latest = feature_df.iloc[-1]
    model_mode = "trained_model"
    model_error: str | None = None
    if model_path.exists():
        try:
            model = joblib.load(model_path)
            x_latest = latest[FEATURE_COLUMNS].to_frame().T
            prob_up = float(model.predict_proba(x_latest)[0, 1])
        except Exception as err:  # noqa: BLE001
            model_mode = "heuristic_fallback"
            model_error = str(err)
            prob_up = _heuristic_prob(latest)
    else:
        model_mode = "heuristic_fallback"
        model_error = "model_file_missing"
        prob_up = _heuristic_prob(latest)
    action = _resolve_action(prob_up)
    confidence = abs(prob_up - 0.5) * 2.0

    meta = read_json("models/signal_model_meta.json") or {}
    payload: dict[str, object] = {
        "symbol": settings.symbol,
        "timeframe": settings.timeframe,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "close_price": float(latest["Close"]),
        "prob_up": round(prob_up, 6),
        "confidence": round(float(confidence), 6),
        "action": action,
        "threshold_buy": settings.model_threshold_buy,
        "threshold_sell": settings.model_threshold_sell,
        "model_meta": {
            **meta,
            "mode": model_mode,
            "error": model_error,
        },
    }
    write_json("data/processed/latest_signal.json", payload)
    return payload


if __name__ == "__main__":
    print(get_latest_signal())
