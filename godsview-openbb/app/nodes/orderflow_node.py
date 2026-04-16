"""
GodsView — Order Flow Node (Production)

Fetches real orderbook data via OrderbookClient, analyzes it with
OrderFlowAnalyzer, and populates StockBrainState.order_flow with
genuine institutional-grade order flow metrics.

Falls back to heuristic scoring when real orderbook data is unavailable.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.state.schemas import StockBrainState
from app.state.store import BrainStore
from app.orderbook_client import OrderbookClient, OrderbookSnapshot
from app.analysis.orderflow_analyzer import OrderFlowAnalyzer

from .base_node import NodeBase

logger = logging.getLogger("godsview.nodes.orderflow")

# Module-level singletons (initialized on first use)
_client: OrderbookClient | None = None
_analyzer: OrderFlowAnalyzer | None = None


def _get_client() -> OrderbookClient:
    global _client
    if _client is None:
        try:
            from app.config import settings
            _client = OrderbookClient(
                node_api_url=getattr(settings, "node_api_url", "http://localhost:3000"),
                alpaca_key=getattr(settings, "alpaca_api_key", ""),
                alpaca_secret=getattr(settings, "alpaca_secret_key", ""),
                timeout=getattr(settings, "orderbook_timeout_seconds", 5.0),
                max_retries=getattr(settings, "orderbook_max_retries", 2),
            )
        except Exception:
            _client = OrderbookClient()
    return _client


def _get_analyzer() -> OrderFlowAnalyzer:
    global _analyzer
    if _analyzer is None:
        _analyzer = OrderFlowAnalyzer()
    return _analyzer


class OrderFlowNode(NodeBase):
    name = "orderflow_node"

    def run(self, brain: StockBrainState, payload: dict[str, Any], store: BrainStore) -> StockBrainState:
        """
        Try to fetch real orderbook data and analyze it.
        Falls back to heuristic analysis if the orderbook is unavailable.
        """
        symbol = brain.symbol if hasattr(brain, "symbol") else "UNKNOWN"
        data = payload.get("data", payload)
        market = data.get("market", {}) if isinstance(data, dict) else {}
        price = float(market.get("close", market.get("price", 0.0)))
        trend = float(market.get("trend_20", 0.0))

        # Attempt real orderbook fetch
        snapshot = self._fetch_orderbook(symbol)
        analyzer = _get_analyzer()

        if snapshot:
            analysis = analyzer.analyze(snapshot, price=price, trend=trend)
            self._apply_real_analysis(brain, analysis)
            logger.info(
                "orderflow_real symbol=%s source=%s delta=%.4f cvd=%.4f latency=%.1fms",
                symbol, analysis.data_source, analysis.delta,
                analysis.cvd, analysis.latency_ms,
            )
        else:
            # Fallback to heuristic from payload data
            self._apply_heuristic(brain, payload, trend)
            logger.debug("orderflow_heuristic symbol=%s", symbol)

        self.mark_live(brain)
        return brain

    def _fetch_orderbook(self, symbol: str) -> OrderbookSnapshot | None:
        """Fetch real orderbook, running async in sync context."""
        try:
            client = _get_client()
            # Try to get the running event loop
            try:
                loop = asyncio.get_running_loop()
                # If we're in an async context, create a task
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    future = pool.submit(asyncio.run, client.get_orderbook(symbol))
                    return future.result(timeout=10)
            except RuntimeError:
                # No running loop, safe to use asyncio.run
                return asyncio.run(client.get_orderbook(symbol))
        except Exception as e:
            logger.debug("orderbook_fetch_failed symbol=%s error=%s", symbol, e)
            return None

    @staticmethod
    def _apply_real_analysis(brain: StockBrainState, analysis) -> None:
        """Map OrderFlowAnalysis fields to brain state."""
        of = brain.order_flow
        of.delta_score = max(-1.0, min(1.0, analysis.delta_pct))
        of.cvd_slope = analysis.cvd_slope
        of.cvd_trend = analysis.cvd_trend
        of.absorption_score = analysis.absorption_score
        of.imbalance_score = max(-1.0, min(1.0, analysis.imbalance_score))
        of.buy_volume_ratio = 0.5 + (analysis.delta_pct * 0.5)
        of.delta_momentum = max(-1.0, min(1.0, analysis.delta_pct * 5))
        of.large_delta_bar = abs(analysis.delta_pct) > 0.15
        of.cvd_divergence = analysis.cvd_divergence

        # Extended fields (if schema supports them)
        if hasattr(of, "data_source"):
            of.data_source = analysis.data_source
        if hasattr(of, "spread"):
            of.spread = analysis.spread
        if hasattr(of, "mid_price"):
            of.mid_price = analysis.mid_price
        if hasattr(of, "bid_depth"):
            of.bid_depth = analysis.bid_depth
        if hasattr(of, "ask_depth"):
            of.ask_depth = analysis.ask_depth
        if hasattr(of, "liquidity_walls"):
            of.liquidity_walls = [
                {"price": w.price, "size": w.size, "side": w.side, "strength": w.strength}
                for w in analysis.liquidity_walls
            ]
        if hasattr(of, "volume_clusters"):
            of.volume_clusters = [
                {"price_low": c.price_low, "price_high": c.price_high,
                 "total_volume": c.total_volume, "level_count": c.level_count}
                for c in analysis.volume_clusters
            ]
        if hasattr(of, "exhaustion_detected"):
            of.exhaustion_detected = analysis.exhaustion_detected
        if hasattr(of, "latency_ms"):
            of.latency_ms = analysis.latency_ms

    @staticmethod
    def _apply_heuristic(brain: StockBrainState, payload: dict, trend: float) -> None:
        """Legacy heuristic fallback when orderbook data is unavailable."""
        data = payload.get("data", payload)
        hard_gates = data.get("hard_gates", {}) if isinstance(data, dict) else {}
        scoring = data.get("scoring", {}) if isinstance(data, dict) else {}
        components = scoring.get("components", {}) if isinstance(scoring, dict) else {}

        liquidity = float(hard_gates.get("liquidity_score", 0.0))
        pattern = float(components.get("setup_pattern_quality", 0.0))

        of = brain.order_flow
        of.delta_score = max(-1.0, min(1.0, (liquidity * 2.0) - 1.0))
        of.cvd_slope = trend
        of.cvd_trend = "up" if trend > 0 else "down" if trend < 0 else "flat"
        of.absorption_score = max(0.0, min(1.0, pattern))
        of.imbalance_score = max(0.0, min(1.0, float(hard_gates.get("pass_ratio", 0.0))))
        of.buy_volume_ratio = 0.5 + max(-0.5, min(0.5, trend * 5))
        of.delta_momentum = max(-1.0, min(1.0, trend * 10))
        of.large_delta_bar = abs(of.delta_momentum) > 0.6
        of.cvd_divergence = bool(of.delta_momentum * trend < 0)

        if hasattr(of, "data_source"):
            of.data_source = "heuristic_fallback"
