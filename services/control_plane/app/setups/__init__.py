"""Setup detector library — six canonical setups for GodsView.

Modules
-------

* :mod:`types` — shared ``SetupOut``, ``SetupConfidenceOut``,
  ``PriceZoneOut`` dataclasses + the ``blend_confidence`` helper.
* :mod:`liquidity_sweep` — liquidity sweep + reclaim.
* :mod:`ob_retest` — order-block first-retest.
* :mod:`breakout_retest` — BOS/CHOCH-level retest.
* :mod:`fvg_reaction` — Fair-Value-Gap reaction.
* :mod:`momentum` — expanding-range continuation with flow.
* :mod:`session_reversal` — session high/low sweep + rejection.
* :mod:`orchestrator` — :func:`detect_all_setups` runs every detector
  and dedups overlapping hits.

Every detector is a pure function — no DB access, no I/O. The PR7
route module persists results to ``setups`` rows and exposes them via
the ``/v1/setups`` list + detail endpoints.
"""

from app.setups.breakout_retest import detect_breakout_retest
from app.setups.fvg_reaction import detect_fvg_reaction
from app.setups.liquidity_sweep import detect_liquidity_sweep_reclaim
from app.setups.momentum import detect_momentum_continuation
from app.setups.ob_retest import detect_ob_retest
from app.setups.orchestrator import detect_all_setups
from app.setups.session_reversal import detect_session_reversal
from app.setups.types import (
    PriceZoneOut,
    SetupConfidenceComponents,
    SetupConfidenceOut,
    SetupDirection,
    SetupOut,
    SetupStatus,
    SetupType,
    blend_confidence,
    compute_rr,
    default_expiry,
)

__all__ = [
    "PriceZoneOut",
    "SetupConfidenceComponents",
    "SetupConfidenceOut",
    "SetupDirection",
    "SetupOut",
    "SetupStatus",
    "SetupType",
    "blend_confidence",
    "compute_rr",
    "default_expiry",
    "detect_all_setups",
    "detect_breakout_retest",
    "detect_fvg_reaction",
    "detect_liquidity_sweep_reclaim",
    "detect_momentum_continuation",
    "detect_ob_retest",
    "detect_session_reversal",
]
