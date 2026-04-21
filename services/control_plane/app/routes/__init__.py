"""Aggregated API router for the control_plane."""

from fastapi import APIRouter

from app.routes.auth import router as auth_router
from app.routes.flags import router as flags_router
from app.routes.health import router as health_router
from app.routes.system_config import router as system_config_router
from app.routes.audit import router as audit_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(flags_router)
api_router.include_router(system_config_router)
api_router.include_router(audit_router)
