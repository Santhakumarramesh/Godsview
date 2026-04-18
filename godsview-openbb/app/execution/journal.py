from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import ROOT_DIR

JOURNAL_PATH = ROOT_DIR / "data" / "processed" / "trade_journal.jsonl"


def append_journal_entry(entry: dict[str, Any]) -> Path:
    JOURNAL_PATH.parent.mkdir(parents=True, exist_ok=True)
    enriched = dict(entry)
    enriched.setdefault("logged_at", datetime.now(timezone.utc).isoformat())
    with JOURNAL_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(enriched, sort_keys=True) + "\n")
    return JOURNAL_PATH


def read_journal_entries() -> list[dict[str, Any]]:
    if not JOURNAL_PATH.exists():
        return []
    rows: list[dict[str, Any]] = []
    with JOURNAL_PATH.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                continue
    return rows


def get_trade_count_today(symbol: str | None = None) -> int:
    entries = read_journal_entries()
    today = datetime.now(timezone.utc).date().isoformat()
    count = 0
    for row in entries:
        ts = str(row.get("logged_at", ""))
        if not ts.startswith(today):
            continue
        if symbol and str(row.get("symbol", "")).upper() != symbol.upper():
            continue
        status = str(row.get("status", "")).lower()
        if status in {"simulated", "submitted"}:
            count += 1
    return count
