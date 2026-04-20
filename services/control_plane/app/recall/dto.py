"""Recall wire DTOs — Pydantic v2 mirror of ``packages/types/src/recall.ts``.

The wire contract is camelCase; ORM-internal attributes are
snake_case. Every DTO uses ``ConfigDict(populate_by_name=True,
from_attributes=True)`` so routes can build responses directly from
ORM rows without a manual mapper.

Layout parity rules
-------------------

* ``RecallFeaturesDto`` must stay in lockstep with
  :class:`app.recall.features.RecallFeatures` and the TS
  ``RecallFeaturesSchema`` — the structured projection.
* ``RecallTradeDto.features`` and ``RecallTradeDto.vector`` are always
  both emitted. ``vector`` has exactly ``RECALL_FEATURE_DIMS`` entries
  so the contract-validation workflow can assert on the length.
* ``RecallSearchRequestDto`` is a discriminated union on ``kind`` —
  the three variants mirror ``RecallSearchByIdSchema``,
  ``RecallSearchByTradeSchema`` and ``RecallSearchByFeaturesSchema``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

from app.recall.features import RECALL_FEATURE_DIMS


__all__ = [
    "AnnotationDto",
    "MissedTradeDto",
    "MissedTradesListOut",
    "RecallFeaturesDto",
    "RecallMatchDto",
    "RecallSearchByFeaturesRequestDto",
    "RecallSearchByIdRequestDto",
    "RecallSearchByTradeRequestDto",
    "RecallSearchRequestDto",
    "RecallSearchResultDto",
    "RecallScreenshotCreateRequestDto",
    "RecallScreenshotDto",
    "RecallScreenshotsListOut",
    "RecallSearchSummaryDto",
    "RecallTradeDto",
    "RecallTradesListOut",
]


# ──────────────────────────── base config ──────────────────────────────


class _CamelBase(BaseModel):
    """Pydantic v2 base — camelCase on the wire, attribute read support.

    ``populate_by_name=True`` means the same DTO is accepted with either
    snake_case or camelCase on input (handy for Python callers) but
    always serialises as camelCase.
    """

    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


# ──────────────────────────── features ────────────────────────────────


class RecallFeaturesDto(_CamelBase):
    """Structured projection of the recall feature vector."""

    symbol_id: str = Field(..., alias="symbolId")
    tf: str
    direction: str
    setup_type: str = Field(..., alias="setupType")
    trend_sign: int = Field(..., alias="trendSign", ge=-1, le=1)
    bos_flag: int = Field(..., alias="bosFlag", ge=0, le=1)
    choch_flag: int = Field(..., alias="chochFlag", ge=0, le=1)
    sweep_flag: int = Field(..., alias="sweepFlag", ge=0, le=1)
    volatility_bucket: float = Field(..., alias="volatilityBucket", ge=0.0, le=1.0)
    session: str
    order_flow_sign: int = Field(..., alias="orderFlowSign", ge=-1, le=1)
    regime: str
    confidence_at_detection: float = Field(
        ..., alias="confidenceAtDetection", ge=0.0, le=1.0
    )


# ──────────────────────────── trade memory ────────────────────────────


RecallOutcomeLiteral = Literal["win", "loss", "scratch", "open"]


class RecallTradeDto(_CamelBase):
    """Single recall-trade memory row — mirrors ``RecallTradeSchema``.

    ``vector`` is always the full ``RECALL_FEATURE_DIMS``-length list so
    the contract check can assert on the envelope. ``paperTradeId`` and
    ``liveTradeId`` are both nullable because the row is the superset of
    all trade origins (backtest, paper, live).
    """

    id: str
    setup_id: str = Field(..., alias="setupId")
    paper_trade_id: str | None = Field(default=None, alias="paperTradeId")
    live_trade_id: str | None = Field(default=None, alias="liveTradeId")
    symbol_id: str = Field(..., alias="symbolId")
    tf: str
    setup_type: str = Field(..., alias="setupType")
    direction: str
    detected_at: datetime = Field(..., alias="detectedAt")
    closed_at: datetime | None = Field(default=None, alias="closedAt")
    features: RecallFeaturesDto
    vector: list[float] = Field(
        ...,
        min_length=RECALL_FEATURE_DIMS,
        max_length=RECALL_FEATURE_DIMS,
    )
    outcome: RecallOutcomeLiteral
    pnl_r: float | None = Field(default=None, alias="pnlR")
    reasoning: str = ""


class RecallTradesListOut(_CamelBase):
    trades: list[RecallTradeDto]
    total: int


# ──────────────────────────── screenshots ─────────────────────────────


AnnotationKindLiteral = Literal["arrow", "note", "zone", "level"]


class AnnotationDto(_CamelBase):
    kind: AnnotationKindLiteral
    text: str = ""
    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)
    w: float = Field(default=0.0, ge=0.0, le=1.0)
    h: float = Field(default=0.0, ge=0.0, le=1.0)


class RecallScreenshotDto(_CamelBase):
    id: str
    setup_id: str | None = Field(default=None, alias="setupId")
    live_trade_id: str | None = Field(default=None, alias="liveTradeId")
    paper_trade_id: str | None = Field(default=None, alias="paperTradeId")
    symbol_id: str = Field(..., alias="symbolId")
    tf: str
    storage_key: str = Field(..., alias="storageKey")
    url: str | None = None
    mime_type: str = Field(default="image/png", alias="mimeType")
    width_px: int = Field(..., alias="widthPx", gt=0)
    height_px: int = Field(..., alias="heightPx", gt=0)
    annotations: list[AnnotationDto] = Field(default_factory=list)
    captured_at: datetime = Field(..., alias="capturedAt")
    captured_by_user_id: str = Field(..., alias="capturedByUserId")


class RecallScreenshotCreateRequestDto(_CamelBase):
    setup_id: str | None = Field(default=None, alias="setupId")
    live_trade_id: str | None = Field(default=None, alias="liveTradeId")
    paper_trade_id: str | None = Field(default=None, alias="paperTradeId")
    symbol_id: str = Field(..., alias="symbolId")
    tf: str
    storage_key: str = Field(..., alias="storageKey")
    mime_type: str = Field(default="image/png", alias="mimeType")
    width_px: int = Field(..., alias="widthPx", gt=0)
    height_px: int = Field(..., alias="heightPx", gt=0)
    annotations: list[AnnotationDto] = Field(default_factory=list)


class RecallScreenshotsListOut(_CamelBase):
    screenshots: list[RecallScreenshotDto]
    total: int


# ──────────────────────────── missed trades ───────────────────────────


MissedReasonLiteral = Literal[
    "below_confidence",
    "gate_rejected",
    "risk_capped",
    "operator_skipped",
    "data_quality",
    "duplicate",
    "expired",
    "other",
]


class MissedTradeDto(_CamelBase):
    id: str
    setup_id: str = Field(..., alias="setupId")
    symbol_id: str = Field(..., alias="symbolId")
    tf: str
    setup_type: str = Field(..., alias="setupType")
    direction: str
    reason: MissedReasonLiteral
    reason_detail: str = Field(default="", alias="reasonDetail")
    detected_at: datetime = Field(..., alias="detectedAt")
    hypothetical_r: float | None = Field(default=None, alias="hypotheticalR")
    evaluated_through: datetime | None = Field(
        default=None, alias="evaluatedThrough"
    )
    features: RecallFeaturesDto


class MissedTradesListOut(_CamelBase):
    trades: list[MissedTradeDto]
    total: int
    window_mean_r: float | None = Field(default=None, alias="windowMeanR")


# ──────────────────────────── similarity search ────────────────────────


class RecallSearchByIdRequestDto(_CamelBase):
    kind: Literal["by_setup"] = "by_setup"
    setup_id: str = Field(..., alias="setupId", min_length=1)
    k: int = Field(default=20, ge=1, le=100)
    min_similarity: float = Field(default=0.3, alias="minSimilarity", ge=0.0, le=1.0)


class RecallSearchByTradeRequestDto(_CamelBase):
    kind: Literal["by_live_trade"] = "by_live_trade"
    live_trade_id: str = Field(..., alias="liveTradeId", min_length=1)
    k: int = Field(default=20, ge=1, le=100)
    min_similarity: float = Field(default=0.3, alias="minSimilarity", ge=0.0, le=1.0)


class RecallSearchByFeaturesRequestDto(_CamelBase):
    kind: Literal["by_features"] = "by_features"
    features: RecallFeaturesDto
    k: int = Field(default=20, ge=1, le=100)
    min_similarity: float = Field(default=0.3, alias="minSimilarity", ge=0.0, le=1.0)


# Discriminated union — FastAPI + Pydantic v2 resolve this against
# ``kind`` at parse time, so the route hands a typed object to helpers.
RecallSearchRequestDto = Union[
    RecallSearchByIdRequestDto,
    RecallSearchByTradeRequestDto,
    RecallSearchByFeaturesRequestDto,
]


class RecallMatchDto(_CamelBase):
    recall_trade_id: str = Field(..., alias="recallTradeId")
    setup_id: str = Field(..., alias="setupId")
    similarity: float = Field(..., ge=0.0, le=1.0)
    outcome: RecallOutcomeLiteral
    pnl_r: float | None = Field(default=None, alias="pnlR")
    symbol_id: str = Field(..., alias="symbolId")
    tf: str
    setup_type: str = Field(..., alias="setupType")
    direction: str
    detected_at: datetime = Field(..., alias="detectedAt")


class RecallSearchSummaryDto(_CamelBase):
    count: int = Field(..., ge=0)
    win_rate: float | None = Field(default=None, alias="winRate")
    mean_pnl_r: float | None = Field(default=None, alias="meanPnlR")
    best_outcome: RecallOutcomeLiteral | None = Field(default=None, alias="bestOutcome")
    worst_outcome: RecallOutcomeLiteral | None = Field(
        default=None, alias="worstOutcome"
    )


class RecallSearchResultDto(_CamelBase):
    matches: list[RecallMatchDto]
    summary: RecallSearchSummaryDto
    generated_at: datetime = Field(..., alias="generatedAt")
