"""Canonical 64-dim recall feature packer — Phase 5 PR7.

The recall engine stores one canonical vector per trade memory. The
*shape* of that vector is frozen here and mirrored in
``packages/types/src/recall.ts::RecallFeaturesSchema`` so UIs,
Python workers, and the ranking path all produce bit-identical
embeddings for the same inputs.

Design goals
------------

*  **Deterministic.** No RNG, no time-based salts. Same dict in →
   same 64 floats out.
*  **Bounded magnitudes.** Every dimension lives in ``[-1, 1]`` or
   ``[0, 1]`` so cosine similarity is not dominated by a single
   feature — the ``norm`` column on ``RecallEmbedding`` keeps ANN
   scans cheap.
*  **Append-only shape.** Later PRs can widen the vector by adding
   trailing slots but the first ``RECALL_FEATURE_DIMS`` positions
   stay frozen so historical memories remain comparable.

The structured :class:`RecallFeatures` projection is what the API
serves back to the UI — it is the human-readable dual of the packed
vector. :func:`pack_features` and :func:`features_to_vector` are
pure functions: no I/O, no side effects.

Layout
------

The 64 slots break down as (index → meaning):

    0..5    setup_type one-hot   (6 canonical setups)
    6..9    direction one-hot    (long, short, flat, unknown)
    10..17  timeframe one-hot    (1m..1w + unknown)
    18      trend sign           in [-1, 1]
    19      BOS flag             in {0, 1}
    20      CHOCH flag           in {0, 1}
    21      liquidity sweep flag in {0, 1}
    22      order-flow sign      in [-1, 1]
    23      volatility bucket    in [0, 1]
    24..28  session one-hot      (asia, london, ny_am, ny_pm, off)
    29..32  regime one-hot       (trending, ranging, volatile, news)
    33      confidence@detection in [0, 1]
    34..63  padding (reserved)   — every entry is ``0.0``

Reserved padding is spelled out explicitly so the JSON persisted on
``RecallEmbedding.vector`` always has the full ``dims`` length — the
Alembic column is a JSON list so length is load-bearing.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence


# ──────────────────────────── frozen constants ─────────────────────────

RECALL_FEATURE_DIMS = 64

SETUP_TYPES: tuple[str, ...] = (
    "liquidity_sweep_reclaim",
    "ob_retest",
    "breakout_retest",
    "fvg_reaction",
    "momentum_continuation",
    "session_reversal",
)

DIRECTIONS: tuple[str, ...] = ("long", "short", "flat", "unknown")

TIMEFRAMES: tuple[str, ...] = (
    "1m",
    "5m",
    "15m",
    "30m",
    "1h",
    "4h",
    "1d",
    "1w",
)

SESSIONS: tuple[str, ...] = ("asia", "london", "ny_am", "ny_pm", "off_hours")

REGIMES: tuple[str, ...] = ("trending", "ranging", "volatile", "news")

# Slot offsets — change only by appending new blocks.
_OFF_SETUP = 0
_OFF_DIRECTION = 6
_OFF_TIMEFRAME = 10
_OFF_TREND_SIGN = 18
_OFF_BOS = 19
_OFF_CHOCH = 20
_OFF_SWEEP = 21
_OFF_ORDER_FLOW_SIGN = 22
_OFF_VOL_BUCKET = 23
_OFF_SESSION = 24
_OFF_REGIME = 29
_OFF_CONFIDENCE = 33
_PADDING_START = 34  # inclusive


__all__ = [
    "DIRECTIONS",
    "RECALL_FEATURE_DIMS",
    "REGIMES",
    "RecallFeatures",
    "SESSIONS",
    "SETUP_TYPES",
    "TIMEFRAMES",
    "cosine_similarity",
    "features_to_vector",
    "pack_features",
    "vector_norm",
]


# ──────────────────────────── structured features ──────────────────────


@dataclass(frozen=True, slots=True)
class RecallFeatures:
    """Structured projection — mirrors ``RecallFeaturesSchema`` in TS.

    Use :meth:`to_vector` (or module :func:`features_to_vector`) to
    pack into the 64-dim array; use :meth:`to_dict` to serialise as
    the wire projection.
    """

    symbol_id: str
    tf: str
    direction: str
    setup_type: str
    trend_sign: int
    bos_flag: int
    choch_flag: int
    sweep_flag: int
    volatility_bucket: float
    session: str
    order_flow_sign: int
    regime: str
    confidence_at_detection: float

    def to_vector(self) -> list[float]:
        return features_to_vector(self)

    def to_dict(self) -> dict[str, object]:
        return {
            "symbolId": self.symbol_id,
            "tf": self.tf,
            "direction": self.direction,
            "setupType": self.setup_type,
            "trendSign": int(_clip_int(self.trend_sign, -1, 1)),
            "bosFlag": int(_clip_int(self.bos_flag, 0, 1)),
            "chochFlag": int(_clip_int(self.choch_flag, 0, 1)),
            "sweepFlag": int(_clip_int(self.sweep_flag, 0, 1)),
            "volatilityBucket": float(_clip01(self.volatility_bucket)),
            # Wire contract in recall.ts uses numeric session index; we
            # keep the string here and map to the canonical index when
            # packing.  UIs consume the structured dict.
            "session": self.session,
            "orderFlowSign": int(_clip_int(self.order_flow_sign, -1, 1)),
            "regime": self.regime,
            "confidenceAtDetection": float(_clip01(self.confidence_at_detection)),
        }


# ──────────────────────────── packing helpers ──────────────────────────


def pack_features(
    *,
    symbol_id: str,
    tf: str,
    direction: str,
    setup_type: str,
    trend_sign: int,
    bos_flag: int,
    choch_flag: int,
    sweep_flag: int,
    volatility_bucket: float,
    session: str,
    order_flow_sign: int,
    regime: str,
    confidence_at_detection: float,
) -> RecallFeatures:
    """Normalise + validate raw inputs into a frozen :class:`RecallFeatures`.

    Unknown enum values (setup_type / tf / session / regime / direction)
    round down to the last "unknown" / "off_hours" / "ranging" bucket
    rather than raising — the recall path should never block a detection
    because of a novel enum label.
    """

    return RecallFeatures(
        symbol_id=symbol_id.strip(),
        tf=tf if tf in TIMEFRAMES else "1h",
        direction=direction if direction in DIRECTIONS else "unknown",
        setup_type=setup_type if setup_type in SETUP_TYPES else "fvg_reaction",
        trend_sign=_clip_int(trend_sign, -1, 1),
        bos_flag=_clip_int(bos_flag, 0, 1),
        choch_flag=_clip_int(choch_flag, 0, 1),
        sweep_flag=_clip_int(sweep_flag, 0, 1),
        volatility_bucket=_clip01(volatility_bucket),
        session=session if session in SESSIONS else "off_hours",
        order_flow_sign=_clip_int(order_flow_sign, -1, 1),
        regime=regime if regime in REGIMES else "ranging",
        confidence_at_detection=_clip01(confidence_at_detection),
    )


def features_to_vector(features: RecallFeatures) -> list[float]:
    """Pack a :class:`RecallFeatures` into the frozen 64-dim layout."""

    vec: list[float] = [0.0] * RECALL_FEATURE_DIMS

    # 0..5 — setup_type one-hot
    if features.setup_type in SETUP_TYPES:
        vec[_OFF_SETUP + SETUP_TYPES.index(features.setup_type)] = 1.0

    # 6..9 — direction one-hot
    if features.direction in DIRECTIONS:
        vec[_OFF_DIRECTION + DIRECTIONS.index(features.direction)] = 1.0

    # 10..17 — timeframe one-hot
    if features.tf in TIMEFRAMES:
        vec[_OFF_TIMEFRAME + TIMEFRAMES.index(features.tf)] = 1.0

    # 18 — trend sign
    vec[_OFF_TREND_SIGN] = float(_clip_int(features.trend_sign, -1, 1))

    # 19..21 — structure flags
    vec[_OFF_BOS] = float(_clip_int(features.bos_flag, 0, 1))
    vec[_OFF_CHOCH] = float(_clip_int(features.choch_flag, 0, 1))
    vec[_OFF_SWEEP] = float(_clip_int(features.sweep_flag, 0, 1))

    # 22 — order-flow sign
    vec[_OFF_ORDER_FLOW_SIGN] = float(_clip_int(features.order_flow_sign, -1, 1))

    # 23 — volatility bucket
    vec[_OFF_VOL_BUCKET] = _clip01(features.volatility_bucket)

    # 24..28 — session one-hot
    if features.session in SESSIONS:
        vec[_OFF_SESSION + SESSIONS.index(features.session)] = 1.0

    # 29..32 — regime one-hot
    if features.regime in REGIMES:
        vec[_OFF_REGIME + REGIMES.index(features.regime)] = 1.0

    # 33 — confidence
    vec[_OFF_CONFIDENCE] = _clip01(features.confidence_at_detection)

    # 34..63 — reserved padding, already zeroed above.
    return vec


# ──────────────────────────── similarity math ──────────────────────────


def vector_norm(vec: Sequence[float]) -> float:
    return math.sqrt(sum(x * x for x in vec))


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity in ``[0, 1]`` for non-negative vectors.

    For the recall layout the vector is only ever in ``[-1, 1]`` and
    the negative components are sparse (trend + order-flow signs), so
    the cosine still lives comfortably in ``[-1, 1]``. We clamp to
    ``[0, 1]`` here because downstream consumers (confidence calibration,
    UI pills) treat similarity as a probability-like quantity.
    """

    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    dot = sum(a[i] * b[i] for i in range(n))
    norm_a = math.sqrt(sum(a[i] * a[i] for i in range(n)))
    norm_b = math.sqrt(sum(b[i] * b[i] for i in range(n)))
    if norm_a <= 0.0 or norm_b <= 0.0:
        return 0.0
    cos = dot / (norm_a * norm_b)
    if cos < 0.0:
        return 0.0
    if cos > 1.0:
        return 1.0
    return cos


# ──────────────────────────── private helpers ──────────────────────────


def _clip01(x: float) -> float:
    if x is None or x != x:  # NaN guard
        return 0.0
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return float(x)


def _clip_int(x: int | float, lo: int, hi: int) -> int:
    try:
        i = int(x)
    except (TypeError, ValueError):
        return lo
    if i < lo:
        return lo
    if i > hi:
        return hi
    return i
