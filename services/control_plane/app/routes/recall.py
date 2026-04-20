"""Recall engine HTTP surface — Phase 5 PR7.

Wire contract (all responses camelCase JSON, all inputs accept either
snake_case or camelCase):

  * ``POST /v1/recall/search``          — similarity search (by setup,
                                          by live trade, or by raw
                                          feature envelope).
  * ``GET  /v1/recall/trades``          — paginated trade memory.
  * ``GET  /v1/recall/trades/{id}``     — single trade detail.
  * ``GET  /v1/recall/screenshots``     — paginated screenshot memory.
  * ``GET  /v1/recall/screenshots/{id}``— single screenshot detail.
  * ``POST /v1/recall/screenshots``     — admin; attach new screenshot.
  * ``GET  /v1/recall/missed``          — missed-trade log with
                                          window-mean hypothetical R.

Every mutation goes through :func:`app.audit.log_event` with
``resource_type="recall.screenshot"`` so the audit stream carries the
who/what/when of every manual memory action. Reads are un-logged (the
recall page opens a lot of these and polluting audit-tail would be
noisy).

Similarity search is deterministic: given identical inputs + identical
DB rows the ordering is stable. The route sorts by descending
similarity with strategy_id as a tie-breaker so two rows that scored
identically always fall out the same way.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query, Request, status
from pydantic import BaseModel, ValidationError

from app.audit import log_event
from app.db import DbSession
from app.deps import AdminUser, CurrentUser
from app.errors import ApiError
from app.recall import dto as recall_dto
from app.recall.dto import (
    MissedTradesListOut,
    RecallScreenshotCreateRequestDto,
    RecallScreenshotDto,
    RecallScreenshotsListOut,
    RecallSearchByFeaturesRequestDto,
    RecallSearchByIdRequestDto,
    RecallSearchByTradeRequestDto,
    RecallSearchResultDto,
    RecallTradeDto,
    RecallTradesListOut,
)
from app.recall.features import (
    RecallFeatures,
    pack_features,
)
from app.recall.repo import (
    get_recall_trade_by_id,
    get_screenshot_by_id,
    list_missed_trades,
    list_recall_screenshots,
    list_recall_trades,
    match_to_dto,
    search_recall_by_features,
    search_recall_by_setup_id,
    search_recall_by_trade_id,
    summarise_matches,
    attach_screenshot as repo_attach_screenshot,
    _trade_to_dto,  # type: ignore[attr-defined]  # re-used by GET endpoints
    _screenshot_to_dto,  # type: ignore[attr-defined]
)


UTC = timezone.utc

router = APIRouter(prefix="/recall", tags=["recall"])


_VALID_SEARCH_KINDS = frozenset({"by_setup", "by_live_trade", "by_features"})
_VALID_OUTCOMES = frozenset({"win", "loss", "scratch", "open"})
_VALID_REASONS = frozenset(
    {
        "below_confidence",
        "gate_rejected",
        "risk_capped",
        "operator_skipped",
        "data_quality",
        "duplicate",
        "expired",
        "other",
    }
)


def _now_utc() -> datetime:
    return datetime.now(UTC)


# ─────────────────────────── trade memory ──────────────────────────────


@router.get(
    "/trades",
    response_model=RecallTradesListOut,
    summary="List recall trade memory",
)
async def list_trades(
    db: DbSession,
    user: CurrentUser,
    symbol_id: str | None = Query(default=None, alias="symbolId"),
    setup_type: str | None = Query(default=None, alias="setupType"),
    direction: str | None = Query(default=None),
    outcome: str | None = Query(default=None),
    cursor: datetime | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> RecallTradesListOut:
    if outcome is not None and outcome not in _VALID_OUTCOMES:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_outcome",
            message=f"outcome must be one of {sorted(_VALID_OUTCOMES)}",
        )
    return await list_recall_trades(
        db,
        symbol_id=symbol_id,
        setup_type=setup_type,
        direction=direction,
        outcome=outcome,
        cursor=cursor,
        limit=limit,
    )


@router.get(
    "/trades/{trade_id}",
    response_model=RecallTradeDto,
    summary="Get one recall trade memory",
)
async def get_trade(
    trade_id: str,
    db: DbSession,
    user: CurrentUser,
) -> RecallTradeDto:
    bundle = await get_recall_trade_by_id(db, trade_id=trade_id)
    if bundle is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="recall_trade_not_found",
            message=f"no recall trade with id {trade_id!r}",
        )
    return _trade_to_dto(bundle)


# ─────────────────────────── similarity search ─────────────────────────


class _RawSearchBody(BaseModel):
    """Loose envelope so we can discriminate before pydantic v2 parses.

    Direct use of ``Union[..]`` with ``discriminator="kind"`` has a
    history of leaking ``422`` errors that don't include the field path
    the UI expects — parsing here in two steps (raw then concrete)
    lets the route emit a deterministic 400 with a ``code`` the UI
    wires to its error banner.
    """

    kind: str


@router.post(
    "/search",
    response_model=RecallSearchResultDto,
    summary="Similarity search over recall memory",
)
async def search(
    payload: dict[str, Any],
    db: DbSession,
    user: CurrentUser,
) -> RecallSearchResultDto:
    kind = str(payload.get("kind") or "").strip()
    if kind not in _VALID_SEARCH_KINDS:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_search_kind",
            message=f"search kind must be one of {sorted(_VALID_SEARCH_KINDS)}",
        )

    try:
        if kind == "by_setup":
            req_by_setup = RecallSearchByIdRequestDto.model_validate(payload)
            hits = await search_recall_by_setup_id(
                db,
                setup_id=req_by_setup.setup_id,
                k=req_by_setup.k,
                min_similarity=req_by_setup.min_similarity,
            )
        elif kind == "by_live_trade":
            req_by_trade = RecallSearchByTradeRequestDto.model_validate(payload)
            hits = await search_recall_by_trade_id(
                db,
                trade_id=req_by_trade.live_trade_id,
                k=req_by_trade.k,
                min_similarity=req_by_trade.min_similarity,
            )
        else:  # by_features
            req_by_features = RecallSearchByFeaturesRequestDto.model_validate(payload)
            features = pack_features(
                symbol_id=req_by_features.features.symbol_id,
                tf=req_by_features.features.tf,
                direction=req_by_features.features.direction,
                setup_type=req_by_features.features.setup_type,
                trend_sign=req_by_features.features.trend_sign,
                bos_flag=req_by_features.features.bos_flag,
                choch_flag=req_by_features.features.choch_flag,
                sweep_flag=req_by_features.features.sweep_flag,
                volatility_bucket=req_by_features.features.volatility_bucket,
                session=req_by_features.features.session,
                order_flow_sign=req_by_features.features.order_flow_sign,
                regime=req_by_features.features.regime,
                confidence_at_detection=req_by_features.features.confidence_at_detection,
            )
            hits = await search_recall_by_features(
                db,
                features=features,
                k=req_by_features.k,
                min_similarity=req_by_features.min_similarity,
            )
    except ValidationError as exc:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_search_payload",
            message=str(exc),
        )

    matches = [match_to_dto(t, e, s) for t, e, s in hits]
    summary_dto = summarise_matches(hits)

    return RecallSearchResultDto(
        matches=matches,
        summary=summary_dto,
        generatedAt=_now_utc(),
    )


# ─────────────────────────── screenshots ───────────────────────────────


@router.get(
    "/screenshots",
    response_model=RecallScreenshotsListOut,
    summary="List chart screenshots",
)
async def list_screenshots(
    db: DbSession,
    user: CurrentUser,
    setup_id: str | None = Query(default=None, alias="setupId"),
    symbol_id: str | None = Query(default=None, alias="symbolId"),
    cursor: datetime | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> RecallScreenshotsListOut:
    return await list_recall_screenshots(
        db,
        setup_id=setup_id,
        symbol_id=symbol_id,
        cursor=cursor,
        limit=limit,
    )


@router.get(
    "/screenshots/{screenshot_id}",
    response_model=RecallScreenshotDto,
    summary="Get one chart screenshot",
)
async def get_screenshot(
    screenshot_id: str,
    db: DbSession,
    user: CurrentUser,
) -> RecallScreenshotDto:
    row = await get_screenshot_by_id(db, screenshot_id=screenshot_id)
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="recall_screenshot_not_found",
            message=f"no screenshot with id {screenshot_id!r}",
        )
    return _screenshot_to_dto(row)


@router.post(
    "/screenshots",
    response_model=RecallScreenshotDto,
    status_code=status.HTTP_201_CREATED,
    summary="Attach a chart screenshot (admin only)",
)
async def create_screenshot(
    request: Request,
    req: RecallScreenshotCreateRequestDto,
    db: DbSession,
    admin: AdminUser,
) -> RecallScreenshotDto:
    # Defence in depth — the route layer validates the anchor rule even
    # though the repo also raises. Surfaces a cleaner 400 than a 500.
    if not any([req.setup_id, req.paper_trade_id, req.live_trade_id]):
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="missing_anchor",
            message="screenshot must be anchored to a setup, paper trade, or live trade",
        )

    screenshot = await repo_attach_screenshot(db, actor=admin, req=req)
    await log_event(
        db,
        request=request,
        actor_user_id=admin.id,
        actor_email=admin.email,
        action="recall.screenshot.create",
        resource_type="recall.screenshot",
        resource_id=screenshot.id,
        outcome="success",
        details={
            "symbolId": req.symbol_id,
            "tf": req.tf,
            "setupId": req.setup_id,
            "paperTradeId": req.paper_trade_id,
            "liveTradeId": req.live_trade_id,
        },
    )
    await db.commit()
    dto = _screenshot_to_dto(screenshot)
    # Guarantee that the actor user-id is echoed back — the helper pulls
    # it from the annotation trailer, which is committed.
    if dto.captured_by_user_id == "system":
        dto = RecallScreenshotDto(**{**dto.model_dump(by_alias=True), "capturedByUserId": admin.id})
    return dto


# ─────────────────────────── missed trades ─────────────────────────────


@router.get(
    "/missed",
    response_model=MissedTradesListOut,
    summary="List missed (systematic) trades",
)
async def list_missed(
    db: DbSession,
    user: CurrentUser,
    symbol_id: str | None = Query(default=None, alias="symbolId"),
    reason: str | None = Query(default=None),
    from_ts: datetime | None = Query(default=None, alias="fromTs"),
    to_ts: datetime | None = Query(default=None, alias="toTs"),
    cursor: datetime | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> MissedTradesListOut:
    if reason is not None and reason not in _VALID_REASONS:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_miss_reason",
            message=f"reason must be one of {sorted(_VALID_REASONS)}",
        )
    return await list_missed_trades(
        db,
        symbol_id=symbol_id,
        reason=reason,
        from_ts=from_ts,
        to_ts=to_ts,
        cursor=cursor,
        limit=limit,
    )
