"""Setup orchestrator — runs all six detectors and dedups overlaps.

The orchestrator is intentionally tiny: it calls every individual
detector with the same input bundle and concatenates the outputs.
Dedup logic favours the highest-confidence setup whenever two setups
fire on the *same bar* + *same direction* (the recall engine in PR6
will refine this with similarity-based collision rules).
"""

from __future__ import annotations

from typing import Sequence

from app.orderflow.absorption import AbsorptionEventOut
from app.orderflow.imbalance import ImbalanceEventOut
from app.structure.bos_choch import StructureEventOut
from app.structure.fvgs import FvgOut
from app.structure.order_blocks import OrderBlockOut
from app.structure.pivots import BarLike, PivotOut
from app.setups.breakout_retest import detect_breakout_retest
from app.setups.fvg_reaction import detect_fvg_reaction
from app.setups.liquidity_sweep import detect_liquidity_sweep_reclaim
from app.setups.momentum import detect_momentum_continuation
from app.setups.ob_retest import detect_ob_retest
from app.setups.session_reversal import detect_session_reversal
from app.setups.types import SetupOut


def detect_all_setups(
    bars: Sequence[BarLike],
    *,
    symbol_id: str,
    tf: str,
    pivots: Sequence[PivotOut] = (),
    structure_events: Sequence[StructureEventOut] = (),
    order_blocks: Sequence[OrderBlockOut] = (),
    fvgs: Sequence[FvgOut] = (),
    imbalances: Sequence[ImbalanceEventOut] = (),
    absorptions: Sequence[AbsorptionEventOut] = (),
    bias: str = "neutral",
    dedupe: bool = True,
) -> list[SetupOut]:
    """Run every setup detector and merge their outputs.

    ``dedupe=True`` keeps only the highest-confidence setup per
    (entry-bar timestamp, direction) collision. Set ``False`` to see
    every fired setup (useful for backtest analysis).
    """

    found: list[SetupOut] = []

    found.extend(
        detect_liquidity_sweep_reclaim(
            bars,
            pivots=pivots,
            imbalances=imbalances,
            absorptions=absorptions,
            symbol_id=symbol_id,
            tf=tf,
        )
    )
    found.extend(
        detect_ob_retest(
            bars,
            order_blocks=order_blocks,
            imbalances=imbalances,
            absorptions=absorptions,
            symbol_id=symbol_id,
            tf=tf,
        )
    )
    found.extend(
        detect_breakout_retest(
            bars,
            events=structure_events,
            imbalances=imbalances,
            absorptions=absorptions,
            symbol_id=symbol_id,
            tf=tf,
        )
    )
    found.extend(
        detect_fvg_reaction(
            bars,
            fvgs=fvgs,
            imbalances=imbalances,
            absorptions=absorptions,
            symbol_id=symbol_id,
            tf=tf,
        )
    )
    found.extend(
        detect_momentum_continuation(
            bars,
            bias=bias,
            imbalances=imbalances,
            absorptions=absorptions,
            symbol_id=symbol_id,
            tf=tf,
        )
    )
    found.extend(
        detect_session_reversal(
            bars,
            imbalances=imbalances,
            absorptions=absorptions,
            symbol_id=symbol_id,
            tf=tf,
        )
    )

    if not dedupe or not found:
        return found

    # Collision key: (entry-ref price rounded, direction).
    best: dict[tuple[float, str], SetupOut] = {}
    for s in found:
        key = (round(s.entry.ref, 6), s.direction)
        cur = best.get(key)
        if cur is None or s.confidence.score > cur.confidence.score:
            best[key] = s
    return list(best.values())
