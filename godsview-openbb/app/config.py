from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

mpl_config_dir = os.getenv("MPLCONFIGDIR", "").strip() or ".cache/matplotlib"
mpl_path = Path(mpl_config_dir)
if not mpl_path.is_absolute():
    mpl_path = ROOT_DIR / mpl_path
mpl_path.mkdir(parents=True, exist_ok=True)
os.environ["MPLCONFIGDIR"] = str(mpl_path)


def _as_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"Invalid boolean for {name}: {raw}")


def _as_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return int(raw)


def _as_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return float(raw)


@dataclass(frozen=True)
class Settings:
    alpaca_api_key: str = os.getenv("ALPACA_API_KEY", "").strip()
    alpaca_secret_key: str = os.getenv("ALPACA_SECRET_KEY", "").strip()
    alpaca_paper: bool = _as_bool("ALPACA_PAPER", True)
    alpaca_data_feed: str = os.getenv("ALPACA_DATA_FEED", "iex").strip().lower()

    symbol: str = os.getenv("SYMBOL", "BTCUSD").strip().upper()
    timeframe: str = os.getenv("TIMEFRAME", "1D").strip().upper()
    lookback: int = _as_int("LOOKBACK", 500)
    openbb_provider: str = os.getenv("OPENBB_PROVIDER", "yfinance").strip()

    model_type: str = os.getenv("MODEL_TYPE", "random_forest").strip().lower()
    model_threshold_buy: float = _as_float("MODEL_THRESHOLD_BUY", 0.60)
    model_threshold_sell: float = _as_float("MODEL_THRESHOLD_SELL", 0.40)

    max_risk_per_trade: float = _as_float("MAX_RISK_PER_TRADE", 0.01)
    max_daily_loss: float = _as_float("MAX_DAILY_LOSS", 0.03)
    default_stop_pct: float = _as_float("DEFAULT_STOP_PCT", 0.015)

    dry_run: bool = _as_bool("DRY_RUN", True)
    x_bearer_token: str = os.getenv("X_BEARER_TOKEN", "").strip()
    ftmo_calendar_url: str = os.getenv("FTMO_CALENDAR_URL", "https://ftmo.com/en/calendar/").strip()
    session_timezone: str = os.getenv("SESSION_TIMEZONE", "America/New_York").strip()
    allowed_sessions: str = os.getenv("ALLOWED_SESSIONS", "LONDON,NEW_YORK").strip().upper()
    max_positions: int = _as_int("MAX_POSITIONS", 3)
    min_rr: float = _as_float("MIN_RR", 1.5)

    @property
    def has_alpaca_keys(self) -> bool:
        return bool(self.alpaca_api_key and self.alpaca_secret_key)


settings = Settings()
