"""Idempotent bootstrap seed for a fresh control plane database.

Creates:
  * the bootstrap admin user (from BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD)
  * default FeatureFlag rows for every KNOWN_FLAGS entry (all disabled except
    ``execution.kill_switch`` which defaults to engaged per Decision #4)
  * default SystemConfig sentinel rows used by downstream phases

Safe to re-run — existing rows are left alone.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass

from sqlalchemy import select

from app.config import get_settings
from app.db import session_scope
from app.logging import get_logger
from app.models import FeatureFlag, SystemConfig, User
from app.security import hash_password

_log = get_logger("seed")


@dataclass(frozen=True)
class _FlagSeed:
    key: str
    enabled: bool
    description: str


# Mirrors packages/types/src/feature-flags.ts::KNOWN_FLAGS. Keep in sync.
DEFAULT_FLAGS: tuple[_FlagSeed, ...] = (
    _FlagSeed(
        key="auth.mfa.required",
        enabled=False,
        description="Require TOTP MFA on login for all users.",
    ),
    _FlagSeed(
        key="execution.kill_switch",
        enabled=True,
        description=(
            "Deterministic safety floor: when enabled, blocks every broker "
            "dispatch regardless of agent confidence. Default ON."
        ),
    ),
    _FlagSeed(
        key="execution.allow_live",
        enabled=False,
        description="Allow orders to reach live broker (paper only when off).",
    ),
    _FlagSeed(
        key="intelligence.allow_autonomous",
        enabled=False,
        description="Allow autonomous-tier strategies to submit without approval.",
    ),
    _FlagSeed(
        key="ui.show_v2_command_center",
        enabled=True,
        description="Toggle the v2 command center in the web app.",
    ),
)


@dataclass(frozen=True)
class _ConfigSeed:
    key: str
    value: object
    description: str


DEFAULT_CONFIG: tuple[_ConfigSeed, ...] = (
    _ConfigSeed(
        key="risk.max_daily_loss_pct",
        value=2.0,
        description="Daily equity drawdown (%) that flips the kill switch.",
    ),
    _ConfigSeed(
        key="risk.max_open_positions",
        value=10,
        description="Hard cap on simultaneously open positions across all strategies.",
    ),
    _ConfigSeed(
        key="calibration.drift_threshold",
        value=0.15,
        description="Brier-score drift above this demotes an autonomous strategy.",
    ),
)


async def _ensure_admin() -> str:
    settings = get_settings()
    async with session_scope() as db:
        existing = await db.scalar(
            select(User).where(User.email == settings.bootstrap_admin_email.lower())
        )
        if existing is not None:
            _log.info("seed.admin.skip", email=existing.email)
            return existing.id
        user = User(
            id=f"usr_{uuid.uuid4().hex}",
            email=settings.bootstrap_admin_email.lower(),
            display_name="Bootstrap Admin",
            password_hash=hash_password(settings.bootstrap_admin_password.get_secret_value()),
            roles=["admin"],
            mfa_enabled=False,
            disabled=False,
        )
        db.add(user)
        await db.flush()
        _log.info("seed.admin.created", user_id=user.id, email=user.email)
        return user.id


async def _ensure_flags() -> int:
    created = 0
    async with session_scope() as db:
        for seed in DEFAULT_FLAGS:
            existing = await db.scalar(select(FeatureFlag).where(FeatureFlag.key == seed.key))
            if existing is not None:
                continue
            db.add(
                FeatureFlag(
                    key=seed.key,
                    enabled=seed.enabled,
                    description=seed.description,
                    scope="global",
                    scope_ref=None,
                    updated_by="seed",
                )
            )
            created += 1
    if created:
        _log.info("seed.flags.created", count=created)
    return created


async def _ensure_config() -> int:
    created = 0
    async with session_scope() as db:
        for seed in DEFAULT_CONFIG:
            existing = await db.scalar(select(SystemConfig).where(SystemConfig.key == seed.key))
            if existing is not None:
                continue
            db.add(
                SystemConfig(
                    key=seed.key,
                    value=seed.value,
                    description=seed.description,
                    updated_by="seed",
                )
            )
            created += 1
    if created:
        _log.info("seed.config.created", count=created)
    return created


async def run() -> None:
    admin_id = await _ensure_admin()
    flags_created = await _ensure_flags()
    config_created = await _ensure_config()
    _log.info(
        "seed.completed",
        admin_id=admin_id,
        flags_created=flags_created,
        config_created=config_created,
    )


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
