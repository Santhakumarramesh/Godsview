/**
 * TradingViewChart.tsx
 *
 * Embeds TradingView's Advanced Chart widget via direct iframe URL.
 * This approach requires no JavaScript library download and renders immediately.
 *
 * Data source: Coinbase (BTCUSD, ETHUSD) — IDENTICAL to TradingView.com prices.
 * Free for personal/non-commercial use per TradingView's embed policy.
 */

import { useMemo } from "react";

type Timeframe = "1" | "5" | "15" | "60" | "D";

interface Props {
  symbol?:     string;
  timeframe?:  Timeframe;
  height?:     number;
  showToolbar?: boolean;
  studies?:    string[];
}

// Map our internal symbol codes to TradingView's exchange:symbol format
const SYMBOL_MAP: Record<string, string> = {
  BTCUSD:  "COINBASE:BTCUSD",
  ETHUSD:  "COINBASE:ETHUSD",
  BTCUSDT: "BINANCE:BTCUSDT",
  ETHUSDT: "BINANCE:ETHUSDT",
};

// TradingView interval strings
const TF_MAP: Record<string, string> = {
  "1":   "1",
  "5":   "5",
  "15":  "15",
  "60":  "60",
  "D":   "D",
  "1Min":  "1",
  "5Min":  "5",
  "15Min": "15",
  "1Hour": "60",
  "1Day":  "D",
};

// ─────────────────────────────────────────────────────────────────────────────
export default function TradingViewChart({
  symbol      = "BTCUSD",
  timeframe   = "5",
  height      = 480,
  showToolbar = true,
}: Props) {
  const tvSymbol = SYMBOL_MAP[symbol] ?? `COINBASE:${symbol}`;
  const tvTf     = TF_MAP[timeframe] ?? timeframe;

  const iframeSrc = useMemo(() => {
    const base = "https://www.tradingview.com/widgetembed/";
    const p = [
      `symbol=${encodeURIComponent(tvSymbol)}`,
      `interval=${tvTf}`,
      `theme=dark`,
      `style=1`,
      `locale=en`,
      `toolbar_bg=%231a191b`,
      `enable_publishing=0`,
      `hide_top_toolbar=${showToolbar ? "0" : "1"}`,
      `hide_legend=0`,
      `save_image=0`,
      `hide_side_toolbar=0`,
      `allow_symbol_change=0`,
      `withdateranges=1`,
      `calendar=0`,
      `studies=Volume%40tv-basicstudies`,
      `studies=RSI%40tv-basicstudies`,
      `backgroundColor=rgba%2814%2C14%2C15%2C1%29`,
    ];
    return `${base}?${p.join("&")}`;
  }, [tvSymbol, tvTf, showToolbar]);

  return (
    <div style={{ height: `${height}px`, backgroundColor: "#1a191b", overflow: "hidden" }}>
      <iframe
        src={iframeSrc}
        title={`TradingView chart — ${tvSymbol}`}
        width="100%"
        height="100%"
        frameBorder="0"
        allow="fullscreen"
        style={{ display: "block", border: "none" }}
      />
    </div>
  );
}

/** Utility: convert "5Min" → "5" for the TradingView timeframe prop */
export function toTVInterval(tf: string): Timeframe {
  return (TF_MAP[tf] ?? tf) as Timeframe;
}
