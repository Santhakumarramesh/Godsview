"""
GodsView — Confidence Calibration Engine

Tracks prediction accuracy over time and adjusts confidence scores
so that "80% confidence" actually means ~80% win rate.

Features:
  - Bucket-based accuracy tracking (0–10%, 10–20%, ..., 90–100%)
  - Brier score computation
  - Calibration curve with adjustment factors
  - Rolling window to adapt to regime changes
  - Per-strategy and per-regime calibration
"""
from __future__ import annotations

import time
import math
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("godsview.confidence_calibrator")


# ── Data Models ──────────────────────────────────────────────────────────────

@dataclass
class CalibrationBucket:
    """Stats for a single confidence bucket (e.g. 70-80%)."""
    bucket_low: float
    bucket_high: float
    predictions: int = 0
    correct: int = 0
    sum_confidence: float = 0.0
    sum_sq_error: float = 0.0  # for Brier score

    @property
    def accuracy(self) -> float:
        return self.correct / self.predictions if self.predictions > 0 else 0.0

    @property
    def avg_confidence(self) -> float:
        return self.sum_confidence / self.predictions if self.predictions > 0 else 0.0

    @property
    def calibration_error(self) -> float:
        """Difference between avg confidence and actual accuracy."""
        return self.avg_confidence - self.accuracy

    @property
    def adjustment_factor(self) -> float:
        """
        Multiplier to apply to raw confidence.
        If we predict 80% but only win 60%, factor = 0.75 (60/80).
        """
        if self.predictions < 10 or self.avg_confidence <= 0:
            return 1.0  # not enough data, don't adjust
        return self.accuracy / self.avg_confidence

    @property
    def brier_score(self) -> float:
        """Lower is better. Perfect = 0, worst = 1."""
        return self.sum_sq_error / self.predictions if self.predictions > 0 else 1.0


@dataclass
class CalibrationReport:
    """Full calibration report across all buckets."""
    total_predictions: int = 0
    total_correct: int = 0
    overall_accuracy: float = 0.0
    overall_brier: float = 0.0
    mean_calibration_error: float = 0.0  # avg |predicted - actual| per bucket
    max_calibration_error: float = 0.0
    buckets: list[dict] = field(default_factory=list)
    calibration_quality: str = "unknown"  # "excellent", "good", "fair", "poor"


@dataclass
class PredictionRecord:
    """A single prediction with its outcome."""
    timestamp: float
    raw_confidence: float
    calibrated_confidence: float
    outcome: bool  # True = correct prediction
    strategy: str = ""
    regime: str = ""
    context: str = ""


# ── Calibration Engine ───────────────────────────────────────────────────────

NUM_BUCKETS = 10


