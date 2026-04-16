"""
GodsView — Session Intelligence Engine

Analyzes market behavior by trading session (Asian, London, NY, Overlap)
to detect session-specific patterns, volatility profiles, and reversal zones.

Features:
  - Session classification from UTC timestamps
  - Per-session volatility profiling
  - Session open/close reversal detection
  - Cross-session momentum tracking
  - Historical session performance stats
"""
from __future__ import annotations

import time
import math
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

logger = logging.getLogger("godsview.session_intelligence")


# ── Session Definitions ──────────────────────────────────────────────────────

class Session(str, Enum):
    ASIAN = "asian"           # 00:00–07:00 UTC
    LONDON = "london"         # 07:00–12:00 UTC
    OVERLAP = "overlap"       # 12:00–14:00 UTC (London+NY)
    NEW_YORK = "new_york"     # 14:00–21:00 UTC
    OFF_HOURS = "off_hours"   # 21:00–00:00 UTC


SESSION_HOURS = {
    Session.ASIAN: (0, 7),
    Session.LONDON: (7, 12),
    Session.OVERLAP: (12, 14),
    Session.NEW_YORK: (14, 21),
    Session.OFF_HOURS: (21, 24),
}


def classify_session(hour_utc: int) -> Session:
    """Classify a UTC hour into a trading session."""
    for session, (start, end) in SESSION_HOURS.items():
        if start <= hour_utc < end:
            return session
    return Session.OFF_HOURS


# ── Data Models ──────────────────────────────────────────────────────────────

@dataclass
class SessionBar:
    """A single OHLCV bar with session context."""
    timestamp: float
    open: float
    high: float
    low: float
    close: float
    volume: float
    session: Session = Session.OFF_HOURS


@dataclass
class SessionProfile:
    """Volatility and behavior profile for a single session."""
    session: Session
    avg_range: float = 0.0          # avg high-low
    avg_range_pct: float = 0.0      # as pct of price
    avg_volume: float = 0.0
    directional_bias: float = 0.0   # −1 bearish → +1 bullish
    reversal_rate: float = 0.0      # how often session reverses prior move
    continuation_rate: float = 0.0
    open_drive_rate: float = 0.0    # opens near extremes
    sample_count: int = 0


@dataclass
class SessionTransition:
    """Behavior at session boundaries."""
    from_session: Session
    to_session: Session
    gap_pct: float = 0.0            # price gap at transition
    momentum_carry: float = 0.0     # momentum carried into new session
    reversal_probability: float = 0.0
    sample_count: int = 0


@dataclass
class SessionAnalysis:
    """Complete session intelligence output."""
    current_session: Session
    symbol: str
    timestamp: float

    # Current session state
    session_open_price: float = 0.0
    session_high: float = 0.0
    session_low: float = 0.0
    session_range: float = 0.0
    session_range_pct: float = 0.0
    session_volume: float = 0.0
    bars_in_session: int = 0

    # Session profile (historical averages)
    expected_range: float = 0.0
    range_exhaustion_pct: float = 0.0  # current_range / expected_range

    # Directional
    session_bias: str = "neutral"  # "bullish", "bearish", "neutral"
    momentum_score: float = 0.0

    # Reversal detection
    reversal_zone: bool = False
    reversal_reason: str = ""

    # Transition context
    prior_session: Optional[Session] = None
    prior_session_close: float = 0.0
    transition_gap_pct: float = 0.0

    # Profile reference
    session_profile: Optional[SessionProfile] = None


# ── Session Intelligence Engine ──────────────────────────────────────────────

