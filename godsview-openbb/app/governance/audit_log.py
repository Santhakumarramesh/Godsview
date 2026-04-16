from __future__ import annotations

import json
import sqlite3
import threading
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Optional

from app.config import ROOT_DIR


class EventType(Enum):
    """Audit event type enumeration."""
    TRADE_SIGNAL = "trade_signal"
    APPROVAL_REQUIRED = "approval_required"
    APPROVAL_GRANTED = "approval_granted"
    APPROVAL_REJECTED = "approval_rejected"
    TRADE_SUBMITTED = "trade_submitted"
    TRADE_FILLED = "trade_filled"
    TRADE_CANCELED = "trade_canceled"
    TIER_PROMOTED = "tier_promoted"
    TIER_DEMOTED = "tier_demoted"
    TIER_EMERGENCY_DEMOTION = "tier_emergency_demotion"
    ANOMALY_DETECTED = "anomaly_detected"
    GOVERNANCE_OVERRIDE = "governance_override"
    AGENT_DISAGREEMENT = "agent_disagreement"
    KILL_SWITCH_ACTIVATED = "kill_switch_activated"
    CONFIG_CHANGE = "config_change"


@dataclass
class AuditEvent:
    """Immutable audit event record."""

    event_type: EventType
    timestamp: str
    correlation_id: str
    symbol: str
    payload: dict[str, Any]
    user_id: Optional[str] = None
    severity: str = "info"  # info, warning, critical

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for storage."""
        return {
            "event_type": self.event_type.value,
            "timestamp": self.timestamp,
            "correlation_id": self.correlation_id,
            "symbol": self.symbol,
            "user_id": self.user_id,
            "severity": self.severity,
            "payload": self.payload,
        }


class AuditLogger:
    """SQLite-backed persistent audit log with thread-safe operations."""

    def __init__(
        self,
        db_path: Optional[Path] = None,
        init_schema: bool = True,
    ):
        """Initialize audit logger.

        Args:
            db_path: Path to SQLite database (defaults to data/processed/audit.db)
            init_schema: Whether to initialize schema if needed
        """
        if db_path is None:
            db_path = ROOT_DIR / "data" / "processed" / "audit.db"

        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

        if init_schema:
            self._init_schema()

    def _init_schema(self) -> None:
        """Initialize database schema if not present."""
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS audit_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        event_type TEXT NOT NULL,
                        timestamp TEXT NOT NULL,
                        correlation_id TEXT NOT NULL,
                        symbol TEXT NOT NULL,
                        user_id TEXT,
                        severity TEXT DEFAULT 'info',
                        payload TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_correlation (correlation_id),
                        INDEX idx_timestamp (timestamp),
                        INDEX idx_symbol (symbol),
                        INDEX idx_event_type (event_type)
                    )
                    """
                )
                conn.commit()
            finally:
                conn.close()

    def log_event(
        self,
        event_type: EventType,
        correlation_id: str,
        symbol: str,
        payload: dict[str, Any],
        user_id: Optional[str] = None,
        severity: str = "info",
    ) -> int:
        """Write an audit event to the log.

        Args:
            event_type: Type of event
            correlation_id: Unique ID linking related events (signal -> order -> fill)
            symbol: Trading symbol
            payload: Event-specific data payload
            user_id: Optional user ID (for human actions)
            severity: Event severity (info, warning, critical)

        Returns:
            Event ID in database
        """
        timestamp = datetime.now(timezone.utc).isoformat()

        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    INSERT INTO audit_events
                    (event_type, timestamp, correlation_id, symbol, user_id, severity, payload)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        event_type.value,
                        timestamp,
                        correlation_id,
                        symbol,
                        user_id,
                        severity,
                        json.dumps(payload),
                    ),
                )
                conn.commit()
                return cursor.lastrowid
            finally:
                conn.close()

    def query_events(
        self,
        event_type: Optional[EventType] = None,
        symbol: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """Query audit events with filters.

        Args:
            event_type: Filter by event type
            symbol: Filter by symbol
            start_time: Filter by start time (ISO format)
            end_time: Filter by end time (ISO format)
            limit: Maximum number of results
            offset: Offset for pagination

        Returns:
            List of event dictionaries
        """
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            conn.row_factory = sqlite3.Row
            try:
                cursor = conn.cursor()

                query = "SELECT * FROM audit_events WHERE 1=1"
                params: list[Any] = []

                if event_type:
                    query += " AND event_type = ?"
                    params.append(event_type.value)
                if symbol:
                    query += " AND symbol = ?"
                    params.append(symbol)
                if start_time:
                    query += " AND timestamp >= ?"
                    params.append(start_time)
                if end_time:
                    query += " AND timestamp <= ?"
                    params.append(end_time)

                query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
                params.extend([limit, offset])

                cursor.execute(query, params)
                rows = cursor.fetchall()

                return [
                    {
                        "id": row["id"],
                        "event_type": row["event_type"],
                        "timestamp": row["timestamp"],
                        "correlation_id": row["correlation_id"],
                        "symbol": row["symbol"],
                        "user_id": row["user_id"],
                        "severity": row["severity"],
                        "payload": json.loads(row["payload"]),
                        "created_at": row["created_at"],
                    }
                    for row in rows
                ]
            finally:
                conn.close()

    def get_decision_trail(self, correlation_id: str) -> list[dict[str, Any]]:
        """Get full audit trail for a single trade decision (signal -> approval -> execution).

        Args:
            correlation_id: The correlation ID linking related events

        Returns:
            List of events in chronological order for this decision
        """
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            conn.row_factory = sqlite3.Row
            try:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    SELECT * FROM audit_events
                    WHERE correlation_id = ?
                    ORDER BY timestamp ASC
                    """,
                    (correlation_id,),
                )
                rows = cursor.fetchall()

                return [
                    {
                        "id": row["id"],
                        "event_type": row["event_type"],
                        "timestamp": row["timestamp"],
                        "correlation_id": row["correlation_id"],
                        "symbol": row["symbol"],
                        "user_id": row["user_id"],
                        "severity": row["severity"],
                        "payload": json.loads(row["payload"]),
                        "created_at": row["created_at"],
                    }
                    for row in rows
                ]
            finally:
                conn.close()

    def export_audit(
        self,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        format: str = "json",
    ) -> str:
        """Export audit log for compliance review.

        Args:
            start_time: Start time filter (ISO format)
            end_time: End time filter (ISO format)
            format: Export format ('json' or 'csv')

        Returns:
            Exported data as string
        """
        events = self.query_events(start_time=start_time, end_time=end_time, limit=10000)

        if format == "json":
            return json.dumps(events, indent=2, default=str)

        if format == "csv":
            import csv
            from io import StringIO

            output = StringIO()
            if not events:
                return ""

            writer = csv.DictWriter(
                output,
                fieldnames=[
                    "id",
                    "event_type",
                    "timestamp",
                    "correlation_id",
                    "symbol",
                    "user_id",
                    "severity",
                    "payload",
                ],
            )
            writer.writeheader()
            for event in events:
                event["payload"] = json.dumps(event["payload"])
                writer.writerow(event)

            return output.getvalue()

        raise ValueError(f"Unsupported export format: {format}")

    def get_event_count(self, event_type: Optional[EventType] = None) -> int:
        """Get total count of events optionally filtered by type.

        Args:
            event_type: Optional event type filter

        Returns:
            Total count of events
        """
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                cursor = conn.cursor()
                if event_type:
                    cursor.execute(
                        "SELECT COUNT(*) FROM audit_events WHERE event_type = ?",
                        (event_type.value,),
                    )
                else:
                    cursor.execute("SELECT COUNT(*) FROM audit_events")
                return cursor.fetchone()[0]
            finally:
                conn.close()

    def clear_old_events(self, days: int = 90) -> int:
        """Delete audit events older than specified days (for cleanup).

        Args:
            days: Number of days to retain

        Returns:
            Number of deleted rows
        """
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    DELETE FROM audit_events
                    WHERE datetime(timestamp) < datetime('now', '-' || ? || ' days')
                    """,
                    (days,),
                )
                conn.commit()
                return cursor.rowcount
            finally:
                conn.close()


# Global audit logger instance
_audit_logger: Optional[AuditLogger] = None


def get_audit_logger() -> AuditLogger:
    """Get or create the global audit logger instance.

    Returns:
        Global AuditLogger instance
    """
    global _audit_logger
    if _audit_logger is None:
        _audit_logger = AuditLogger()
    return _audit_logger
