from __future__ import annotations

import json
from typing import Any, Optional

from app.governance.approval_workflow import ApprovalStatus, ApprovalWorkflow
from app.governance.audit_log import EventType, get_audit_logger
from app.governance.engine import GovernanceEngine
from app.governance.trust_tiers import TrustTierLevel


# Global governance engine instance (initialize elsewhere)
_governance_engine: Optional[GovernanceEngine] = None


def set_governance_engine(engine: GovernanceEngine) -> None:
    """Set the global governance engine instance."""
    global _governance_engine
    _governance_engine = engine


def get_governance_engine() -> GovernanceEngine:
    """Get the global governance engine instance."""
    global _governance_engine
    if _governance_engine is None:
        _governance_engine = GovernanceEngine()
    return _governance_engine


class GovernanceAPI:
    """REST API routes for governance system."""

    @staticmethod
    def get_status() -> dict[str, Any]:
        """GET /governance/status

        Returns current governance status, trust tier, pending approvals, recent events.
        """
        engine = get_governance_engine()
        return engine.get_status()

    @staticmethod
    def get_audit_log(
        event_type: Optional[str] = None,
        symbol: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> dict[str, Any]:
        """GET /governance/audit

        Query audit log with filters.

        Args:
            event_type: Filter by event type (e.g., 'trade_signal', 'approval_required')
            symbol: Filter by trading symbol
            start_time: ISO format start timestamp
            end_time: ISO format end timestamp
            limit: Max results (default 100)
            offset: Pagination offset

        Returns:
            Dict with events and metadata
        """
        logger = get_audit_logger()

        # Parse event_type if provided
        et = None
        if event_type:
            try:
                et = EventType[event_type.upper()] if hasattr(EventType, event_type.upper()) else None
            except (KeyError, AttributeError):
                et = None

        events = logger.query_events(
            event_type=et,
            symbol=symbol,
            start_time=start_time,
            end_time=end_time,
            limit=limit,
            offset=offset,
        )

        return {
            "events": events,
            "count": len(events),
            "limit": limit,
            "offset": offset,
            "filters": {
                "event_type": event_type,
                "symbol": symbol,
                "start_time": start_time,
                "end_time": end_time,
            },
        }

    @staticmethod
    def get_pending_approvals(symbol: Optional[str] = None) -> dict[str, Any]:
        """GET /governance/pending

        List all pending approval requests.

        Args:
            symbol: Optional symbol filter

        Returns:
            Dict with pending requests
        """
        engine = get_governance_engine()
        pending = engine.approval_workflow.get_pending_requests(symbol=symbol)

        return {
            "pending_requests": [p.to_dict() for p in pending],
            "count": len(pending),
            "symbol_filter": symbol,
        }

    @staticmethod
    def approve_request(
        request_id: str,
        approved_by: str,
        notes: Optional[str] = None,
    ) -> dict[str, Any]:
        """POST /governance/approve/{request_id}

        Approve a pending approval request.

        Args:
            request_id: Approval request ID
            approved_by: User ID of approver
            notes: Optional approval notes

        Returns:
            Updated approval request
        """
        engine = get_governance_engine()
        request = engine.approval_workflow.approve_request(
            request_id=request_id,
            approved_by=approved_by,
            notes=notes,
        )

        if not request:
            return {
                "error": "request_not_found",
                "request_id": request_id,
            }

        # Log approval in audit
        logger = get_audit_logger()
        logger.log_event(
            EventType.APPROVAL_GRANTED,
            request.correlation_id,
            request.symbol,
            {
                "request_id": request_id,
                "approved_by": approved_by,
                "notes": notes,
                "action": request.action,
                "quantity": request.quantity,
            },
            user_id=approved_by,
        )

        return {
            "status": "approved",
            "request": request.to_dict(),
        }

    @staticmethod
    def reject_request(
        request_id: str,
        rejected_by: str,
        reason: Optional[str] = None,
    ) -> dict[str, Any]:
        """POST /governance/reject/{request_id}

        Reject a pending approval request.

        Args:
            request_id: Approval request ID
            rejected_by: User ID of rejector
            reason: Rejection reason

        Returns:
            Updated approval request
        """
        engine = get_governance_engine()
        request = engine.approval_workflow.reject_request(
            request_id=request_id,
            rejected_by=rejected_by,
            reason=reason,
        )

        if not request:
            return {
                "error": "request_not_found",
                "request_id": request_id,
            }

        # Log rejection in audit
        logger = get_audit_logger()
        logger.log_event(
            EventType.APPROVAL_REJECTED,
            request.correlation_id,
            request.symbol,
            {
                "request_id": request_id,
                "rejected_by": rejected_by,
                "reason": reason,
                "action": request.action,
                "quantity": request.quantity,
            },
            user_id=rejected_by,
        )

        return {
            "status": "rejected",
            "request": request.to_dict(),
        }

    @staticmethod
    def override_tier(
        new_tier: str,
        reason: str,
        user_id: str,
    ) -> dict[str, Any]:
        """POST /governance/tier/override

        Manually override trust tier (requires authentication/authorization).

        Args:
            new_tier: Target tier name (TIER_0_DISABLED, TIER_1_OBSERVER, etc.)
            reason: Reason for override
            user_id: User ID performing override

        Returns:
            Tier change result
        """
        engine = get_governance_engine()

        # Parse tier
        try:
            tier = TrustTierLevel[new_tier]
        except KeyError:
            return {
                "error": "invalid_tier",
                "tier": new_tier,
                "valid_tiers": [t.name for t in TrustTierLevel],
            }

        # Perform override
        result = engine.promote_or_demote_tier(
            new_tier=tier,
            reason=reason,
            triggered_by="manual_override",
            user_id=user_id,
        )

        return result

    @staticmethod
    def emergency_kill_switch(
        reason: str,
        user_id: str,
    ) -> dict[str, Any]:
        """POST /governance/emergency-demote

        Emergency demote to TIER_0_DISABLED (instant kill switch).

        Args:
            reason: Reason for emergency action
            user_id: User ID performing action

        Returns:
            Emergency demotion result
        """
        engine = get_governance_engine()

        result = engine.emergency_demote_to_tier_0(
            reason=reason,
            user_id=user_id,
        )

        return result

    @staticmethod
    def get_decision_trail(correlation_id: str) -> dict[str, Any]:
        """GET /governance/trail/{correlation_id}

        Get full audit trail for a single trade decision (signal -> approval -> execution -> outcome).

        Args:
            correlation_id: Correlation ID linking related events

        Returns:
            Complete decision trail with all events
        """
        logger = get_audit_logger()
        events = logger.get_decision_trail(correlation_id)

        return {
            "correlation_id": correlation_id,
            "events": events,
            "count": len(events),
            "timeline": [
                {
                    "timestamp": e["timestamp"],
                    "event_type": e["event_type"],
                    "severity": e["severity"],
                    "payload": e["payload"],
                }
                for e in events
            ],
        }

    @staticmethod
    def export_audit(
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        format: str = "json",
    ) -> dict[str, Any]:
        """GET /governance/export

        Export audit log for compliance review.

        Args:
            start_time: ISO format start timestamp
            end_time: ISO format end timestamp
            format: Export format ('json' or 'csv')

        Returns:
            Exported data or error
        """
        logger = get_audit_logger()

        try:
            data = logger.export_audit(
                start_time=start_time,
                end_time=end_time,
                format=format,
            )
            return {
                "status": "exported",
                "format": format,
                "start_time": start_time,
                "end_time": end_time,
                "data": data,
            }
        except ValueError as e:
            return {
                "error": str(e),
                "valid_formats": ["json", "csv"],
            }

    @staticmethod
    def get_approval_history(
        symbol: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        """GET /governance/approval-history

        Get historical approval requests (approved, rejected, expired).

        Args:
            symbol: Optional symbol filter
            limit: Max results
            offset: Pagination offset

        Returns:
            List of historical approval requests
        """
        engine = get_governance_engine()
        history = engine.approval_workflow.get_request_history(
            symbol=symbol,
            limit=limit,
            offset=offset,
        )

        return {
            "requests": [r.to_dict() for r in history],
            "count": len(history),
            "symbol_filter": symbol,
            "limit": limit,
            "offset": offset,
        }


# Flask/FastAPI route decorators (example for FastAPI)
# These would be called from your actual route definitions

def register_governance_routes(app: Any) -> None:
    """Register governance routes to FastAPI app.

    Usage:
        from fastapi import FastAPI
        app = FastAPI()
        register_governance_routes(app)
    """
    api = GovernanceAPI()

    @app.get("/governance/status")
    async def get_status():
        return api.get_status()

    @app.get("/governance/audit")
    async def get_audit(
        event_type: Optional[str] = None,
        symbol: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ):
        return api.get_audit_log(
            event_type=event_type,
            symbol=symbol,
            start_time=start_time,
            end_time=end_time,
            limit=limit,
            offset=offset,
        )

    @app.get("/governance/pending")
    async def get_pending(symbol: Optional[str] = None):
        return api.get_pending_approvals(symbol=symbol)

    @app.post("/governance/approve/{request_id}")
    async def approve(request_id: str, approved_by: str, notes: Optional[str] = None):
        return api.approve_request(request_id=request_id, approved_by=approved_by, notes=notes)

    @app.post("/governance/reject/{request_id}")
    async def reject(request_id: str, rejected_by: str, reason: Optional[str] = None):
        return api.reject_request(request_id=request_id, rejected_by=rejected_by, reason=reason)

    @app.post("/governance/tier/override")
    async def override_tier(new_tier: str, reason: str, user_id: str):
        return api.override_tier(new_tier=new_tier, reason=reason, user_id=user_id)

    @app.post("/governance/emergency-demote")
    async def emergency(reason: str, user_id: str):
        return api.emergency_kill_switch(reason=reason, user_id=user_id)

    @app.get("/governance/trail/{correlation_id}")
    async def trail(correlation_id: str):
        return api.get_decision_trail(correlation_id=correlation_id)

    @app.get("/governance/export")
    async def export(
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        format: str = "json",
    ):
        return api.export_audit(start_time=start_time, end_time=end_time, format=format)

    @app.get("/governance/approval-history")
    async def approval_history(symbol: Optional[str] = None, limit: int = 50, offset: int = 0):
        return api.get_approval_history(symbol=symbol, limit=limit, offset=offset)
