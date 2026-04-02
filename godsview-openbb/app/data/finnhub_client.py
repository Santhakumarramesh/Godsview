"""
Finnhub Client — Alternative Data + Insider Intelligence.

The closest free replacement for Quiver Quantitative:
  - Insider transactions (SEC Form 4 filings)
  - Company news with sentiment
  - Earnings calendar + surprises
  - Recommendation trends (analyst consensus)
  - Social sentiment (Reddit, Twitter mentions)
  - Basic financials

Free tier: 60 calls/min → generous for our use case.
"""

from __future__ import annotations

import os
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import requests
import pandas as pd

from app.data.base import BaseDataClient

logger = logging.getLogger("godsview.data.finnhub")


@dataclass
class InsiderSignal:
    """Aggregated insider trading signal."""
    symbol: str
    buy_count: int = 0
    sell_count: int = 0
    net_shares: int = 0
    net_sentiment: float = 0.0            # -1 to +1
    largest_buy: float = 0.0
    largest_sell: float = 0.0
    recent_transactions: list = field(default_factory=list)
    fetched_at: str = ""

    def to_dict(self) -> dict:
        d = self.__dict__.copy()
        d["recent_transactions"] = d["recent_transactions"][:5]  # limit for payload
        return d


@dataclass
class AnalystConsensus:
    """Analyst recommendation consensus."""
    symbol: str
    buy: int = 0
    hold: int = 0
    sell: int = 0
    strong_buy: int = 0
    strong_sell: int = 0
    consensus: str = "neutral"           # "strong_buy" | "buy" | "hold" | "sell" | "strong_sell"
    period: str = ""
    fetched_at: str = ""

    def to_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class SocialSentiment:
    """Social media sentiment aggregation."""
    symbol: str
    reddit_mentions: int = 0
    reddit_sentiment: float = 0.0        # -1 to +1
    twitter_mentions: int = 0
    twitter_sentiment: float = 0.0
    composite_sentiment: float = 0.0
    fetched_at: str = ""

    def to_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class AltDataSnapshot:
    """Complete alternative data snapshot — replaces Quiver."""
    symbol: str
    insider: InsiderSignal | None = None
    analyst: AnalystConsensus | None = None
    social: SocialSentiment | None = None
    news_sentiment: float = 0.0
    news_count: int = 0
    composite_score: float = 0.0         # -1 to +1 overall alt-data signal
    confidence_adjustment: float = 0.0   # how much to adjust signal confidence
    fetched_at: str = ""

    def to_dict(self) -> dict:
        result = {
            "symbol": self.symbol,
            "composite_score": self.composite_score,
            "confidence_adjustment": self.confidence_adjustment,
            "news_sentiment": self.news_sentiment,
            "news_count": self.news_count,
            "fetched_at": self.fetched_at,
        }
        if self.insider:
            result["insider"] = self.insider.to_dict()
        if self.analyst:
            result["analyst"] = self.analyst.to_dict()
        if self.social:
            result["social"] = self.social.to_dict()
        return result


