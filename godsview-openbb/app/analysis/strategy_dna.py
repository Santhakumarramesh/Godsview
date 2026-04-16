"""
GodsView — Strategy DNA System

Each strategy carries a DNA profile that tracks where it works best
and where it fails, enabling adaptive strategy selection.

Profiles strategies across dimensions:
  - Market regime (trend_up, trend_down, range, etc.)
  - Trading session (asian, london, ny, overlap)
  - Day of week
  - Volatility bucket (low, medium, high, extreme)
  - Instrument type
"""
from __future__ import annotations

import time
import math
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

logger = logging.getLogger("godsview.strategy_dna")


# ── Enums ────────────────────────────────────────────────────────────────────

class VolatilityBucket(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    EXTREME = "extreme"


class TradingSession(str, Enum):
    ASIAN = "asian"
    LONDON = "london"
    NEW_YORK = "new_york"
    LONDON_NY_OVERLAP = "london_ny_overlap"
    OFF_HOURS = "off_hours"


# ── Data Models ──────────────────────────────────────────────────────────────

@dataclass
class DimensionStats:
    """Performance stats within a single dimension value."""
    trades: int = 0
    wins: int = 0
    losses: int = 0
    total_pnl: float = 0.0
    total_rr: float = 0.0
    max_win: float = 0.0
    max_loss: float = 0.0
    sum_sq_pnl: float = 0.0  # for Sharpe-like calc

    @property
    def win_rate(self) -> float:
        return self.wins / self.trades if self.trades > 0 else 0.0

    @property
    def avg_pnl(self) -> float:
        return self.total_pnl / self.trades if self.trades > 0 else 0.0

    @property
    def avg_rr(self) -> float:
        return self.total_rr / self.trades if self.trades > 0 else 0.0

    @property
    def profit_factor(self) -> float:
        gross_win = self.total_pnl if self.total_pnl > 0 else 0.0
        gross_loss = abs(self.total_pnl) if self.total_pnl < 0 else 0.0
        # Approximation: use win/loss ratio * avg amounts
        if self.losses == 0:
            return float("inf") if self.wins > 0 else 0.0
        if self.wins == 0:
            return 0.0
        avg_win = self.max_win * 0.6 if self.max_win > 0 else 0.0
        avg_loss = abs(self.max_loss) * 0.6 if self.max_loss < 0 else 1.0
        return (self.wins * avg_win) / (self.losses * avg_loss) if avg_loss > 0 else 0.0

    @property
    def expectancy(self) -> float:
        if self.trades == 0:
            return 0.0
        return self.total_pnl / self.trades

    @property
    def sharpe_approx(self) -> float:
        if self.trades < 2:
            return 0.0
        mean = self.total_pnl / self.trades
        variance = (self.sum_sq_pnl / self.trades) - mean ** 2
        std = math.sqrt(max(0, variance))
        return mean / std if std > 0 else 0.0

    @property
    def score(self) -> float:
        """Composite fitness score (0-100) for this dimension."""
        if self.trades < 5:
            return 0.0
        wr_score = self.win_rate * 40
        exp_score = min(30, max(0, self.expectancy * 100))
        volume_score = min(20, self.trades / 5)
        consistency = min(10, self.sharpe_approx * 5)
        return round(wr_score + exp_score + volume_score + consistency, 2)


@dataclass
class StrategyDNA:
    """Complete DNA profile for one strategy."""
    strategy_id: str
    strategy_name: str
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    # Dimension → value → stats
    regime_stats: dict[str, DimensionStats] = field(default_factory=dict)
    session_stats: dict[str, DimensionStats] = field(default_factory=dict)
    day_stats: dict[str, DimensionStats] = field(default_factory=dict)
    volatility_stats: dict[str, DimensionStats] = field(default_factory=dict)
    instrument_stats: dict[str, DimensionStats] = field(default_factory=dict)

    # Aggregate
    total_trades: int = 0
    total_pnl: float = 0.0

    @property
    def overall_win_rate(self) -> float:
        wins = sum(s.wins for s in self.regime_stats.values())
        return wins / self.total_trades if self.total_trades > 0 else 0.0

    def best_conditions(self, top_n: int = 3) -> list[dict]:
        """Return top N conditions where this strategy performs best."""
        all_scores: list[dict] = []
        for dim_name, dim_dict in [
            ("regime", self.regime_stats),
            ("session", self.session_stats),
            ("day", self.day_stats),
            ("volatility", self.volatility_stats),
            ("instrument", self.instrument_stats),
        ]:
            for val, stats in dim_dict.items():
                if stats.trades >= 5:
                    all_scores.append({
                        "dimension": dim_name,
                        "value": val,
                        "score": stats.score,
                        "win_rate": round(stats.win_rate, 4),
                        "trades": stats.trades,
                        "expectancy": round(stats.expectancy, 4),
                    })
        all_scores.sort(key=lambda x: x["score"], reverse=True)
        return all_scores[:top_n]

    def worst_conditions(self, top_n: int = 3) -> list[dict]:
        """Return top N conditions where this strategy fails."""
        all_scores: list[dict] = []
        for dim_name, dim_dict in [
            ("regime", self.regime_stats),
            ("session", self.session_stats),
            ("day", self.day_stats),
            ("volatility", self.volatility_stats),
            ("instrument", self.instrument_stats),
        ]:
            for val, stats in dim_dict.items():
                if stats.trades >= 5:
                    all_scores.append({
                        "dimension": dim_name,
                        "value": val,
                        "score": stats.score,
                        "win_rate": round(stats.win_rate, 4),
                        "trades": stats.trades,
                        "expectancy": round(stats.expectancy, 4),
                    })
        all_scores.sort(key=lambda x: x["score"])
        return all_scores[:top_n]


# ── Strategy DNA Engine ──────────────────────────────────────────────────────

class StrategyDNAEngine:
    """Manages DNA profiles for all strategies."""

    def __init__(self) -> None:
        self._profiles: dict[str, StrategyDNA] = {}

    def get_or_create(self, strategy_id: str, strategy_name: str = "") -> StrategyDNA:
        if strategy_id not in self._profiles:
            self._profiles[strategy_id] = StrategyDNA(
                strategy_id=strategy_id,
                strategy_name=strategy_name or strategy_id,
            )
        return self._profiles[strategy_id]

    def record_trade(
        self,
        strategy_id: str,
        pnl: float,
        rr: float = 0.0,
        regime: str = "unknown",
        session: str = "unknown",
        day_of_week: str = "unknown",
        volatility: str = "medium",
        instrument: str = "unknown",
        strategy_name: str = "",
    ) -> None:
        """Record a completed trade and update all dimension stats."""
        dna = self.get_or_create(strategy_id, strategy_name)
        dna.total_trades += 1
        dna.total_pnl += pnl
        dna.updated_at = time.time()

        is_win = pnl > 0

        # Update each dimension
        for dim_dict, dim_val in [
            (dna.regime_stats, regime),
            (dna.session_stats, session),
            (dna.day_stats, day_of_week),
            (dna.volatility_stats, volatility),
            (dna.instrument_stats, instrument),
        ]:
            if dim_val not in dim_dict:
                dim_dict[dim_val] = DimensionStats()
            stats = dim_dict[dim_val]
            stats.trades += 1
            stats.total_pnl += pnl
            stats.total_rr += rr
            stats.sum_sq_pnl += pnl ** 2
            if is_win:
                stats.wins += 1
                stats.max_win = max(stats.max_win, pnl)
            else:
                stats.losses += 1
                stats.max_loss = min(stats.max_loss, pnl)

        logger.info(
            "dna_trade_recorded strategy=%s pnl=%.4f regime=%s session=%s vol=%s",
            strategy_id, pnl, regime, session, volatility,
        )

    def get_fitness(
        self,
        strategy_id: str,
        regime: str = "unknown",
        session: str = "unknown",
        day_of_week: str = "unknown",
        volatility: str = "medium",
    ) -> dict:
        """
        Get fitness score for a strategy under current conditions.
        Returns composite score and per-dimension breakdown.
        """
        dna = self._profiles.get(strategy_id)
        if not dna:
            return {"composite_score": 0.0, "confidence": 0.0, "dimensions": {}}

        dims: dict[str, float] = {}
        weights = {
            "regime": 0.30,
            "session": 0.20,
            "day": 0.15,
            "volatility": 0.25,
            "instrument": 0.10,
        }

        for dim_name, dim_val, dim_dict in [
            ("regime", regime, dna.regime_stats),
            ("session", session, dna.session_stats),
            ("day", day_of_week, dna.day_stats),
            ("volatility", volatility, dna.volatility_stats),
        ]:
            stats = dim_dict.get(dim_val)
            dims[dim_name] = stats.score if stats else 0.0

        composite = sum(dims.get(k, 0) * w for k, w in weights.items())
        total_evidence = sum(
            dim_dict.get(val, DimensionStats()).trades
            for val, dim_dict in [
                (regime, dna.regime_stats),
                (session, dna.session_stats),
                (day_of_week, dna.day_stats),
                (volatility, dna.volatility_stats),
            ]
        )
        confidence = min(1.0, total_evidence / 40)

        return {
            "composite_score": round(composite, 2),
            "confidence": round(confidence, 4),
            "dimensions": {k: round(v, 2) for k, v in dims.items()},
            "best_conditions": dna.best_conditions(3),
            "worst_conditions": dna.worst_conditions(3),
        }

    def rank_strategies(
        self,
        regime: str = "unknown",
        session: str = "unknown",
        day_of_week: str = "unknown",
        volatility: str = "medium",
    ) -> list[dict]:
        """Rank all strategies by fitness for current conditions."""
        rankings: list[dict] = []
        for sid, dna in self._profiles.items():
            fitness = self.get_fitness(sid, regime, session, day_of_week, volatility)
            rankings.append({
                "strategy_id": sid,
                "strategy_name": dna.strategy_name,
                "composite_score": fitness["composite_score"],
                "confidence": fitness["confidence"],
                "total_trades": dna.total_trades,
                "overall_win_rate": round(dna.overall_win_rate, 4),
            })
        rankings.sort(key=lambda x: x["composite_score"], reverse=True)
        return rankings

    def get_all_profiles(self) -> dict[str, dict]:
        """Export all DNA profiles as dicts."""
        result = {}
        for sid, dna in self._profiles.items():
            result[sid] = {
                "strategy_id": dna.strategy_id,
                "strategy_name": dna.strategy_name,
                "total_trades": dna.total_trades,
                "total_pnl": round(dna.total_pnl, 4),
                "overall_win_rate": round(dna.overall_win_rate, 4),
                "best_conditions": dna.best_conditions(3),
                "worst_conditions": dna.worst_conditions(3),
                "created_at": dna.created_at,
                "updated_at": dna.updated_at,
            }
        return result


def classify_volatility(atr: float, avg_atr: float) -> str:
    """Classify current volatility into a bucket."""
    if avg_atr <= 0:
        return "medium"
    ratio = atr / avg_atr
    if ratio < 0.6:
        return "low"
    elif ratio < 1.2:
        return "medium"
    elif ratio < 2.0:
        return "high"
    else:
        return "extreme"


def classify_session(hour_utc: int) -> str:
    """Classify UTC hour into a trading session."""
    if 0 <= hour_utc < 7:
        return "asian"
    elif 7 <= hour_utc < 12:
        return "london"
    elif 12 <= hour_utc < 14:
        return "london_ny_overlap"
    elif 14 <= hour_utc < 21:
        return "new_york"
    else:
        return "off_hours"
