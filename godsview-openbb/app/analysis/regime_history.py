"""
GodsView — Regime History Tracker

Tracks regime changes over time per symbol/timeframe.
Provides multi-timeframe confluence analysis.
"""
from __future__ import annotations

import time
import logging
from dataclasses import dataclass, field

from .regime_detector import Regime, RegimeAnalysis

logger = logging.getLogger("godsview.regime_history")


@dataclass
class RegimeTransition:
    """A single regime change event."""
    timestamp: float
    symbol: str
    timeframe: str
    from_regime: Regime
    to_regime: Regime
    confidence: float
    duration_bars: int  # how long the previous regime lasted


@dataclass
class RegimeStats:
    """Aggregate statistics for a symbol's regime history."""
    total_transitions: int = 0
    avg_regime_duration: float = 0.0
    regime_frequency: dict[str, int] = field(default_factory=dict)
    current_regime: Regime = Regime.RANGE
    current_duration: int = 0


class RegimeTracker:
    """Tracks regime transitions and provides history/confluence analysis."""

    def __init__(self) -> None:
        # symbol -> timeframe -> list[RegimeTransition]
        self._history: dict[str, dict[str, list[RegimeTransition]]] = {}
        # symbol -> timeframe -> (regime, duration_bars)
        self._current: dict[str, dict[str, tuple[Regime, int]]] = {}

    def update(
        self,
        symbol: str,
        timeframe: str,
        analysis: RegimeAnalysis,
    ) -> RegimeTransition | None:
        """
        Update regime state for a symbol/timeframe.
        Returns a RegimeTransition if the regime changed, else None.
        """
        current_map = self._current.setdefault(symbol, {})
        prev = current_map.get(timeframe)

        new_regime = analysis.current_regime
        transition: RegimeTransition | None = None

        if prev is None:
            current_map[timeframe] = (new_regime, 1)
        elif prev[0] != new_regime:
            transition = RegimeTransition(
                timestamp=time.time(),
                symbol=symbol,
                timeframe=timeframe,
                from_regime=prev[0],
                to_regime=new_regime,
                confidence=analysis.confidence,
                duration_bars=prev[1],
            )
            hist = self._history.setdefault(symbol, {}).setdefault(timeframe, [])
            hist.append(transition)
            if len(hist) > 500:
                hist[:] = hist[-500:]
            current_map[timeframe] = (new_regime, 1)
            logger.info(
                "regime_transition symbol=%s tf=%s %s→%s conf=%.2f dur=%d",
                symbol, timeframe, prev[0].value, new_regime.value,
                analysis.confidence, prev[1],
            )
        else:
            current_map[timeframe] = (new_regime, prev[1] + 1)

        return transition

    def get_current(self, symbol: str, timeframe: str) -> tuple[Regime, int]:
        """Get current regime and duration for a symbol/timeframe."""
        return self._current.get(symbol, {}).get(timeframe, (Regime.RANGE, 0))

    def get_history(
        self, symbol: str, timeframe: str, limit: int = 50
    ) -> list[RegimeTransition]:
        """Get recent regime transitions."""
        return self._history.get(symbol, {}).get(timeframe, [])[-limit:]

    def get_stats(self, symbol: str, timeframe: str) -> RegimeStats:
        """Compute aggregate statistics."""
        transitions = self._history.get(symbol, {}).get(timeframe, [])
        current = self.get_current(symbol, timeframe)

        freq: dict[str, int] = {}
        total_duration = 0
        for t in transitions:
            freq[t.from_regime.value] = freq.get(t.from_regime.value, 0) + 1
            total_duration += t.duration_bars

        n = len(transitions)
        return RegimeStats(
            total_transitions=n,
            avg_regime_duration=total_duration / n if n > 0 else 0.0,
            regime_frequency=freq,
            current_regime=current[0],
            current_duration=current[1],
        )

    def get_confluence(self, symbol: str) -> dict[str, str]:
        """
        Multi-timeframe regime confluence.
        Returns {timeframe: regime_value} for all tracked timeframes.
        """
        tfs = self._current.get(symbol, {})
        return {tf: regime.value for tf, (regime, _) in tfs.items()}

    def get_confluence_score(self, symbol: str) -> float:
        """
        Confluence score: 1.0 if all timeframes agree, lower if mixed.
        """
        tfs = self._current.get(symbol, {})
        if not tfs:
            return 0.0
        regimes = [r.value for r, _ in tfs.values()]
        from collections import Counter
        counts = Counter(regimes)
        most_common = counts.most_common(1)[0][1]
        return most_common / len(regimes)
