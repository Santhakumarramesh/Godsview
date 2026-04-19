"""Recall-weighted setup-confidence calibration.

The calibrator is the pass that turns a :class:`SetupConfidenceOut`
from :func:`app.setups.types.blend_confidence` into a *historically-
informed* confidence. For every fresh setup we:

1. Build a stable feature fingerprint from the setup's identity +
   price plan + order-flow score (see :func:`feature_fingerprint`).
2. Ask the recall store for its top-*k* closed neighbours.
3. Compute a similarity-weighted win-rate over those neighbours
   (:func:`neighbour_win_rate`).
4. Blend the neighbour win-rate into the raw
   :class:`SetupConfidenceComponents.history_score` and rebuild the
   envelope with the new score + ``history_count``.

The blend is intentionally gentle — the calibrator never drops the raw
score below 0.05 or pushes it past 0.95, so a cold start (no
neighbours) leaves the detector's own score untouched. As the store
fills, the ``history_score`` component dominates and the setup score
drifts toward the empirical rate of similar-setup outcomes.

Pure functions only. I/O lives in the route layer.
"""

from __future__ import annotations

from typing import Iterable, Sequence

from app.recall.store import RecallNeighbour, RecallStore
from app.setups.types import (
    SetupConfidenceComponents,
    SetupConfidenceOut,
)


# A neighbour whose similarity is below this cosine threshold is
# ignored — we don't want a nearly-orthogonal memory to sway the score.
_MIN_SIMILARITY = 0.2

# Minimum total weighted-support before we trust the win-rate estimate.
# Below this, we fall back to the raw ``history_score`` and report
# ``history_count = 0`` so the UI can show "insufficient history".
_MIN_SUPPORT = 0.6

# When support is heavy, pull the raw score toward the neighbour rate
# this fraction of the way. 0.0 = ignore history, 1.0 = replace score.
_MAX_BLEND = 0.5


# ───────────────────────── feature fingerprint ─────────────────────────


def feature_fingerprint(
    *,
    setup_type: str,
    direction: str,
    tf: str,
    rr: float,
    entry_ref: float,
    of_score: float,
    structure_score: float,
    regime_score: float,
    session_score: float,
    atr_ratio: float = 0.0,
) -> tuple[float, ...]:
    """Build a stable ordered feature vector for cosine similarity.

    The order is frozen: adding new dimensions must only *append* to
    the tuple so historical memories stay comparable. All features are
    floats in roughly the same magnitude (0..10) so cosine similarity
    is not swamped by a single dimension.

    * ``setup_type`` → one-hot index across the six canonical setups
    * ``direction`` → +1 for long, -1 for short
    * ``tf`` → timeframe rank (1m=1, 5m=2, 15m=3, 1h=4, 4h=5, 1d=6)
    * ``rr`` → risk:reward, clamped to [0, 10]
    * ``entry_ref`` → log-price proxy to keep scale sane
    * ``of_score`` / ``structure_score`` / ``regime_score`` /
      ``session_score`` → 0..1 component scores
    * ``atr_ratio`` → volatility regime proxy, optional
    """

    setup_types = (
        "liquidity_sweep_reclaim",
        "ob_retest",
        "breakout_retest",
        "fvg_reaction",
        "momentum_continuation",
        "session_reversal",
    )
    one_hot = [0.0] * len(setup_types)
    if setup_type in setup_types:
        one_hot[setup_types.index(setup_type)] = 1.0

    direction_val = 1.0 if direction == "long" else -1.0

    tf_rank = {"1m": 1.0, "5m": 2.0, "15m": 3.0, "1h": 4.0, "4h": 5.0, "1d": 6.0}
    tf_val = tf_rank.get(tf, 0.0)

    rr_clamped = max(0.0, min(10.0, rr))

    # Log-price proxy — 0 when entry_ref <= 0 (defensive).
    if entry_ref > 0:
        import math

        price_proxy = math.log1p(entry_ref)
    else:
        price_proxy = 0.0

    return tuple(
        one_hot
        + [
            direction_val,
            tf_val,
            rr_clamped,
            price_proxy,
            _clip01(of_score),
            _clip01(structure_score),
            _clip01(regime_score),
            _clip01(session_score),
            max(0.0, min(10.0, atr_ratio)),
        ]
    )


# ──────────────────────── neighbour statistics ────────────────────────


