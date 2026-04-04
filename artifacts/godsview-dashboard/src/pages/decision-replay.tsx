import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useDecisionReplay,
  useDecisionReplayBlockReasons,
  useDecisionReplayLatency,
} from "@/lib/api";

type TradeListItem = {
  id: number;
  instrument: string;
  setup_type: string;
  direction: string;
  outcome: string;
  pnl: number | string | null;
  created_at: string | null;
};

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function latencyLabel(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function scoreColor(value: number): string {
  if (value >= 0.75) return "#9cff93";
  if (value >= 0.55) return "#f0e442";
  return "#ff7162";
}

export default function DecisionReplayPage() {
  const [selectedTradeId, setSelectedTradeId] = useState<number | null>(null);

  const tradesQuery = useQuery({
    queryKey: ["decision-replay", "trade-selector"],
    queryFn: async () => {
      const res = await fetch("/api/trades?limit=120");
      if (!res.ok) throw new Error(`Failed to load trades (${res.status})`);
      const payload = await res.json() as { trades?: TradeListItem[] };
      return Array.isArray(payload.trades) ? payload.trades : [];
    },
    refetchInterval: 30_000,
  });

  const replayQuery = useDecisionReplay(selectedTradeId);
  const blocksQuery = useDecisionReplayBlockReasons(24, 500);
  const latencyQuery = useDecisionReplayLatency(24, 2000);

  useEffect(() => {
    if (!selectedTradeId && tradesQuery.data && tradesQuery.data.length > 0) {
      setSelectedTradeId(tradesQuery.data[0]!.id);
    }
  }, [selectedTradeId, tradesQuery.data]);

  const trades = tradesQuery.data ?? [];
  const selectedReplay = replayQuery.data;

  const tradeStats = useMemo(() => {
    const closed = trades.filter((trade) => String(trade.outcome ?? "") !== "open");
    const wins = closed.filter((trade) => toNumber(trade.pnl) > 0).length;
    const losses = closed.filter((trade) => toNumber(trade.pnl) <= 0).length;
    const totalPnl = closed.reduce((sum, trade) => sum + toNumber(trade.pnl), 0);

    return {
      trades: trades.length,
      closed: closed.length,
      wins,
      losses,
      totalPnl,
      winRate: closed.length > 0 ? (wins / closed.length) * 100 : 0,
    };
  }, [trades]);

  return (
    <div style={{ padding: "24px", maxWidth: "1280px" }}>
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontFamily: "Space Grotesk", fontSize: "18px", fontWeight: 700, letterSpacing: "0.14em", color: "#9cff93", marginBottom: "6px" }}>
          DECISION REPLAY
        </h1>
        <p style={{ fontSize: "11px", color: "#767576" }}>
          Trade-by-trade explainability with stage timelines, block reasons, and latency telemetry.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(120px, 1fr))", gap: "10px", marginBottom: "18px" }}>
        {[
          { label: "TRADES", value: tradeStats.trades.toString(), color: "#56b4e9" },
          { label: "CLOSED", value: tradeStats.closed.toString(), color: "#adaaab" },
          { label: "WIN RATE", value: `${tradeStats.winRate.toFixed(1)}%`, color: scoreColor(tradeStats.winRate / 100) },
          { label: "TOTAL PNL", value: `${tradeStats.totalPnl >= 0 ? "+" : ""}${tradeStats.totalPnl.toFixed(2)}`, color: tradeStats.totalPnl >= 0 ? "#9cff93" : "#ff7162" },
          { label: "SELECTED", value: selectedTradeId ? `#${selectedTradeId}` : "-", color: "#f0e442" },
        ].map((card) => (
          <div key={card.label} style={{ padding: "10px", borderRadius: "6px", backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.18)" }}>
            <div style={{ fontSize: "8px", color: "#484849", fontFamily: "Space Grotesk", letterSpacing: "0.12em", marginBottom: "6px" }}>{card.label}</div>
            <div style={{ fontSize: "16px", fontFamily: "JetBrains Mono, monospace", fontWeight: 700, color: card.color }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "14px", alignItems: "start" }}>
        <div style={{ borderRadius: "8px", backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.18)", maxHeight: "620px", overflow: "auto" }}>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(72,72,73,0.15)", fontSize: "10px", color: "#484849", letterSpacing: "0.12em", fontFamily: "Space Grotesk" }}>
            TRADE SELECTOR
          </div>
          {tradesQuery.isLoading && <div style={{ padding: "12px", fontSize: "11px", color: "#767576" }}>Loading trades...</div>}
          {trades.map((trade) => {
            const isActive = trade.id === selectedTradeId;
            const pnl = toNumber(trade.pnl);
            return (
              <button
                key={trade.id}
                onClick={() => setSelectedTradeId(trade.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  background: isActive ? "rgba(156,255,147,0.08)" : "transparent",
                  borderBottom: "1px solid rgba(72,72,73,0.10)",
                  padding: "10px 12px",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ fontSize: "11px", color: "#e6e1e5", fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>
                    #{trade.id} · {trade.instrument}
                  </span>
                  <span style={{ fontSize: "10px", color: pnl >= 0 ? "#9cff93" : "#ff7162", fontFamily: "JetBrains Mono, monospace" }}>
                    {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "9px", color: "#adaaab", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                    {trade.setup_type} · {trade.direction} · {trade.outcome}
                  </span>
                  <span style={{ fontSize: "9px", color: "#767576", fontFamily: "JetBrains Mono, monospace" }}>
                    {compactDate(trade.created_at)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ borderRadius: "8px", backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.18)", padding: "12px" }}>
            <div style={{ fontSize: "10px", color: "#484849", fontFamily: "Space Grotesk", letterSpacing: "0.12em", marginBottom: "10px" }}>
              TRADE DECISION TRACE
            </div>

            {replayQuery.isLoading && <div style={{ fontSize: "11px", color: "#767576" }}>Loading replay...</div>}
            {!selectedTradeId && <div style={{ fontSize: "11px", color: "#767576" }}>Select a trade to inspect timeline.</div>}
            {replayQuery.error && <div style={{ fontSize: "11px", color: "#ff7162" }}>{(replayQuery.error as Error).message}</div>}

            {selectedReplay && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(120px, 1fr))", gap: "10px", marginBottom: "10px" }}>
                  <div>
                    <div style={{ fontSize: "8px", color: "#484849", letterSpacing: "0.11em", marginBottom: "4px" }}>SYMBOL</div>
                    <div style={{ fontSize: "12px", color: "#e6e1e5", fontFamily: "JetBrains Mono, monospace" }}>{selectedReplay.trade.symbol}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "8px", color: "#484849", letterSpacing: "0.11em", marginBottom: "4px" }}>SETUP</div>
                    <div style={{ fontSize: "12px", color: "#e6e1e5", fontFamily: "JetBrains Mono, monospace" }}>{selectedReplay.trade.setup_type}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "8px", color: "#484849", letterSpacing: "0.11em", marginBottom: "4px" }}>DECISION</div>
                    <div style={{ fontSize: "12px", color: selectedReplay.decision?.approved ? "#9cff93" : "#ff7162", fontFamily: "JetBrains Mono, monospace" }}>
                      {selectedReplay.decision?.approved ? "APPROVED" : "BLOCKED"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "8px", color: "#484849", letterSpacing: "0.11em", marginBottom: "4px" }}>WIN PROB</div>
                    <div style={{ fontSize: "12px", color: scoreColor(selectedReplay.decision?.win_probability ?? 0), fontFamily: "JetBrains Mono, monospace" }}>
                      {((selectedReplay.decision?.win_probability ?? 0) * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>

                <div style={{ maxHeight: "300px", overflow: "auto", border: "1px solid rgba(72,72,73,0.14)", borderRadius: "6px" }}>
                  {(selectedReplay.timeline ?? []).map((item, index) => (
                    <div key={`${item.stage}-${index}`} style={{ padding: "9px 10px", borderTop: index === 0 ? "none" : "1px solid rgba(72,72,73,0.10)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                        <span style={{ fontSize: "10px", color: "#e6e1e5", fontWeight: 600 }}>{item.stage.replaceAll("_", " ")}</span>
                        <span style={{ fontSize: "9px", color: "#767576", fontFamily: "JetBrains Mono, monospace" }}>{compactDate(item.at)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "9px", color: "#adaaab" }}>{item.source}</span>
                        <span style={{ fontSize: "9px", color: "#669dff", fontFamily: "JetBrains Mono, monospace" }}>
                          Δ {latencyLabel(item.latency_ms_from_prev)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div style={{ borderRadius: "8px", backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.18)", padding: "12px" }}>
              <div style={{ fontSize: "10px", color: "#484849", fontFamily: "Space Grotesk", letterSpacing: "0.12em", marginBottom: "10px" }}>
                BLOCK REASONS (24H)
              </div>
              {blocksQuery.isLoading && <div style={{ fontSize: "11px", color: "#767576" }}>Loading block reasons...</div>}
              {(blocksQuery.data?.block_reasons ?? []).slice(0, 8).map((row) => (
                <div key={`${row.event_type}-${row.reason}`} style={{ padding: "6px 0", borderTop: "1px solid rgba(72,72,73,0.10)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                    <span style={{ fontSize: "10px", color: "#e6e1e5" }}>{row.reason || row.event_type}</span>
                    <span style={{ fontSize: "10px", color: "#ff7162", fontFamily: "JetBrains Mono, monospace" }}>{row.count}</span>
                  </div>
                  <div style={{ fontSize: "9px", color: "#767576", fontFamily: "JetBrains Mono, monospace" }}>
                    latest {compactDate(row.latest_at)}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ borderRadius: "8px", backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.18)", padding: "12px" }}>
              <div style={{ fontSize: "10px", color: "#484849", fontFamily: "Space Grotesk", letterSpacing: "0.12em", marginBottom: "10px" }}>
                LATENCY PROFILE (24H)
              </div>
              {latencyQuery.isLoading && <div style={{ fontSize: "11px", color: "#767576" }}>Loading latency profile...</div>}
              {latencyQuery.data && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  {[
                    { label: "P50", value: latencyLabel(latencyQuery.data.latency_ms.p50) },
                    { label: "P95", value: latencyLabel(latencyQuery.data.latency_ms.p95) },
                    { label: "P99", value: latencyLabel(latencyQuery.data.latency_ms.p99) },
                    { label: "AVG", value: latencyLabel(latencyQuery.data.latency_ms.avg) },
                    { label: "<1S", value: latencyQuery.data.by_bucket.under_1s.toString() },
                    { label: ">10S", value: latencyQuery.data.by_bucket.over_10s.toString() },
                  ].map((item) => (
                    <div key={item.label} style={{ border: "1px solid rgba(72,72,73,0.12)", borderRadius: "6px", padding: "8px" }}>
                      <div style={{ fontSize: "8px", color: "#484849", letterSpacing: "0.1em", marginBottom: "4px" }}>{item.label}</div>
                      <div style={{ fontSize: "12px", color: "#669dff", fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
