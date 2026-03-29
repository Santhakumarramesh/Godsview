# Godsview OpenBB Research Pipeline

This package is a Python-side research and paper-trading scaffold for Godsview.

It provides an end-to-end flow:

1. Fetch market data (`OpenBB` first, fallback `Alpaca`).
2. Engineer features.
3. Train a classification model.
4. Generate live candidate signal with confidence.
5. Apply AI/rule veto.
6. Apply risk sizing and optional paper order execution.

This is designed for research + paper workflows first.

## Quick Start

```bash
cd godsview-openbb
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
cp .env.example .env
```

Train model:

```bash
python -m app.train
```

Generate latest signal:

```bash
python -m app.infer
```

Run full decision pipeline:

```bash
python -m app.main
```

Run multi-agent orchestration:

```bash
python -m app.agents.orchestrator --symbol AAPL
python -m app.agents.orchestrator --symbol BTCUSD --live
```

Run lightweight backtest report:

```bash
python -m app.backtest
```

## Files

- `app/config.py`: runtime settings and env handling.
- `app/data_fetch.py`: OpenBB/Alpaca historical data fetchers.
- `app/features.py`: engineered features + target labels.
- `app/train.py`: model training and artifact export.
- `app/infer.py`: latest inference + JSON signal artifact.
- `app/ai_filter.py`: veto/approval layer.
- `app/risk.py`: position sizing and safety checks.
- `app/broker.py`: Alpaca paper order bridge.
- `app/main.py`: orchestrator.
- `app/backtest.py`: walk-forward style scoring summary.
- `app/brain/schema.py`: entity/relationship/memory models.
- `app/brain/memory.py`: persistent brain memory store.
- `app/agents/*`: 6-agent pipeline (`data`, `signal`, `reasoning`, `risk`, `execution`, `monitor`) and orchestrator.

## Output Artifacts

- Model: `models/signal_model.joblib`
- Metadata: `models/signal_model_meta.json`
- Latest signal: `data/processed/latest_signal.json`
- Backtest summary: `data/processed/backtest_summary.json`

## Safety Defaults

- `dry_run=true` by default (no order submission).
- `ALPACA_PAPER=true` by default.
- Risk check blocks execution after daily loss threshold.
- If model confidence is neutral, signal is `skip`.

## Notes

- OpenBB APIs evolve quickly across versions/providers. This pipeline includes robust fallback logic and clear error messages.
- For production deployment, keep broker keys outside source control and use secret management.
