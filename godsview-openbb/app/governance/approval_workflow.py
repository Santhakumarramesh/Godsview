from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Optional

from app.config import ROOT_DIR


class ApprovalStatus(Enum):
    """Status of an approval request."""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"
    CANCELED = "canceled"


@dataclass
class ApprovalRequest:
    """Human approval request for a trade."""

    request_id: str
    symbol: str
    action: str  # 'buy' or 'sell'
    quantity: int
    price: float
    signal_confidence: float
    correlation_id: str

    # Full context for decision-making
    signal_data: dict[str, Any]
    scoring_data: dict[str, Any]
    risk_assessment: dict[str, Any]
    recall_data: dict[str, Any]

    status: ApprovalStatus = ApprovalStatus.PENDING
    created_at: str = ""
    expires_at: str = ""
    approved_at: Optional[str] = None
    approved_by: Optional[str] = None
    approval_notes: Optional[str] = None
    rejected_at: Optional[str] = None
    rejected_by: Optional[str] = None
    rejection_reason: Optional[str] = None

    def __post_init__(self) -> None:
        """Set timestamps if not provided."""
        if not self.created_at:
            self.created_at = datetime.now(timezone.utc).isoformat()
        if not self.expires_at:
            # Default 5 minute expiry
            expires = datetime.now(timezone.utc) + timedelta(minutes=5)
            self.expires_at = expires.isoformat()

    def is_expired(self) -> bool:
        """Check if approval request has expired."""
        expires = datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
        return datetime.now(timezone.utc) > expires

    def is_pending(self) -> bool:
        """Check if request is still pending."""
        return self.status == ApprovalStatus.PENDING and not self.is_expired()

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for storage/API."""
        return {
            "request_id": self.request_id,
            "symbol": self.symbol,
            "action": self.action,
            "quantity": self.quantity,
            "price": self.price,
            "signal_confidence": self.signal_confidence,
            "correlation_id": self.correlation_id,
            "signal_data": self.signal_data,
            "scoring_data": self.scoring_data,
            "risk_assessment": self.risk_assessment,
            "recall_data": self.recall_data,
            "status": self.status.value,
            "created_at": self.created_at,
            "expires_at": self.expires_at,
            "approved_at": self.approved_at,
            "approved_by": self.approved_by,
            "approval_notes": self.approval_notes,
            "rejected_at": self.rejected_at,
            "rejected_by": self.rejected_by,
            "rejection_reason": self.rejection_reason,
        }


class ApprovalWorkflow:
    """Manages human approval workflow for trades requiring human review."""

    def __init__(self, db_path: Optional[Path] = None):
        """Initialize approval workflow.

        Args:
            db_path: Path to SQLite database (defaults to data/processed/approvals.db)
        """
        if db_path is None:
            db_path = ROOT_DIR / "data" / "processed" / "approvals.db"

        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

        self._init_schema()

    def _init_schema(self) -> None:
        """Initialize database schema."""
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS approval_requests (
                        request_id TEXT PRIMARY KEY,
                        symbol TEXT NOT NULL,
                        action TEXT NOT NULL,
                        quantity INTEGER NOT NULL,
                        price REAL NOT NULL,
                        signal_confidence REAL NOT NULL,
                        correlation_id TEXT NOT NULL,
                        signal_data TEXT NOT NULL,
                        scoring_data TEXT NOT NULL,
                        risk_assessment TEXT NOT NULL,
                        recall_data TEXT NOT NULL,
                        status TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        expires_at TEXT NOT NULL,
                        approved_at TEXT,
                        approved_by TEXT,
                        approval_notes TEXT,
                        rejected_at TEXT,
                        rejected_by TEXT,
                        rejection_reason TEXT,
                        db_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_status (status),
                        INDEX idx_symbol (symbol),
                        INDEX idx_correlation (correlation_id),
                        INDEX idx_expires (expires_at)
                    )
                    """
                )
                conn.commit()
            finally:
                conn.close()

    def create_approval_request(
        self,
        symbol: str,
        action: str,
        quantity: int,
        price: float,
        signal_confidence: float,
        correlation_id: str,
        signal_data: dict[str, Any],
        scoring_data: dict[str, Any],
        risk_assessment: dict[str, Any],
        recall_data: dict[str, Any],
        expires_in_seconds: int = 300,  # 5 minutes default
    ) -> ApprovalRequest:
        """Create a new approval request.

        Args:
            symbol: Trading symbol
            action: 'buy' or 'sell'
            quantity: Trade quantity
            price: Entry price
            signal_confidence: Signal confidence score (0-1)
            correlation_id: Correlation ID linking to trade signal
            signal_data: Raw signal analysis data
            scoring_data: Scoring agent results
            risk_assessment: Risk assessment data
            recall_data: Historical recall/performance data
            expires_in_seconds: Request expiry duration in seconds

        Returns:
            Created ApprovalRequest object
        """
        request_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        expires_at = (now + timedelta(seconds=expires_in_seconds)).isoformat()

        request = ApprovalRequest(
            request_id=request_id,
            symbol=symbol,
            action=action,
            quantity=quantity,
            price=price,
            signal_confidence=signal_confidence,
            correlation_id=correlation_id,
            signal_data=signal_data,
            scoring_data=scoring_data,
            risk_assessment=risk_assessment,
            recall_data=recall_data,
            status=ApprovalStatus.PENDING,
            created_at=now.isoformat(),
            expires_at=expires_at,
        )

        self._save_request(request)
        return request

    def _save_request(self, request: ApprovalRequest) -> None:
        """Save approval request to database."""
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO approval_requests
                    (request_id, symbol, action, quantity, price, signal_confidence,
                     correlation_id, signal_data, scoring_data, risk_assessment, recall_data,
                     status, created_at, expires_at, approved_at, approved_by, approval_notes,
                     rejected_at, rejected_by, rejection_reason)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        request.request_id,
                        request.symbol,
                        request.action,
                        request.quantity,
                        request.price,
                        request.signal_confidence,
                        request.correlation_id,
                        json.dumps(request.signal_data),
                        json.dumps(request.scoring_data),
                        json.dumps(request.risk_assessment),
                        json.dumps(request.recall_data),
                        request.status.value,
                        request.created_at,
                        request.expires_at,
                        request.approved_at,
                        request.approved_by,
                        request.approval_notes,
                        request.rejected_at,
                        request.rejected_by,
                        request.rejection_reason,
                    ),
                )
                conn.commit()
            finally:
                conn.close()

    def get_request(self, request_id: str) -> Optional[ApprovalRequest]:
        """Retrieve an approval request by ID.

        Args:
            request_id: Request ID

        Returns:
            ApprovalRequest or None if not found
        """
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            conn.row_factory = sqlite3.Row
            try:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT * FROM approval_requests WHERE request_id = ?",
                    (request_id,),
                )
                row = cursor.fetchone()
                if not row:
                    return None

                return self._row_to_request(row)
            finally:
                conn.close()

    def get_pending_requests(self, symbol: Optional[str] = None) -> list[ApprovalRequest]:
        """Get all pending approval requests.

        Args:
            symbol: Optional symbol filter

        Returns:
            List of pending ApprovalRequest objects
        """
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            conn.row_factory = sqlite3.Row
            try:
                cursor = conn.cursor()
                now = datetime.now(timezone.utc).isoformat()

                if symbol:
                    cursor.execute(
                        """
                        SELECT * FROM approval_requests
                        WHERE status = ? AND expires_at > ? AND symbol = ?
                        ORDER BY created_at DESC
                        """,
                        (ApprovalStatus.PENDING.value, now, symbol),
                    )
                else:
                    cursor.execute(
                        """
                        SELECT * FROM approval_requests
                        WHERE status = ? AND expires_at > ?
                        ORDER BY created_at DESC
                        """,
                        (ApprovalStatus.PENDING.value, now),
                    )

                rows = cursor.fetchall()
                return [self._row_to_request(row) for row in rows]
            finally:
                conn.close()

    def approve_request(
        self,
        request_id: str,
        approved_by: str,
        notes: Optional[str] = None,
    ) -> Optional[ApprovalRequest]:
        """Approve an approval request.

        Args:
            request_id: Request ID
            approved_by: User ID or identifier of approver
            notes: Optional approval notes

        Returns:
            Updated ApprovalRequest or None if not found
        """
        request = self.get_request(request_id)
        if not request:
            return None

        request.status = ApprovalStatus.APPROVED
        request.approved_at = datetime.now(timezone.utc).isoformat()
        request.approved_by = approved_by
        request.approval_notes = notes

        self._save_request(request)
        return request

    def reject_request(
        self,
        request_id: str,
        rejected_by: str,
        reason: Optional[str] = None,
    ) -> Optional[ApprovalRequest]:
        """Reject an approval request.

        Args:
            request_id: Request ID
            rejected_by: User ID or identifier of rejector
            reason: Reason for rejection

        Returns:
            Updated ApprovalRequest or None if not found
        """
        request = self.get_request(request_id)
        if not request:
            return None

        request.status = ApprovalStatus.REJECTED
        request.rejected_at = datetime.now(timezone.utc).isoformat()
        request.rejected_by = rejected_by
        request.rejection_reason = reason

        self._save_request(request)
        return request

    def expire_old_requests(self) -> int:
        """Mark expired pending requests as expired. Called periodically.

        Returns:
            Number of requests expired
        """
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                cursor = conn.cursor()
                now = datetime.now(timezone.utc).isoformat()

                cursor.execute(
                    """
                    UPDATE approval_requests
                    SET status = ?
                    WHERE status = ? AND expires_at < ?
                    """,
                    (ApprovalStatus.EXPIRED.value, ApprovalStatus.PENDING.value, now),
                )
                conn.commit()
                return cursor.rowcount
            finally:
                conn.close()

    def get_request_history(
        self,
        symbol: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[ApprovalRequest]:
        """Get request history (completed and expired requests).

        Args:
            symbol: Optional symbol filter
            limit: Maximum number of results
            offset: Pagination offset

        Returns:
            List of ApprovalRequest objects
        """
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            conn.row_factory = sqlite3.Row
            try:
                cursor = conn.cursor()

                if symbol:
                    cursor.execute(
                        """
                        SELECT * FROM approval_requests
                        WHERE status IN (?, ?, ?) AND symbol = ?
                        ORDER BY created_at DESC
                        LIMIT ? OFFSET ?
                        """,
                        (
                            ApprovalStatus.APPROVED.value,
                            ApprovalStatus.REJECTED.value,
                            ApprovalStatus.EXPIRED.value,
                            symbol,
                            limit,
                            offset,
                        ),
                    )
                else:
                    cursor.execute(
                        """
                        SELECT * FROM approval_requests
                        WHERE status IN (?, ?, ?)
                        ORDER BY created_at DESC
                        LIMIT ? OFFSET ?
                        """,
                        (
                            ApprovalStatus.APPROVED.value,
                            ApprovalStatus.REJECTED.value,
                            ApprovalStatus.EXPIRED.value,
                            limit,
                            offset,
                        ),
                    )

                rows = cursor.fetchall()
                return [self._row_to_request(row) for row in rows]
            finally:
                conn.close()

    @staticmethod
    def _row_to_request(row: sqlite3.Row) -> ApprovalRequest:
        """Convert database row to ApprovalRequest object."""
        return ApprovalRequest(
            request_id=row["request_id"],
            symbol=row["symbol"],
            action=row["action"],
            quantity=row["quantity"],
            price=row["price"],
            signal_confidence=row["signal_confidence"],
            correlation_id=row["correlation_id"],
            signal_data=json.loads(row["signal_data"]),
            scoring_data=json.loads(row["scoring_data"]),
            risk_assessment=json.loads(row["risk_assessment"]),
            recall_data=json.loads(row["recall_data"]),
            status=ApprovalStatus(row["status"]),
            created_at=row["created_at"],
            expires_at=row["expires_at"],
            approved_at=row["approved_at"],
            approved_by=row["approved_by"],
            approval_notes=row["approval_notes"],
            rejected_at=row["rejected_at"],
            rejected_by=row["rejected_by"],
            rejection_reason=row["rejection_reason"],
        )
