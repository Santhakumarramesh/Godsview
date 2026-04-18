from __future__ import annotations

from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import pandas as pd


def plot_chart_with_overlays(
    *,
    df: pd.DataFrame,
    title: str,
    output_path: Path,
    order_blocks: list[dict[str, Any]] | None = None,
    fvgs: list[dict[str, Any]] | None = None,
    trade: dict[str, Any] | None = None,
) -> Path:
    order_blocks = order_blocks or []
    fvgs = fvgs or []

    fig, ax = plt.subplots(figsize=(14, 7))
    x_values = range(len(df))
    closes = df["Close"].tolist()
    ax.plot(x_values, closes, color="#1f77b4", linewidth=1.4, label="Close")

    for block in order_blocks[-12:]:
        low = float(block["low"])
        high = float(block["high"])
        side = str(block.get("side", "bullish"))
        color = "#00a86b" if side == "bullish" else "#d62728"
        ax.axhspan(low, high, alpha=0.12, color=color)

    for gap in fvgs[-12:]:
        low = float(gap["low"])
        high = float(gap["high"])
        side = str(gap.get("side", "bullish"))
        color = "#17becf" if side == "bullish" else "#ff7f0e"
        ax.axhspan(low, high, alpha=0.08, color=color)

    if trade:
        entry = trade.get("entry")
        stop = trade.get("stop")
        target = trade.get("target")
        if entry is not None:
            ax.axhline(
                float(entry),
                linestyle="--",
                linewidth=1.0,
                color="#9467bd",
                label="Entry",
            )
        if stop is not None:
            ax.axhline(
                float(stop), linestyle=":", linewidth=1.0, color="#d62728", label="Stop"
            )
        if target is not None:
            ax.axhline(
                float(target),
                linestyle=":",
                linewidth=1.0,
                color="#2ca02c",
                label="Target",
            )

    ax.set_title(title)
    ax.set_xlabel("Bars")
    ax.set_ylabel("Price")
    ax.grid(alpha=0.25)
    ax.legend(loc="best")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(output_path, dpi=130)
    plt.close(fig)
    return output_path
