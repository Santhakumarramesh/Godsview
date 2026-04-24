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
  bullish: "#9cff93",
  bearish: "#ff6b6b",
};

interface OrderBlock {
  type: "bullish" | "bearish";
  high: number;
  low: number;
  mitigated: boolean;
  freshness: string;
  timeframe?: string;
  volume?: number;
  strength?: number;
  touch_count?: number;
  created_at?: string;
}

function StrengthBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div style={{ width: "60px", height: "4px", backgroundColor: "rgba(255,255,255,0.1)", borderRadius: "2px", overflow: "hidden" }}>
        <div style={{ width: `${Math.min(value * 100, 100)}%`, height: "100%", backgroundColor: color, borderRadius: "2px" }} />
      </div>
      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: C.muted }}>
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  );
}

export default function OrderBlocks() {
  const [symbol, setSymbol] = useState("BTCUSD");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortBy, setSortBy] = useState<"strength" | "freshness" | "price">("strength");
  const [selectedOB, setSelectedOB] = useState<number | null>(null);
  const [timeframe, setTimeframe] = useState("all");

  const { data: marketStructure, isLoading, error } = useQuery({
    queryKey: ["market-structure", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/market-structure?symbol=${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: signals } = useQuery({
    queryKey: ["signals", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/signals?symbol=${symbol}&limit=50`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  const orderBlocks: OrderBlock[] = marketStructure?.orderBlocks || [];
  const currentPrice = marketStructure?.price || signals?.price || 0;

  const filtered = useMemo(() => {
    let blocks = orderBlocks;
    if (filterType !== "all") blocks = blocks.filter((ob) => ob.type === filterType);
    if (filterStatus === "active") blocks = blocks.filter((ob) => !ob.mitigated);
    if (filterStatus === "mitigated") blocks = blocks.filter((ob) => ob.mitigated);
    if (timeframe !== "all") blocks = blocks.filter((ob) => ob.timeframe === timeframe);

    if (sortBy === "strength") blocks = [...blocks].sort((a, b) => (b.strength || 0) - (a.strength || 0));
    else if (sortBy === "price") blocks = [...blocks].sort((a, b) => b.high - a.high);
    return blocks;
  }, [orderBlocks, filterType, filterStatus, timeframe, sortBy]);

  const stats = useMemo(() => {
    const active = orderBlocks.filter((ob) => !ob.mitigated);
    const bullish = active.filter((ob) => ob.type === "bullish");
    const bearish = active.filter((ob) => ob.type === "bearish");
    const avgStrength = active.length > 0
      ? (active.reduce((s, ob) => s + (ob.strength || 0), 0) / active.length * 100).toFixed(0)
      : "0";
    const nearPrice = currentPrice > 0
      ? active.filter((ob) => {
          const mid = (ob.high + ob.low) / 2;
          return Math.abs(mid - currentPrice) / currentPrice < 0.02;
        }).length
      : 0;
    return { total: orderBlocks.length, active: active.length, bullish: bullish.length, bearish: bearish.length, avgStrength, nearPrice };
  }, [orderBlocks, currentPrice]);

  const timeframes = useMemo(() => [...new Set(orderBlocks.map((ob) => ob.timeframe).filter(Boolean))], [orderBlocks]);

  return (
    <div style={{ backgroundColor: C.bg, color: C.text, minHeight: "100vh", padding: "24px", fontFamily: '"Space Grotesk", sans-serif' }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ fontSize: "28px", marginBottom: "8px" }}>Order Block Engine</h1>
          <p style={{ color: C.muted, fontSize: "14px" }}>
            Detect institutional order blocks across timeframes — bullish demand and bearish supply zones
          </p>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "24px" }}>
          <input
            type="text"
            placeholder="Symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            style={{
              backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "8px",
              padding: "8px 12px", color: C.text, fontFamily: "Space Grotesk", width: "120px",
            }}
          />
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "8px 12px", color: C.text }}>
            <option value="all">All Types</option>
            <option value="bullish">Bullish</option>
            <option value="bearish">Bearish</option>
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "8px 12px", color: C.text }}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="mitigated">Mitigated</option>
          </select>
          {timeframes.length > 0 && (
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "8px 12px", color: C.text }}>
              <option value="all">All Timeframes</option>
              {timeframes.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
            </select>
          )}
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "8px 12px", color: C.text }}>
            <option value="strength">Sort: Strength</option>
            <option value="price">Sort: Price</option>
            <option value="freshness">Sort: Freshness</option>
          </select>
        </div>

        {/* Stats Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "16px", marginBottom: "24px" }}>
          {[
            { label: "Total Blocks", value: stats.total, color: C.text },
            { label: "Active", value: stats.active, color: C.accent },
            { label: "Bullish Zones", value: stats.bullish, color: C.bullish },
            { label: "Bearish Zones", value: stats.bearish, color: C.bearish },
            { label: "Avg Strength", value: `${stats.avgStrength}%`, color: C.accent },
            { label: "Near Price (±2%)", value: stats.nearPrice, color: stats.nearPrice > 0 ? "#ffb347" : C.muted },
          ].map((m) => (
            <div key={m.label} style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "16px" }}>
              <div style={{ fontSize: "12px", color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>{m.label}</div>
              <div style={{ fontSize: "22px", fontWeight: "700", color: m.color }}>{m.value}</div>
            </div>
          ))}
        </div>

        {/* Current Price Reference */}
        {currentPrice > 0 && (
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "12px 16px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "12px", color: C.muted, textTransform: "uppercase" }}>Current Price</span>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "16px", fontWeight: "600", color: C.accent }}>
              ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>
        )}

        {/* Error / Loading */}
        {error ? (
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "40px", textAlign: "center" }}>
            <div style={{ color: "#ff6b6b", fontSize: "14px", marginBottom: "8px" }}>Failed to load market structure</div>
            <div style={{ color: C.muted, fontSize: "12px" }}>Check API connection for {symbol}</div>
          </div>
        ) : isLoading ? (
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "40px", textAlign: "center" }}>
            <div style={{ color: C.muted }}>Loading order blocks for {symbol}...</div>
          </div>
        ) : (
          /* Order Blocks Table */
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: '"JetBrains Mono", monospace', fontSize: "12px" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {["Type", "High", "Low", "Range", "Strength", "Touches", "Status", "Timeframe", "Freshness"].map((h) => (
                      <th key={h} style={{ padding: "12px", textAlign: h === "Strength" || h === "Range" ? "center" : "left", color: C.muted, fontWeight: "500", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ padding: "32px", textAlign: "center", color: C.muted }}>
                        No order blocks found for {symbol} with current filters
                      </td>
                    </tr>
                  ) : (
                    filtered.slice(0, 25).map((ob, idx) => {
                      const range = ob.high - ob.low;
                      const isNearPrice = currentPrice > 0 && Math.abs((ob.high + ob.low) / 2 - currentPrice) / currentPrice < 0.02;
                      return (
                        <tr
                          key={idx}
                          style={{
                            borderBottom: `1px solid ${C.border}`,
                            cursor: "pointer",
                            backgroundColor: selectedOB === idx ? "rgba(156,255,147,0.05)" : isNearPrice ? "rgba(255,179,71,0.05)" : "transparent",
                          }}
                          onClick={() => setSelectedOB(selectedOB === idx ? null : idx)}
                        >
                          <td style={{ padding: "12px" }}>
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: "6px", padding: "3px 8px", borderRadius: "4px", fontSize: "11px",
                              backgroundColor: ob.type === "bullish" ? "rgba(156,255,147,0.15)" : "rgba(255,107,107,0.15)",
                              color: ob.type === "bullish" ? C.bullish : C.bearish,
                            }}>
                              {ob.type === "bullish" ? "▲" : "▼"} {ob.type.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ padding: "12px", color: C.text }}>${ob.high?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td style={{ padding: "12px", color: C.text }}>${ob.low?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td style={{ padding: "12px", color: C.muted, textAlign: "center" }}>${range.toFixed(2)}</td>
                          <td style={{ padding: "12px" }}>
                            <StrengthBar value={ob.strength || 0.5} color={ob.type === "bullish" ? C.bullish : C.bearish} />
                          </td>
                          <td style={{ padding: "12px", color: C.muted, textAlign: "center" }}>{ob.touch_count ?? "—"}</td>
                          <td style={{ padding: "12px" }}>
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "4px", fontSize: "11px",
                              backgroundColor: ob.mitigated ? "rgba(118,117,118,0.15)" : "rgba(156,255,147,0.15)",
                              color: ob.mitigated ? C.muted : C.accent,
                            }}>
                              <span style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: ob.mitigated ? C.muted : C.accent }} />
                              {ob.mitigated ? "MITIGATED" : "ACTIVE"}
                            </span>
                          </td>
                          <td style={{ padding: "12px", color: C.muted }}>{ob.timeframe || "—"}</td>
                          <td style={{ padding: "12px", color: C.muted }}>{ob.freshness || "—"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {filtered.length > 25 && (
              <div style={{ textAlign: "center", padding: "12px", color: C.muted, fontSize: "12px" }}>
                Showing 25 of {filtered.length} order blocks
              </div>
            )}
          </div>
        )}

        {/* OB Zone Visualization */}
        {selectedOB !== null && filtered[selectedOB] && (
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px", marginTop: "16px" }}>
            <h3 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: C.accent, marginBottom: "16px" }}>
              Zone Detail — {filtered[selectedOB].type.toUpperCase()} OB
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
              <div>
                <div style={{ fontSize: "11px", color: C.muted, textTransform: "uppercase" }}>Zone Range</div>
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "14px", color: C.text, marginTop: "4px" }}>
                  ${filtered[selectedOB].low.toFixed(2)} — ${filtered[selectedOB].high.toFixed(2)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: C.muted, textTransform: "uppercase" }}>Distance from Price</div>
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "14px", color: C.text, marginTop: "4px" }}>
                  {currentPrice > 0
                    ? `${(((((filtered[selectedOB].high + filtered[selectedOB].low) / 2) - currentPrice) / currentPrice) * 100).toFixed(2)}%`
                    : "—"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: C.muted, textTransform: "uppercase" }}>Volume at Zone</div>
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "14px", color: C.text, marginTop: "4px" }}>
                  {filtered[selectedOB].volume?.toLocaleString() || "—"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: C.muted, textTransform: "uppercase" }}>Created</div>
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "14px", color: C.text, marginTop: "4px" }}>
                  {filtered[selectedOB].created_at ? new Date(filtered[selectedOB].created_at!).toLocaleDateString() : "—"}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
