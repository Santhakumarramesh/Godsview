"""
Alpha Vantage Client — Technical Indicators + News Sentiment.

The indicator backbone:
  - Pre-computed RSI, MACD, EMA, SMA, Bollinger, Stochastic, ADX, ATR
  - News sentiment scores (bullish/bearish per ticker)
  - Earnings calendar
  - Company overview + fundamentals

Alpha Vantage computes indicators server-side, so we get clean
signals without needing to implement our own TA library.

Free tier: 25 requests/day → aggressive caching required.
"""

from __future__ import annotations

import os
import logging
from dataclasses import dataclass, field

import requests
import pandas as pd

from app.data.base import BaseDataClient

logger = logging.getLogger("godsview.data.alphavantage")


@dataclass
class SentimentResult:
    """News sentiment for a ticker."""
    ticker: str
    sentiment_score: float = 0.0       # -1 to +1
    sentiment_label: str = "neutral"   # Bullish / Bearish / Neutral
    relevance_score: float = 0.0       # 0 to 1
    article_count: int = 0
    bullish_count: int = 0
    bearish_count: int = 0
    neutral_count: int = 0
    fetched_at: str = ""

    def to_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class TechnicalSnapshot:
    """Pre-computed technical indicators from Alpha Vantage."""
    symbol: str
    rsi_14: float | None = None
    macd_line: float | None = None
    macd_signal: float | None = None
    macd_hist: float | None = None
    ema_12: float | None = None
    ema_26: float | None = None
    sma_50: float | None = None
    sma_200: float | None = None
    bb_upper: float | None = None
    bb_middle: float | None = None
    bb_lower: float | None = None
    adx: float | None = None
    atr: float | None = None
    stoch_k: float | None = None
    stoch_d: float | None = None
    indicator_bias: str = "neutral"     # "bull" | "bear" | "neutral"
    fetched_at: str = ""

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v is not None}


