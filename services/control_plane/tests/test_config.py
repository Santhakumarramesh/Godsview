"""Config/validation coverage — ensures driver guard stays in place."""

from __future__ import annotations

import pytest
from pydantic import ValidationError


def test_database_url_requires_async_driver(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import Settings

    monkeypatch.setenv("DATABASE_URL", "postgresql://gv:gv@localhost:5432/gv")
    monkeypatch.setenv("JWT_SIGNING_KEY", "test-signing-key-0123456789abcdef-test")

    with pytest.raises(ValidationError) as excinfo:
        Settings()  # type: ignore[call-arg]
    assert "postgresql+asyncpg" in str(excinfo.value)


def test_settings_load_with_async_driver(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import Settings

    monkeypatch.setenv(
        "DATABASE_URL", "postgresql+asyncpg://gv:gv@localhost:5432/gv"
    )
    monkeypatch.setenv("JWT_SIGNING_KEY", "test-signing-key-0123456789abcdef-test")

    settings = Settings()  # type: ignore[call-arg]
    assert settings.database_url.startswith("postgresql+asyncpg://")
    assert settings.jwt_algorithm == "HS256"
    assert settings.kill_switch_on_boot is False
