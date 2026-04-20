"""Pydantic v2 DTOs for the quant-lab replay surface.

Mirror of the Zod schemas in ``packages/types/src/quant-lab.ts``:

  * ``QuantReplayFrame``     — one decision envelope per frame.
  * ``ReplayStatus``         — queued | streaming | completed | failed | cancelled.
  * ``ReplayRunRequest``     — payload for ``POST /v1/quant/replay``.
  * ``ReplayRun``            — the replay cursor row.
  * ``QuantReplayFramesOut`` — paginated frame list.
  * ``ReplayRunsListOut``    — paginated replay run list.

The replay engine purposely keeps a *separate* DTO namespace from the
Phase 4 ``app.execution.replay`` tick-level cursor so the two shapes
don't collide at the type layer. The SQL side picked ``ReplayFrameRow``
for the same reason.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.quant_lab.types import DirectionLiteral, TimeframeLiteral


# ───────────────────────────── enums ─────────────────────────────────────

ReplayStatusLiteral = Literal[
    "queued", "streaming", "completed", "failed", "cancelled"
]

DecisionActionLiteral = Literal["none", "enter_long", "enter_short", "exit"]

StructureTrendLiteral = Literal["bullish", "bearish", "neutral"]

LiquidityEventLiteral = Literal["sweep_high", "sweep_low", "none"]

ImbalanceLiteral = Literal["buy", "sell", "balanced"]


# ───────────────────────────── base ──────────────────────────────────────


class _CamelBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


# ───────────────────────────── frame envelope ────────────────────────────


class ReplayBarDto(_CamelBase):
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


class ReplayStructureDto(_CamelBase):
    trend: StructureTrendLiteral = "neutral"
    bos: bool = False
    choch: bool = False
    liquidityEvent: LiquidityEventLiteral = "none"


class ReplayOrderFlowDto(_CamelBase):
    delta: float = 0.0
    imbalance: ImbalanceLiteral = "balanced"
    absorption: bool = False


class ReplayDecisionDto(_CamelBase):
    action: DecisionActionLiteral = "none"
    setupId: str | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    reasoning: str = ""


class QuantReplayFrameDto(_CamelBase):
    id: str
    replayRunId: str
    ts: datetime
    symbolId: str
    tf: TimeframeLiteral
    bar: ReplayBarDto
    structure: ReplayStructureDto
    orderFlow: ReplayOrderFlowDto
    decision: ReplayDecisionDto
    hypotheticalPnLR: float | None = None


# ───────────────────────────── run envelope ──────────────────────────────


class ReplayRunRequestDto(_CamelBase):
    """Payload for ``POST /v1/quant/replay``.

    Either ``setupId`` (centre a replay on a persisted setup) **or**
    ``symbolId`` (ad-hoc window) must be supplied. The route layer
    enforces the either-or invariant.
    """

    setupId: str | None = None
    symbolId: str | None = None
    startAt: datetime
    endAt: datetime
    tf: TimeframeLiteral
    stepMs: int = Field(default=0, ge=0, le=60_000)
    withLiveGate: bool = False


class ReplayRunDto(_CamelBase):
    id: str
    request: ReplayRunRequestDto
    status: ReplayStatusLiteral
    totalFrames: int
    error: str | None = None
    createdAt: datetime
    completedAt: datetime | None = None
    createdByUserId: str | None = None


class ReplayRunsListOut(_CamelBase):
    runs: list[ReplayRunDto]
    total: int


class QuantReplayFramesOut(_CamelBase):
    replayRunId: str
    frames: list[QuantReplayFrameDto]
    total: int


__all__ = [
    "DecisionActionLiteral",
    "ImbalanceLiteral",
    "LiquidityEventLiteral",
    "QuantReplayFrameDto",
    "QuantReplayFramesOut",
    "ReplayBarDto",
    "ReplayDecisionDto",
    "ReplayOrderFlowDto",
    "ReplayRunDto",
    "ReplayRunRequestDto",
    "ReplayRunsListOut",
    "ReplayStatusLiteral",
    "ReplayStructureDto",
    "StructureTrendLiteral",
]
