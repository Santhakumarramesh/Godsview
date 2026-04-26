import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  border: "rgba(72,72,73,0.2)",
  accent: "#9cff93",
  text: "#ffffff",
  muted: "#767576",
  bearish: "#ff6b6b",
};

const TF_CONFIG = [
  { label: "Daily (HTF)", value: "1d", interval: 60000 },
  { label: "4-Hour (MTF)", value: "240", interval: 60000 },
  { label: "1-Hour", value: "60", interval: 60000 },
  { label: "15-Minute (LTF)", value: "15", interval: 30000 },
];

function useTimeframeData(symbol: string, tf: string, interval: number) {
  return useQuery({
    queryKey: ["bars", symbol, tf],
    queryFn: async () => {
      const res = await fetch(`${API}/api/market/bars/${symbol}?timeframe=${tf}&limit=50`);
      if (!res.ok) throw new Error(`Failed to fetch ${tf} data`);
      return res.json();
    },
    refetchInterval: interval,
  });
}

function getTrend(data: any): { direction: string; color: string } {
  if (!data?.bars || data.bars.length < 2) return { direction: "N/A", color: C.muted };
  const latest = data.bars[data.bars.length - 1];
  const prev = data.bars[data.bars.length - 2];
  if (latest.c > prev.c) return { direction: "BULLISH", color: C.accent };
  if (latest.c < prev.c) return { direction: "BEARISH", color: C.bearish };
  return { direction: "NEUTRAL", color: C.muted };
}

function getStats(data: any) {
  if (!data?.bars || data.bars.length === 0)
    return { high: "—", low: "—", close: "—", change: 0, volume: 0, barCount: 0 };
  const bars = data.bars;
  const latest = bars[bars.length - 1];
  const first = bars[0];
  const highs = bars.map((b: any) => b.h);
  const lows = bars.map((b: any) => b.l);
  const change = first.c > 0 ? ((latest.c - first.c) / first.c) * 100 : 0;
  const volume = bars.reduce((s: number, b: any) => s + (b.v || 0), 0);
  return {
    high: Math.max(...highs).toFixed(2),
    low: Math.min(...lows).toFixed(2),
    close: latest.c?.toFixed(2) ?? "—",
    change,
    volume,
    barCount: bars.length,
  };
}

function MiniBarChart({ data }: { data: any }) {
  if (!data?.bars || data.bars.length < 2) {
    return <div style={{ height: "40px", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: "11px" }}>No bars</div>;
  }
  const bars = data.bars.slice(-10);
  const maxH = Math.max(...bars.map((b: any) => b.h));
  const minL = Math.min(...bars.map((b: any) => b.l));
  const range = maxH - minL || 1;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "40px" }}>
      {bars.map((b: any, i: number) => {
        const h = Math.max(4, ((b.c - minL) / range) * 36);
        const isUp = b.c >= b.o;
        return (
          <div
            key={i}
            style={{
              width: "6px",
              height: `${h}px`,
              backgroundColor: isUp ? C.accent : C.bearish,
              borderRadius: "1px",
              opacity: 0.7 + (i / bars.length) * 0.3,
            }}
          />
        );
      })}
    </div>
  );
}

