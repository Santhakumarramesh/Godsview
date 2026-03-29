from __future__ import annotations

import argparse
from datetime import datetime, timezone
from typing import Any

from app.execution.journal import read_journal_entries
from app.utils import read_json, write_json


def build_daily_report(symbol: str | None = None) -> dict[str, Any]:
    today = datetime.now(timezone.utc).date().isoformat()
    rows = read_journal_entries()
    filtered = []
    for row in rows:
        ts = str(row.get("logged_at", ""))
        if not ts.startswith(today):
            continue
        if symbol and str(row.get("symbol", "")).upper() != symbol.upper():
            continue
        filtered.append(row)

    taken = [r for r in filtered if str(r.get("status", "")).lower() in {"simulated", "submitted"}]
    skipped = [r for r in filtered if str(r.get("status", "")).lower() in {"blocked", "error"}]

    reason_counts: dict[str, int] = {}
    for row in filtered:
        reason = str(row.get("reason", row.get("block_reason", "unknown")))
        reason_counts[reason] = reason_counts.get(reason, 0) + 1

    latest_run = read_json("data/processed/latest_orchestrator_run.json") or {}
    report = {
        "date": today,
        "symbol": symbol.upper() if symbol else "ALL",
        "trades_taken": len(taken),
        "trades_skipped_or_blocked": len(skipped),
        "top_reasons": sorted(reason_counts.items(), key=lambda item: item[1], reverse=True)[:10],
        "system_health": "GOOD" if len(skipped) <= len(taken) + 2 else "DEGRADED",
        "latest_strategy_control": latest_run.get("data", {}).get("strategy_control"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    suffix = f"_{symbol.upper()}" if symbol else ""
    write_json(f"data/processed/daily_report_{today}{suffix}.json", report)
    write_json("data/processed/daily_report_latest.json", report)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate daily system report from journal/orchestrator artifacts.")
    parser.add_argument("--symbol", type=str, default=None)
    args = parser.parse_args()
    print(build_daily_report(args.symbol))

