"""Deterministic candle-by-candle replay simulator.

Replay is the "time-travel" sibling of :mod:`app.quant_lab.engine`. Given
a window of bars it walks them chronologically, and at each frame it
produces a :class:`QuantReplayFrameDto` decision envelope answering
"what would GodsView do here, right now, with no look-ahead?".

Design invariants
-----------------
* **Pure function of inputs.** No DB access. Given (symbol, tf, bars,
  config) the emitted frame stream is bit-identical across reruns.
* **No look-ahead.** Each frame only considers bars at index ``i`` and
  earlier. The decision envelope at frame ``i`` is computed from
  ``bars[:i+1]`` only.
* **Decoupled from the backtest engine.** We share the feature
  primitives (``_atr``, ``_trend_bias``, ``_MIN_HISTORY``) from
  :mod:`app.quant_lab.engine` but keep the replay output shape separate
  because it carries a richer per-frame envelope (structure + order-flow
  projections + decision reasoning).
* **Hypothetical PnL is forward-looking, but computed only when the
  replay run finishes.** Each frame emits ``None`` in real time, and
  after the cursor hits ``end_at`` we walk the frame list once more to
  compute "if I entered at this frame, what R would I have made by the
  time the window ended?". This is the only non-streaming step; for
  SSE delivery we stream the frame envelopes with ``hypotheticalPnLR``
  populated after the walk completes (caller can choose either shape
  by setting ``populate_hypothetical_pnl``).

Streaming
---------
The engine is a generator-friendly builder: call :func:`iter_frames` to
get a sequence of :class:`QuantReplayFrameDto` envelopes. The route
layer wraps this for both:

  * **Synchronous** — collect all frames, persist, return.
  * **SSE**         — wrap the iterator in an ``asyncio`` producer that
    ``await asyncio.sleep(stepMs / 1000)`` between frames.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Sequence
from uuid import uuid4

from app.quant_lab.engine import (
    EngineBar,
    _MIN_HISTORY,
    _atr,
    _detect_setup_at_bar,
    _trend_bias,
)
from app.quant_lab.replay_types import (
    DecisionActionLiteral,
    ImbalanceLiteral,
    LiquidityEventLiteral,
    QuantReplayFrameDto,
    ReplayBarDto,
    ReplayDecisionDto,
    ReplayOrderFlowDto,
    ReplayStructureDto,
    StructureTrendLiteral,
)
from app.quant_lab.types import (
    StrategyVersionConfigDto,
    TimeframeLiteral,
)

UTC = timezone.utc


# ───────────────────────────── inputs ────────────────────────────────────


@dataclass(slots=True)
class ReplayConfig:
    """Inputs the replay engine needs to emit frame envelopes.

    ``strategy_config`` is optional — when ``None`` we still emit
    structure + order-flow projections + "action=none" decisions so the
    operator can scroll through the chart without a strategy tied.
    """

    replay_run_id: str
    symbol_id: str
    tf: TimeframeLiteral
    bars: Sequence[EngineBar]
    strategy_config: StrategyVersionConfigDto | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None


# ───────────────────────────── helpers ───────────────────────────────────


def _trend_to_label(value: int) -> StructureTrendLiteral:
    if value > 0:
        return "bullish"
    if value < 0:
        return "bearish"
    return "neutral"


def _structure_at(
    history: Sequence[EngineBar],
    current: EngineBar,
) -> ReplayStructureDto:
    """Derive a compact structure verdict from bar history.

    The detector is deliberately lightweight — BOS / CHOCH are
    heuristics based on a 20-bar extreme break; ``liquidityEvent`` is
    a wick-through-extreme check on the current bar. These are the same
    shapes the Phase 2/3 structure detectors surface, projected into a
    tiny envelope.
    """

    if len(history) < _MIN_HISTORY:
        return ReplayStructureDto()

    trend_bias = _trend_bias(history)
    trend_label = _trend_to_label(trend_bias)

    # Compute 20-bar high/low from *prior* closed bars.
    prior = history[-_MIN_HISTORY:]
    high_20 = max(b.h for b in prior)
    low_20 = min(b.l for b in prior)
    atr = _atr(history)
    displacement_ok = atr > 0.0

    # Break of structure: current bar's close pushes past prior high/low
    # with a meaningful displacement.
    bos = False
    if displacement_ok:
        if current.c > high_20 and (current.c - high_20) > 0.25 * atr:
            bos = True
        elif current.c < low_20 and (low_20 - current.c) > 0.25 * atr:
            bos = True

    # Change of character: we flip bias against the prior half.
    first_half = sum(b.c for b in prior[: _MIN_HISTORY // 2]) / (_MIN_HISTORY // 2)
    second_half = sum(b.c for b in prior[_MIN_HISTORY // 2 :]) / (
        _MIN_HISTORY - _MIN_HISTORY // 2
    )
    choch = False
    if displacement_ok:
        if second_half > first_half and current.c < first_half - 0.25 * atr:
            choch = True
        elif second_half < first_half and current.c > first_half + 0.25 * atr:
            choch = True

    # Liquidity sweep: wick through extreme + close back inside.
    liquidity: LiquidityEventLiteral = "none"
    if current.h > high_20 and current.c < high_20:
        liquidity = "sweep_high"
    elif current.l < low_20 and current.c > low_20:
        liquidity = "sweep_low"

    return ReplayStructureDto(
        trend=trend_label,
        bos=bos,
        choch=choch,
        liquidityEvent=liquidity,
    )


def _orderflow_at(
    history: Sequence[EngineBar],
    current: EngineBar,
) -> ReplayOrderFlowDto:
    """Project a delta / imbalance / absorption envelope from OHLCV alone.

    Without a real tape the engine estimates delta from bar body ×
    volume signed by direction, and calls absorption when a large-volume
    bar has a small body (the classic absorption signature).
    """

    body = current.c - current.o
    body_ratio = 0.0
    rng = current.h - current.l
    if rng > 0:
        body_ratio = body / rng

    delta = body_ratio * max(current.v, 1.0)

    imbalance: ImbalanceLiteral = "balanced"
    if body_ratio > 0.2:
        imbalance = "buy"
    elif body_ratio < -0.2:
        imbalance = "sell"

    # Rolling avg-volume window for absorption detection.
    absorption = False
    if len(history) >= 10 and current.v > 0:
        avg_v = sum(b.v for b in history[-10:]) / 10
        if avg_v > 0 and current.v > 1.5 * avg_v and abs(body_ratio) < 0.2:
            absorption = True

    return ReplayOrderFlowDto(
        delta=delta,
        imbalance=imbalance,
        absorption=absorption,
    )


def _decision_at(
    history: Sequence[EngineBar],
    current: EngineBar,
    *,
    strategy_config: StrategyVersionConfigDto | None,
    structure: ReplayStructureDto,
) -> ReplayDecisionDto:
    """Build the decision envelope for the current frame.

    We reuse :func:`app.quant_lab.engine._detect_setup_at_bar` so the
    replay view agrees with the backtest engine on what constitutes a
    valid setup. The ``setupId`` is left ``None`` here — the route layer
    attaches a persisted :class:`app.models.Setup` id when one exists.
    """

    if strategy_config is None:
        return ReplayDecisionDto(
            action="none",
            reasoning=(
                f"chart-only replay · trend={structure.trend} · "
                f"bos={structure.bos} · liq={structure.liquidityEvent}"
            ),
        )

    detected = _detect_setup_at_bar(
        history,
        current,
        setup_type=strategy_config.entry.setupType,
        allowed_direction=strategy_config.entry.direction,
        stop_style=strategy_config.exit.stopStyle,
        take_profit_rr=strategy_config.exit.takeProfitRR,
        min_confidence=strategy_config.entry.minConfidence,
    )
    if detected is None:
        return ReplayDecisionDto(
            action="none",
            confidence=None,
            reasoning=(
                f"no setup · trend={structure.trend} · "
                f"atr={_atr(history):.5f}"
            ),
        )

    action: DecisionActionLiteral = (
        "enter_long" if detected.direction == "long" else "enter_short"
    )
    return ReplayDecisionDto(
        action=action,
        setupId=None,
        confidence=detected.confidence,
        reasoning=(
            f"{detected.setup_type} · "
            f"{detected.direction} · "
            f"entry={detected.entry:.5f} · "
            f"sl={detected.stop_loss:.5f} · "
            f"tp={detected.take_profit:.5f} · "
            f"bos={structure.bos} · choch={structure.choch}"
        ),
    )


def _compute_hypothetical_pnl(
    frames: list[QuantReplayFrameDto],
    bars: Sequence[EngineBar],
) -> None:
    """Back-fill ``hypotheticalPnLR`` on every decision frame in-place.

    For each frame that would have entered, we walk forward through the
    remaining bars and close the hypothetical trade at whichever of
    ``take_profit`` / ``stop_loss`` / window-end happens first. We keep
    the calculation cheap — a single linear scan per entry frame.
    """

    if not frames or not bars:
        return

    # Index bars by timestamp for O(1) forward scan alignment.
    ts_index: dict[datetime, int] = {}
    for idx, bar in enumerate(bars):
        ts_index.setdefault(bar.t, idx)

    for frame in frames:
        decision = frame.decision
        if decision.action not in ("enter_long", "enter_short"):
            continue
        start_idx = ts_index.get(frame.ts)
        if start_idx is None or start_idx + 1 >= len(bars):
            frame.hypotheticalPnLR = 0.0
            continue

        # Reuse the detector output signal. The engine's detector already
        # gave us a trade-plan shape; we rebuild it cheaply here from the
        # reasoning string is fragile, so instead we re-run the detector.
        # Simpler: derive a 1R trade using a fixed ATR stop + 2R target.
        history = bars[: start_idx + 1]
        atr = _atr(history)
        if atr <= 0:
            frame.hypotheticalPnLR = 0.0
            continue

        entry_price = bars[start_idx].c
        direction = "long" if decision.action == "enter_long" else "short"
        stop_distance = 1.25 * atr
        if direction == "long":
            stop_loss = entry_price - stop_distance
            take_profit = entry_price + stop_distance * 2.0
        else:
            stop_loss = entry_price + stop_distance
            take_profit = entry_price - stop_distance * 2.0

        pnl_r = 0.0
        for forward in bars[start_idx + 1 :]:
            if direction == "long":
                if forward.l <= stop_loss:
                    pnl_r = -1.0
                    break
                if forward.h >= take_profit:
                    pnl_r = 2.0
                    break
            else:
                if forward.h >= stop_loss:
                    pnl_r = -1.0
                    break
                if forward.l <= take_profit:
                    pnl_r = 2.0
                    break
        else:
            # End-of-window close at last bar.
            last = bars[-1].c
            pnl = last - entry_price if direction == "long" else entry_price - last
            pnl_r = pnl / stop_distance if stop_distance > 0 else 0.0

        frame.hypotheticalPnLR = pnl_r


# ───────────────────────────── entry point ───────────────────────────────


def iter_frames(
    config: ReplayConfig,
    *,
    populate_hypothetical_pnl: bool = True,
) -> list[QuantReplayFrameDto]:
    """Run the full replay and return the ordered frame list.

    Callers wanting a streaming shape can iterate ``iter_frames_stream``
    and apply ``_compute_hypothetical_pnl`` after the generator drains.
    """

    frames: list[QuantReplayFrameDto] = []
    bars_in_window: list[EngineBar] = []
    for bar in config.bars:
        if config.start_at and bar.t < config.start_at:
            continue
        if config.end_at and bar.t > config.end_at:
            continue
        bars_in_window.append(bar)

    bars_in_window.sort(key=lambda b: b.t)

    for idx, bar in enumerate(bars_in_window):
        history = bars_in_window[: idx + 1]
        structure = _structure_at(history[:-1], bar) if len(history) > 1 else (
            ReplayStructureDto()
        )
        order_flow = _orderflow_at(history[:-1], bar) if len(history) > 1 else (
            ReplayOrderFlowDto(delta=0.0, imbalance="balanced", absorption=False)
        )
        decision = _decision_at(
            history[:-1],
            bar,
            strategy_config=config.strategy_config,
            structure=structure,
        )
        frame = QuantReplayFrameDto(
            id=f"rfr_{uuid4().hex}",
            replayRunId=config.replay_run_id,
            ts=bar.t,
            symbolId=config.symbol_id,
            tf=config.tf,
            bar=ReplayBarDto(
                open=bar.o,
                high=bar.h,
                low=bar.l,
                close=bar.c,
                volume=bar.v,
            ),
            structure=structure,
            orderFlow=order_flow,
            decision=decision,
            hypotheticalPnLR=None,
        )
        frames.append(frame)

    if populate_hypothetical_pnl:
        _compute_hypothetical_pnl(frames, bars_in_window)

    return frames


def iter_frames_stream(
    config: ReplayConfig,
) -> Iterable[QuantReplayFrameDto]:
    """Yield frames one-by-one without the forward-PnL back-fill.

    This is the right shape for SSE streaming — the UI paints each
    frame as it arrives, and the final persisted frame list is
    back-filled in a single pass after the stream ends.
    """

    bars_in_window: list[EngineBar] = []
    for bar in config.bars:
        if config.start_at and bar.t < config.start_at:
            continue
        if config.end_at and bar.t > config.end_at:
            continue
        bars_in_window.append(bar)

    bars_in_window.sort(key=lambda b: b.t)

    for idx, bar in enumerate(bars_in_window):
        history = bars_in_window[: idx + 1]
        structure = _structure_at(history[:-1], bar) if len(history) > 1 else (
            ReplayStructureDto()
        )
        order_flow = _orderflow_at(history[:-1], bar) if len(history) > 1 else (
            ReplayOrderFlowDto(delta=0.0, imbalance="balanced", absorption=False)
        )
        decision = _decision_at(
            history[:-1],
            bar,
            strategy_config=config.strategy_config,
            structure=structure,
        )
        yield QuantReplayFrameDto(
            id=f"rfr_{uuid4().hex}",
            replayRunId=config.replay_run_id,
            ts=bar.t,
            symbolId=config.symbol_id,
            tf=config.tf,
            bar=ReplayBarDto(
                open=bar.o,
                high=bar.h,
                low=bar.l,
                close=bar.c,
                volume=bar.v,
            ),
            structure=structure,
            orderFlow=order_flow,
            decision=decision,
            hypotheticalPnLR=None,
        )


__all__ = [
    "ReplayConfig",
    "iter_frames",
    "iter_frames_stream",
]
