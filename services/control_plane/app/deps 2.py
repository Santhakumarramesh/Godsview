"""FastAPI dependencies: current user extraction, role guards."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import DbSession
from app.errors import ApiError
from app.models import User
from app.security import verify_token


async def _extract_bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    if not authorization.lower().startswith("bearer "):
        return None
    return authorization.split(" ", 1)[1].strip() or None


async def get_current_user(
    request: Request,
    db: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    token = await _extract_bearer(authorization)
    if not token:
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="unauthenticated",
            message="missing bearer token",
        )
    try:
        payload = verify_token(settings=settings, token=token, expected_type="access")
    except ValueError as exc:
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="unauthenticated",
            message=str(exc),
        ) from exc
    user_id: str = payload.get("sub", "")
    if not user_id:
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="unauthenticated",
            message="token missing subject",
        )
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None or user.disabled:
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="unauthenticated",
            message="user not found or disabled",
        )
    request.state.user_id = user.id
    return user


def require_roles(*roles: str):
    """Factory that returns a dep enforcing the current user has any of the roles."""
    required = set(roles)

    async def _dep(user: Annotated[User, Depends(get_current_user)]) -> User:
        if required and not (required & set(user.roles)):
            raise ApiError(
                status_code=status.HTTP_403_FORBIDDEN,
                code="forbidden",
                message=f"requires one of roles: {sorted(required)}",
            )
        return user

    return _dep


# Convenience type aliases.
CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(require_roles("admin"))]
OperatorOrAdmin = Annotated[User, Depends(require_roles("operator", "admin"))]


async def get_db_session(session: DbSession) -> AsyncSession:
    return session
