"""
GodsView v2 — Candle-by-Candle Replay Engine.

Replays market history through the full analysis pipeline:
  1. Build features bar-by-bar
  2. Detect signals
  3. Record what GodsView "saw" and "decided"
  4. Compare against what actually happened next

Enables "what-if" analysis and strategy validation.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Sequence, Optional, Any

from services.shared.types import Bar, Signal
from services.feature_service.signal_detector import detect_signal
from services.shared.logging import get_logger

log = get_logger(__name__)


@dataclass
class ReplayFrame:
    """Record of what GodsView saw and decided at each bar."""
    bar_index: int
    timestamp: datetime
    symbol: str
    timeframe: str
    ohlcv: dict[str, float]  # {open, high, low, close, volume}

    # What GodsView "saw"
    signal: Optional[dict[str, Any]] = None
    signal_type: Optional[str] = None
    direction: Optional[str] = None
    entry_price: Optional[float] = None
    stop_price: Optional[float] = None
    target_price: Optional[float] = None
    confidence: Optional[float] = None

    # What GodsView "decided"
    decision: str = "HOLD"  # HOLD | LONG | SHORT
    decision_reason: str = ""

    # What actually happened next
    next_bar_ohlcv: Optional[dict[str, float]] = None
    actual_outcome: str = "neutral"  # win | loss | neutral


@dataclass
class ReplayTrace:
    """Complete replay trace for a symbol over a date range."""
    symbol: str
    timeframe: str
    start_date: datetime
    end_date: datetime
    total_bars: int
    frames: list[ReplayFrame] = field(default_factory=list)
    total_signals: int = 0
    win_rate: float = 0.0
    avg_confidence: float = 0.0
    max_consecutive_signals: int = 0


def replay_bars(
    bars: Sequence[Bar],
    timeframe: str,
    symbol: str,
    lookback: int = 55,
) -> ReplayTrace:
    """
    Replay all bars through the signal detector and record decisions.

    Args:
        bars: OHLCV bars (oldest → newest)
        timeframe: Timeframe string (e.g., "15min")
        symbol: Symbol/ticker
        lookback: Minimum bars before starting signal detection

    Returns:
        ReplayTrace with detailed frame-by-frame analysis
    """
    if not bars or len(bars) < lookback:
        log.warning(
            "replay_insufficient_bars",
            symbol=symbol,
            bars=len(bars),
            lookback=lookback,
        )
        return ReplayTrace(
            symbol=symbol,
            timeframe=timeframe,
            start_date=bars[0].timestamp if bars else datetime.now(),
            end_date=bars[-1].timestamp if bars else datetime.now(),
            total_bars=len(bars),
            frames=[],
        )

    frames: list[ReplayFrame] = []
    signals_list = []
    consecutive_signals = 0

    for i in range(lookback, len(bars)):
        bar = bars[i]
        next_bar = bars[i + 1] if i + 1 < len(bars) else None

        # Build rolling window
        window = bars[max(0, i - lookback) : i + 1]

        # Detect signal
        signal = detect_signal(window, timeframe)

        frame_dict = {
            "bar_index": i,
            "timestamp": bar.timestamp,
            "symbol": symbol,
            "timeframe": timeframe,
            "ohlcv": {
                "open": bar.open,
                "high": bar.high,
                "low": bar.low,
                "close": bar.close,
                "volume": bar.volume,
            },
        }

        if signal:
            consecutive_signals += 1
            signals_list.append(signal)
            frame_dict["signal"] = signal.id
            frame_dict["signal_type"] = signal.signal_type.value
            frame_dict["direction"] = signal.direction.value
            frame_dict["entry_price"] = signal.entry
            frame_dict["stop_price"] = signal.stop
            frame_dict["target_price"] = signal.target
            frame_dict["confidence"] = signal.confidence
            frame_dict["decision"] = signal.direction.value
            frame_dict["decision_reason"] = f"Signal: {signal.signal_type.value}"
        else:
            consecutive_signals = 0
            frame_dict["decision"] = "HOLD"
            frame_dict["decision_reason"] = "No signal"

        # Record what actually happened next
        if next_bar:
            frame_dict["next_bar_ohlcv"] = {
                "open": next_bar.open,
                "high": next_bar.high,
                "low": next_bar.low,
                "close": next_bar.close,
                "volume": next_bar.volume,
            }

            # Simple next-bar outcome: was it profitable?
            if signal:
                if signal.direction.value == "LONG":
                    move = next_bar.close - bar.close
                    frame_dict["actual_outcome"] = "win" if move > 0 else "loss" if move < 0 else "neutral"
                else:  # SHORT
                    move = bar.close - next_bar.close
                    frame_dict["actual_outcome"] = "win" if move > 0 else "loss" if move < 0 else "neutral"

        frames.append(ReplayFrame(**frame_dict))

    # Compute statistics
    total_signals = len(signals_list)
    wins = [f for f in frames if f.actual_outcome == "win"]
    win_rate = len(wins) / total_signals if total_signals else 0.0
    avg_confidence = (
        sum(f.confidence for f in frames if f.confidence) / total_signals
        if total_signals
        else 0.0
    )

    log.info(
        "replay_complete",
        symbol=symbol,
        timeframe=timeframe,
        total_bars=len(bars),
        signals=total_signals,
        win_rate=f"{win_rate:.1%}",
    )

    return ReplayTrace(
        symbol=symbol,
        timeframe=timeframe,
        start_date=bars[0].timestamp,
        end_date=bars[-1].timestamp,
        total_bars=len(bars),
        frames=frames,
        total_signals=total_signals,
        win_rate=round(win_rate, 4),
        avg_confidence=round(avg_confidence, 4),
        max_consecutive_signals=max([consecutive_signals] + [0]),
    )


def replay_with_params(
    bars: Sequence[Bar],
    timeframe: str,
    symbol: str,
    param_overrides: dict[str, Any],
    lookback: int = 55,
) -> ReplayTrace:
    """
    Replay bars with modified strategy parameters (for what-if analysis).

    Args:
        bars: OHLCV bars
        timeframe: Timeframe string
        symbol: Symbol
        param_overrides: Parameters to override in signal detector
        lookback: Lookback window

    Returns:
        ReplayTrace with parameter-adjusted signals
    """
    # Store original params, apply overrides, replay, restore
    # This is a placeholder for future parameter swapping logic
    # For now, just replay normally
    return replay_bars(bars, timeframe, symbol, lookback)


def frame_to_dict(frame: ReplayFrame) -> dict[str, Any]:
    """Convert ReplayFrame to dict for JSON serialization."""
    return asdict(frame) | {
        "timestamp": frame.timestamp.isoformat(),
        "next_bar_ohlcv": frame.next_bar_ohlcv or {},
    }