export default function MultiTimeframe() {
  const [symbol, setSymbol] = useState("BTCUSD");

  const daily = useTimeframeData(symbol, "1d", 60000);
  const fourHour = useTimeframeData(symbol, "240", 60000);
  const oneHour = useTimeframeData(symbol, "60", 60000);
  const fifteenMin = useTimeframeData(symbol, "15", 30000);

  const frames = [
    { label: "Daily (HTF)", ...daily },
    { label: "4-Hour (MTF)", ...fourHour },
    { label: "1-Hour", ...oneHour },
    { label: "15-Minute (LTF)", ...fifteenMin },
  ];

  const anyLoading = frames.some((f) => f.isLoading);
  const anyError = frames.find((f) => f.error);

  const alignment = useMemo(() => {
    const trends = frames.map((f) => getTrend(f.data));
    const valid = trends.filter((t) => t.direction !== "N/A");
    if (valid.length === 0) return { status: "NO DATA", color: C.muted, bullish: 0, bearish: 0 };
    const bullish = valid.filter((t) => t.direction === "BULLISH").length;
    const bearish = valid.filter((t) => t.direction === "BEARISH").length;
    if (bullish === valid.length) return { status: "ALIGNED BULLISH", color: C.accent, bullish, bearish };
    if (bearish === valid.length) return { status: "ALIGNED BEARISH", color: C.bearish, bullish, bearish };
    return { status: "DIVERGENT", color: "#ffcc00", bullish, bearish };
  }, [frames.map((f) => f.data)]);

  return (
    <div style={{ backgroundColor: C.bg, color: C.text, minHeight: "100vh", padding: "24px", fontFamily: '"Space Grotesk", sans-serif' }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ fontSize: "28px", marginBottom: "8px" }}>Multi-Timeframe Structure</h1>
          <p style={{ color: C.muted, fontSize: "14px" }}>
            Analyze market structure across HTF, MTF, and LTF — macro trend, intraday structure, and micro entry context
          </p>
        </div>

        {/* Symbol Input */}
        <div style={{ marginBottom: "24px" }}>
          <input
            type="text"
            placeholder="Symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            style={{
              backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "8px",
              padding: "8px 12px", color: C.text, fontFamily: "Space Grotesk", width: "160px",
            }}
          />
          {anyLoading && <span style={{ marginLeft: "12px", fontSize: "12px", color: C.muted }}>Refreshing...</span>}
        </div>

        {/* Error State */}
        {anyError && (
          <div style={{ backgroundColor: C.card, border: `1px solid rgba(255,107,107,0.3)`, borderRadius: "12px", padding: "20px", marginBottom: "24px" }}>
            <div style={{ color: C.bearish, fontSize: "14px" }}>Failed to load some timeframe data</div>
            <div style={{ color: C.muted, fontSize: "12px", marginTop: "4px" }}>Check API connection for {symbol}</div>
          </div>
        )}

        {/* Alignment Summary */}
        <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "20px", marginBottom: "24px", display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{
              width: "36px", height: "36px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              backgroundColor: `${alignment.color}22`, border: `2px solid ${alignment.color}`,
              fontSize: "14px", fontWeight: "700", color: alignment.color,
            }}>
              {alignment.status === "ALIGNED BULLISH" ? "↑" : alignment.status === "ALIGNED BEARISH" ? "↓" : "⇅"}
            </div>
            <div>
              <div style={{ fontSize: "14px", fontWeight: "600", color: alignment.color }}>{alignment.status}</div>
              <div style={{ fontSize: "11px", color: C.muted }}>Timeframe alignment</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "16px" }}>
            <div style={{ fontSize: "12px" }}>
              <span style={{ color: C.muted }}>Bullish: </span>
              <span style={{ color: C.accent, fontWeight: "600" }}>{alignment.bullish}</span>
            </div>
            <div style={{ fontSize: "12px" }}>
              <span style={{ color: C.muted }}>Bearish: </span>
              <span style={{ color: C.bearish, fontWeight: "600" }}>{alignment.bearish}</span>
            </div>
          </div>
        </div>

        {/* Timeframe Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px", marginBottom: "24px" }}>
          {frames.map((frame) => {
            const trend = getTrend(frame.data);
            const stats = getStats(frame.data);
            return (
              <div key={frame.label} style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <h2 style={{ fontSize: "14px", color: C.muted, textTransform: "uppercase" }}>{frame.label}</h2>
                  {frame.isLoading && <span style={{ fontSize: "10px", color: C.muted }}>Loading...</span>}
                </div>

                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontSize: "12px", color: C.muted, marginBottom: "4px" }}>Trend Direction</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "16px", fontWeight: "700", color: trend.color, fontFamily: '"JetBrains Mono", monospace' }}>
                      {trend.direction === "BULLISH" ? "▲" : trend.direction === "BEARISH" ? "▼" : "—"} {trend.direction}
                    </span>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
                  <div>
                    <div style={{ fontSize: "11px", color: C.muted }}>Close</div>
                    <div style={{ fontSize: "14px", fontFamily: '"JetBrains Mono", monospace', fontWeight: "600" }}>${stats.close}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", color: C.muted }}>Change</div>
                    <div style={{ fontSize: "14px", fontFamily: '"JetBrains Mono", monospace', fontWeight: "600", color: stats.change >= 0 ? C.accent : C.bearish }}>
                      {stats.change >= 0 ? "+" : ""}{stats.change.toFixed(2)}%
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", color: C.muted }}>High</div>
                    <div style={{ fontSize: "12px", fontFamily: '"JetBrains Mono", monospace' }}>{stats.high}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", color: C.muted }}>Low</div>
                    <div style={{ fontSize: "12px", fontFamily: '"JetBrains Mono", monospace' }}>{stats.low}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", color: C.muted }}>Bars</div>
                    <div style={{ fontSize: "12px", fontFamily: '"JetBrains Mono", monospace' }}>{stats.barCount}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", color: C.muted }}>Volume</div>
                    <div style={{ fontSize: "12px", fontFamily: '"JetBrains Mono", monospace' }}>
                      {stats.volume > 1e6 ? `${(stats.volume / 1e6).toFixed(1)}M` : stats.volume > 1000 ? `${(stats.volume / 1000).toFixed(0)}K` : stats.volume || "—"}
                    </div>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: "11px", color: C.muted, marginBottom: "6px" }}>Last 10 Bars</div>
                  <div style={{ backgroundColor: C.bg, borderRadius: "6px", padding: "8px" }}>
                    <MiniBarChart data={frame.data} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Structure Alignment Matrix */}
        <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "14px", color: C.muted, textTransform: "uppercase", marginBottom: "16px" }}>
            Structure Alignment Matrix
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontFamily: '"JetBrains Mono", monospace', fontSize: "12px" }}>
              <thead>
                <tr>
                  <th style={{ padding: "8px 12px", color: C.muted }}></th>
                  {frames.map((f) => (
                    <th key={f.label} style={{ padding: "8px 12px", color: C.muted, fontWeight: "normal", fontSize: "11px" }}>
                      {f.label.split(" ")[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {frames.map((row, ri) => (
                  <tr key={row.label}>
                    <td style={{ padding: "8px 12px", color: C.muted, fontSize: "11px" }}>{row.label.split(" ")[0]}</td>
                    {frames.map((col, ci) => {
                      const rowTrend = getTrend(row.data).direction;
                      const colTrend = getTrend(col.data).direction;
                      const match = ri === ci ? "—" : rowTrend === colTrend && rowTrend !== "N/A" ? "✓" : rowTrend === "N/A" || colTrend === "N/A" ? "?" : "✗";
                      const matchColor = match === "✓" ? C.accent : match === "✗" ? C.bearish : C.muted;
                      return (
                        <td key={col.label} style={{ padding: "8px 12px", textAlign: "center", color: matchColor, fontWeight: match === "—" ? "normal" : "600" }}>
                          {match}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
