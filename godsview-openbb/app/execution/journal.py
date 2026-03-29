from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import json
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

