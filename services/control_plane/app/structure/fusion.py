"""Multi-timeframe Fusion Engine.

Combines the raw detector output (structure events, order blocks,
fair value gaps) across a set of timeframes into a single
:class:`MarketContextOut` row that matches
``packages/types/src/structure.ts::MarketContextSchema``.

Responsibilities
----------------

  1. **Bias derivation** — infer a directional bias per timeframe
     from that timeframe's most recent structure event. A recent
     BOS/CHOCH with ``direction="long"`` produces a long bias; flat
     tape with no events produces a neutral bias.
  2. **Higher vs. lower timeframe aggregation** — roll 4H+1H into
     a single HTF bias and 15m+5m into an LTF bias. When the two
     legs within a bucket disagree the higher timeframe wins
     (4H beats 1H; 15m beats 5m) because slower structure drives.
  3. **Conflict detection** — flip ``conflict=True`` when HTF and
     LTF biases disagree (e.g., HTF long + LTF short ⇒ retest only
     with extra caution).
  4. **Zone mutation** — walk a post-detection bar series to update
     each OB's ``retested`` / ``violated`` flags and each FVG's
     ``mitigated`` / ``mitigated_at`` markers. This is the only
     place in the pipeline allowed to mutate zone state.

The engine is a pure function: all state transitions are visible in
the return value. The PR7 persistence layer is responsible for
writing the resulting ``MarketContextOut`` back to Postgres.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Iterable, Mapping, Sequence

from app.structure.bos_choch import StructureEventOut
from app.structure.fvgs import FvgOut
from app.structure.order_blocks import OrderBlockOut
from app.structure.pivots import BarLike

_UTC = timezone.utc

# Bucket weights — the "heavier" leg within each bucket wins when
# both legs agree or the lighter leg is absent. When the two legs
# disagree, the heavier one still wins (slow structure dominates).
_HTF_BUCKETS: tuple[str, ...] = ("4h", "1h")
_LTF_BUCKETS: tuple[str, ...] = ("15m", "5m")


@dataclass(frozen=True, slots=True)
class MarketContextOut:
    """Output row matching ``packages/types/src/structure.ts::MarketContextSchema``."""

    symbol_id: str
    htf_bias: str  # "long" | "short" | "neutral"
    ltf_bias: str
    conflict: bool
    recent_events: list[StructureEventOut]
    active_order_blocks: list[OrderBlockOut]
    active_fvgs: list[FvgOut]
    generated_at: datetime


def derive_bias_from_events(
    events: Sequence[StructureEventOut],
) -> str:
    """Return the bias implied by the *most recent* structure event.

    Returns ``"neutral"`` when the input is empty. Otherwise the most
    recent event's ``direction`` (by ``confirmation_t``) wins.
    """

    if not events:
        return "neutral"
    latest = max(events, key=lambda e: e.confirmation_t)
    return latest.direction


def _aggregate_bucket(
    events_by_tf: Mapping[str, Sequence[StructureEventOut]],
    bucket: Sequence[str],
) -> str:
    """Roll a set of timeframes into a single bias.

    The first timeframe in ``bucket`` is the heavyweight — if it has
    an event, its direction wins. Otherwise fall back to the next
    timeframe. This gives us a deterministic "slowest-wins"
    aggregation without having to weight confidences.
    """

    for tf in bucket:
        evs = events_by_tf.get(tf) or []
        if evs:
            return derive_bias_from_events(evs)
    return "neutral"


def update_order_block_state(
    obs: Iterable[OrderBlockOut], *, bars_after: Sequence[BarLike]
) -> list[OrderBlockOut]:
    """Mutate OB ``retested`` / ``violated`` flags against a post-OB bar run.

    A bullish OB is **retested** when a subsequent bar's low re-enters
    its body (``low <= ob.high``), and **violated** when a subsequent
    bar's close closes below the body (``close < ob.low``). Mirror the
    rules for bearish OBs. Violation dominates retest — a violated OB
    stays violated regardless of subsequent re-entries.
    """

    out: list[OrderBlockOut] = []
    for ob in obs:
        retested = ob.retested
        violated = ob.violated
        future = [b for b in bars_after if b.t > ob.t]
        for b in future:
            if ob.direction == "long":
                if b.c < ob.low:
                    violated = True
                    break
                if b.l <= ob.high:
                    retested = True
            else:  # short
                if b.c > ob.high:
                    violated = True
                    break
                if b.h >= ob.low:
                    retested = True
        out.append(replace(ob, retested=retested, violated=violated))
    return out


def update_fvg_state(
    fvgs: Iterable[FvgOut], *, bars_after: Sequence[BarLike]
) -> list[FvgOut]:
    """Mutate FVG ``mitigated`` / ``mitigated_at`` against a post-FVG bar run.

    Mitigation rule mirrors :func:`app.structure.fvgs.detect_fvgs` —
    a bullish FVG is mitigated by the first close ≤ bottom, a bearish
    FVG by the first close ≥ top. Already-mitigated rows are kept as
    is (first mitigation wins).
    """

    out: list[FvgOut] = []
    for g in fvgs:
        if g.mitigated:
            out.append(g)
            continue
        future = [b for b in bars_after if b.t > g.t]
        mitigated_at: datetime | None = None
        for b in future:
            if g.direction == "long" and b.c <= g.bottom:
                mitigated_at = b.t
                break
            if g.direction == "short" and b.c >= g.top:
                mitigated_at = b.t
                break
        if mitigated_at is not None:
            out.append(
                replace(g, mitigated=True, mitigated_at=mitigated_at)
            )
        else:
            out.append(g)
    return out


def _most_recent_per_tf(
    events_by_tf: Mapping[str, Sequence[StructureEventOut]],
) -> list[StructureEventOut]:
    """One event per tf, ordered by confirmation_t descending."""

    picked: list[StructureEventOut] = []
    for tf, evs in events_by_tf.items():
        if not evs:
            continue
        latest = max(evs, key=lambda e: e.confirmation_t)
        picked.append(latest)
    picked.sort(key=lambda e: e.confirmation_t, reverse=True)
    return picked


def build_market_context(
    *,
    symbol_id: str,
    events_by_tf: Mapping[str, Sequence[StructureEventOut]],
    order_blocks: Sequence[OrderBlockOut],
    fvgs: Sequence[FvgOut],
) -> MarketContextOut:
    """Assemble the per-symbol ``MarketContextOut`` for the fusion layer.

    Callers must pre-filter OBs and FVGs to the relevant active set —
    the fusion engine only reports what it's given. Use
    :func:`update_order_block_state` / :func:`update_fvg_state` first
    to refresh the state flags against recent bars, then pass the
    ``not violated`` / ``not mitigated`` subsets in.
    """

    htf = _aggregate_bucket(events_by_tf, _HTF_BUCKETS)
    ltf = _aggregate_bucket(events_by_tf, _LTF_BUCKETS)
    conflict = (
        htf != "neutral"
        and ltf != "neutral"
        and htf != ltf
    )

    return MarketContextOut(
        symbol_id=symbol_id,
        htf_bias=htf,
        ltf_bias=ltf,
        conflict=conflict,
        recent_events=_most_recent_per_tf(events_by_tf),
        active_order_blocks=list(order_blocks),
        active_fvgs=list(fvgs),
        generated_at=datetime.now(_UTC),
    )
