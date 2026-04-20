"""Confidence calibration — bucket + Platt fitters.

The raw confidence score the detector emits is not a probability.
Calibration maps raw → calibrated by reading historical outcomes.

Two calibrators ship:

  * **bucket** — the default. Partitions [0, 1] into ``CALIBRATION_BIN_COUNT``
    equal-width bins; each bin's ``calibrated`` value is the observed
    win rate of samples in that bin. Stable under small sample sizes
    because empty bins stay at their previous fit (or at ``rawMid``
    when cold-starting).
  * **platt** — a 2-parameter sigmoid ``p(raw) = 1 / (1 + exp(a·raw + b))``
    fit via iterative re-weighted least squares. Smooth + monotonic.
    Requires ≥ 200 samples to be considered stable; the repo layer
    enforces that gate.

Every fitter also returns two canonical error metrics:

  * **ECE** (Expected Calibration Error) — weighted mean gap between
    bin-mean-confidence and bin-win-rate. Lower = better.
  * **Brier score** — mean squared error of (calibrated_prob - win).
    Lower = better.

The module is pure — no DB, no global state, no IO. It is the
reference implementation the learning worker reuses both online (for
calibration-on-the-fly during search) and offline (the hourly
recompute cron).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Literal, Sequence

__all__ = [
    "CALIBRATION_BIN_COUNT",
    "CalibrationBin",
    "CalibrationKindLiteral",
    "CalibrationSamples",
    "brier_score",
    "ece_score",
    "fit_bucket_calibrator",
    "fit_platt_calibrator",
    "platt_predict",
    "predict_calibrated",
]


CALIBRATION_BIN_COUNT = 10
CalibrationKindLiteral = Literal["bucket", "platt"]


# ──────────────────────────── data shapes ────────────────────────────


@dataclass(frozen=True, slots=True)
class CalibrationBin:
    """Canonical representation of a single bucket-calibrator bin.

    ``raw_low`` + ``raw_high`` span the input range; ``calibrated`` is
    the empirical win rate in that bin; ``count`` + ``wins`` carry the
    sample counts so the repo layer can serialise back faithfully.
    """

    raw_low: float
    raw_high: float
    calibrated: float
    count: int
    wins: int


@dataclass(frozen=True, slots=True)
class CalibrationSamples:
    """Input bundle for the calibrator fitters.

    ``raw_scores`` and ``outcomes`` must be the same length. Each
    ``outcome`` is ``1`` for win and ``0`` for loss. Scratch / open
    outcomes must be filtered by the caller — the fitters will reject
    anything else.
    """

    raw_scores: Sequence[float]
    outcomes: Sequence[int]

    def __post_init__(self) -> None:
        if len(self.raw_scores) != len(self.outcomes):
            raise ValueError(
                "raw_scores and outcomes must have the same length "
                f"(got {len(self.raw_scores)} and {len(self.outcomes)})"
            )
        for raw in self.raw_scores:
            if not (0.0 <= float(raw) <= 1.0):
                raise ValueError(f"raw_score {raw!r} out of [0, 1]")
        for o in self.outcomes:
            if o not in (0, 1):
                raise ValueError(f"outcome {o!r} must be 0 or 1")


# ──────────────────────────── bucket calibrator ────────────────────────


def fit_bucket_calibrator(
    samples: CalibrationSamples,
    *,
    bin_count: int = CALIBRATION_BIN_COUNT,
) -> list[CalibrationBin]:
    """Fit an isotonic-style bucket calibrator.

    Rules:
      * ``bin_count`` equal-width bins on ``[0, 1]``.
      * Each bin's ``calibrated`` is the empirical win rate of the
        samples that fall into the bin.
      * Empty bins inherit the bin midpoint as their calibrated value
        (identity fallback) so the calibrator is always well-defined.
      * A sample exactly at ``1.0`` falls into the last bin (we use
        half-open ``[low, high)`` except for the last bin which is
        closed).

    The fit is deterministic — identical inputs produce identical bins.
    """

    if bin_count < 1:
        raise ValueError("bin_count must be at least 1")

    width = 1.0 / bin_count
    # Pre-seed each bin's count / wins at zero.
    counts = [0] * bin_count
    wins = [0] * bin_count

    for raw, outcome in zip(samples.raw_scores, samples.outcomes):
        idx = min(int(raw / width), bin_count - 1)
        counts[idx] += 1
        wins[idx] += int(outcome)

    out: list[CalibrationBin] = []
    for i in range(bin_count):
        lo = i * width
        hi = (i + 1) * width if i < bin_count - 1 else 1.0
        mid = (lo + hi) / 2
        if counts[i] == 0:
            calibrated = mid
        else:
            calibrated = wins[i] / counts[i]
        out.append(
            CalibrationBin(
                raw_low=round(lo, 6),
                raw_high=round(hi, 6),
                calibrated=round(calibrated, 6),
                count=counts[i],
                wins=wins[i],
            )
        )
    return out


def _clamp01(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


def predict_calibrated(
    raw: float, bins: Sequence[CalibrationBin]
) -> float:
    """Apply a fitted bucket calibrator to a single raw score."""

    if not bins:
        return _clamp01(raw)
    raw = _clamp01(raw)
    for b in bins:
        # Last-bin edge handling: the last bin includes 1.0 inclusive.
        is_last = b is bins[-1]
        if is_last:
            if b.raw_low <= raw <= b.raw_high:
                return _clamp01(b.calibrated)
        else:
            if b.raw_low <= raw < b.raw_high:
                return _clamp01(b.calibrated)
    # Shouldn't get here — but fall through to identity.
    return raw


# ──────────────────────────── Platt calibrator ────────────────────────


def _sigmoid(z: float) -> float:
    # Clamp to prevent overflow.
    if z > 500:
        return 1.0
    if z < -500:
        return 0.0
    return 1.0 / (1.0 + math.exp(z))


def platt_predict(raw: float, a: float, b: float) -> float:
    """Apply a fitted Platt calibrator: ``p = 1 / (1 + exp(a·raw + b))``."""

    return _clamp01(_sigmoid(a * _clamp01(raw) + b))


def fit_platt_calibrator(
    samples: CalibrationSamples,
    *,
    max_iter: int = 200,
    tol: float = 1e-6,
) -> tuple[float, float]:
    """Fit the 2-parameter Platt sigmoid via Newton's method.

    Returns ``(a, b)`` such that ``p = 1 / (1 + exp(a·raw + b))``. Uses
    the Lin et al. (2007) smoothed-target formulation to avoid
    degenerate fits when the sample contains only one class.

    Raises :class:`ValueError` if no samples are provided.
    """

    n = len(samples.raw_scores)
    if n == 0:
        raise ValueError("cannot fit Platt calibrator on empty samples")

    prior1 = sum(samples.outcomes)
    prior0 = n - prior1
    # Smoothed targets (Lin et al.) — avoids perfect 0/1 separation.
    hi_target = (prior1 + 1.0) / (prior1 + 2.0)
    lo_target = 1.0 / (prior0 + 2.0)
    targets = [hi_target if o == 1 else lo_target for o in samples.outcomes]

    a = 0.0
    b = math.log((prior0 + 1.0) / (prior1 + 1.0))

    for _ in range(max_iter):
        # Accumulate gradient + Hessian entries.
        g_a = 0.0
        g_b = 0.0
        h_aa = 1e-12
        h_bb = 1e-12
        h_ab = 0.0
        loss = 0.0
        for raw, t in zip(samples.raw_scores, targets):
            z = a * raw + b
            p = _sigmoid(z)
            # Residual: (p - t)
            err = p - t
            g_a += err * raw
            g_b += err
            w = p * (1.0 - p)
            h_aa += raw * raw * w
            h_bb += w
            h_ab += raw * w
            # Stable log-loss.
            if z >= 0:
                loss += t * z + math.log1p(math.exp(-z)) - t * z + z - z
            # (The loss tracking is diagnostic only — not used for stopping.)

        # Solve the 2×2 Newton system: H · d = -g.
        det = h_aa * h_bb - h_ab * h_ab
        if abs(det) < 1e-20:
            break
        da = (-g_a * h_bb + g_b * h_ab) / det
        db = (g_a * h_ab - g_b * h_aa) / det

        a_new = a + da
        b_new = b + db
        if abs(da) < tol and abs(db) < tol:
            a, b = a_new, b_new
            break
        a, b = a_new, b_new

    return a, b


# ──────────────────────────── error metrics ────────────────────────────


def ece_score(
    samples: CalibrationSamples,
    *,
    bin_count: int = CALIBRATION_BIN_COUNT,
) -> float:
    """Expected Calibration Error over ``bin_count`` equal-width bins.

    Uses the *raw* score as the confidence dimension (the un-calibrated
    input). Lower is better. Returns 0.0 on empty samples.
    """

    if len(samples.raw_scores) == 0:
        return 0.0
    if bin_count < 1:
        raise ValueError("bin_count must be at least 1")

    width = 1.0 / bin_count
    counts = [0] * bin_count
    wins = [0] * bin_count
    raw_sum = [0.0] * bin_count

    for raw, outcome in zip(samples.raw_scores, samples.outcomes):
        idx = min(int(raw / width), bin_count - 1)
        counts[idx] += 1
        wins[idx] += int(outcome)
        raw_sum[idx] += float(raw)

    n = len(samples.raw_scores)
    total = 0.0
    for i in range(bin_count):
        if counts[i] == 0:
            continue
        avg_conf = raw_sum[i] / counts[i]
        win_rate = wins[i] / counts[i]
        total += (counts[i] / n) * abs(avg_conf - win_rate)
    return _clamp01(total)


def brier_score(predicted: Sequence[float], outcomes: Sequence[int]) -> float:
    """Brier score of calibrated predictions against binary outcomes.

    Brier = mean((p - o)^2). Clamped to [0, 1]. Returns 0.0 on empty
    inputs; raises if inputs have mismatched lengths.
    """

    n = len(predicted)
    if n != len(outcomes):
        raise ValueError("predicted / outcomes length mismatch")
    if n == 0:
        return 0.0
    total = 0.0
    for p, o in zip(predicted, outcomes):
        p_c = _clamp01(float(p))
        total += (p_c - float(o)) ** 2
    return _clamp01(total / n)
