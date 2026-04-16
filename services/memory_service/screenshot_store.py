"""
GodsView v2 — Screenshot Store for Chart Storage & Retrieval.

Stores chart screenshots with trade context and metadata.
Enables visual chart similarity search and historical chart lookup.

Features:
  - PNG screenshot storage in structured directories
  - SQLite metadata persistence
  - Candlestick chart generation with indicators & levels
  - Query by symbol, setup_type, outcome, date range
  - Visual/statistical similarity search across past charts
"""
from __future__ import annotations

import io
import json
import sqlite3
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional

import numpy as np

from services.shared.config import cfg
from services.shared.logging import get_logger
from services.shared.types import Bar, Signal

log = get_logger(__name__)

_DATA_DIR = Path(cfg.data_dir) / "screenshots"
_DB_PATH = Path(cfg.data_dir) / "screenshots.db"


class ScreenshotStore:
    """Persistent screenshot storage with SQLite metadata."""

    def __init__(self) -> None:
        self._conn: Optional[sqlite3.Connection] = None
        self._ready = False

    async def init(self) -> None:
        try:
            _DATA_DIR.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
            self._create_schema()
            self._ready = True
            log.info("screenshot_store_ready", path=str(_DB_PATH))
        except Exception as exc:
            log.error("screenshot_store_init_failed", err=str(exc))

    def _create_schema(self) -> None:
        if self._conn is None:
            return
        cursor = self._conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS screenshots (
                id TEXT PRIMARY KEY,
                symbol TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                setup_type TEXT NOT NULL,
                timeframe TEXT DEFAULT '15min',
                entry_price REAL,
                stop_loss REAL,
                take_profit REAL,
                outcome TEXT,
                pnl_pct REAL,
                tags TEXT,
                file_path TEXT NOT NULL,
                thumbnail_path TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_symbol_date ON screenshots(symbol, timestamp)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_setup_outcome ON screenshots(setup_type, outcome)
        """)
        self._conn.commit()

    async def save_screenshot(
        self,
        bars: list[Bar],
        signal: Signal,
        outcome: str = "pending",
        pnl_pct: float = 0.0,
        tags: list[str] | None = None,
        notes: str = "",
    ) -> dict[str, Any]:
        """Generate and store a chart screenshot with metadata."""
        if not self._ready or self._conn is None:
            return {"status": "not_ready"}

        screenshot_id = str(uuid.uuid4())
        symbol = signal.symbol
        timestamp = signal.timestamp.isoformat()

        try:
            # Generate candlestick chart
            chart_bytes = _generate_candlestick_chart(
                bars=bars,
                signal=signal,
                title=f"{symbol} {signal.setup_type} @ {signal.timeframe}",
            )

            # Save PNG file
            symbol_dir = _DATA_DIR / symbol
            symbol_dir.mkdir(parents=True, exist_ok=True)

            file_path = symbol_dir / f"{screenshot_id}.png"
            file_path.write_bytes(chart_bytes)

            # Generate thumbnail (same image for now; could optimize)
            thumbnail_path = symbol_dir / f"{screenshot_id}_thumb.png"
            thumbnail_path.write_bytes(chart_bytes)

            # Store metadata in SQLite
            cursor = self._conn.cursor()
            cursor.execute("""
                INSERT INTO screenshots (
                    id, symbol, timestamp, setup_type, timeframe,
                    entry_price, stop_loss, take_profit,
                    outcome, pnl_pct, tags, file_path, thumbnail_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                screenshot_id,
                symbol,
                timestamp,
                signal.signal_type.value,
                signal.timeframe,
                float(signal.entry),
                float(signal.stop),
                float(signal.target),
                outcome,
                float(pnl_pct),
                json.dumps(tags or []),
                str(file_path),
                str(thumbnail_path),
            ))
            self._conn.commit()

            log.info(
                "screenshot_saved",
                id=screenshot_id,
                symbol=symbol,
                setup_type=signal.signal_type.value,
            )

            return {
                "id": screenshot_id,
                "status": "saved",
                "file_path": str(file_path),
                "symbol": symbol,
                "outcome": outcome,
            }

        except Exception as exc:
            log.error("screenshot_save_failed", symbol=symbol, err=str(exc))
            return {"status": "error", "error": str(exc)}

    async def find_similar_charts(
        self,
        bars: list[Bar],
        signal: Signal,
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """Find visually/statistically similar past charts."""
        if not self._ready or self._conn is None:
            return []

        try:
            # Compute feature vector from current bars
            current_features = _extract_chart_features(bars, signal)

            # Query database for same symbol/setup
            cursor = self._conn.cursor()
            cursor.execute("""
                SELECT id, symbol, timestamp, setup_type, outcome, pnl_pct,
                       entry_price, stop_loss, take_profit, file_path
                FROM screenshots
                WHERE symbol = ? AND setup_type = ?
                ORDER BY timestamp DESC
                LIMIT ?
            """, (signal.symbol, signal.signal_type.value, top_k * 3))

            results = cursor.fetchall()

            # Score by feature similarity
            scored = []
            for row in results:
                screenshot_id, symbol, ts, setup, outcome, pnl, entry, sl, tp, path = row
                past_features = _extract_screenshot_features_from_path(path) \
                    if Path(path).exists() else None

                if past_features:
                    sim = _cosine_similarity(current_features, past_features)
                    scored.append({
                        "id": screenshot_id,
                        "symbol": symbol,
                        "timestamp": ts,
                        "setup_type": setup,
                        "outcome": outcome,
                        "pnl_pct": pnl,
                        "entry_price": entry,
                        "stop_loss": sl,
                        "take_profit": tp,
                        "file_path": path,
                        "similarity": sim,
                    })

            # Return top-k by similarity
            scored.sort(key=lambda x: x["similarity"], reverse=True)
            return scored[:top_k]

        except Exception as exc:
            log.error("similar_charts_search_failed", err=str(exc))
            return []

    async def get_screenshot(self, screenshot_id: str) -> dict[str, Any] | None:
        """Retrieve a specific screenshot and metadata."""
        if not self._ready or self._conn is None:
            return None

        try:
            cursor = self._conn.cursor()
            cursor.execute("""
                SELECT id, symbol, timestamp, setup_type, timeframe,
                       entry_price, stop_loss, take_profit,
                       outcome, pnl_pct, tags, file_path, thumbnail_path
                FROM screenshots WHERE id = ?
            """, (screenshot_id,))

            row = cursor.fetchone()
            if not row:
                return None

            return {
                "id": row[0],
                "symbol": row[1],
                "timestamp": row[2],
                "setup_type": row[3],
                "timeframe": row[4],
                "entry_price": row[5],
                "stop_loss": row[6],
                "take_profit": row[7],
                "outcome": row[8],
                "pnl_pct": row[9],
                "tags": json.loads(row[10]) if row[10] else [],
                "file_path": row[11],
                "thumbnail_path": row[12],
            }

        except Exception as exc:
            log.error("screenshot_get_failed", id=screenshot_id, err=str(exc))
            return None

    async def list_screenshots(
        self,
        symbol: str | None = None,
        setup_type: str | None = None,
        outcome: str | None = None,
        days_back: int = 30,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Query screenshots by filters."""
        if not self._ready or self._conn is None:
            return []

        try:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days_back)).isoformat()

            query = "SELECT id, symbol, timestamp, setup_type, outcome, pnl_pct, file_path FROM screenshots WHERE timestamp >= ?"
            params = [cutoff]

            if symbol:
                query += " AND symbol = ?"
                params.append(symbol)
            if setup_type:
                query += " AND setup_type = ?"
                params.append(setup_type)
            if outcome:
                query += " AND outcome = ?"
                params.append(outcome)

            query += " ORDER BY timestamp DESC LIMIT ?"
            params.append(limit)

            cursor = self._conn.cursor()
            cursor.execute(query, params)
            rows = cursor.fetchall()

            return [
                {
                    "id": row[0],
                    "symbol": row[1],
                    "timestamp": row[2],
                    "setup_type": row[3],
                    "outcome": row[4],
                    "pnl_pct": row[5],
                    "file_path": row[6],
                }
                for row in rows
            ]

        except Exception as exc:
            log.error("screenshots_list_failed", err=str(exc))
            return []

    async def update_outcome(
        self,
        screenshot_id: str,
        outcome: str,
        pnl_pct: float,
    ) -> dict[str, Any]:
        """Update screenshot outcome after trade completion."""
        if not self._ready or self._conn is None:
            return {"status": "not_ready"}

        try:
            cursor = self._conn.cursor()
            cursor.execute("""
                UPDATE screenshots
                SET outcome = ?, pnl_pct = ?
                WHERE id = ?
            """, (outcome, pnl_pct, screenshot_id))
            self._conn.commit()

            log.info("screenshot_outcome_updated", id=screenshot_id, outcome=outcome)
            return {"status": "updated", "id": screenshot_id}

        except Exception as exc:
            log.error("screenshot_update_failed", id=screenshot_id, err=str(exc))
            return {"status": "error", "error": str(exc)}


# ── Chart Generation ──────────────────────────────────────────────────────────

def _generate_candlestick_chart(
    bars: list[Bar],
    signal: Signal,
    title: str = "Price Chart",
) -> bytes:
    """Generate a candlestick chart with entry/SL/TP levels marked."""
    try:
        import matplotlib.pyplot as plt
        import matplotlib.patches as mpatches
        from matplotlib.patches import Rectangle
    except ImportError:
        log.warning("matplotlib_not_installed, returning placeholder")
        return b"PNG_PLACEHOLDER"

    fig, ax = plt.subplots(figsize=(12, 6), dpi=100)

    # Candlesticks
    for i, bar in enumerate(bars[-100:]):  # Last 100 bars
        if bar.is_bullish:
            color = "green"
        else:
            color = "red"

        # Wick
        ax.plot([i, i], [bar.low, bar.high], color=color, linewidth=1)

        # Body
        body_height = abs(bar.close - bar.open)
        body_bottom = min(bar.open, bar.close)
        rect = Rectangle(
            (i - 0.3, body_bottom),
            0.6,
            body_height,
            facecolor=color,
            edgecolor=color,
            linewidth=1,
        )
        ax.add_patch(rect)

    # Mark entry, SL, TP
    if len(bars) > 0:
        last_idx = len(bars) - 1
        ax.axhline(y=signal.entry, color="blue", linestyle="--", label="Entry", linewidth=2)
        ax.axhline(y=signal.stop, color="red", linestyle="--", label="SL", linewidth=2)
        ax.axhline(y=signal.target, color="green", linestyle="--", label="TP", linewidth=2)

    # EMA indicators (simplified)
    closes = [b.close for b in bars[-100:]]
    if len(closes) >= 20:
        ema20 = _simple_ema(closes, 20)
        ax.plot(range(len(ema20)), ema20, color="orange", label="EMA20", linewidth=1)

    ax.set_title(title, fontsize=14, fontweight="bold")
    ax.set_xlabel("Bars")
    ax.set_ylabel("Price")
    ax.legend(loc="upper left")
    ax.grid(True, alpha=0.3)

    # Serialize to PNG bytes
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=100, bbox_inches="tight")
    buf.seek(0)
    plt.close(fig)

    return buf.getvalue()


def _simple_ema(values: list[float], period: int) -> list[float]:
    """Compute exponential moving average."""
    if len(values) < period:
        return values

    ema = [sum(values[:period]) / period]
    multiplier = 2 / (period + 1)

    for val in values[period:]:
        ema.append((val - ema[-1]) * multiplier + ema[-1])

    return ema


# ── Feature Extraction ─────────────────────────────────────────────────────────

def _extract_chart_features(bars: list[Bar], signal: Signal) -> list[float]:
    """Extract statistical features from current bars for similarity search."""
    if not bars:
        return [0.0] * 20

    closes = [b.close for b in bars[-50:]]
    volumes = [b.volume for b in bars[-50:]]

    features = [
        np.mean(closes),  # Mean close
        np.std(closes),   # Volatility
        closes[-1],       # Latest close
        (closes[-1] - closes[0]) / closes[0],  # Return
        np.mean(volumes),  # Avg volume
        signal.confidence,  # Confidence
        signal.structure_score,  # Structure
        signal.volume_score,  # Volume score
        signal.order_flow_score,  # Order flow
        signal.risk_reward,  # Risk/reward
    ]

    # Pad to 20 dimensions
    while len(features) < 20:
        features.append(0.0)

    return features[:20]


def _extract_screenshot_features_from_path(path: str) -> list[float] | None:
    """Extract features from stored screenshot (simplified)."""
    # In production, could analyze the image or store features separately
    # For now, return None to indicate features need recalculation
    return None


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two feature vectors."""
    if not a or not b or len(a) != len(b):
        return 0.0

    dot = sum(x * y for x, y in zip(a, b))
    mag_a = np.sqrt(sum(x ** 2 for x in a)) or 1.0
    mag_b = np.sqrt(sum(x ** 2 for x in b)) or 1.0

    return dot / (mag_a * mag_b)


# ── Factory ───────────────────────────────────────────────────────────────────

async def make_screenshot_store() -> ScreenshotStore:
    """Initialize and return screenshot store."""
    store = ScreenshotStore()
    await store.init()
    return store