def neighbour_win_rate(
    neighbours: Iterable[RecallNeighbour],
) -> tuple[float, float, int]:
    """Similarity-weighted win-rate + support over recall neighbours.

    Returns ``(win_rate, weighted_support, eligible_count)``.

    * ``win_rate`` — similarity-weighted fraction of wins in ``[0, 1]``.
      Scratches count as half a win (neither edge nor catastrophe).
      Open / unknown outcomes are skipped.
    * ``weighted_support`` — sum of similarity weights actually used.
      The calibrator uses this as a trust knob (low support → ignore).
    * ``eligible_count`` — integer count of neighbours that passed the
      similarity threshold, reported verbatim as ``history_count``.
    """

    total_weight = 0.0
    win_weight = 0.0
    count = 0
    for nb in neighbours:
        if nb.similarity < _MIN_SIMILARITY:
            continue
        outcome = nb.record.outcome
        if outcome == "open":
            continue
        if outcome == "win":
            reward = 1.0
        elif outcome == "loss":
            reward = 0.0
        elif outcome == "scratch":
            reward = 0.5
        else:
            continue
        weight = max(0.0, nb.similarity)
        total_weight += weight
        win_weight += weight * reward
        count += 1

    if total_weight <= 0.0:
        return (0.0, 0.0, 0)
    return (win_weight / total_weight, total_weight, count)


# ────────────────────────── score calibration ─────────────────────────


def calibrate_confidence(
    *,
    components: SetupConfidenceComponents,
    raw_score: float,
    neighbours: Sequence[RecallNeighbour],
) -> SetupConfidenceOut:
    """Blend neighbour win-rate into the raw detector score.

    The resulting :class:`SetupConfidenceOut` rebuilds the component
    bundle with the calibrated ``history_score`` so the UI can show
    where the signal is coming from. When there is insufficient
    support the raw score is returned unchanged with
    ``history_count = 0``.
    """

    rate, support, count = neighbour_win_rate(neighbours)

    if support < _MIN_SUPPORT or count == 0:
        calibrated_components = components
        score = _clamp_score(raw_score)
        return SetupConfidenceOut(
            score=score,
            components=calibrated_components,
            history_count=0,
        )

    # Saturate blend weight at _MAX_BLEND. A support of 1.0 already
    # deserves the full weight — more support doesn't mean *more* pull.
    blend_weight = min(_MAX_BLEND, support / (support + 2.0) + 0.15)
    blend_weight = max(0.0, min(_MAX_BLEND, blend_weight))

    blended_score = (1.0 - blend_weight) * raw_score + blend_weight * rate

    calibrated_components = SetupConfidenceComponents(
        structure_score=components.structure_score,
        order_flow_score=components.order_flow_score,
        regime_score=components.regime_score,
        session_score=components.session_score,
        # Report the neighbour rate verbatim so UI panels can drill
        # into the history signal directly.
        history_score=_clip01(rate),
    )

    return SetupConfidenceOut(
        score=_clamp_score(blended_score),
        components=calibrated_components,
        history_count=count,
    )


# ──────────────────────────── helpers ────────────────────────────────


def _clip01(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


def _clamp_score(x: float) -> float:
    # Mirror ``blend_confidence``'s 0.05/0.95 clamp so the envelope
    # never escapes the usable band.
    return max(0.05, min(0.95, x))


# ───────────────────────── convenience wrapper ────────────────────────


def calibrate_with_store(
    *,
    components: SetupConfidenceComponents,
    raw_score: float,
    store: RecallStore,
    setup_type: str,
    direction: str,
    tf: str,
    symbol_id: str,
    rr: float,
    entry_ref: float,
    of_score: float,
    structure_score: float,
    regime_score: float,
    session_score: float,
    atr_ratio: float = 0.0,
    k: int = 12,
) -> SetupConfidenceOut:
    """End-to-end calibration: fingerprint → search → blend.

    Wrapper for the common route-layer call pattern.
    """

    features = feature_fingerprint(
        setup_type=setup_type,
        direction=direction,
        tf=tf,
        rr=rr,
        entry_ref=entry_ref,
        of_score=of_score,
        structure_score=structure_score,
        regime_score=regime_score,
        session_score=session_score,
        atr_ratio=atr_ratio,
    )
    neighbours = store.search(
        features,
        setup_type=setup_type,
        direction=direction,
        tf=tf,
        symbol_id=symbol_id,
        only_closed=True,
        k=k,
    )
    return calibrate_confidence(
        components=components,
        raw_score=raw_score,
        neighbours=neighbours,
    )
