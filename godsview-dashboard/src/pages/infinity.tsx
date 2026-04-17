import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import TradingViewChart from "@/components/TradingViewChart";
import ChartIntelStrip from "@/components/ChartIntelStrip";
import { DEFAULT_WATCH_SYMBOLS, normalizeMarketSymbol, toTvSymbol } from "@/lib/market/symbols";

type Timeframe = "1" | "5" | "15" | "60" | "D";

type StreamStatus = {
  pollingMode?: boolean;
  authenticated?: boolean;
  wsState?: number;
  ticksReceived?: number;
  quotesReceived?: number;
};

const C = {
  card: "#1a191b",
  border: "rgba(72,72,73,0.25)",
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  muted: "#adaaab",
  outline: "#767576",
  outlineVar: "#484849",
};

function parseSymbols(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => normalizeMarketSymbol(item, ""))
        .filter(Boolean)
    )
  ).slice(0, 16);
}

function MicroLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", color: C.outline }}>{children}</span>;
}

export default function InfinityPage() {
  const [symbolsInput, setSymbolsInput] = useState(DEFAULT_WATCH_SYMBOLS.slice(0, 8).join(","));
  const [timeframe, setTimeframe] = useState<Timeframe>("5");
  const [columns, setColumns] = useState<2 | 3 | 4>(3);
  const [showIntel, setShowIntel] = useState(true);

  const symbols = useMemo(() => {
    const parsed = parseSymbols(symbolsInput);
    return parsed.length > 0 ? parsed : DEFAULT_WATCH_SYMBOLS.slice(0, 4);
  }, [symbolsInput]);

  const chartHeight = columns === 4 ? 220 : columns === 3 ? 250 : 300;

  const gridClass =
    columns === 2
      ? "grid-cols-1 xl:grid-cols-2"
      : columns === 3
      ? "grid-cols-1 md:grid-cols-2 2xl:grid-cols-3"
      : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

  const { data: streamStatus } = useQuery<StreamStatus>({
    queryKey: ["infinity-stream-status"],
    queryFn: () => fetch("/api/alpaca/stream-status").then((r) => r.json()),
    refetchInterval: 10_000,
    staleTime: 8_000,
  });

  const wsHealthy = !streamStatus?.pollingMode && streamStatus?.authenticated && streamStatus?.wsState === 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: "6px" }}>
            Godsview · Infinity Monitor
          </div>
          <h1 className="font-headline font-bold text-2xl tracking-tight">Infinity Screen</h1>
          <p style={{ fontSize: "10px", color: C.muted, marginTop: "4px" }}>
            Run many charts together with embedded orderbook, heatmap, and per-candle intelligence.
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded" style={{ backgroundColor: wsHealthy ? "rgba(156,255,147,0.08)" : "rgba(251,191,36,0.1)", border: `1px solid ${wsHealthy ? "rgba(156,255,147,0.2)" : "rgba(251,191,36,0.25)"}` }}>
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: wsHealthy ? C.primary : "#fbbf24" }} />
          <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: wsHealthy ? C.primary : "#fbbf24", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {wsHealthy ? "WS Real-Time" : "Fallback Mode"}
          </span>
        </div>
      </div>

      <div className="rounded p-4 space-y-3" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-3">
          <div className="xl:col-span-2">
            <MicroLabel>Symbols (comma-separated)</MicroLabel>
            <input
              value={symbolsInput}
              onChange={(e) => setSymbolsInput(e.target.value.toUpperCase())}
              placeholder="BTCUSD,ETHUSD,SOLUSD,AVAXUSD,DOGEUSD"
              className="mt-1.5 w-full rounded px-3 py-2 outline-none text-xs"
              style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}`, color: "#ffffff", fontFamily: "JetBrains Mono, monospace" }}
            />
          </div>

          <div>
            <MicroLabel>Timeframe</MicroLabel>
            <div className="mt-1.5 flex gap-1">
              {(["1", "5", "15", "60", "D"] as const).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  style={{
                    padding: "4px 8px",
                    borderRadius: "4px",
                    border: `1px solid ${timeframe === tf ? "rgba(156,255,147,0.25)" : "rgba(72,72,73,0.25)"}`,
                    backgroundColor: timeframe === tf ? "rgba(156,255,147,0.12)" : "transparent",
                    color: timeframe === tf ? C.primary : C.outline,
                    fontSize: "9px",
                    fontFamily: "Space Grotesk",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                  }}
                >
                  {tf === "60" ? "1H" : tf === "D" ? "1D" : `${tf}M`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <MicroLabel>Layout</MicroLabel>
            <div className="mt-1.5 flex gap-1">
              {([2, 3, 4] as const).map((count) => (
                <button
                  key={count}
                  onClick={() => setColumns(count)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "4px",
                    border: `1px solid ${columns === count ? "rgba(102,157,255,0.25)" : "rgba(72,72,73,0.25)"}`,
                    backgroundColor: columns === count ? "rgba(102,157,255,0.1)" : "transparent",
                    color: columns === count ? C.secondary : C.outline,
                    fontSize: "9px",
                    fontFamily: "Space Grotesk",
                    fontWeight: 700,
                  }}
                >
                  {count} Col
                </button>
              ))}
            </div>
          </div>

          <div>
            <MicroLabel>Overlay</MicroLabel>
            <button
              onClick={() => setShowIntel((prev) => !prev)}
              className="mt-1.5 w-full rounded px-3 py-2"
              style={{
                border: `1px solid ${showIntel ? "rgba(156,255,147,0.25)" : "rgba(72,72,73,0.25)"}`,
                backgroundColor: showIntel ? "rgba(156,255,147,0.1)" : "rgba(72,72,73,0.08)",
                color: showIntel ? C.primary : C.outline,
                fontSize: "9px",
                fontFamily: "Space Grotesk",
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              {showIntel ? "Intel On" : "Intel Off"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2" style={{ borderTop: `1px solid rgba(72,72,73,0.2)`, paddingTop: "10px" }}>
          <div className="flex flex-wrap items-center gap-2">
            <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: C.muted }}>
              {symbols.length} charts active
            </span>
            <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
              ticks {streamStatus?.ticksReceived ?? 0} · quotes {streamStatus?.quotesReceived ?? 0}
            </span>
          </div>
          <Link href="/alpaca">
            <button className="rounded px-3 py-1.5" style={{ fontSize: "9px", fontFamily: "Space Grotesk", border: `1px solid rgba(102,157,255,0.25)`, backgroundColor: "rgba(102,157,255,0.08)", color: C.secondary, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>
              Open Live Intelligence
            </button>
          </Link>
        </div>
      </div>

      <div className={`grid ${gridClass} gap-3`}>
        {symbols.map((symbol) => {
          const tvSymbol = toTvSymbol(symbol);

          return (
            <div key={symbol} className="rounded overflow-hidden" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
              <div className="px-3 py-1.5 flex items-center justify-between" style={{ borderBottom: `1px solid rgba(72,72,73,0.2)` }}>
                <MicroLabel>{tvSymbol}</MicroLabel>
                <span style={{ fontSize: "8px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>{symbol}</span>
              </div>

              <TradingViewChart
                symbol={tvSymbol}
                timeframe={timeframe}
                height={chartHeight}
                showToolbar={false}
                allowSymbolChange={false}
                studies={["Volume@tv-basicstudies", "RSI@tv-basicstudies", "MACD@tv-basicstudies"]}
              />

              {showIntel && (
                <div className="p-2" style={{ borderTop: `1px solid rgba(72,72,73,0.2)` }}>
                  <ChartIntelStrip symbol={symbol} timeframe={timeframe} compact={columns >= 3} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
