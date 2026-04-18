from __future__ import annotations

from typing import Any

import pandas as pd

from app.analysis.fvg import detect_fvg
from app.analysis.liquidity import detect_equal_levels
from app.analysis.order_blocks import detect_order_blocks
from app.analysis.structure import analyze_structure
from app.analysis.sweep import detect_liquidity_sweep


def generate_setup_candidate(
    df: pd.DataFrame, session: dict[str, Any] | None = None
) -> dict[str, Any]:
    if len(df) < 80:
        return {"valid": False, "reason": "insufficient_bars"}

    session = session or {}
    time_window_trigger = bool(session.get("allowed", True))
    structure = analyze_structure(df)
    liquidity = detect_equal_levels(df.tail(180))
    sweep = detect_liquidity_sweep(df.tail(120))
    blocks = detect_order_blocks(df.tail(220))
    fvgs = detect_fvg(df.tail(220))
    latest_close = float(df["Close"].iloc[-1])

    if not time_window_trigger:
        return {
            "valid": False,
            "reason": "outside_time_window",
            "time_window_trigger": False,
            "structure": structure,
            "liquidity": liquidity,
            "sweep": sweep,
            "order_blocks": blocks[-20:],
            "fvgs": fvgs[-20:],
        }

    if not sweep.get("detected"):
        return {
            "valid": False,
            "reason": "no_sweep",
            "time_window_trigger": time_window_trigger,
            "structure": structure,
            "liquidity": liquidity,
            "sweep": sweep,
            "order_blocks": blocks[-20:],
            "fvgs": fvgs[-20:],
        }

    direction = "long" if sweep.get("direction") == "bullish" else "short"
    setup = "sweep_reclaim"
    if structure.get("choch"):
        setup = "sweep_reclaim_choch"
    elif structure.get("bos"):
        setup = "sweep_reclaim_bos"

    block = None
    for item in reversed(blocks):
        side = item.get("side")
        if (direction == "long" and side == "bullish") or (
            direction == "short" and side == "bearish"
        ):
            block = item
            break

    if block:
        stop = float(block["low"]) if direction == "long" else float(block["high"])
    else:
        recent = df.tail(25)
        stop = (
            float(recent["Low"].min())
            if direction == "long"
            else float(recent["High"].max())
        )

    aligned_fvg = None
    for gap in reversed(fvgs):
        side = str(gap.get("side", ""))
        if (direction == "long" and side == "bullish") or (
            direction == "short" and side == "bearish"
        ):
            aligned_fvg = gap
            break

    risk = abs(latest_close - stop)
    if risk <= 0:
        return {"valid": False, "reason": "invalid_stop_distance"}

    target = (
        latest_close + (2.0 * risk)
        if direction == "long"
        else latest_close - (2.0 * risk)
    )
    return {
        "valid": True,
        "setup": setup,
        "direction": direction,
        "entry": latest_close,
        "stop": stop,
        "target": target,
        "rr": 2.0,
        "time_window_trigger": time_window_trigger,
        "has_order_block": block is not None,
        "has_fvg": aligned_fvg is not None,
        "structure": structure,
        "liquidity": liquidity,
        "sweep": sweep,
        "order_blocks": blocks[-20:],
        "fvgs": fvgs[-20:],
        "entry_block": block,
        "entry_fvg": aligned_fvg,
    }
