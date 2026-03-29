from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np

from app.config import ROOT_DIR, settings
from app.data_fetch import fetch_price_history
from app.features import FEATURE_COLUMNS, add_features
from app.utils import write_json


def run_backtest() -> dict[str, float | int | str]:
    model_path = ROOT_DIR / "models" / "signal_model.joblib"
    if not model_path.exists():
        raise FileNotFoundError("Model not found. Run `python -m app.train` first.")

    model = joblib.load(model_path)
    df = fetch_price_history(settings.symbol, settings.timeframe)
    features = add_features(df)
    if len(features) < 120:
        raise RuntimeError(f"Not enough rows for backtest: {len(features)}")

    split_idx = int(len(features) * 0.7)
    test = features.iloc[split_idx:].copy()
    x_test = test[FEATURE_COLUMNS]
    y_test = test["target"].to_numpy()

    prob_up = model.predict_proba(x_test)[:, 1]

    long_mask = prob_up >= settings.model_threshold_buy
    short_mask = prob_up <= settings.model_threshold_sell
    signal_mask = long_mask | short_mask

    pred = np.where(long_mask, 1, np.where(short_mask, 0, -1))
    active_pred = pred[signal_mask]
    active_true = y_test[signal_mask]

    total = int(len(pred))
    signaled = int(signal_mask.sum())
    if signaled == 0:
        summary: dict[str, float | int | str] = {
            "symbol": settings.symbol,
            "timeframe": settings.timeframe,
            "total_bars": total,
            "signaled_bars": 0,
            "signal_rate": 0.0,
            "hit_rate": 0.0,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        write_json("data/processed/backtest_summary.json", summary)
        return summary

    hits = int((active_pred == active_true).sum())
    summary = {
        "symbol": settings.symbol,
        "timeframe": settings.timeframe,
        "total_bars": total,
        "signaled_bars": signaled,
        "signal_rate": float(signaled / total),
        "hit_rate": float(hits / signaled),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    write_json("data/processed/backtest_summary.json", summary)
    return summary


if __name__ == "__main__":
    print(run_backtest())

