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
from app.routes.api_keys import router as api_keys_router
from app.routes.audit import router as audit_router
from app.routes.auth import router as auth_router
from app.routes.broker import router as broker_router
from app.routes.execution import router as execution_router
from app.routes.flags import router as flags_router
from app.routes.health import router as health_router
from app.routes.market import router as market_router
from app.routes.mcp_servers import router as mcp_servers_router
from app.routes.ops import router as ops_router
from app.routes.orderflow import router as orderflow_router
from app.routes.risk import router as risk_router
from app.routes.settings import router as settings_router
from app.routes.setups import router as setups_router
from app.routes.system_config import router as system_config_router
from app.routes.tv_webhook import router as tv_webhook_router
from app.routes.users import router as users_router
from app.routes.webhooks import router as webhooks_router
from app.routes.ws_quotes import router as ws_quotes_router

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
api_router.include_router(
    api_keys_router,
    responses={**COMMON_ERROR_RESPONSES, **AUTH_ERROR_RESPONSES},
)
api_router.include_router(
    webhooks_router,
    responses={**COMMON_ERROR_RESPONSES, **AUTH_ERROR_RESPONSES},
)
api_router.include_router(
    mcp_servers_router,
    responses={**COMMON_ERROR_RESPONSES, **AUTH_ERROR_RESPONSES},
)
api_router.include_router(
    ops_router,
    responses={**COMMON_ERROR_RESPONSES, **AUTH_ERROR_RESPONSES},
)
api_router.include_router(
    settings_router,
    responses={**COMMON_ERROR_RESPONSES, **AUTH_ERROR_RESPONSES},
)
api_router.include_router(
    market_router,
    responses={**COMMON_ERROR_RESPONSES, **AUTH_ERROR_RESPONSES},
)
api_router.include_router(
    orderflow_router,
    responses={**COMMON_ERROR_RESPONSES, **AUTH_ERROR_RESPONSES},
)
api_router.include_router(
    setups_router,
    responses={**COMMON_ERROR_RESPONSES, **AUTH_ERROR_RESPONSES},
)
api_router.include_router(
    execution_router,
    responses={**COMMON_ERROR_RESPONSES, **AUTH_ERROR_RESPONSES},
)
api_router.include_router(
    broker_router,
    responses={**COMMON_ERROR_RESPONSES, **AUTH_ERROR_RESPONSES},
)
api_router.include_router(
    risk_router,
    responses={**COMMON_ERROR_RESPONSES, **AUTH_ERROR_RESPONSES},
)
# /v1/tv-webhook is unauthenticated — it is HMAC-gated via the
# `X-Godsview-Signature` header against the source webhook's active
# secret. The operator-mux in front of it holds the plaintext secret.
api_router.include_router(
    tv_webhook_router,
    responses=COMMON_ERROR_RESPONSES,
)
# /ws/quotes is a WebSocket route — auth happens in-handler (close-with-4401
# on failure) so the OpenAPI 401/403 envelope is irrelevant here.
api_router.include_router(ws_quotes_router)
