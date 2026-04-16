"""
GodsView — Order Flow Analyzer

Computes real order-flow metrics from live orderbook snapshots:
  - Delta (bid vs ask volume differential)
  - CVD (Cumulative Volume Delta)
  - Absorption detection
  - Imbalance at price levels
  - Liquidity wall detection
  - Exhaustion detection
  - Volume cluster analysis
  - CVD divergence detection
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("godsview.orderflow_analyzer")


# ── Data Models ───────────────────────────────────────────────────────────────


@dataclass
class LiquidityWall:
    """A price level with unusually large resting liquidity."""
    price: float
    size: float
    side: str  # "bid" or "ask"
    strength: float  # multiple of average level size


@dataclass
class VolumeCluster:
    """A price zone where significant volume is concentrated."""
    price_low: float
    price_high: float
    total_volume: float
    level_count: int


@dataclass
class OrderFlowAnalysis:
    """Complete order-flow analysis output."""
    symbol: str
    timestamp: float
    data_source: str  # "live_orderbook" | "synthetic_fallback"

    # ── Core metrics ──────────────────────────────────────────────────────
    delta: float = 0.0
    delta_pct: float = 0.0
    cvd: float = 0.0
    cvd_slope: float = 0.0
    cvd_trend: str = "flat"  # "up" | "down" | "flat"

    # ── Detection flags ───────────────────────────────────────────────────
    absorption_detected: bool = False
    absorption_side: str = "none"
    absorption_score: float = 0.0

    imbalance_score: float = 0.0  # −1 ask-heavy → +1 bid-heavy
    imbalance_levels: int = 0

    exhaustion_detected: bool = False
    exhaustion_bars: int = 0

    cvd_divergence: bool = False

    # ── Liquidity structure ───────────────────────────────────────────────
    liquidity_walls: list[LiquidityWall] = field(default_factory=list)
    volume_clusters: list[VolumeCluster] = field(default_factory=list)

    # ── Book metrics ──────────────────────────────────────────────────────
    book_imbalance: float = 0.0
    spread: float = 0.0
    mid_price: float = 0.0
    bid_depth: float = 0.0
    ask_depth: float = 0.0

    latency_ms: float = 0.0


# ── Analyzer ──────────────────────────────────────────────────────────────────


class OrderFlowAnalyzer:
    """Analyzes real orderbook snapshots to produce institutional-grade flow metrics."""

    def __init__(self) -> None:
        self._cvd_history: dict[str, list[tuple[float, float]]] = {}
        self._delta_history: dict[str, list[float]] = {}
        self._price_history: dict[str, list[float]] = {}

    # ── Public API ────────────────────────────────────────────────────────

    def analyze(
        self,
        snapshot,  # OrderbookSnapshot (avoid circular import)
        price: float = 0.0,
        trend: float = 0.0,
    ) -> OrderFlowAnalysis:
        """Full analysis of a single orderbook snapshot."""
        if snapshot is None:
            return self._synthetic_fallback(price, trend)

        t0 = time.monotonic()
        symbol = snapshot.symbol

        bid_vol = snapshot.bid_depth
        ask_vol = snapshot.ask_depth
        total_vol = bid_vol + ask_vol
        delta = bid_vol - ask_vol
        delta_pct = delta / total_vol if total_vol > 0 else 0.0

        # CVD tracking
        cvd_list = self._cvd_history.setdefault(symbol, [])
        prev_cvd = cvd_list[-1][1] if cvd_list else 0.0
        new_cvd = prev_cvd + delta
        cvd_list.append((time.time(), new_cvd))
        if len(cvd_list) > 500:
            cvd_list[:] = cvd_list[-500:]

        cvd_slope, cvd_trend = self._cvd_trend(cvd_list)

        # Delta history
        delta_hist = self._delta_history.setdefault(symbol, [])
        delta_hist.append(delta)
        if len(delta_hist) > 50:
            delta_hist[:] = delta_hist[-50:]

        # Price history
        price_hist = self._price_history.setdefault(symbol, [])
        if price > 0:
            price_hist.append(price)
            if len(price_hist) > 50:
                price_hist[:] = price_hist[-50:]

        imbalance_score, imbalance_levels = self._compute_imbalance(snapshot)
        abs_det, abs_side, abs_score = self._detect_absorption(snapshot, delta_hist)
        walls = self._find_liquidity_walls(snapshot)
        exh_det, exh_bars = self._detect_exhaustion(delta_hist)
        cvd_div = self._detect_cvd_divergence(price_hist, cvd_list)
        clusters = self._find_volume_clusters(snapshot)

        latency = (time.monotonic() - t0) * 1000

        return OrderFlowAnalysis(
            symbol=symbol,
            timestamp=time.time(),
            data_source="live_orderbook",
            delta=round(delta, 6),
            delta_pct=round(delta_pct, 4),
            cvd=round(new_cvd, 6),
            cvd_slope=round(cvd_slope, 6),
            cvd_trend=cvd_trend,
            absorption_detected=abs_det,
            absorption_side=abs_side,
            absorption_score=round(abs_score, 4),
            imbalance_score=round(imbalance_score, 4),
            imbalance_levels=imbalance_levels,
            exhaustion_detected=exh_det,
            exhaustion_bars=exh_bars,
            cvd_divergence=cvd_div,
            liquidity_walls=walls,
            volume_clusters=clusters,
            book_imbalance=round(snapshot.imbalance, 4),
            spread=round(snapshot.spread, 8),
            mid_price=round(snapshot.mid_price, 8),
            bid_depth=round(bid_vol, 6),
            ask_depth=round(ask_vol, 6),
            latency_ms=round(latency + snapshot.latency_ms, 2),
        )

    # ── Internal helpers ──────────────────────────────────────────────────

    @staticmethod
    def _cvd_trend(cvd_list: list[tuple[float, float]]) -> tuple[float, str]:
        if len(cvd_list) < 3:
            return 0.0, "flat"
        recent = [c[1] for c in cvd_list[-10:]]
        slope = (recent[-1] - recent[0]) / len(recent)
        if slope > 0.01:
            return slope, "up"
        if slope < -0.01:
            return slope, "down"
        return slope, "flat"

    @staticmethod
    def _compute_imbalance(snapshot) -> tuple[float, int]:
        n = min(len(snapshot.bids), len(snapshot.asks))
        if n == 0:
            return 0.0, 0
        imbalanced = 0
        for i in range(n):
            b = snapshot.bids[i].size
            a = snapshot.asks[i].size
            if b > 0 and a > 0 and max(b, a) / min(b, a) > 2.0:
                imbalanced += 1
        return snapshot.imbalance, imbalanced

    @staticmethod
    def _detect_absorption(snapshot, delta_hist: list[float]) -> tuple[bool, str, float]:
        if len(delta_hist) < 3 or not snapshot.bids or not snapshot.asks:
            return False, "none", 0.0
        top_bid = snapshot.bids[0].size
        top_ask = snapshot.asks[0].size
        avg_size = (top_bid + top_ask) / 2
        recent = delta_hist[-5:]
        avg_abs = sum(abs(d) for d in recent) / len(recent) if recent else 1.0
        if avg_size > 0 and avg_abs < avg_size * 0.3:
            if top_bid > top_ask * 1.5:
                return True, "bid", min(1.0, avg_size / (avg_abs + 1e-8) / 10)
            if top_ask > top_bid * 1.5:
                return True, "ask", min(1.0, avg_size / (avg_abs + 1e-8) / 10)
        return False, "none", 0.0

    @staticmethod
    def _find_liquidity_walls(snapshot) -> list[LiquidityWall]:
        walls: list[LiquidityWall] = []
        for side, levels in [("bid", snapshot.bids), ("ask", snapshot.asks)]:
            if not levels:
                continue
            sizes = [lv.size for lv in levels]
            avg = sum(sizes) / len(sizes) if sizes else 1.0
            for lv in levels:
                if lv.size > avg * 3:
                    walls.append(LiquidityWall(
                        price=lv.price, size=lv.size,
                        side=side, strength=round(lv.size / avg, 2),
                    ))
        walls.sort(key=lambda w: w.strength, reverse=True)
        return walls[:10]

    @staticmethod
    def _detect_exhaustion(delta_hist: list[float]) -> tuple[bool, int]:
        if len(delta_hist) < 5:
            return False, 0
        recent = delta_hist[-5:]
        same_dir = all(d > 0 for d in recent) or all(d < 0 for d in recent)
        if not same_dir:
            return False, 0
        abs_vals = [abs(d) for d in recent]
        dec_count = sum(1 for i in range(1, len(abs_vals)) if abs_vals[i] < abs_vals[i - 1])
        return (dec_count >= 3), dec_count

    @staticmethod
    def _detect_cvd_divergence(
        price_hist: list[float], cvd_list: list[tuple[float, float]]
    ) -> bool:
        if len(price_hist) < 5 or len(cvd_list) < 5:
            return False
        price_dir = price_hist[-1] - price_hist[-5]
        cvd_dir = cvd_list[-1][1] - cvd_list[-5][1]
        return (price_dir > 0 and cvd_dir < 0) or (price_dir < 0 and cvd_dir > 0)

    @staticmethod
    def _find_volume_clusters(snapshot) -> list[VolumeCluster]:
        all_lvls = [(lv.price, lv.size) for lv in snapshot.bids + snapshot.asks]
        if len(all_lvls) < 4:
            return []
        all_lvls.sort(key=lambda x: x[0])
        spread = all_lvls[-1][0] - all_lvls[0][0]
        if spread <= 0:
            return []
        bkt = spread / 5
        clusters: list[VolumeCluster] = []
        for i in range(5):
            lo = all_lvls[0][0] + i * bkt
            hi = lo + bkt
            vol = sum(s for p, s in all_lvls if lo <= p < hi)
            cnt = sum(1 for p, s in all_lvls if lo <= p < hi)
            if vol > 0:
                clusters.append(VolumeCluster(lo, hi, round(vol, 6), cnt))
        clusters.sort(key=lambda c: c.total_volume, reverse=True)
        return clusters[:5]

    def _synthetic_fallback(self, price: float, trend: float) -> OrderFlowAnalysis:
        """When no real data is available, produce degraded heuristic output."""
        return OrderFlowAnalysis(
            symbol="unknown",
            timestamp=time.time(),
            data_source="synthetic_fallback",
            delta=trend * 100,
            delta_pct=max(-1.0, min(1.0, trend * 5)),
            cvd_trend="up" if trend > 0 else ("down" if trend < 0 else "flat"),
            imbalance_score=max(-1.0, min(1.0, trend * 3)),
        )
