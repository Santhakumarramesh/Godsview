from __future__ import annotations

import argparse
import time
from datetime import datetime, timezone

from app.agents.orchestrator import run_orchestrator
from app.config import settings


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_loop(symbol: str, interval_seconds: int, with_replay: bool) -> None:
    print(f"[{utc_now_iso()}] brain_loop start symbol={symbol} interval={interval_seconds}s replay={with_replay}")
    while True:
        try:
            result = run_orchestrator(
                symbol=symbol,
                live=False,
                dry_run=True,
                human_approval=False,
                with_replay=with_replay,
            )
            blocked = bool(result.get("blocked", False))
            reason = str(result.get("block_reason", ""))
            print(
                f"[{utc_now_iso()}] cycle complete symbol={symbol} blocked={blocked} reason={reason}"
            )
        except Exception as err:  # noqa: BLE001
            print(f"[{utc_now_iso()}] cycle error symbol={symbol} error={err}")
        time.sleep(max(5, interval_seconds))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Godsview brain update loop")
    parser.add_argument("--symbol", type=str, default=settings.symbol)
    parser.add_argument("--interval", type=int, default=30, help="Seconds between cycles")
    parser.add_argument("--with-replay", action="store_true", help="Run replay on each cycle")
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    run_loop(symbol=args.symbol.upper(), interval_seconds=args.interval, with_replay=bool(args.with_replay))

