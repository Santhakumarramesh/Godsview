"""Control plane runtime configuration loaded from env + validated with pydantic."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env", "../../.env"),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    godsview_env: Literal["local", "dev", "staging", "prod"] = Field("local", alias="GODSVIEW_ENV")
    godsview_service_name: str = Field("control_plane", alias="GODSVIEW_SERVICE_NAME")
    godsview_service_version: str = Field("0.1.0", alias="GODSVIEW_SERVICE_VERSION")

    database_url: str = Field(..., alias="DATABASE_URL")
    redis_url: str = Field("redis://localhost:6379/0", alias="REDIS_URL")

    jwt_signing_key: SecretStr = Field(..., alias="JWT_SIGNING_KEY")
    jwt_algorithm: Literal["HS256", "RS256"] = Field("HS256", alias="JWT_ALGORITHM")
    jwt_access_ttl_seconds: int = Field(900, alias="JWT_ACCESS_TTL_SECONDS")
    jwt_refresh_ttl_seconds: int = Field(604800, alias="JWT_REFRESH_TTL_SECONDS")
    jwt_issuer: str = Field("godsview", alias="JWT_ISSUER")
    jwt_audience: str = Field("godsview-v2", alias="JWT_AUDIENCE")

    allowed_origins_raw: str = Field("http://localhost:3000", alias="ALLOWED_ORIGINS")
    log_level: Literal["debug", "info", "warn", "error"] = Field("info", alias="LOG_LEVEL")
    kill_switch_on_boot: bool = Field(False, alias="KILL_SWITCH_ON_BOOT")

    bootstrap_admin_email: str = Field("admin@godsview.local", alias="BOOTSTRAP_ADMIN_EMAIL")
    bootstrap_admin_password: SecretStr = Field(
        SecretStr("godsview-admin-dev"), alias="BOOTSTRAP_ADMIN_PASSWORD"
    )

    @field_validator("database_url")
    @classmethod
    def require_async_driver(cls, v: str) -> str:
        if not v.startswith("postgresql+asyncpg://"):
            raise ValueError("DATABASE_URL must use 'postgresql+asyncpg://' driver")
        return v

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins_raw.split(",") if o.strip()]

    @property
    def is_prod(self) -> bool:
        return self.godsview_env == "prod"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings accessor used by FastAPI dependency injection."""
    return Settings()  # type: ignore[call-arg]
