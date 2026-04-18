from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from app.config import ROOT_DIR
from app.visuals.plot_chart import plot_chart_with_overlays


def save_analysis_screenshot(
    *,
    symbol: str,
    timeframe: str,
    df: pd.DataFrame,
    order_blocks: list[dict[str, Any]] | None = None,
    fvgs: list[dict[str, Any]] | None = None,
    trade: dict[str, Any] | None = None,
    suffix: str = "analysis",
) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    safe_symbol = symbol.upper().replace("/", "")
    safe_tf = timeframe.lower().replace(" ", "")
    file_name = f"{safe_symbol}_{safe_tf}_{suffix}_{stamp}.png"
    output_path = ROOT_DIR / "charts" / file_name
    title = f"{safe_symbol} {timeframe} - {suffix}"
    return plot_chart_with_overlays(
        df=df,
        title=title,
        output_path=output_path,
        order_blocks=order_blocks,
        fvgs=fvgs,
        trade=trade,
    )
