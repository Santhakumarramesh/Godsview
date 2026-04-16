"""
GodsView — Real Orderbook Client

Fetches live orderbook snapshots from:
  1. Node API (primary) — /api/orderbook/:symbol
  2. Alpaca REST (fallback) — /v1beta3/crypto/us/latest/orderbooks
"""
from __future__ import annotations
import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger("godsview.orderbook_client")

@dataclass
class OrderbookLevel:
    price: float
    size: float

@dataclass
class OrderbookSnapshot:
    symbol: str
    timestamp: float
    bids: list[OrderbookLevel]
    asks: list[OrderbookLevel]
    source: str = "unknown"
    latency_ms: float = 0.0

    @property
    def mid_price(self) -> float:
        if self.bids and self.asks:
            return (self.bids[0].price + self.asks[0].price) / 2
        return 0.0

    @property
    def spread(self) -> float:
        if self.bids and self.asks:
            return self.asks[0].price - self.bids[0].price
        return 0.0

    @property
    def bid_depth(self) -> float:
        return sum(l.size for l in self.bids)

    @property
    def ask_depth(self) -> float:
        return sum(l.size for l in self.asks)

    @property
    def imbalance(self) -> float:
        total = self.bid_depth + self.ask_depth
        if total == 0:
            return 0.0
        return (self.bid_depth - self.ask_depth) / total


class OrderbookClient:
    def __init__(self, node_api_url: str = "http://localhost:3000",
                 alpaca_key: str = "", alpaca_secret: str = "",
                 timeout: float = 5.0, max_retries: int = 2):
        self._node_url = node_api_url.rstrip("/")
        self._alpaca_key = alpaca_key
        self._alpaca_secret = alpaca_secret
        self._timeout = timeout
        self._max_retries = max_retries
        self._cache: dict[str, OrderbookSnapshot] = {}
        self._cache_ttl = 2.0  # seconds

    async def get_orderbook(self, symbol: str) -> Optional[OrderbookSnapshot]:
        # Check cache
        cached = self._cache.get(symbol)
        if cached and (time.time() - cached.timestamp) < self._cache_ttl:
            return cached

        # Try Node API first
        snap = await self._fetch_from_node(symbol)
        if snap:
            self._cache[symbol] = snap
            return snap

        # Fallback to Alpaca
        snap = await self._fetch_from_alpaca(symbol)
        if snap:
            self._cache[symbol] = snap
            return snap

        logger.warning(f"orderbook_unavailable symbol={symbol}")
        return None

    async def _fetch_from_node(self, symbol: str) -> Optional[OrderbookSnapshot]:
        try:
            import httpx
            start = time.monotonic()
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(f"{self._node_url}/api/orderbook/{symbol}")
                if resp.status_code != 200:
                    return None
                data = resp.json()
                latency = (time.monotonic() - start) * 1000

                bids = [OrderbookLevel(price=float(b.get("price", b.get("p", 0))),
                                       size=float(b.get("size", b.get("s", 0))))
                        for b in data.get("bids", [])]
                asks = [OrderbookLevel(price=float(a.get("price", a.get("p", 0))),
                                       size=float(a.get("size", a.get("s", 0))))
                        for a in data.get("asks", [])]

                return OrderbookSnapshot(
                    symbol=symbol, timestamp=time.time(),
                    bids=bids, asks=asks,
                    source="node_api", latency_ms=latency,
                )
        except Exception as e:
            logger.debug(f"node_api_fetch_failed symbol={symbol} error={e}")
            return None

    async def _fetch_from_alpaca(self, symbol: str) -> Optional[OrderbookSnapshot]:
        if not self._alpaca_key:
            return None
        try:
            import httpx
            start = time.monotonic()
            alpaca_symbol = symbol.replace("/", "").replace("-", "")
            url = f"https://data.alpaca.markets/v1beta3/crypto/us/latest/orderbooks?symbols={alpaca_symbol}"
            headers = {
                "APCA-API-KEY-ID": self._alpaca_key,
                "APCA-API-SECRET-KEY": self._alpaca_secret,
            }
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(url, headers=headers)
                if resp.status_code != 200:
                    return None
                data = resp.json()
                book = data.get("orderbooks", {}).get(alpaca_symbol, {})
                latency = (time.monotonic() - start) * 1000

                bids = [OrderbookLevel(price=float(b["p"]), size=float(b["s"]))
                        for b in book.get("b", [])]
                asks = [OrderbookLevel(price=float(a["p"]), size=float(a["s"]))
                        for a in book.get("a", [])]

                return OrderbookSnapshot(
                    symbol=symbol, timestamp=time.time(),
                    bids=bids, asks=asks,
                    source="alpaca_rest", latency_ms=latency,
                )
        except Exception as e:
            logger.debug(f"alpaca_fetch_failed symbol={symbol} error={e}")
            return None
