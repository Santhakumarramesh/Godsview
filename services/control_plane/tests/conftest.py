"""Shared pytest fixtures for the control_plane test suite.

The suite uses aiosqlite so it runs without Postgres. Postgres-only ORM
types (ARRAY, JSONB) are swapped for JSON via SQLAlchemy type decorators
installed in ``_install_sqlite_shims``.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import JSON
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

# Env must be populated *before* app.config is imported anywhere.
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://gv:gv@localhost:5432/gv_test"
)
os.environ.setdefault("JWT_SIGNING_KEY", "test-signing-key-0123456789abcdef-test")
os.environ.setdefault("JWT_ALGORITHM", "HS256")
os.environ.setdefault("GODSVIEW_ENV", "local")
os.environ.setdefault("BOOTSTRAP_ADMIN_EMAIL", "admin@godsview.test")
os.environ.setdefault("BOOTSTRAP_ADMIN_PASSWORD", "godsview-admin-test")


def _install_sqlite_shims() -> None:
    """Rewrite Postgres-only column types to portable equivalents.

    Runs once before ``Base.metadata.create_all`` so the baseline schema can
    materialize on aiosqlite. Production migrations still use JSONB/ARRAY.
    """

    # Import lazily: importing models registers columns on Base.metadata.
    from app import models  # noqa: F401
    from app.db import Base

    for table in Base.metadata.tables.values():
        for column in table.columns:
            ctype = column.type
            # sqlalchemy.dialects.postgresql.ARRAY → JSON list
            if ctype.__class__.__name__ == "ARRAY":
                column.type = JSON()
            # sqlalchemy.dialects.postgresql.JSONB → JSON
            elif ctype.__class__.__name__ == "JSONB":
                column.type = JSON()


@pytest_asyncio.fixture()
async def engine() -> AsyncIterator[AsyncEngine]:
    _install_sqlite_shims()
    from app.db import Base

    eng = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture()
async def session_factory(
    engine: AsyncEngine,
) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        engine, expire_on_commit=False, autoflush=False, autocommit=False
    )


@pytest_asyncio.fixture()
async def db(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture()
async def client(
    engine: AsyncEngine,
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncClient]:
    # Wire the test engine/session factory into the module-level globals
    # so FastAPI's ``get_db`` picks them up.
    from app import db as db_module
    from app.main import _create_app

    db_module.override_session_factory(session_factory, engine)
    app = _create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    db_module.reset_engine_for_tests()


@pytest_asyncio.fixture()
async def admin_user(
    db: AsyncSession,
) -> dict[str, Any]:
    """Insert an admin user and return its credentials."""

    import uuid

    from app.models import User
    from app.security import hash_password

    password = "admin-password-123"
    user = User(
        id=f"usr_{uuid.uuid4().hex}",
        email="admin@godsview.test",
        display_name="Test Admin",
        password_hash=hash_password(password),
        roles=["admin"],
        mfa_enabled=False,
        disabled=False,
    )
    db.add(user)
    await db.commit()
    return {"email": user.email, "password": password, "id": user.id}