class ConfidenceCalibrator:
    """Tracks and adjusts prediction confidence based on historical accuracy."""

    def __init__(self, window_size: int = 500) -> None:
        self._window_size = window_size
        # key → list of CalibrationBucket (10 buckets)
        self._buckets: dict[str, list[CalibrationBucket]] = {}
        # key → rolling list of PredictionRecord
        self._history: dict[str, list[PredictionRecord]] = {}

    def _get_buckets(self, key: str = "global") -> list[CalibrationBucket]:
        if key not in self._buckets:
            self._buckets[key] = [
                CalibrationBucket(
                    bucket_low=i / NUM_BUCKETS,
                    bucket_high=(i + 1) / NUM_BUCKETS,
                )
                for i in range(NUM_BUCKETS)
            ]
        return self._buckets[key]

    @staticmethod
    def _bucket_index(confidence: float) -> int:
        idx = int(confidence * NUM_BUCKETS)
        return max(0, min(NUM_BUCKETS - 1, idx))

    def calibrate(
        self,
        raw_confidence: float,
        strategy: str = "",
        regime: str = "",
    ) -> float:
        """
        Adjust a raw confidence score based on historical calibration.

        Returns calibrated confidence (0–1).
        """
        raw = max(0.0, min(1.0, raw_confidence))
        idx = self._bucket_index(raw)

        # Try strategy-specific calibration first
        if strategy:
            key = f"strategy:{strategy}"
            buckets = self._buckets.get(key)
            if buckets and buckets[idx].predictions >= 10:
                factor = buckets[idx].adjustment_factor
                calibrated = raw * factor
                return max(0.0, min(1.0, round(calibrated, 4)))

        # Try regime-specific
        if regime:
            key = f"regime:{regime}"
            buckets = self._buckets.get(key)
            if buckets and buckets[idx].predictions >= 10:
                factor = buckets[idx].adjustment_factor
                calibrated = raw * factor
                return max(0.0, min(1.0, round(calibrated, 4)))

        # Fall back to global
        buckets = self._buckets.get("global")
        if buckets and buckets[idx].predictions >= 10:
            factor = buckets[idx].adjustment_factor
            calibrated = raw * factor
            return max(0.0, min(1.0, round(calibrated, 4)))

        return raw  # no adjustment if insufficient data

    def record_outcome(
        self,
        raw_confidence: float,
        outcome: bool,
        strategy: str = "",
        regime: str = "",
        context: str = "",
    ) -> None:
        """Record whether a prediction at the given confidence was correct."""
        raw = max(0.0, min(1.0, raw_confidence))
        idx = self._bucket_index(raw)
        calibrated = self.calibrate(raw, strategy, regime)

        # Update all relevant bucket sets
        keys = ["global"]
        if strategy:
            keys.append(f"strategy:{strategy}")
        if regime:
            keys.append(f"regime:{regime}")

        for key in keys:
            buckets = self._get_buckets(key)
            b = buckets[idx]
            b.predictions += 1
            b.sum_confidence += raw
            sq_err = (raw - (1.0 if outcome else 0.0)) ** 2
            b.sum_sq_error += sq_err
            if outcome:
                b.correct += 1

        # Record in history
        record = PredictionRecord(
            timestamp=time.time(),
            raw_confidence=raw,
            calibrated_confidence=calibrated,
            outcome=outcome,
            strategy=strategy,
            regime=regime,
            context=context,
        )
        for key in keys:
            hist = self._history.setdefault(key, [])
            hist.append(record)
            if len(hist) > self._window_size:
                # Remove oldest and recompute buckets
                self._recompute_from_history(key)

        logger.debug(
            "calibration_record conf=%.2f outcome=%s strategy=%s regime=%s",
            raw, outcome, strategy, regime,
        )

    def _recompute_from_history(self, key: str) -> None:
        """Recompute buckets from rolling window of history."""
        hist = self._history.get(key, [])
        if len(hist) > self._window_size:
            hist[:] = hist[-self._window_size:]

        # Reset buckets
        buckets = [
            CalibrationBucket(
                bucket_low=i / NUM_BUCKETS,
                bucket_high=(i + 1) / NUM_BUCKETS,
            )
            for i in range(NUM_BUCKETS)
        ]

        for rec in hist:
            idx = self._bucket_index(rec.raw_confidence)
            b = buckets[idx]
            b.predictions += 1
            b.sum_confidence += rec.raw_confidence
            sq_err = (rec.raw_confidence - (1.0 if rec.outcome else 0.0)) ** 2
            b.sum_sq_error += sq_err
            if rec.outcome:
                b.correct += 1

        self._buckets[key] = buckets

    def get_report(self, key: str = "global") -> CalibrationReport:
        """Generate a calibration report for a given key."""
        buckets = self._buckets.get(key, self._get_buckets(key))

        total_pred = sum(b.predictions for b in buckets)
        total_correct = sum(b.correct for b in buckets)
        total_sq_error = sum(b.sum_sq_error for b in buckets)

        bucket_reports: list[dict] = []
        cal_errors: list[float] = []

        for b in buckets:
            report = {
                "range": f"{b.bucket_low:.0%}–{b.bucket_high:.0%}",
                "predictions": b.predictions,
                "correct": b.correct,
                "accuracy": round(b.accuracy, 4),
                "avg_confidence": round(b.avg_confidence, 4),
                "calibration_error": round(b.calibration_error, 4),
                "adjustment_factor": round(b.adjustment_factor, 4),
                "brier_score": round(b.brier_score, 4),
            }
            bucket_reports.append(report)
            if b.predictions >= 5:
                cal_errors.append(abs(b.calibration_error))

        mean_cal_err = sum(cal_errors) / len(cal_errors) if cal_errors else 0.0
        max_cal_err = max(cal_errors) if cal_errors else 0.0

        # Quality assessment
        if mean_cal_err < 0.05:
            quality = "excellent"
        elif mean_cal_err < 0.10:
            quality = "good"
        elif mean_cal_err < 0.20:
            quality = "fair"
        else:
            quality = "poor"

        return CalibrationReport(
            total_predictions=total_pred,
            total_correct=total_correct,
            overall_accuracy=round(total_correct / total_pred, 4) if total_pred > 0 else 0.0,
            overall_brier=round(total_sq_error / total_pred, 4) if total_pred > 0 else 1.0,
            mean_calibration_error=round(mean_cal_err, 4),
            max_calibration_error=round(max_cal_err, 4),
            buckets=bucket_reports,
            calibration_quality=quality,
        )

    def get_calibration_curve(self, key: str = "global") -> list[tuple[float, float]]:
        """
        Return (predicted, actual) pairs for plotting a calibration curve.
        Perfect calibration = diagonal line.
        """
        buckets = self._buckets.get(key, [])
        curve: list[tuple[float, float]] = []
        for b in buckets:
            if b.predictions >= 5:
                curve.append((round(b.avg_confidence, 4), round(b.accuracy, 4)))
        return curve

    def get_all_keys(self) -> list[str]:
        """List all calibration keys (global, strategy:X, regime:Y)."""
        return list(self._buckets.keys())
