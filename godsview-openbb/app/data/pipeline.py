"""
GodsView Data Pipeline — Orchestrates the full 6-provider stack.

Pipeline flow:
    FRED (Macro) → Alpha Vantage (Indicators) → Tiingo (Price) → Signal Engine
                                                                      ↓
    Finnhub (Alt-Data) → Claude Reasoning → Risk Engine → Alpaca (Execution)

Each provider is isolated — one failure doesn't crash the pipeline.
Missing data results in neutral/default values, not errors.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

import pandas as pd

from app.data.fred_client import FREDClient, MacroSnapshot
from app.data.tiingo_client import TiingoClient
from app.data.quiver_client import QuiverClient, SmartMoneySignal
from app.data.alpaca_client import AlpacaDataClient, AccountSnapshot
from app.data.alphavantage_client import AlphaVantageClient, TechnicalSnapshot, SentimentResult
from app.data.finnhub_client import FinnhubClient, AltDataSnapshot

logger = logging.getLogger("godsview.data.pipeline")


@dataclass
class MarketContext:
    """
    Complete market context for the signal engine.

    This is the single object that gets passed through the pipeline:
      Signal Engine → AI Reasoning → Risk Engine → Execution
    """
    symbol: str
    timestamp: str = ""

    # Layer 1: FRED Macro
    macro: MacroSnapshot | None = None
    macro_bias: str = "neutral"            # "bullish" | "bearish" | "neutral"
    macro_confidence_adj: float = 0.0      # +-0.1

    # Layer 2A: Finnhub Alt-Data (replaces Quiver)
    alt_data: AltDataSnapshot | None = None
    alt_data_bias: str = "neutral"
    alt_data_confidence_adj: float = 0.0

    # Layer 2B: Alpha Vantage Technicals + Sentiment
    technicals: TechnicalSnapshot | None = None
    news_sentiment: SentimentResult | None = None
    indicator_bias: str = "neutral"
    sentiment_score: float = 0.0

    # Layer 2C: Quiver Smart Money (legacy — used if API key present)
    smart_money: SmartMoneySignal | None = None
    smart_money_bias: str = "neutral"
    smart_money_confidence_adj: float = 0.0

    # Layer 3: Price Data (Tiingo or Alpaca)
    bars_1m: pd.DataFrame = field(default_factory=lambda: pd.DataFrame())
    bars_5m: pd.DataFrame = field(default_factory=lambda: pd.DataFrame())
    bars_15m: pd.DataFrame = field(default_factory=lambda: pd.DataFrame())
    bars_1h: pd.DataFrame = field(default_factory=lambda: pd.DataFrame())
    bars_1d: pd.DataFrame = field(default_factory=lambda: pd.DataFrame())
    latest_price: float | None = None

    # Layer 4: Alpaca Execution Context
    account: AccountSnapshot | None = None
    open_positions: list = field(default_factory=list)

    # Aggregated confidence adjustment from all layers
    total_confidence_adj: float = 0.0

    # Provider health
    provider_health: dict = field(default_factory=dict)

    def is_macro_hostile(self) -> bool:
        """Check if macro environment is hostile to trading."""
        if self.macro is None:
            return False
        if self.macro.yield_spread is not None and self.macro.yield_spread < -0.5:
            if self.macro.vix is not None and self.macro.vix > 35:
                return True
        return self.macro_bias == "bearish" and (self.macro.vix or 0) > 30

    def get_effective_confidence(self, base_quality: float) -> float:
        """Apply all data layer adjustments to a base signal quality score."""
        adjusted = base_quality + self.total_confidence_adj
        return max(0.0, min(1.0, adjusted))


class DataPipeline:
    """
    Orchestrates the full data stack:
        FRED → Alpha Vantage → Finnhub → Tiingo → Alpaca

    Usage:
        pipeline = DataPipeline()
        ctx = pipeline.build_context("BTCUSD")
    """

    def __init__(self):
        self.fred = FREDClient()
        self.tiingo = TiingoClient()
        self.quiver = QuiverClient()          # legacy — optional
        self.alpaca = AlpacaDataClient()
        self.alphavantage = AlphaVantageClient()
        self.finnhub = FinnhubClient()
        logger.info("[pipeline] Data pipeline initialized with 6 providers")

    def build_context(
        self,
        symbol: str,
        include_macro: bool = True,
        include_sentiment: bool = True,
        include_bars: bool = True,
        include_account: bool = True,
    ) -> MarketContext:
        """
        Build complete market context for the signal engine.

        Each layer is fetched independently — one failure doesn't block others.
        """
        ctx = MarketContext(
            symbol=symbol,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

        # ── Layer 1: FRED Macro Intelligence ─────────────────────────────────
        if include_macro:
            try:
                ctx.macro = self.fred.get_macro_snapshot()
                ctx.macro_bias = ctx.macro.regime_bias
                if ctx.macro_bias == "bullish":
                    ctx.macro_confidence_adj = 0.05
                elif ctx.macro_bias == "bearish":
                    ctx.macro_confidence_adj = -0.05
                logger.info("[pipeline] Macro: %s (yield_spread=%.2f, vix=%.1f)",
                           ctx.macro_bias,
                           ctx.macro.yield_spread or 0,
                           ctx.macro.vix or 0)
            except Exception as e:
                logger.warning("[pipeline] FRED macro fetch failed: %s", e)

        # ── Layer 2A: Finnhub Alt-Data (Insider + Analyst + Social) ──────────
        if include_sentiment:
            try:
                equity_symbol = self._crypto_to_equity_proxy(symbol)
                target = equity_symbol or symbol
                ctx.alt_data = self.finnhub.get_alt_data_snapshot(target)
                ctx.alt_data_confidence_adj = ctx.alt_data.confidence_adjustment
                if ctx.alt_data.composite_score > 0.2:
                    ctx.alt_data_bias = "bullish"
                elif ctx.alt_data.composite_score < -0.2:
                    ctx.alt_data_bias = "bearish"
                logger.info("[pipeline] Finnhub alt-data: %s (composite=%.2f, insiders=%s)",
                           ctx.alt_data_bias,
                           ctx.alt_data.composite_score,
                           f"buy={ctx.alt_data.insider.buy_count}/sell={ctx.alt_data.insider.sell_count}" if ctx.alt_data.insider else "n/a")
            except Exception as e:
                logger.warning("[pipeline] Finnhub alt-data fetch failed: %s", e)

        # ── Layer 2B: Alpha Vantage Technicals + Sentiment ───────────────────
        if include_sentiment:
            try:
                equity_symbol = self._crypto_to_equity_proxy(symbol)
                target = equity_symbol or symbol
                ctx.technicals = self.alphavantage.get_technical_snapshot(target)
                ctx.indicator_bias = ctx.technicals.indicator_bias
                logger.info("[pipeline] AlphaVantage technicals: bias=%s (RSI=%.1f)",
                           ctx.indicator_bias,
                           ctx.technicals.rsi_14 or 0)
            except Exception as e:
                logger.warning("[pipeline] Alpha Vantage technicals failed: %s", e)

            try:
                equity_symbol = self._crypto_to_equity_proxy(symbol)
                target = equity_symbol or symbol
                ctx.news_sentiment = self.alphavantage.get_news_sentiment(target)
                ctx.sentiment_score = ctx.news_sentiment.sentiment_score
                logger.info("[pipeline] News sentiment: %.2f (%s, %d articles)",
                           ctx.sentiment_score,
                           ctx.news_sentiment.sentiment_label,
                           ctx.news_sentiment.article_count)
            except Exception as e:
                logger.warning("[pipeline] Alpha Vantage sentiment failed: %s", e)

        # ── Layer 2C: Quiver (legacy — only if API key present) ──────────────
        if include_sentiment:
            try:
                equity_symbol = self._crypto_to_equity_proxy(symbol)
                if equity_symbol and self.quiver._is_available():
                    ctx.smart_money = self.quiver.get_smart_money_signal(equity_symbol)
                    ctx.smart_money_confidence_adj = ctx.smart_money.confidence_adjustment
                    if ctx.smart_money.composite_score > 0.2:
                        ctx.smart_money_bias = "bullish"
                    elif ctx.smart_money.composite_score < -0.2:
                        ctx.smart_money_bias = "bearish"
            except Exception as e:
                logger.warning("[pipeline] Quiver smart money failed: %s", e)

        # ── Layer 3: Tiingo Price Data ───────────────────────────────────────
        if include_bars:
            try:
                ctx.bars_1h = self.tiingo.get_ohlcv(symbol, interval="1hour", lookback_days=7)
                ctx.bars_1d = self.tiingo.get_ohlcv(symbol, interval="1day", lookback_days=90)
                ctx.latest_price = self.tiingo.get_latest_price(symbol)

                # Intraday from Alpaca (lower latency)
                alpaca_bars = self.alpaca.get_bars(symbol, timeframe="5Min", lookback_days=2)
                if not alpaca_bars.empty:
                    ctx.bars_5m = alpaca_bars

                alpaca_1m = self.alpaca.get_bars(symbol, timeframe="1Min", lookback_days=1)
                if not alpaca_1m.empty:
                    ctx.bars_1m = alpaca_1m

                logger.info("[pipeline] Price data: 1m=%d, 5m=%d, 1h=%d, 1d=%d bars",
                           len(ctx.bars_1m), len(ctx.bars_5m),
                           len(ctx.bars_1h), len(ctx.bars_1d))
            except Exception as e:
                logger.warning("[pipeline] Price data fetch failed: %s", e)

        # ── Layer 4: Alpaca Execution Context ────────────────────────────────
        if include_account:
            try:
                ctx.account = self.alpaca.get_account()
                ctx.open_positions = self.alpaca.get_positions()
                logger.info("[pipeline] Account: equity=$%.2f, positions=%d",
                           ctx.account.equity, len(ctx.open_positions))
            except Exception as e:
                logger.warning("[pipeline] Alpaca account fetch failed: %s", e)

        # ── Aggregate confidence adjustments ─────────────────────────────────
        ctx.total_confidence_adj = (
            ctx.macro_confidence_adj +
            ctx.alt_data_confidence_adj +
            ctx.smart_money_confidence_adj +
            (ctx.sentiment_score * 0.05)  # news sentiment contributes +-5%
        )

        # ── Provider health ──────────────────────────────────────────────────
        ctx.provider_health = {
            "fred": self.fred.health(),
            "tiingo": self.tiingo.health(),
            "alphavantage": self.alphavantage.health(),
            "finnhub": self.finnhub.health(),
            "quiver": self.quiver.health(),
            "alpaca": self.alpaca.health(),
        }

        return ctx

    def health_check(self) -> dict:
        """Check health of all providers."""
        return {
            "pipeline_status": "operational",
            "providers": {
                "fred": self.fred.health(),
                "tiingo": self.tiingo.health(),
                "alphavantage": self.alphavantage.health(),
                "finnhub": self.finnhub.health(),
                "quiver": self.quiver.health(),
                "alpaca": self.alpaca.health(),
            },
        }

    @staticmethod
    def _crypto_to_equity_proxy(symbol: str) -> str | None:
        """
        Map crypto symbols to related equity tickers.
        Crypto doesn't have insider/congress trading, but related companies do.
        """
        proxies = {
            "BTC": "MSTR",   # MicroStrategy (BTC proxy)
            "ETH": "COIN",   # Coinbase (crypto proxy)
            "SOL": "COIN",
            "AVAX": "COIN",
            "DOGE": "COIN",
            "ADA": "COIN",
        }
        clean = symbol.upper().replace("/", "").replace("USD", "").replace("USDT", "")
        return proxies.get(clean)
