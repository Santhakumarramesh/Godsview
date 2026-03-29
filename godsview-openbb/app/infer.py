from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

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


def get_latest_signal() -> dict[str, object]:
    model_path = ROOT_DIR / "models" / "signal_model.joblib"
    if not model_path.exists():
        raise FileNotFoundError(
            "Model not found. Run `python -m app.train` before inference."
        )

    model = joblib.load(model_path)
    df = fetch_price_history(settings.symbol, settings.timeframe)
    feature_df = add_features(df)
    latest = feature_df.iloc[-1]

    x_latest = latest[FEATURE_COLUMNS].to_frame().T
    prob_up = float(model.predict_proba(x_latest)[0, 1])
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
        "model_meta": meta,
    }
    write_json("data/processed/latest_signal.json", payload)
    return payload


if __name__ == "__main__":
    print(get_latest_signal())

