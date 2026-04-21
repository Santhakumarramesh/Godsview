"""
GodsView v2 — pytest configuration and shared fixtures.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

# Ensure the repo root is on sys.path so `services.*` imports work
REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT))

# Set test env vars before any service config is loaded
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("LOG_LEVEL", "WARNING")
os.environ.setdefault("ALPACA_KEY_ID",     "test-key-id")
os.environ.setdefault("ALPACA_SECRET_KEY", "test-secret")
os.environ.setdefault("DATABASE_URL",      "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("LANCEDB_URI",       "/tmp/godsview_test_lancedb")
os.environ.setdefault("MLFLOW_TRACKING_URI", "file:///tmp/godsview_test_mlruns")


# ── Bar factory ───────────────────────────────────────────────────────────────

from services.shared.types import Bar


def make_bar(
    close: float = 100.0,
    open_: float | None = None,
    high: float | None = None,
    low: float | None = None,
    volume: float = 100_000.0,
    symbol: str = "AAPL",
    timeframe: str = "15min",
    ts: datetime | None = None,
) -> Bar:
    if open_ is None:
        open_ = close * 0.999
    if high is None:
        high = close * 1.005
    if low is None:
        low = close * 0.995
    return Bar(
        symbol=symbol,
        timestamp=ts or datetime.now(timezone.utc),
        open=open_,
        high=high,
        low=low,
        close=close,
        volume=volume,
        timeframe=timeframe,
    )


def make_bars(
    n: int = 100,
    base_price: float = 100.0,
    trend: float = 0.001,
    symbol: str = "AAPL",
    timeframe: str = "15min",
) -> list[Bar]:
    """Generate a synthetic bar series with a mild uptrend and realistic noise."""
    import random
    from datetime import timedelta
    rng = random.Random(42)
    bars: list[Bar] = []
    price = base_price
    now = datetime.now(timezone.utc)
    for i in range(n):
        change = price * (trend + rng.gauss(0, 0.008))
        open_  = price
        close  = max(open_ + change, 0.01)
        high   = max(open_, close) * (1 + abs(rng.gauss(0, 0.003)))
        low    = min(open_, close) * (1 - abs(rng.gauss(0, 0.003)))
        vol    = rng.uniform(50_000, 500_000)
        ts     = now - timedelta(minutes=15 * (n - i))
        bars.append(Bar(
            symbol=symbol,
            timestamp=ts,
            open=round(open_, 4),
            high=round(high, 4),
            low=round(low, 4),
            close=round(close, 4),
            volume=round(vol, 0),
            timeframe=timeframe,
        ))
        price = close
    return bars


@pytest.fixture
def sample_bars() -> list[Bar]:
    return make_bars(200, base_price=150.0)


@pytest.fixture
def trending_bars_long() -> list[Bar]:
    """200 bars with strong uptrend — should trigger long signals."""
    return make_bars(200, base_price=100.0, trend=0.003)


@pytest.fixture
def trending_bars_short() -> list[Bar]:
    """200 bars with strong downtrend — should trigger short signals."""
    return make_bars(200, base_price=100.0, trend=-0.003)