class FinnhubClient(BaseDataClient):
    """
    Production Finnhub client — insider trades, sentiment, analyst data.

    Replaces Quiver Quantitative with free data that's actually better
    for real-time trading decisions.

    Usage:
        fh = FinnhubClient()
        insiders = fh.get_insider_signal("AAPL")
        analysts = fh.get_analyst_consensus("AAPL")
        snapshot = fh.get_alt_data_snapshot("AAPL")
    """

    BASE_URL = "https://finnhub.io/api/v1"

    def __init__(self):
        super().__init__(name="Finnhub", default_ttl=1800.0, max_retries=2)  # 30min cache
        self.api_key = os.getenv("FINNHUB_API_KEY", "")
        if not self.api_key:
            logger.warning("[Finnhub] No FINNHUB_API_KEY — alt-data layer unavailable")

    def _is_available(self) -> bool:
        return bool(self.api_key)

    def _request(self, endpoint: str, params: dict | None = None) -> dict | list | None:
        """Make a request to Finnhub API."""
        if not self._is_available():
            return None

        full_params = {"token": self.api_key}
        if params:
            full_params.update(params)

        def _do_fetch():
            resp = requests.get(
                f"{self.BASE_URL}/{endpoint}",
                params=full_params,
                timeout=15,
            )
            resp.raise_for_status()
            return resp.json()

        return self._fetch_with_retry(_do_fetch, label=f"Finnhub/{endpoint}")

    # ── Insider Transactions ─────────────────────────────────────────────────

    def get_insider_transactions(self, symbol: str) -> pd.DataFrame:
        """
        Fetch SEC Form 4 insider transactions.

        Returns DataFrame with: date, name, share, change, filingDate, transactionCode
        """
        cache_key = f"insider_tx:{symbol}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        data = self._request("stock/insider-transactions", {"symbol": symbol})
        if not data or "data" not in data:
            return pd.DataFrame()

        df = pd.DataFrame(data["data"])
        if df.empty:
            return df

        # Filter to last 90 days
        if "transactionDate" in df.columns:
            df["transactionDate"] = pd.to_datetime(df["transactionDate"], errors="coerce")
            cutoff = datetime.now(timezone.utc) - timedelta(days=90)
            df = df[df["transactionDate"] >= cutoff]

        self._cache_set(cache_key, df)
        return df.reset_index(drop=True)

    def get_insider_signal(self, symbol: str) -> InsiderSignal:
        """Build aggregated insider trading signal."""
        cache_key = f"insider_signal:{symbol}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        signal = InsiderSignal(symbol=symbol, fetched_at=self.utcnow().isoformat())

        df = self.get_insider_transactions(symbol)
        if df.empty:
            self._cache_set(cache_key, signal)
            return signal

        if "change" in df.columns and "transactionCode" in df.columns:
            # P = Purchase, S = Sale, A = Grant/Award
            buys = df[df["transactionCode"].isin(["P"])]
            sells = df[df["transactionCode"].isin(["S"])]

            signal.buy_count = len(buys)
            signal.sell_count = len(sells)

            if "share" in df.columns:
                buy_shares = buys["share"].sum() if not buys.empty else 0
                sell_shares = sells["share"].sum() if not sells.empty else 0
                signal.net_shares = int(buy_shares - sell_shares)

                if not buys.empty:
                    signal.largest_buy = float(buys["share"].max())
                if not sells.empty:
                    signal.largest_sell = float(sells["share"].max())

            total = signal.buy_count + signal.sell_count
            if total > 0:
                signal.net_sentiment = (signal.buy_count - signal.sell_count) / total

            # Recent transactions (last 5)
            recent_cols = ["transactionDate", "name", "transactionCode", "share"]
            available_cols = [c for c in recent_cols if c in df.columns]
            if available_cols:
                signal.recent_transactions = (
                    df[available_cols].head(5).to_dict("records")
                )

        self._cache_set(cache_key, signal)
        return signal

    # ── Analyst Recommendations ──────────────────────────────────────────────

    def get_analyst_consensus(self, symbol: str) -> AnalystConsensus:
        """Fetch analyst recommendation consensus."""
        cache_key = f"analyst:{symbol}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        result = AnalystConsensus(symbol=symbol, fetched_at=self.utcnow().isoformat())

        data = self._request("stock/recommendation", {"symbol": symbol})
        if not data or not isinstance(data, list) or len(data) == 0:
            self._cache_set(cache_key, result)
            return result

        # Most recent period
        latest = data[0]
        result.buy = latest.get("buy", 0)
        result.hold = latest.get("hold", 0)
        result.sell = latest.get("sell", 0)
        result.strong_buy = latest.get("strongBuy", 0)
        result.strong_sell = latest.get("strongSell", 0)
        result.period = latest.get("period", "")

        # Derive consensus
        total = result.strong_buy + result.buy + result.hold + result.sell + result.strong_sell
        if total > 0:
            weighted = (
                result.strong_buy * 2 + result.buy * 1 +
                result.hold * 0 +
                result.sell * -1 + result.strong_sell * -2
            ) / total
            if weighted > 1.0:
                result.consensus = "strong_buy"
            elif weighted > 0.3:
                result.consensus = "buy"
            elif weighted > -0.3:
                result.consensus = "hold"
            elif weighted > -1.0:
                result.consensus = "sell"
            else:
                result.consensus = "strong_sell"

        self._cache_set(cache_key, result)
        return result

    # ── News Sentiment ───────────────────────────────────────────────────────

    def get_company_news(self, symbol: str, lookback_days: int = 7) -> list[dict]:
        """Fetch recent company news."""
        cache_key = f"news:{symbol}:{lookback_days}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        now = datetime.now(timezone.utc)
        start = (now - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
        end = now.strftime("%Y-%m-%d")

        data = self._request("company-news", {
            "symbol": symbol,
            "from": start,
            "to": end,
        })
        if not data or not isinstance(data, list):
            return []

        # Limit to 50 articles
        result = data[:50]
        self._cache_set(cache_key, result, ttl=1800.0)
        return result

    # ── Social Sentiment ─────────────────────────────────────────────────────

    def get_social_sentiment(self, symbol: str) -> SocialSentiment:
        """Fetch Reddit + Twitter mention/sentiment data."""
        cache_key = f"social:{symbol}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        result = SocialSentiment(symbol=symbol, fetched_at=self.utcnow().isoformat())

        data = self._request("stock/social-sentiment", {"symbol": symbol})
        if not data:
            self._cache_set(cache_key, result)
            return result

        # Reddit
        reddit = data.get("reddit", [])
        if reddit:
            result.reddit_mentions = sum(r.get("mention", 0) for r in reddit)
            scores = [r.get("score", 0) for r in reddit if r.get("score", 0) != 0]
            if scores:
                result.reddit_sentiment = sum(scores) / len(scores)

        # Twitter
        twitter = data.get("twitter", [])
        if twitter:
            result.twitter_mentions = sum(t.get("mention", 0) for t in twitter)
            scores = [t.get("score", 0) for t in twitter if t.get("score", 0) != 0]
            if scores:
                result.twitter_sentiment = sum(scores) / len(scores)

        # Composite: Reddit weighted 60%, Twitter 40%
        result.composite_sentiment = (
            result.reddit_sentiment * 0.6 + result.twitter_sentiment * 0.4
        )

        self._cache_set(cache_key, result, ttl=1800.0)
        return result

    # ── Full Alt-Data Snapshot (Replaces Quiver) ─────────────────────────────

    def get_alt_data_snapshot(self, symbol: str) -> AltDataSnapshot:
        """
        Build complete alternative data snapshot.

        This replaces QuiverClient.get_smart_money_signal() with
        better data from Finnhub's free tier:
          - Insider transactions (SEC Form 4)
          - Analyst consensus
          - Social sentiment (Reddit + Twitter)
          - Company news volume
        """
        cache_key = f"alt_snapshot:{symbol}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        snap = AltDataSnapshot(
            symbol=symbol,
            fetched_at=self.utcnow().isoformat(),
        )

        # ── Insider data ─────────────────────────────────────────────────────
        try:
            snap.insider = self.get_insider_signal(symbol)
        except Exception as e:
            logger.warning("[Finnhub] Insider fetch failed: %s", e)

        # ── Analyst consensus ────────────────────────────────────────────────
        try:
            snap.analyst = self.get_analyst_consensus(symbol)
        except Exception as e:
            logger.warning("[Finnhub] Analyst fetch failed: %s", e)

        # ── Social sentiment ─────────────────────────────────────────────────
        try:
            snap.social = self.get_social_sentiment(symbol)
        except Exception as e:
            logger.warning("[Finnhub] Social sentiment failed: %s", e)

        # ── News volume ──────────────────────────────────────────────────────
        try:
            news = self.get_company_news(symbol, lookback_days=7)
            snap.news_count = len(news)
        except Exception as e:
            logger.warning("[Finnhub] News fetch failed: %s", e)

        # ── Composite Score ──────────────────────────────────────────────────
        # Weight: Insiders 40%, Analyst 30%, Social 20%, News volume 10%
        score = 0.0

        if snap.insider:
            score += snap.insider.net_sentiment * 0.40

        if snap.analyst:
            consensus_map = {
                "strong_buy": 1.0, "buy": 0.5, "hold": 0.0,
                "sell": -0.5, "strong_sell": -1.0,
            }
            score += consensus_map.get(snap.analyst.consensus, 0.0) * 0.30

        if snap.social:
            score += snap.social.composite_sentiment * 0.20

        # High news volume in bull market = slight positive
        if snap.news_count > 20:
            score += 0.10
        elif snap.news_count > 10:
            score += 0.05

        snap.composite_score = max(-1.0, min(1.0, score))
        snap.confidence_adjustment = snap.composite_score * 0.10  # +-10%

        self._cache_set(cache_key, snap, ttl=1800.0)
        return snap
