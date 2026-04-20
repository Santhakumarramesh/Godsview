"""Learning wire DTOs — Pydantic v2 mirror of ``packages/types/src/learning.ts``.

Wire contract: camelCase JSON over the wire, attribute access from
ORM rows. Every DTO uses ``ConfigDict(populate_by_name=True,
from_attributes=True)`` so the routes can build responses directly
from SQLAlchemy rows.

Layout parity rules
-------------------

* ``LearningEventDto`` mirrors ``LearningEventSchema``. The ORM table
  has a superset of columns (``symbol_id``, ``setup_id``) that are
  projected into ``payload`` by the repo mapper — the wire contract
  stays TS-schema-clean.
* ``ConfidenceCalibrationDto.bins`` is always the full 10-bin list.
  Platt fits return an empty ``bins`` + populated ``plattA / plattB``.
* ``DataTruthStatusOutDto.status`` is the worst-of the contained
  checks; the killSwitch* fields are computed by the aggregator.
* ``StrategyDNADto.cells`` is the full 20-entry grid (4 regimes × 5
  sessions) even when the strategy only has trades in a handful of
  cells.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


__all__ = [
    "CalibrationBinDto",
    "CalibrationKindLiteral",
    "CalibrationCurvesOut",
    "CalibrationRecomputeRequestDto",
    "CalibrationRecomputeResponseDto",
    "ConfidenceCalibrationDto",
    "DataTruthCheckCreateRequestDto",
    "DataTruthCheckDto",
    "DataTruthCheckKindLiteral",
    "DataTruthStatusLiteral",
    "DataTruthStatusOutDto",
    "DNACellDto",
    "LearningEventDto",
    "LearningEventKindLiteral",
    "LearningEventSubjectLiteral",
    "LearningEventsListOut",
    "RegimeCurrentOutDto",
    "RegimeHistoryOutDto",
    "RegimeKindLiteral",
    "RegimeSnapshotDto",
    "SessionIntelOutDto",
    "SessionSnapshotDto",
    "StrategyDNADto",
    "StrategyDNAListOutDto",
    "TradingSessionLiteral",
]


# ──────────────────────────── base config ──────────────────────────────


class _CamelBase(BaseModel):
    """Pydantic v2 base — camelCase on the wire, attribute read support."""

    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


# ──────────────────────────── literals ────────────────────────────────


LearningEventKindLiteral = Literal[
    "setup_detected",
    "setup_approved",
    "setup_rejected",
    "trade_opened",
    "trade_closed_win",
    "trade_closed_loss",
    "trade_closed_scratch",
    "backtest_completed",
    "calibration_updated",
    "regime_flipped",
    "data_truth_breach",
    "promotion_auto_demote",
    "promotion_manual",
]

LearningEventSubjectLiteral = Literal[
    "setup",
    "paper_trade",
    "live_trade",
    "backtest",
    "strategy",
    "calibration",
    "regime",
    "data_truth",
]

CalibrationKindLiteral = Literal["bucket", "platt"]

RegimeKindLiteral = Literal[
    "trending",
    "ranging",
    "volatile",
    "news_driven",
]

TradingSessionLiteral = Literal[
    "asia",
    "london",
    "ny_am",
    "ny_pm",
    "off_hours",
]

DataTruthStatusLiteral = Literal["green", "amber", "red"]

DataTruthCheckKindLiteral = Literal[
    "bar_latency",
    "bar_gap",
    "book_staleness",
    "feed_desync",
    "symbol_missing",
    "broker_heartbeat",
]

StrategyTierLiteral = Literal["A", "B", "C"]


# ──────────────────────────── learning events ────────────────────────


class LearningEventDto(_CamelBase):
    """One row from the learning event bus.

    ``payload`` carries the kind-specific delta — e.g. a
    ``trade_closed_win`` event will have ``payload.pnlR``, while a
    ``calibration_updated`` event will have ``payload.scope``. The
    structure is intentionally loose; consumers discriminate on
    ``kind``.
    """

    id: str
    kind: LearningEventKindLiteral
    subject_id: str = Field(..., alias="subjectId")
    subject_kind: LearningEventSubjectLiteral = Field(..., alias="subjectKind")
    strategy_id: str | None = Field(default=None, alias="strategyId")
    payload: dict[str, Any] = Field(default_factory=dict)
    correlation_id: str | None = Field(default=None, alias="correlationId")
    occurred_at: datetime = Field(..., alias="occurredAt")
    ingested_at: datetime = Field(..., alias="ingestedAt")


class LearningEventsListOut(_CamelBase):
    events: list[LearningEventDto]
    total: int


# ──────────────────────────── calibration ─────────────────────────────


class CalibrationBinDto(_CamelBase):
    raw_low: float = Field(..., alias="rawLow", ge=0.0, le=1.0)
    raw_high: float = Field(..., alias="rawHigh", ge=0.0, le=1.0)
    calibrated: float = Field(..., ge=0.0, le=1.0)
    count: int = Field(..., ge=0)
    wins: int = Field(..., ge=0)


class ConfidenceCalibrationDto(_CamelBase):
    id: str
    strategy_id: str | None = Field(default=None, alias="strategyId")
    setup_type: str | None = Field(default=None, alias="setupType")
    tf: str | None = None
    kind: CalibrationKindLiteral
    bins: list[CalibrationBinDto] = Field(default_factory=list)
    platt_a: float | None = Field(default=None, alias="plattA")
    platt_b: float | None = Field(default=None, alias="plattB")
    ece: float = Field(..., ge=0.0, le=1.0)
    brier: float = Field(..., ge=0.0, le=1.0)
    sample_size: int = Field(..., alias="sampleSize", ge=0)
    generated_at: datetime = Field(..., alias="generatedAt")


class CalibrationCurvesOut(_CamelBase):
    curves: list[ConfidenceCalibrationDto]
    generated_at: datetime = Field(..., alias="generatedAt")


class CalibrationRecomputeRequestDto(_CamelBase):
    """Admin-triggered recompute scope.

    All fields are optional — omitting every scope field recomputes
    the **global** curve (strategyId = setupType = tf = null).
    """

    strategy_id: str | None = Field(default=None, alias="strategyId")
    setup_type: str | None = Field(default=None, alias="setupType")
    tf: str | None = None
    kind: CalibrationKindLiteral = "bucket"


class CalibrationRecomputeResponseDto(_CamelBase):
    curve: ConfidenceCalibrationDto
    sample_size: int = Field(..., alias="sampleSize", ge=0)
    stored: bool


# ──────────────────────────── regime ──────────────────────────────────


class RegimeSnapshotDto(_CamelBase):
    id: str
    symbol_id: str = Field(..., alias="symbolId")
    tf: str
    kind: RegimeKindLiteral
    confidence: float = Field(..., ge=0.0, le=1.0)
    trend_strength: float = Field(..., alias="trendStrength", ge=-1.0, le=1.0)
    volatility: float = Field(..., ge=0.0, le=1.0)
    bar_age_ms: int = Field(..., alias="barAgeMs", ge=0)
    observed_at: datetime = Field(..., alias="observedAt")
    notes: str = ""


class RegimeCurrentOutDto(_CamelBase):
    snapshots: list[RegimeSnapshotDto]
    generated_at: datetime = Field(..., alias="generatedAt")


class RegimeHistoryOutDto(_CamelBase):
    symbol_id: str = Field(..., alias="symbolId")
    tf: str
    snapshots: list[RegimeSnapshotDto]


# ──────────────────────────── session ──────────────────────────────────


class SessionSnapshotDto(_CamelBase):
    id: str
    symbol_id: str = Field(..., alias="symbolId")
    session: TradingSessionLiteral
    volatility: float = Field(..., ge=0.0, le=1.0)
    win_rate: float | None = Field(default=None, alias="winRate")
    mean_r: float | None = Field(default=None, alias="meanR")
    sample_size: int = Field(..., alias="sampleSize", ge=0)
    observed_at: datetime = Field(..., alias="observedAt")


class SessionIntelOutDto(_CamelBase):
    snapshots: list[SessionSnapshotDto]
    generated_at: datetime = Field(..., alias="generatedAt")


# ──────────────────────────── data truth ──────────────────────────────


class DataTruthCheckDto(_CamelBase):
    id: str
    kind: DataTruthCheckKindLiteral
    status: DataTruthStatusLiteral
    message: str = ""
    measurement: float
    amber_threshold: float = Field(..., alias="amberThreshold")
    red_threshold: float = Field(..., alias="redThreshold")
    symbol_id: str | None = Field(default=None, alias="symbolId")
    observed_at: datetime = Field(..., alias="observedAt")


class DataTruthCheckCreateRequestDto(_CamelBase):
    kind: DataTruthCheckKindLiteral
    measurement: float
    amber_threshold: float = Field(..., alias="amberThreshold")
    red_threshold: float = Field(..., alias="redThreshold")
    message: str = ""
    symbol_id: str | None = Field(default=None, alias="symbolId")


class DataTruthStatusOutDto(_CamelBase):
    status: DataTruthStatusLiteral
    checks: list[DataTruthCheckDto]
    kill_switch_tripped: bool = Field(..., alias="killSwitchTripped")
    kill_switch_reason: str | None = Field(default=None, alias="killSwitchReason")
    generated_at: datetime = Field(..., alias="generatedAt")


# ──────────────────────────── strategy DNA ────────────────────────────


class DNACellDto(_CamelBase):
    regime: RegimeKindLiteral
    session: TradingSessionLiteral
    win_rate: float | None = Field(default=None, alias="winRate")
    mean_r: float | None = Field(default=None, alias="meanR")
    sample_size: int = Field(..., alias="sampleSize", ge=0)


class StrategyDNADto(_CamelBase):
    id: str
    strategy_id: str = Field(..., alias="strategyId")
    cells: list[DNACellDto]
    best_cell: DNACellDto | None = Field(default=None, alias="bestCell")
    worst_cell: DNACellDto | None = Field(default=None, alias="worstCell")
    tier_at_generation: StrategyTierLiteral = Field(
        default="C", alias="tierAtGeneration"
    )
    total_trades: int = Field(..., alias="totalTrades", ge=0)
    generated_at: datetime = Field(..., alias="generatedAt")


class StrategyDNAListOutDto(_CamelBase):
    dna: list[StrategyDNADto]
    generated_at: datetime = Field(..., alias="generatedAt")
