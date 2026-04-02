"""
GodsView v2 — Central configuration (env-driven, pydantic-settings).

Every service imports from here so secrets/endpoints live in ONE place.
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── Environment ────────────────────────────────────────────────────────────
    env: Literal["development", "staging", "production"] = Field(
        default="development", alias="APP_ENV"
    )
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    secret_key: str = Field(default="dev-secret-change-me", alias="SECRET_KEY")

    # ── Service ports ──────────────────────────────────────────────────────────
    api_gateway_port: int = Field(default=8000, alias="API_GATEWAY_PORT")
    market_data_port: int = Field(default=8001, alias="MARKET_DATA_PORT")
    feature_port: int = Field(default=8002, alias="FEATURE_PORT")
    backtest_port: int = Field(default=8003, alias="BACKTEST_PORT")
    ml_port: int = Field(default=8004, alias="ML_PORT")
    execution_port: int = Field(default=8005, alias="EXECUTION_PORT")
    risk_port: int = Field(default=8006, alias="RISK_PORT")
    memory_port: int = Field(default=8007, alias="MEMORY_PORT")

    # ── Inter-service URLs ─────────────────────────────────────────────────────
    market_data_url: str = Field(
        default="http://market-data:8001", alias="MARKET_DATA_URL"
    )
    feature_url: str = Field(default="http://feature:8002", alias="FEATURE_URL")
    backtest_url: str = Field(
        default="http://backtest:8003", alias="BACKTEST_URL"
    )
    ml_url: str = Field(default="http://ml:8004", alias="ML_URL")
    execution_url: str = Field(
        default="http://execution:8005", alias="EXECUTION_URL"
    )
    risk_url: str = Field(default="http://risk:8006", alias="RISK_URL")
    memory_url: str = Field(default="http://memory:8007", alias="MEMORY_URL")

    # ── Alpaca ─────────────────────────────────────────────────────────────────
    alpaca_key_id: str = Field(default="", alias="ALPACA_KEY_ID")
    alpaca_secret_key: str = Field(default="", alias="ALPACA_SECRET_KEY")
    alpaca_base_url: str = Field(
        default="https://paper-api.alpaca.markets", alias="ALPACA_BASE_URL"
    )
    alpaca_data_url: str = Field(
        default="https://data.alpaca.markets", alias="ALPACA_DATA_URL"
    )
    alpaca_paper: bool = Field(default=True, alias="ALPACA_PAPER")

    # ── Database ───────────────────────────────────────────────────────────────
    database_url: str = Field(
        default="sqlite+aiosqlite:///./godsview_v2.db", alias="DATABASE_URL"
    )
    redis_url: str = Field(default="redis://redis:6379/0", alias="REDIS_URL")

    # ── ML / MLflow ────────────────────────────────────────────────────────────
    mlflow_tracking_uri: str = Field(
        default="http://mlflow:5000", alias="MLFLOW_TRACKING_URI"
    )
    mlflow_experiment: str = Field(
        default="godsview-signals", alias="MLFLOW_EXPERIMENT"
    )

    # ── LanceDB ────────────────────────────────────────────────────────────────
    lancedb_uri: str = Field(
        default="./data/lancedb", alias="LANCEDB_URI"
    )

    # ── OpenBB ────────────────────────────────────────────────────────────────
    openbb_pat: str = Field(default="", alias="OPENBB_PAT")

    # ── Risk defaults ─────────────────────────────────────────────────────────
    max_daily_loss_pct: float = Field(default=2.0, alias="MAX_DAILY_LOSS_PCT")
    max_position_size_pct: float = Field(
        default=5.0, alias="MAX_POSITION_SIZE_PCT"
    )
    max_open_positions: int = Field(default=10, alias="MAX_OPEN_POSITIONS")
    default_risk_per_trade_pct: float = Field(
        default=1.0, alias="DEFAULT_RISK_PER_TRADE_PCT"
    )

    # ── Feature flags ─────────────────────────────────────────────────────────
    live_trading_enabled: bool = Field(
        default=False, alias="LIVE_TRADING_ENABLED"
    )
    si_filter_enabled: bool = Field(default=True, alias="SI_FILTER_ENABLED")
    auto_retrain_enabled: bool = Field(
        default=True, alias="AUTO_RETRAIN_ENABLED"
    )

    @field_validator("log_level")
    @classmethod
    def _normalise_log_level(cls, v: str) -> str:
        return v.upper()

    model_config = {"env_file": ".env", "extra": "ignore", "populate_by_name": True}


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


# Convenience singleton — import as `cfg`
cfg = get_settings()
