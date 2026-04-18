from __future__ import annotations

import argparse
from datetime import datetime, timezone

import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, roc_auc_score

from app.config import ROOT_DIR, settings
from app.data_fetch import fetch_price_history
from app.features import FEATURE_COLUMNS, add_features
from app.utils import write_json


def _build_model() -> RandomForestClassifier:
    if settings.model_type != "random_forest":
        print(
            f"[warn] Unsupported MODEL_TYPE={settings.model_type}. Falling back to random_forest."
        )
    return RandomForestClassifier(
        n_estimators=400,
        max_depth=7,
        min_samples_leaf=6,
        random_state=42,
        n_jobs=-1,
    )


def train_model(
    symbol: str | None = None, timeframe: str | None = None
) -> dict[str, float | int | str]:
    run_symbol = (symbol or settings.symbol).upper()
    run_timeframe = (timeframe or settings.timeframe).upper()
    df = fetch_price_history(run_symbol, run_timeframe)
    feature_df = add_features(df)

    if len(feature_df) < 160:
        raise RuntimeError(f"Not enough feature rows for training: {len(feature_df)}")

    split_idx = int(len(feature_df) * 0.8)
    train_df = feature_df.iloc[:split_idx].copy()
    test_df = feature_df.iloc[split_idx:].copy()

    x_train = train_df[FEATURE_COLUMNS]
    y_train = train_df["target"]
    x_test = test_df[FEATURE_COLUMNS]
    y_test = test_df["target"]

    model = _build_model()
    model.fit(x_train, y_train)

    prob_up = model.predict_proba(x_test)[:, 1]
    preds = (prob_up >= 0.5).astype(int)

    metrics = {
        "symbol": run_symbol,
        "timeframe": run_timeframe,
        "train_rows": int(len(train_df)),
        "test_rows": int(len(test_df)),
        "accuracy": float(accuracy_score(y_test, preds)),
        "roc_auc": float(roc_auc_score(y_test, prob_up)),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    print("=== Training Summary ===")
    print(metrics)
    print(classification_report(y_test, preds, digits=3))

    models_dir = ROOT_DIR / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    model_path = models_dir / "signal_model.joblib"
    joblib.dump(model, model_path)

    write_json("models/signal_model_meta.json", metrics)
    print(f"Saved model artifact: {model_path}")

    return metrics


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Godsview research model")
    parser.add_argument("--symbol", type=str, default=settings.symbol)
    parser.add_argument("--timeframe", type=str, default=settings.timeframe)
    args = parser.parse_args()
    train_model(symbol=args.symbol, timeframe=args.timeframe)
