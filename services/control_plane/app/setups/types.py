"""Shared dataclasses for the setup detector library.

Every detector in :mod:`app.setups` produces a :class:`SetupOut`
envelope matching ``packages/types/src/setups.ts::SetupSchema``. The
detectors stay pure — no I/O, no DB access — so the persistence layer
(PR7 route module) can serialise them unchanged to camelCase JSON.

A :class:`SetupOut` always carries:

* identity + routing (``symbol_id``, ``tf``, ``type``, ``direction``)
* price plan (``entry``, ``stop_loss``, ``take_profit``, ``rr``)
* calibration inputs (:class:`SetupConfidenceOut` components)
* provenance (``structure_event_ids``, ``order_flow_event_ids``)
* operational metadata (``status``, ``expires_at``, ``reasoning``)

The detectors set a *raw* confidence derived from their own inputs.
PR6 adds a calibration pass that reweights these components against
the recall engine's historical win-rate; this module deliberately
keeps the component weights equal (0.2·each) so PR6 can change the
mixing without touching detector code.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Literal

_UTC = timezone.utc

SetupType = Literal[
    "liquidity_sweep_reclaim",
    "ob_retest",
    "breakout_retest",
    "fvg_reaction",
    "momentum_continuation",
    "session_reversal",
]

SetupDirection = Literal["long", "short"]

SetupStatus = Literal[
    "detected",
    "approved_paper",
    "approved_live",
    "filled",
    "closed",
    "expired",
    "rejected",
]


@dataclass(frozen=True, slots=True)
class PriceZoneOut:
    """Entry / SL / TP price envelope."""

    low: float
    high: float
    ref: float


@dataclass(frozen=True, slots=True)
class SetupConfidenceComponents:
    """Weighted inputs to the setup confidence score.

    Each component is clipped to ``[0, 1]``. The raw score returned by
    :func:`blend_confidence` is the arithmetic mean — PR6 replaces this
    with a calibrator that draws from historical similar-setup outcomes.
    """

    structure_score: float
    order_flow_score: float
    regime_score: float
    session_score: float
    history_score: float


@dataclass(frozen=True, slots=True)
class SetupConfidenceOut:
    """Calibrated probability envelope."""

    score: float
    components: SetupConfidenceComponents
    history_count: int


@dataclass(frozen=True, slots=True)
class SetupOut:
    """Output row matching ``packages/types/src/setups.ts::SetupSchema``."""

    id: str
    symbol_id: str
    tf: str
    type: SetupType
    direction: SetupDirection
    status: SetupStatus
    detected_at: datetime
    entry: PriceZoneOut
    stop_loss: float
    take_profit: float
    rr: float
    confidence: SetupConfidenceOut
    reasoning: str
    structure_event_ids: list[str] = field(default_factory=list)
    order_flow_event_ids: list[str] = field(default_factory=list)
    expires_at: datetime | None = None


# ───────────────────────────── helpers ─────────────────────────────


def _ev_id() -> str:
    return f"stp_{uuid.uuid4().hex}"


def _clip01(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


def blend_confidence(
    *,
    structure_score: float,
    order_flow_score: float,
    regime_score: float = 0.5,
    session_score: float = 0.5,
    history_score: float = 0.5,
    history_count: int = 0,
) -> SetupConfidenceOut:
    """Build a :class:`SetupConfidenceOut` from raw 0..1 components.

    The raw blend is a flat arithmetic mean of the five components.
    PR6 introduces a calibrator hook that takes over this function —
    detectors should always call this helper so the upgrade is a
    one-line swap.
    """

    components = SetupConfidenceComponents(
        structure_score=_clip01(structure_score),
        order_flow_score=_clip01(order_flow_score),
        regime_score=_clip01(regime_score),
        session_score=_clip01(session_score),
        history_score=_clip01(history_score),
    )
    score = (
        components.structure_score
        + components.order_flow_score
        + components.regime_score
        + components.session_score
        + components.history_score
    ) / 5.0
    # Clamp away from 0/1 so downstream calibrators can still move it.
    score = max(0.05, min(0.95, score))
    return SetupConfidenceOut(
        score=score,
        components=components,
        history_count=max(0, history_count),
    )


def compute_rr(
    *, entry_ref: float, stop_loss: float, take_profit: float
) -> float:
    """Risk:reward ratio = |TP-entry| / |entry-SL|.

    Returns ``0.0`` when the stop equals the entry (degenerate). The
    caller is responsible for rejecting degenerate setups before
    emitting them; this helper is lenient so unit tests can feed bad
    inputs and assert the degenerate outcome.
    """

    risk = abs(entry_ref - stop_loss)
    reward = abs(take_profit - entry_ref)
    if risk <= 0:
        return 0.0
    return reward / risk


def default_expiry(tf: str, *, detected_at: datetime) -> datetime:
    """Canonical expiry window for a freshly-detected setup.

    Short timeframes expire fast (setups on 1m are stale in minutes);
    higher timeframes hold for hours. Values mirror the TradingView-side
    alert TTLs so UI + Pine can agree on staleness.
    """

    minutes_by_tf = {
        "1m": 5,
        "5m": 30,
        "15m": 90,
        "1h": 240,
        "4h": 720,
        "1d": 1440,
    }
    window = minutes_by_tf.get(tf, 60)
    return detected_at + timedelta(minutes=window)