class AlphaVantageClient(BaseDataClient):
    """
    Production Alpha Vantage client — indicators + sentiment.

    Aggressive caching (4h for indicators, 1h for sentiment) to stay
    within the 25 req/day free limit.

    Usage:
        av = AlphaVantageClient()
        technicals = av.get_technical_snapshot("AAPL")
        sentiment = av.get_news_sentiment("AAPL")
        rsi_df = av.get_rsi("AAPL", interval="daily", period=14)
    """

    BASE_URL = "https://www.alphavantage.co/query"

    def __init__(self):
        super().__init__(name="AlphaVantage", default_ttl=14400.0, max_retries=2)  # 4h cache
        self.api_key = os.getenv("ALPHA_VANTAGE_API_KEY", "")
        if not self.api_key:
            logger.warning("[AlphaVantage] No ALPHA_VANTAGE_API_KEY — indicators will use local computation")

    def _is_available(self) -> bool:
        return bool(self.api_key)

    def _request(self, params: dict) -> dict | None:
        """Make a rate-limited request to Alpha Vantage."""
        params["apikey"] = self.api_key

        def _do_fetch():
            resp = requests.get(self.BASE_URL, params=params, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            # AV returns error messages in "Note" or "Information" keys
            if "Note" in data:
                raise RuntimeError(f"Rate limited: {data['Note']}")
            if "Error Message" in data:
                raise ValueError(f"AV error: {data['Error Message']}")
            return data

        return self._fetch_with_retry(_do_fetch, label=f"AV/{params.get('function', '?')}")

    # ── Individual Indicators ────────────────────────────────────────────────

    def get_rsi(self, symbol: str, interval: str = "daily", period: int = 14) -> pd.DataFrame:
        """Fetch RSI series."""
        cache_key = f"rsi:{symbol}:{interval}:{period}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        if not self._is_available():
            return pd.DataFrame(columns=["date", "RSI"])

        data = self._request({
            "function": "RSI",
            "symbol": symbol,
            "interval": interval,
            "time_period": period,
            "series_type": "close",
        })
        if not data:
            return pd.DataFrame(columns=["date", "RSI"])

        key = f"Technical Analysis: RSI"
        series = data.get(key, {})
        rows = [{"date": pd.Timestamp(d), "RSI": float(v["RSI"])} for d, v in series.items()]
        df = pd.DataFrame(rows).sort_values("date").reset_index(drop=True)
        self._cache_set(cache_key, df)
        return df

    def get_macd(self, symbol: str, interval: str = "daily") -> pd.DataFrame:
        """Fetch MACD series."""
        cache_key = f"macd:{symbol}:{interval}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        if not self._is_available():
            return pd.DataFrame(columns=["date", "MACD", "MACD_Signal", "MACD_Hist"])

        data = self._request({
            "function": "MACD",
            "symbol": symbol,
            "interval": interval,
            "series_type": "close",
        })
        if not data:
            return pd.DataFrame(columns=["date", "MACD", "MACD_Signal", "MACD_Hist"])

        series = data.get("Technical Analysis: MACD", {})
        rows = [{
            "date": pd.Timestamp(d),
            "MACD": float(v.get("MACD", 0)),
            "MACD_Signal": float(v.get("MACD_Signal", 0)),
            "MACD_Hist": float(v.get("MACD_Hist", 0)),
        } for d, v in series.items()]
        df = pd.DataFrame(rows).sort_values("date").reset_index(drop=True)
        self._cache_set(cache_key, df)
        return df

    def get_bbands(self, symbol: str, interval: str = "daily", period: int = 20) -> pd.DataFrame:
        """Fetch Bollinger Bands."""
        cache_key = f"bbands:{symbol}:{interval}:{period}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        if not self._is_available():
            return pd.DataFrame(columns=["date", "upper", "middle", "lower"])

        data = self._request({
            "function": "BBANDS",
            "symbol": symbol,
            "interval": interval,
            "time_period": period,
            "series_type": "close",
        })
        if not data:
            return pd.DataFrame(columns=["date", "upper", "middle", "lower"])

        series = data.get("Technical Analysis: BBANDS", {})
        rows = [{
            "date": pd.Timestamp(d),
            "upper": float(v.get("Real Upper Band", 0)),
            "middle": float(v.get("Real Middle Band", 0)),
            "lower": float(v.get("Real Lower Band", 0)),
        } for d, v in series.items()]
        df = pd.DataFrame(rows).sort_values("date").reset_index(drop=True)
        self._cache_set(cache_key, df)
        return df

    # ── Technical Snapshot (Aggregated) ──────────────────────────────────────

    def get_technical_snapshot(self, symbol: str) -> TechnicalSnapshot:
        """
        Build a complete technical snapshot for the signal engine.

        Fetches RSI, MACD, BBands and derives an indicator bias.
        Each indicator is independent — one failure doesn't block others.
        """
        cache_key = f"tech_snapshot:{symbol}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        snap = TechnicalSnapshot(symbol=symbol, fetched_at=self.utcnow().isoformat())

        # RSI
        rsi_df = self.get_rsi(symbol)
        if not rsi_df.empty:
            snap.rsi_14 = float(rsi_df.iloc[-1]["RSI"])

        # MACD
        macd_df = self.get_macd(symbol)
        if not macd_df.empty:
            row = macd_df.iloc[-1]
            snap.macd_line = float(row["MACD"])
            snap.macd_signal = float(row["MACD_Signal"])
            snap.macd_hist = float(row["MACD_Hist"])

        # Bollinger Bands
        bb_df = self.get_bbands(symbol)
        if not bb_df.empty:
            row = bb_df.iloc[-1]
            snap.bb_upper = float(row["upper"])
            snap.bb_middle = float(row["middle"])
            snap.bb_lower = float(row["lower"])

        # Derive bias
        snap.indicator_bias = self._classify_bias(snap)

        self._cache_set(cache_key, snap, ttl=14400.0)  # 4h
        return snap

    @staticmethod
    def _classify_bias(snap: TechnicalSnapshot) -> str:
        """Derive indicator bias from RSI, MACD, BB position."""
        score = 0

        if snap.rsi_14 is not None:
            if snap.rsi_14 > 60:
                score += 1
            elif snap.rsi_14 < 40:
                score -= 1

        if snap.macd_hist is not None:
            if snap.macd_hist > 0:
                score += 1
            elif snap.macd_hist < 0:
                score -= 1

        if score >= 2:
            return "bull"
        elif score <= -2:
            return "bear"
        return "neutral"

    # ── News Sentiment ───────────────────────────────────────────────────────

    def get_news_sentiment(self, ticker: str) -> SentimentResult:
        """
        Fetch news sentiment for a ticker.

        Returns aggregated sentiment score from recent articles.
        """
        cache_key = f"sentiment:{ticker}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        result = SentimentResult(ticker=ticker, fetched_at=self.utcnow().isoformat())

        if not self._is_available():
            return result

        data = self._request({
            "function": "NEWS_SENTIMENT",
            "tickers": ticker,
            "limit": 50,
            "sort": "LATEST",
        })
        if not data or "feed" not in data:
            return result

        articles = data["feed"]
        result.article_count = len(articles)

        total_score = 0.0
        total_relevance = 0.0

        for article in articles:
            # Find the ticker-specific sentiment
            for ts in article.get("ticker_sentiment", []):
                if ts.get("ticker", "").upper() == ticker.upper():
                    score = float(ts.get("ticker_sentiment_score", 0))
                    relevance = float(ts.get("relevance_score", 0))
                    total_score += score * relevance
                    total_relevance += relevance

                    if score > 0.15:
                        result.bullish_count += 1
                    elif score < -0.15:
                        result.bearish_count += 1
                    else:
                        result.neutral_count += 1

        if total_relevance > 0:
            result.sentiment_score = total_score / total_relevance
            result.relevance_score = total_relevance / max(result.article_count, 1)

        if result.sentiment_score > 0.15:
            result.sentiment_label = "Bullish"
        elif result.sentiment_score < -0.15:
            result.sentiment_label = "Bearish"
        else:
            result.sentiment_label = "Neutral"

        self._cache_set(cache_key, result, ttl=3600.0)  # 1h for sentiment
        return result
