"""Approval-policy CRUD + bootstrap defaults.

The policy row for a given ``GovernanceAction`` is the authoritative
answer to "does this action need approval, and by whom". The bootstrap
layer ships one row per canonical action — safe defaults, all writable
via the ``PATCH /policies/{action}`` route (itself gated by the
``approval_policy_edit`` policy, which is why the bootstrap row for that
action is the *strictest* in the catalog).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.governance.dto import (
    ApprovalPolicyDto,
    ApprovalPolicyListDto,
    ApprovalPolicyUpdateDto,
)
from app.governance.tiers import at_least, is_valid_tier
from app.models import ApprovalPolicyRow

UTC = timezone.utc


# ──────────────────────────── bootstrap catalog ─────────────────────────


@dataclass(frozen=True)
class _PolicyDefault:
    action: str
    requires_approval: bool
    min_requester_tier: str
    min_approver_tier: str
    approver_count: int
    ttl_seconds: int


# Safe defaults for every action. Edits via the route *always* produce
# an audit row, so this catalog only seeds brand-new databases; existing
# production rows are never rewritten on upgrade.
DEFAULT_POLICIES: List[_PolicyDefault] = [
    _PolicyDefault("live_mode_enable", True, "senior_operator", "admin", 1, 86400),
    _PolicyDefault("kill_switch_toggle", False, "operator", "senior_operator", 1, 3600),
    _PolicyDefault("risk_budget_widen", True, "senior_operator", "admin", 1, 86400),
    _PolicyDefault("risk_budget_tighten", False, "operator", "senior_operator", 1, 86400),
    _PolicyDefault("strategy_promote", True, "operator", "senior_operator", 1, 172800),
    _PolicyDefault("strategy_demote", False, "operator", "senior_operator", 1, 172800),
    _PolicyDefault("strategy_retire", True, "senior_operator", "admin", 1, 172800),
    _PolicyDefault("strategy_autonomous_promote", True, "senior_operator", "admin", 2, 172800),
    _PolicyDefault("strategy_autonomous_demote", False, "operator", "senior_operator", 1, 86400),
    _PolicyDefault("allocation_set", False, "operator", "senior_operator", 1, 86400),
    _PolicyDefault("override_risk", True, "senior_operator", "admin", 1, 14400),
    _PolicyDefault("feature_flag_toggle", False, "operator", "senior_operator", 1, 86400),
    _PolicyDefault("trust_tier_change", True, "admin", "owner", 1, 172800),
    _PolicyDefault("approval_policy_edit", True, "admin", "owner", 2, 172800),
    _PolicyDefault("anomaly_acknowledge", False, "operator", "senior_operator", 1, 3600),
    _PolicyDefault("calibration_recompute", False, "operator", "senior_operator", 1, 86400),
    _PolicyDefault("dna_rebuild", False, "operator", "senior_operator", 1, 86400),
    _PolicyDefault("data_truth_override", True, "senior_operator", "admin", 2, 14400),
]


# ──────────────────────────── helpers ───────────────────────────────────


def _row_to_dto(row: ApprovalPolicyRow) -> ApprovalPolicyDto:
    return ApprovalPolicyDto.model_validate(row)


async def _get_row(
    session: AsyncSession, action: str
) -> Optional[ApprovalPolicyRow]:
    stmt = select(ApprovalPolicyRow).where(ApprovalPolicyRow.action == action)
    return (await session.execute(stmt)).scalar_one_or_none()


# ──────────────────────────── public API ────────────────────────────────


async def ensure_default_policies(session: AsyncSession) -> None:
    """Insert any missing default policy rows. Idempotent."""
    stmt = select(ApprovalPolicyRow.action)
    existing = set((await session.execute(stmt)).scalars().all())
    now = datetime.now(UTC)
    for default in DEFAULT_POLICIES:
        if default.action in existing:
            continue
        session.add(
            ApprovalPolicyRow(
                action=default.action,
                requires_approval=default.requires_approval,
                min_requester_tier=default.min_requester_tier,
                min_approver_tier=default.min_approver_tier,
                approver_count=default.approver_count,
                ttl_seconds=default.ttl_seconds,
                created_at=now,
                updated_at=now,
            )
        )
    await session.flush()


async def list_policies(session: AsyncSession) -> ApprovalPolicyListDto:
    """List every policy row, auto-bootstrapping defaults if empty."""
    stmt = select(ApprovalPolicyRow).order_by(ApprovalPolicyRow.action)
    rows = list((await session.execute(stmt)).scalars().all())
    if not rows:
        await ensure_default_policies(session)
        rows = list((await session.execute(stmt)).scalars().all())
    return ApprovalPolicyListDto(
        policies=[_row_to_dto(r) for r in rows]
    )


async def get_policy(
    session: AsyncSession, action: str
) -> Optional[ApprovalPolicyDto]:
    row = await _get_row(session, action)
    if row is None:
        return None
    return _row_to_dto(row)


async def resolve_policy(
    session: AsyncSession, action: str
) -> Dict[str, object]:
    """Return the effective policy for ``action`` as a plain dict.

    If no row is present, falls back to a safe default:
    requires_approval=True, requester=operator, approver=senior_operator,
    approver_count=1, ttl=86400.
    """
    row = await _get_row(session, action)
    if row is not None:
        return {
            "requires_approval": row.requires_approval,
            "min_requester_tier": row.min_requester_tier,
            "min_approver_tier": row.min_approver_tier,
            "approver_count": row.approver_count,
            "ttl_seconds": row.ttl_seconds,
        }
    for default in DEFAULT_POLICIES:
        if default.action == action:
            return {
                "requires_approval": default.requires_approval,
                "min_requester_tier": default.min_requester_tier,
                "min_approver_tier": default.min_approver_tier,
                "approver_count": default.approver_count,
                "ttl_seconds": default.ttl_seconds,
            }
    return {
        "requires_approval": True,
        "min_requester_tier": "operator",
        "min_approver_tier": "senior_operator",
        "approver_count": 1,
        "ttl_seconds": 86400,
    }


async def update_policy(
    session: AsyncSession,
    *,
    action: str,
    patch: ApprovalPolicyUpdateDto,
    actor_user_id: str,
) -> ApprovalPolicyDto:
    """Apply a partial update to a policy row, creating it if missing.

    Tier ordering invariant enforced: ``min_approver_tier`` must be ≥
    ``min_requester_tier`` — the approver cannot be weaker than the
    person requesting the action.
    """
    row = await _get_row(session, action)
    now = datetime.now(UTC)
    if row is None:
        # Start from defaults so the patch semantics are additive.
        seed = next(
            (d for d in DEFAULT_POLICIES if d.action == action), None
        )
        if seed is None:
            raise ValueError(f"unknown governance action: {action!r}")
        row = ApprovalPolicyRow(
            action=action,
            requires_approval=seed.requires_approval,
            min_requester_tier=seed.min_requester_tier,
            min_approver_tier=seed.min_approver_tier,
            approver_count=seed.approver_count,
            ttl_seconds=seed.ttl_seconds,
            created_at=now,
            updated_at=now,
        )
        session.add(row)

    if patch.requires_approval is not None:
        row.requires_approval = patch.requires_approval
    if patch.min_requester_tier is not None:
        if not is_valid_tier(patch.min_requester_tier):
            raise ValueError(f"invalid tier: {patch.min_requester_tier!r}")
        row.min_requester_tier = patch.min_requester_tier
    if patch.min_approver_tier is not None:
        if not is_valid_tier(patch.min_approver_tier):
            raise ValueError(f"invalid tier: {patch.min_approver_tier!r}")
        row.min_approver_tier = patch.min_approver_tier
    if patch.approver_count is not None:
        row.approver_count = patch.approver_count
    if patch.ttl_seconds is not None:
        row.ttl_seconds = patch.ttl_seconds

    if not at_least(row.min_approver_tier, row.min_requester_tier):
        raise ValueError(
            "min_approver_tier must be >= min_requester_tier"
        )

    row.updated_at = now
    row.updated_by_user_id = actor_user_id
    await session.flush()
    return _row_to_dto(row)


__all__ = [
    "DEFAULT_POLICIES",
    "ensure_default_policies",
    "list_policies",
    "get_policy",
    "resolve_policy",
    "update_policy",
]
