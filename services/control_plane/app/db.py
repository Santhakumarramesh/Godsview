"""Async SQLAlchemy engine/session factory for control_plane."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import Settings, get_settings


class Base(DeclarativeBase):
    """Declarative base shared by every control_plane ORM model."""


_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def _build_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=10,
        future=True,
    )


def get_engine(settings: Settings | None = None) -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = _build_engine(settings or get_settings())
    return _engine


def get_session_factory(
    settings: Settings | None = None,
) -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        engine = get_engine(settings)
        _session_factory = async_sessionmaker(
            engine, expire_on_commit=False, autoflush=False, autocommit=False
        )
    return _session_factory


async def get_db() -> AsyncIterator[AsyncSession]:
    factory = get_session_factory()
    async with factory() as session:
        yield session


DbSession = Annotated[AsyncSession, Depends(get_db)]


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Standalone session helper for scripts (seed, one-offs).

    Commits on successful exit, rolls back on exception. Not used by the
    FastAPI request pipeline (that path goes through ``get_db``).
    """

    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


def reset_engine_for_tests() -> None:
    """Drop the cached engine/session factory.

    Only intended for the test harness — production code never calls this.
    """

    global _engine, _session_factory
    _engine = None
    _session_factory = None


def override_session_factory(
    factory: async_sessionmaker[AsyncSession], engine: AsyncEngine
) -> None:
    """Inject a pre-built session factory/engine pair for the test harness."""

    global _engine, _session_factory
    _engine = engine
    _session_factory = factory
