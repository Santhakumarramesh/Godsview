"""
GodsView v2 — Bar data validator.

Checks for:
  • Missing / NaN values
  • OHLC consistency (high >= max(open, close), low <= min(open, close))
  • Unrealistic price moves (> 20 % in a single bar)
  • Duplicate timestamps
  • Gaps larger than expected bar duration
  • Zero / negative prices or volumes
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from services.shared.logging import get_logger
from services.shared.types import Bar

log = get_logger(__name__)

# Max single-bar price move before flagging as anomalous
_MAX_MOVE_PCT = 0.20

# Minimum volume threshold (below this → likely bad data)
_MIN_VOLUME = 0.0


@dataclass
class ValidationReport:
    total_bars:      int = 0
    valid_bars:      int = 0
    removed_bars:    int = 0
    ohlc_errors:     int = 0
    price_anomalies: int = 0
    zero_volume:     int = 0
    duplicates:      int = 0
    gaps_detected:   int = 0
    issues:          list[str] = field(default_factory=list)

    @property
    def pass_rate(self) -> float:
        if self.total_bars == 0:
            return 0.0
        return self.valid_bars / self.total_bars

    @property
    def is_usable(self) -> bool:
        """Returns True when ≥ 80 % of bars are valid."""
        return self.pass_rate >= 0.80


def validate_bars(
    bars: list[Bar],
    *,
    allow_zero_volume: bool = False,
    gap_tolerance_factor: float = 3.0,
) -> tuple[list[Bar], ValidationReport]:
    """
    Validate and clean a list of bars.

    Returns (cleaned_bars, report).
    """
    report = ValidationReport(total_bars=len(bars))

    if not bars:
        return [], report

    cleaned: list[Bar] = []
    seen_timestamps: set[datetime] = set()

    for bar in bars:
        issues: list[str] = []

        # ── NaN / zero price check ────────────────────────────────────────────
        prices = [bar.open, bar.high, bar.low, bar.close]
        if any(math.isnan(p) or p <= 0 for p in prices):
            issues.append(f"invalid_price ts={bar.timestamp}")
            report.price_anomalies += 1
            continue

        # ── OHLC consistency ──────────────────────────────────────────────────
        if bar.high < max(bar.open, bar.close):
            issues.append(f"high_lt_body ts={bar.timestamp}")
            report.ohlc_errors += 1
            # Correct rather than discard
            bar = Bar(
                symbol=bar.symbol,
                timestamp=bar.timestamp,
                open=bar.open,
                high=max(bar.open, bar.close, bar.high),
                low=bar.low,
                close=bar.close,
                volume=bar.volume,
                timeframe=bar.timeframe,
            )
        if bar.low > min(bar.open, bar.close):
            issues.append(f"low_gt_body ts={bar.timestamp}")
            report.ohlc_errors += 1
            bar = Bar(
                symbol=bar.symbol,
                timestamp=bar.timestamp,
                open=bar.open,
                high=bar.high,
                low=min(bar.open, bar.close, bar.low),
                close=bar.close,
                volume=bar.volume,
                timeframe=bar.timeframe,
            )

        # ── Excessive single-bar move ─────────────────────────────────────────
        move_pct = abs(bar.close - bar.open) / bar.open
        if move_pct > _MAX_MOVE_PCT:
            issues.append(f"large_move {move_pct:.1%} ts={bar.timestamp}")
            report.price_anomalies += 1
            # Flag but keep — flash crashes are real

        # ── Volume ───────────────────────────────────────────────────────────
        if not allow_zero_volume and bar.volume <= _MIN_VOLUME:
            issues.append(f"zero_volume ts={bar.timestamp}")
            report.zero_volume += 1
            # Keep — some markets have valid zero-volume bars

        # ── Duplicate timestamp ───────────────────────────────────────────────
        if bar.timestamp in seen_timestamps:
            issues.append(f"duplicate ts={bar.timestamp}")
            report.duplicates += 1
            continue
        seen_timestamps.add(bar.timestamp)

        cleaned.append(bar)

    # ── Gap detection (informational) ─────────────────────────────────────────
    if len(cleaned) >= 2:
        _tf_minutes: dict[str, int] = {
            "1min": 1, "5min": 5, "15min": 15, "30min": 30,
            "1hour": 60, "2hour": 120, "4hour": 240,
            "8hour": 480, "12hour": 720, "1day": 1440,
        }
        tf = cleaned[0].timeframe.lower()
        expected_delta = timedelta(minutes=_tf_minutes.get(tf, 15))
        threshold = expected_delta * gap_tolerance_factor

        for i in range(1, len(cleaned)):
            actual_delta = cleaned[i].timestamp - cleaned[i - 1].timestamp
            if actual_delta > threshold:
                report.gaps_detected += 1

    report.valid_bars  = len(cleaned)
    report.removed_bars = report.total_bars - report.valid_bars

    if not report.is_usable:
        log.warning(
            "data_quality_low",
            pass_rate=f"{report.pass_rate:.1%}",
            removed=report.removed_bars,
            total=report.total_bars,
        )

    return cleaned, report


def quick_validate(bars: list[Bar]) -> bool:
    """Fast path: return True only if basic checks pass (no cleaning)."""
    if not bars:
        return False
    for bar in bars:
        if bar.high < bar.low or bar.open <= 0 or bar.close <= 0:
            return False
    return True
