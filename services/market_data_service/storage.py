"""
GodsView v2 — Market data storage layer.

Wraps a SQLite DB (via aiosqlite) for local caching of OHLCV bars.
The schema is intentionally minimal — this is a read-heavy append-mostly store.

Tables:
  bars  (symbol, timeframe, timestamp, open, high, low, close, volume)
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import aiosqlite  # type: ignore[import]

    _AIOSQLITE_OK = True
except ImportError:
    _AIOSQLITE_OK = False

from services.shared.logging import get_logger
from services.shared.types import Bar

log = get_logger(__name__)

_DEFAULT_DB = Path("./data/market_data.db")


class BarStorage:
    """
    Async SQLite-backed bar cache.

    Usage:
        storage = BarStorage("./data/market.db")
        await storage.init()
        await storage.upsert_bars(bars)
        bars = await storage.load_bars("AAPL", "15min", limit=200)
    """

    def __init__(self, db_path: str | Path = _DEFAULT_DB) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

    async def init(self) -> None:
        """Create tables if they don't exist."""
        if not _AIOSQLITE_OK:
            log.warning("aiosqlite_not_installed", detail="bar storage disabled")
            return

        async with aiosqlite.connect(str(self.db_path)) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS bars (
                    symbol    TEXT    NOT NULL,
                    timeframe TEXT    NOT NULL,
                    timestamp TEXT    NOT NULL,
                    open      REAL    NOT NULL,
                    high      REAL    NOT NULL,
                    low       REAL    NOT NULL,
                    close     REAL    NOT NULL,
                    volume    REAL    NOT NULL DEFAULT 0,
                    vwap      REAL,
                    trades    INTEGER,
                    PRIMARY KEY (symbol, timeframe, timestamp)
                )
            """)
            await db.execute("""
                CREATE INDEX IF NOT EXISTS idx_bars_sym_tf_ts
                ON bars (symbol, timeframe, timestamp DESC)
            """)
            await db.commit()
            log.info("bar_storage_ready", db=str(self.db_path))

    async def upsert_bars(self, bars: list[Bar]) -> int:
        """Insert-or-replace bars. Returns number of rows written."""
        if not _AIOSQLITE_OK or not bars:
            return 0

        rows = [
            (
                b.symbol,
                b.timeframe,
                b.timestamp.isoformat(),
                b.open,
                b.high,
                b.low,
                b.close,
                b.volume,
                b.vwap,
                b.trades,
            )
            for b in bars
        ]

        async with aiosqlite.connect(str(self.db_path)) as db:
            await db.executemany(
                """
                INSERT OR REPLACE INTO bars
                  (symbol, timeframe, timestamp, open, high, low, close, volume, vwap, trades)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                rows,
            )
            await db.commit()
        return len(rows)

    async def load_bars(
        self,
        symbol: str,
        timeframe: str,
        *,
        start: datetime | None = None,
        end: datetime | None = None,
        limit: int = 500,
    ) -> list[Bar]:
        """Load cached bars from SQLite, newest first then reversed."""
        if not _AIOSQLITE_OK:
            return []

        conditions = ["symbol = ?", "timeframe = ?"]
        params: list[Any] = [symbol, timeframe]

        if start:
            conditions.append("timestamp >= ?")
            params.append(start.isoformat())
        if end:
            conditions.append("timestamp <= ?")
            params.append(end.isoformat())

        where = " AND ".join(conditions)
        sql = f"""
            SELECT symbol, timeframe, timestamp,
                   open, high, low, close, volume, vwap, trades
            FROM bars
            WHERE {where}
            ORDER BY timestamp DESC
            LIMIT ?
        """
        params.append(limit)

        bars: list[Bar] = []
        try:
            async with aiosqlite.connect(str(self.db_path)) as db:
                async with db.execute(sql, params) as cursor:
                    async for row in cursor:
                        ts_str = row[2]
                        ts = datetime.fromisoformat(ts_str)
                        if ts.tzinfo is None:
                            ts = ts.replace(tzinfo=timezone.utc)
                        bars.append(
                            Bar(
                                symbol=row[0],
                                timeframe=row[1],
                                timestamp=ts,
                                open=row[3],
                                high=row[4],
                                low=row[5],
                                close=row[6],
                                volume=row[7],
                                vwap=row[8],
                                trades=row[9],
                            )
                        )
        except Exception as exc:
            log.error("bar_load_failed", symbol=symbol, err=str(exc))
            return []

        bars.reverse()  # return oldest → newest
        return bars

    async def latest_timestamp(self, symbol: str, timeframe: str) -> datetime | None:
        """Return the most recent bar timestamp for a symbol+timeframe."""
        if not _AIOSQLITE_OK:
            return None
        try:
            async with aiosqlite.connect(str(self.db_path)) as db:
                async with db.execute(
                    "SELECT MAX(timestamp) FROM bars WHERE symbol=? AND timeframe=?",
                    (symbol, timeframe),
                ) as cursor:
                    row = await cursor.fetchone()
                    if row and row[0]:
                        ts = datetime.fromisoformat(row[0])
                        return (
                            ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts
                        )
        except Exception as exc:
            log.warning("latest_ts_failed", symbol=symbol, err=str(exc))
        return None

    async def count_bars(self, symbol: str, timeframe: str) -> int:
        if not _AIOSQLITE_OK:
            return 0
        async with aiosqlite.connect(str(self.db_path)) as db:
            async with db.execute(
                "SELECT COUNT(*) FROM bars WHERE symbol=? AND timeframe=?",
                (symbol, timeframe),
            ) as cursor:
                row = await cursor.fetchone()
                return int(row[0]) if row else 0


# Module-level default instance
default_storage = BarStorage()
