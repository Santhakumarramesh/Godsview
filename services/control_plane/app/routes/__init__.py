"""Aggregated API router for the control_plane.

Responses wiring:
  * Every auth-gated router advertises 401/403 via ``AUTH_ERROR_RESPONSES``
    so the OpenAPI spec matches the runtime contract enforced by
    ``contract-validation.yml``.
  * ``/health/*`` and ``/auth/{login,refresh}`` are public — they advertise
    only the generic 4xx responses.
"""

from fastapi import APIRouter

from app.errors import AUTH_ERROR_RESPONSES, COMMON_ERROR_RESPONSES
from app.routes.audit import router as audit_router
from app.routes.auth import router as auth_router
from app.routes.flags import router as flags_router
from app.routes.health import router as health_router
from app.routes.system_config import router as system_config_router
from app.routes.users import router as users_router

api_router = APIRouter()

api_router.include_router(health_router, responses=COMMON_ERROR_RESPONSES)
api_router.include_router(
    auth_router,
    responses={**COMMON_ERROR_RESPONSES, **AUTH_ERROR_RESPONSES},
)
api_router.include_router(
    flags_router,
    responses={**COMMON_ERROR_RESPONSES, **AUTH_ERROR_RESPONSES},
)
api_router.include_router(
    system_config_router,
    responses={**COMMON_ERROR_RESPONSES, **AUTH_ERROR_RESPONSES},
)
api_router.include_router(
    audit_router,
    responses={**COMMON_ERROR_RESPONSES, **AUTH_ERROR_RESPONSES},
)
api_router.include_router(
    users_router,
    responses={**COMMON_ERROR_RESPONSES, **AUTH_ERROR_RESPONSES},
)
