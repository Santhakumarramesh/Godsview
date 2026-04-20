"""Regime detection — pure classifier.

Given a compact bundle of per-``(symbolId, tf)`` features (trend
strength, ADX, ATR percentile, news pressure, realised-volatility
percentile), the classifier emits one of four regimes with a
confidence in ``[0, 1]``:

  * ``trending``    — directional + moderate volatility
  * ``ranging``     — low |trend|, low volatility
  * ``volatile``    — high volatility, mixed trend
  * ``news_driven`` — elevated news pressure dominates

The classifier is *deterministic* — identical features produce an
identical verdict. That determinism is what the regime history
endpoint banks on: given the same observed_at bar, a replay must
produce the exact same RegimeSnapshot row.

Shape-parity note: the TS ``RegimeSnapshotSchema`` stores
``trendStrength`` in ``[-1, 1]`` and ``volatility`` in ``[0, 1]``.
The classifier consumes those same ranges verbatim.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

__all__ = [
    "REGIME_KINDS",
    "RegimeFeatures",
    "RegimeKindLiteral",
    "classify_regime",
    "regime_confidence",
]


RegimeKindLiteral = Literal["trending", "ranging", "volatile", "news_driven"]

REGIME_KINDS: tuple[RegimeKindLiteral, ...] = (
    "trending",
    "ranging",
    "volatile",
    "news_driven",
)


@dataclass(frozen=True, slots=True)
class RegimeFeatures:
    """Input bundle fed to :func:`classify_regime`.

    All features must be normalised to the canonical ranges below:

      * ``trend_strength`` ∈ [-1, 1] (signed).
      * ``adx`` ∈ [0, 100] (raw ADX units).
      * ``atr_percentile`` ∈ [0, 1] (rolling 30-day percentile).
      * ``volatility_percentile`` ∈ [0, 1] (session-volume-normalised).
      * ``news_pressure`` ∈ [0, 1] (composite news-flow intensity).
    """

    trend_strength: float
    adx: float
    atr_percentile: float
    volatility_percentile: float
    news_pressure: float

    def __post_init__(self) -> None:
        if not (-1.0 <= self.trend_strength <= 1.0):
            raise ValueError(f"trend_strength {self.trend_strength!r} out of [-1, 1]")
        if not (0.0 <= self.adx <= 100.0):
            raise ValueError(f"adx {self.adx!r} out of [0, 100]")
        for name, value in (
            ("atr_percentile", self.atr_percentile),
            ("volatility_percentile", self.volatility_percentile),
            ("news_pressure", self.news_pressure),
        ):
            if not (0.0 <= value <= 1.0):
                raise ValueError(f"{name} {value!r} out of [0, 1]")


# ──────────────────────────── scoring ──────────────────────────────────


def _trending_score(f: RegimeFeatures) -> float:
    # Reward strong directional trend + moderate volatility + decent ADX.
    trend = abs(f.trend_strength)
    adx_n = min(f.adx / 50.0, 1.0)
    # Prefer mid volatility (not dead, not chaotic).
    vol = f.volatility_percentile
    vol_window = 1.0 - abs(vol - 0.55) * 1.8
    vol_window = max(vol_window, 0.0)
    return round(
        0.45 * trend + 0.35 * adx_n + 0.20 * vol_window,
        6,
    )


def _ranging_score(f: RegimeFeatures) -> float:
    # Reward weak trend + low ADX + low volatility.
    trend_flat = 1.0 - abs(f.trend_strength)
    adx_low = max(0.0, 1.0 - f.adx / 25.0)
    vol_low = 1.0 - f.volatility_percentile
    return round(
        0.40 * trend_flat + 0.35 * adx_low + 0.25 * vol_low,
        6,
    )


def _volatile_score(f: RegimeFeatures) -> float:
    # Reward high realised + ATR volatility even without direction.
    return round(
        0.55 * f.volatility_percentile + 0.45 * f.atr_percentile,
        6,
    )


def _news_driven_score(f: RegimeFeatures) -> float:
    # News pressure dominates; ATR must also be elevated for this to fire.
    return round(
        0.70 * f.news_pressure + 0.30 * f.atr_percentile,
        6,
    )


_SCORERS: dict[RegimeKindLiteral, callable[[RegimeFeatures], float]] = {  # type: ignore[valid-type]
    "trending": _trending_score,
    "ranging": _ranging_score,
    "volatile": _volatile_score,
    "news_driven": _news_driven_score,
}


def classify_regime(
    features: RegimeFeatures,
) -> tuple[RegimeKindLiteral, float]:
    """Classify a feature bundle into a regime + confidence.

    Ties are broken deterministically by ``REGIME_KINDS`` order. When
    the winning score is ``0.0`` (all features are zero / null) the
    classifier falls back to ``ranging`` at confidence ``0.25`` —
    "we don't know, best guess is boring".
    """

    scores: dict[RegimeKindLiteral, float] = {
        kind: _SCORERS[kind](features) for kind in REGIME_KINDS
    }
    best_kind: RegimeKindLiteral = "ranging"
    best_score = -1.0
    for kind in REGIME_KINDS:  # Deterministic tie-break order.
        s = scores[kind]
        if s > best_score:
            best_score = s
            best_kind = kind

    if best_score <= 0.0:
        return "ranging", 0.25

    # Confidence: margin-over-runner-up scaled by the absolute score.
    confidence = regime_confidence(scores, best_kind)
    return best_kind, confidence


def regime_confidence(
    scores: dict[RegimeKindLiteral, float],
    winner: RegimeKindLiteral,
) -> float:
    """Turn a full scoring dict into a 0..1 confidence for the winner.

    Uses margin-over-runner-up — a dominant winner gets close to 1.0,
    a near-tie gets close to 0.5.
    """

    if winner not in scores:
        raise ValueError(f"winner {winner!r} not in scores")

    winning = scores[winner]
    rivals = [s for k, s in scores.items() if k != winner]
    runner_up = max(rivals) if rivals else 0.0
    margin = max(winning - runner_up, 0.0)

    # Absolute floor + margin boost. Clamp to [0, 1].
    base = min(winning, 1.0) * 0.5
    boost = margin * 2.0  # 0.25 margin → +0.5 boost
    conf = base + boost * 0.5
    if conf < 0.0:
        conf = 0.0
    if conf > 1.0:
        conf = 1.0
    return round(conf, 6)
