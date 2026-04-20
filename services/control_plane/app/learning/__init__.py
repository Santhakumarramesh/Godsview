"""Learning loop + governance — Phase 5 PR8.

The learning module closes the loop on every trade the system sees.
It is organised as five pure cores plus a thin async-DB repo:

  * :mod:`app.learning.calibration` — bucket + Platt calibrators with
    ECE / Brier error metrics. The calibrator turns raw confidence
    scores into probabilities backed by historical win-rate.
  * :mod:`app.learning.regime` — per-``(symbolId, tf)`` regime
    classifier. Emits ``trending`` / ``ranging`` / ``volatile`` /
    ``news_driven`` verdicts on every fresh bar.
  * :mod:`app.learning.data_truth` — feed / latency / broker-heartbeat
    aggregator. Surfaces the green / amber / red roll-up and the
    kill-switch trip condition the live-gate reads.
  * :mod:`app.learning.dna` — builds the ``(regime × session)`` grid
    for every strategy. "Where does this strategy actually work?"
  * :mod:`app.learning.repo` — async SQLAlchemy repo that writes
    events, calibration curves, regime + session snapshots, data-truth
    checks, and DNA cells.

The HTTP surface lives at :mod:`app.routes.learning` and advertises:

  * ``GET  /v1/learning/events``               — append-only event log.
  * ``GET  /v1/learning/calibration``          — active curves.
  * ``POST /v1/learning/calibration/recompute``— admin recompute trigger.
  * ``GET  /v1/learning/regime``               — current regime verdicts.
  * ``GET  /v1/learning/regime/history``       — history for one symbol/tf.
  * ``GET  /v1/learning/sessions``             — per-session rollups.
  * ``GET  /v1/learning/data-truth``           — health + kill-switch.
  * ``POST /v1/learning/data-truth/checks``    — admin write a check.
  * ``GET  /v1/learning/dna``                  — strategy DNA grids.

The module is deliberately split so each pure core is unit-testable
without a DB roundtrip. The repo is the only place that touches the
async session.
"""

from app.learning.calibration import (
    CALIBRATION_BIN_COUNT,
    CalibrationBin,
    CalibrationKindLiteral,
    CalibrationSamples,
    brier_score,
    ece_score,
    fit_bucket_calibrator,
    fit_platt_calibrator,
    platt_predict,
    predict_calibrated,
)
from app.learning.data_truth import (
    DATA_TRUTH_STATUSES,
    DataTruthCheckInput,
    DataTruthStatusLiteral,
    aggregate_data_truth,
    classify_data_truth_status,
    evaluate_kill_switch,
)
from app.learning.dna import (
    DNACellKey,
    build_dna_grid,
    select_best_cell,
    select_worst_cell,
)
from app.learning.regime import (
    REGIME_KINDS,
    RegimeFeatures,
    RegimeKindLiteral,
    classify_regime,
    regime_confidence,
)

__all__ = [
    "CALIBRATION_BIN_COUNT",
    "CalibrationBin",
    "CalibrationKindLiteral",
    "CalibrationSamples",
    "DATA_TRUTH_STATUSES",
    "DNACellKey",
    "DataTruthCheckInput",
    "DataTruthStatusLiteral",
    "REGIME_KINDS",
    "RegimeFeatures",
    "RegimeKindLiteral",
    "aggregate_data_truth",
    "brier_score",
    "build_dna_grid",
    "classify_data_truth_status",
    "classify_regime",
    "ece_score",
    "evaluate_kill_switch",
    "fit_bucket_calibrator",
    "fit_platt_calibrator",
    "platt_predict",
    "predict_calibrated",
    "regime_confidence",
    "select_best_cell",
    "select_worst_cell",
]