class SessionIntelligenceEngine:
    """Tracks and analyzes session-level market behavior."""

    def __init__(self) -> None:
        # symbol → session → list of (range, range_pct, volume, direction, was_reversal)
        self._history: dict[str, dict[str, list[tuple[float, float, float, float, bool]]]] = {}
        # symbol → (session, open_price, high, low, volume, bar_count, first_ts)
        self._current_session: dict[str, dict] = {}
        # symbol → session → SessionProfile
        self._profiles: dict[str, dict[str, SessionProfile]] = {}
        # symbol → transition key → stats accumulator
        self._transitions: dict[str, dict[str, dict]] = {}

    def update(
        self,
        symbol: str,
        bar: SessionBar,
    ) -> SessionAnalysis:
        """Process a new bar and return session analysis."""
        session = bar.session if bar.session != Session.OFF_HOURS else classify_session(
            int((bar.timestamp % 86400) / 3600)
        )

        curr = self._current_session.get(symbol)

        # Session change detection
        if curr is None or curr.get("session") != session:
            # Close previous session
            if curr:
                self._close_session(symbol, curr, bar)
            # Open new session
            curr = {
                "session": session,
                "open_price": bar.open,
                "high": bar.high,
                "low": bar.low,
                "close": bar.close,
                "volume": bar.volume,
                "bar_count": 1,
                "first_ts": bar.timestamp,
            }
            self._current_session[symbol] = curr
        else:
            # Update current session
            curr["high"] = max(curr["high"], bar.high)
            curr["low"] = min(curr["low"], bar.low)
            curr["close"] = bar.close
            curr["volume"] = curr.get("volume", 0) + bar.volume
            curr["bar_count"] = curr.get("bar_count", 0) + 1

        # Build analysis
        return self._build_analysis(symbol, session, curr, bar)

    def _close_session(self, symbol: str, curr: dict, next_bar: SessionBar) -> None:
        """Record stats when a session closes."""
        session_key = curr["session"].value
        rng = curr["high"] - curr["low"]
        open_p = curr["open_price"]
        rng_pct = rng / open_p if open_p > 0 else 0.0
        direction = 1.0 if curr["close"] > open_p else (-1.0 if curr["close"] < open_p else 0.0)

        # Determine if this was a reversal of prior session
        hist = self._history.setdefault(symbol, {}).setdefault(session_key, [])
        was_reversal = False
        if hist:
            prev_dir = hist[-1][3]
            was_reversal = (prev_dir > 0 and direction < 0) or (prev_dir < 0 and direction > 0)

        hist.append((rng, rng_pct, curr.get("volume", 0), direction, was_reversal))
        if len(hist) > 200:
            hist[:] = hist[-200:]

        # Update profile
        self._update_profile(symbol, curr["session"], hist)

        # Track transition
        trans_key = f"{curr['session'].value}->{next_bar.session.value}"
        trans = self._transitions.setdefault(symbol, {}).setdefault(trans_key, {
            "gap_sum": 0.0, "momentum_sum": 0.0, "reversal_count": 0, "count": 0,
        })
        gap_pct = (next_bar.open - curr["close"]) / curr["close"] if curr["close"] > 0 else 0.0
        trans["gap_sum"] += gap_pct
        trans["momentum_sum"] += direction
        trans["count"] += 1

        logger.debug(
            "session_closed symbol=%s session=%s range=%.4f dir=%.0f",
            symbol, session_key, rng, direction,
        )

    def _update_profile(self, symbol: str, session: Session, hist: list) -> None:
        """Recompute session profile from history."""
        if not hist:
            return
        n = len(hist)
        avg_range = sum(h[0] for h in hist) / n
        avg_range_pct = sum(h[1] for h in hist) / n
        avg_vol = sum(h[2] for h in hist) / n
        bias = sum(h[3] for h in hist) / n
        reversal_count = sum(1 for h in hist if h[4])
        reversal_rate = reversal_count / n if n > 0 else 0.0

        profile = SessionProfile(
            session=session,
            avg_range=round(avg_range, 6),
            avg_range_pct=round(avg_range_pct, 6),
            avg_volume=round(avg_vol, 2),
            directional_bias=round(bias, 4),
            reversal_rate=round(reversal_rate, 4),
            continuation_rate=round(1.0 - reversal_rate, 4),
            sample_count=n,
        )
        self._profiles.setdefault(symbol, {})[session.value] = profile

    def _build_analysis(
        self, symbol: str, session: Session, curr: dict, bar: SessionBar
    ) -> SessionAnalysis:
        """Build a SessionAnalysis from current state."""
        rng = curr["high"] - curr["low"]
        open_p = curr["open_price"]
        rng_pct = rng / open_p if open_p > 0 else 0.0

        profile = self._profiles.get(symbol, {}).get(session.value)
        expected = profile.avg_range if profile else 0.0
        exhaustion_pct = rng / expected if expected > 0 else 0.0

        # Determine bias
        price_vs_open = bar.close - open_p
        if abs(price_vs_open) < rng * 0.1:
            bias = "neutral"
        elif price_vs_open > 0:
            bias = "bullish"
        else:
            bias = "bearish"

        # Momentum score (−1 to +1)
        if rng > 0:
            momentum = (bar.close - open_p) / rng
        else:
            momentum = 0.0

        # Reversal zone detection
        reversal_zone = False
        reversal_reason = ""
        if exhaustion_pct > 1.2:
            reversal_zone = True
            reversal_reason = f"Range exhaustion ({exhaustion_pct:.0%} of expected)"
        elif profile and profile.reversal_rate > 0.5 and curr.get("bar_count", 0) > 10:
            reversal_zone = True
            reversal_reason = f"High reversal session (rate: {profile.reversal_rate:.0%})"

        return SessionAnalysis(
            current_session=session,
            symbol=symbol,
            timestamp=bar.timestamp,
            session_open_price=round(open_p, 6),
            session_high=round(curr["high"], 6),
            session_low=round(curr["low"], 6),
            session_range=round(rng, 6),
            session_range_pct=round(rng_pct, 6),
            session_volume=round(curr.get("volume", 0), 2),
            bars_in_session=curr.get("bar_count", 0),
            expected_range=round(expected, 6),
            range_exhaustion_pct=round(exhaustion_pct, 4),
            session_bias=bias,
            momentum_score=round(momentum, 4),
            reversal_zone=reversal_zone,
            reversal_reason=reversal_reason,
            session_profile=profile,
        )

    def get_profile(self, symbol: str, session: str) -> Optional[SessionProfile]:
        """Get historical profile for a symbol/session."""
        return self._profiles.get(symbol, {}).get(session)

    def get_all_profiles(self, symbol: str) -> dict[str, SessionProfile]:
        """Get all session profiles for a symbol."""
        return self._profiles.get(symbol, {})

    def get_session_comparison(self, symbol: str) -> list[dict]:
        """Compare all sessions for a symbol, ranked by opportunity quality."""
        profiles = self._profiles.get(symbol, {})
        comparison: list[dict] = []
        for key, prof in profiles.items():
            score = (
                prof.avg_range_pct * 40
                + abs(prof.directional_bias) * 30
                + prof.continuation_rate * 20
                + min(10, prof.sample_count / 10)
            )
            comparison.append({
                "session": key,
                "avg_range_pct": prof.avg_range_pct,
                "directional_bias": prof.directional_bias,
                "reversal_rate": prof.reversal_rate,
                "avg_volume": prof.avg_volume,
                "sample_count": prof.sample_count,
                "opportunity_score": round(score, 2),
            })
        comparison.sort(key=lambda x: x["opportunity_score"], reverse=True)
        return comparison
