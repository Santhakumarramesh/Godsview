import { useEffect, useState } from "react";
import { useGetSystemStatus } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  cardHigh: "#201f21",
  border: "rgba(72,72,73,0.25)",
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  muted: "#adaaab",
  outline: "#767576",
  outlineVar: "#484849",
};

type DiagnosticsLayer = { status: "live" | "degraded" | "offline"; detail: string };
type Diagnostics = {
  system_status: string;
  timestamp: string;
  layers: Record<string, DiagnosticsLayer>;
  recommendations: string[];
};
type StreamStatus = {
  pollingMode?: boolean;
  authenticated?: boolean;
  wsState?: number;
  wsConnectedAt?: number | null;
  ticksReceived?: number;
  quotesReceived?: number;
  listenersCount?: number;
};
type RiskConfig = {
  maxRiskPerTradePct: number;
  maxDailyLossUsd: number;
  maxOpenExposurePct: number;
  maxConcurrentPositions: number;
  maxTradesPerSession: number;
  cooldownAfterLosses: number;
  cooldownMinutes: number;
  blockOnDegradedData: boolean;
};
type RuntimeRiskSnapshot = {
  runtime: {
    killSwitchActive: boolean;
    updatedAt: string;
  };
  config: RiskConfig;
  fetched_at?: string;
};

const LAYER_LABELS: Record<string, string> = {
  data_feed: "Data Feed (Alpaca)",
  trading_api: "Trading API Keys",
  strategy_engine: "Strategy Engine",
  database: "PostgreSQL Database",
  recall_engine: "Recall / Accuracy DB",
  ml_model: "ML Model Layer",
  claude_reasoning: "Claude Reasoning",
};

const LAYER_ICONS: Record<string, string> = {
  data_feed: "wifi",
  trading_api: "vpn_key",
  strategy_engine: "account_tree",
  database: "storage",
  recall_engine: "psychology",
  ml_model: "smart_toy",
  claude_reasoning: "auto_awesome",
};

function MicroLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", color: C.outline }}>{children}</span>;
}

function StatusPill({ status }: { status: string }) {
  const color = status === "live" ? C.primary : status === "degraded" ? "#fbbf24" : C.tertiary;
  return (
    <span className="px-2 py-0.5 rounded" style={{
      fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
      backgroundColor: `${color}12`, color, border: `1px solid ${color}30`,
    }}>
      {status}
    </span>
  );
}

const PIPELINE_ICONS = ["sensors", "account_tree", "psychology", "smart_toy", "auto_awesome", "shield"];

export default function System() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetSystemStatus();
  const { data: diag, isLoading: diagLoading, refetch: refetchDiag } = useQuery<Diagnostics>({
    queryKey: ["diagnostics"],
    queryFn: () => fetch("/api/system/diagnostics").then((r) => r.json()),
    refetchInterval: 30000,
  });
  const { data: streamStatus } = useQuery<StreamStatus>({
    queryKey: ["stream-status"],
    queryFn: () => fetch("/api/alpaca/stream-status").then((r) => r.json()),
    refetchInterval: 30_000,
    staleTime: 25_000,
  });
  const { data: riskSnapshot, isLoading: riskLoading } = useQuery<RuntimeRiskSnapshot>({
    queryKey: ["system-risk-controls"],
    queryFn: async () => {
      const r = await fetch("/api/system/risk");
      if (!r.ok) throw new Error(`risk controls fetch failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
  });
  const [draft, setDraft] = useState<RiskConfig | null>(null);
  useEffect(() => {
    if (riskSnapshot && !draft) {
      setDraft(riskSnapshot.config);
    }
  }, [riskSnapshot, draft]);

  const retrainMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/system/retrain", { method: "POST" });
      if (!r.ok) throw new Error(`retrain failed: ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["diagnostics"] });
      queryClient.invalidateQueries({ queryKey: ["system-status"] });
    },
  });
  const toggleKillSwitchMutation = useMutation({
    mutationFn: async (active: boolean) => {
      const r = await fetch("/api/system/kill-switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!r.ok) throw new Error(`kill switch update failed: ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-risk-controls"] });
      queryClient.invalidateQueries({ queryKey: ["system-status"] });
    },
  });
  const saveRiskMutation = useMutation({
    mutationFn: async (payload: RiskConfig) => {
      const r = await fetch("/api/system/risk", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`risk controls save failed: ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-risk-controls"] });
    },
  });
  const resetRuntimeMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/system/risk/reset", { method: "POST" });
      if (!r.ok) throw new Error(`risk runtime reset failed: ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-risk-controls"] });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: C.primary }} />
      </div>
    );
  }

  const healthy = data.overall === "healthy";
  const wsHealthy = Boolean(!streamStatus?.pollingMode && streamStatus?.authenticated && streamStatus?.wsState === 1);
  const killSwitchActive = Boolean(riskSnapshot?.runtime.killSwitchActive);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: "6px" }}>
          Godsview · System Diagnostics
        </div>
        <h1 className="font-headline font-bold text-2xl tracking-tight">System Core</h1>
      </div>

      {/* Global Status Hero */}
      <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${healthy ? "rgba(156,255,147,0.15)" : "rgba(255,113,98,0.15)"}` }}>
        <div className="h-0.5 w-full" style={{ backgroundColor: healthy ? C.primary : C.tertiary, boxShadow: `0 0 8px ${healthy ? C.primary : C.tertiary}` }} />
        <div className="p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <MicroLabel>Global Engine Status</MicroLabel>
            <div className="flex items-center gap-3 mt-2">
              <span className="w-3 h-3 rounded-full animate-pulse" style={{ backgroundColor: healthy ? C.primary : C.tertiary }} />
              <span className="font-headline font-bold text-3xl tracking-tight uppercase" style={{ color: healthy ? C.primary : C.tertiary }}>
                {data.overall}
              </span>
            </div>
          </div>
          <div className="flex gap-8">
            <div>
              <MicroLabel>Active Target</MicroLabel>
              <div className="font-headline font-bold text-lg mt-1" style={{ color: C.primary }}>{data.active_instrument || "Awaiting Scan"}</div>
            </div>
            <div>
              <MicroLabel>Session</MicroLabel>
              <div className="font-headline font-bold text-lg mt-1">{data.active_session || "None"}</div>
            </div>
          </div>
        </div>
      </div>

      {/* News Lockout */}
      {data.news_lockout_active && (
        <div className="rounded p-4 flex items-center gap-4" style={{ backgroundColor: "rgba(255,113,98,0.08)", border: "1px solid rgba(255,113,98,0.25)" }}>
          <span className="material-symbols-outlined" style={{ color: C.tertiary }}>warning</span>
          <div>
            <div className="font-headline font-bold" style={{ color: C.tertiary, fontSize: "11px", letterSpacing: "0.1em" }}>NEWS LOCKOUT ACTIVE</div>
            <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>Trading disabled — high-impact economic event window.</div>
          </div>
        </div>
      )}

      {/* Stream Core Health */}
      <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${wsHealthy ? "rgba(156,255,147,0.16)" : "rgba(251,191,36,0.22)"}` }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: "14px", color: wsHealthy ? C.primary : "#fbbf24" }}>hub</span>
            <MicroLabel>Realtime Stream Core</MicroLabel>
            <StatusPill status={wsHealthy ? "live" : "degraded"} />
          </div>
          <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
            ticks {streamStatus?.ticksReceived ?? 0} · quotes {streamStatus?.quotesReceived ?? 0}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
            <MicroLabel>Transport</MicroLabel>
            <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: wsHealthy ? C.primary : "#fbbf24" }}>
              {wsHealthy ? "WebSocket" : "REST Fallback"}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
            <MicroLabel>Auth</MicroLabel>
            <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: streamStatus?.authenticated ? C.primary : C.tertiary }}>
              {streamStatus?.authenticated ? "OK" : "PENDING"}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
            <MicroLabel>WS State</MicroLabel>
            <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
              {streamStatus?.wsState ?? "-"}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
            <MicroLabel>Listeners</MicroLabel>
            <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.secondary }}>
              {streamStatus?.listenersCount ?? 0}
            </div>
          </div>
        </div>
      </div>

      {/* Live Layer Diagnostics */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-base" style={{ color: C.primary }}>monitor_heart</span>
            <MicroLabel>Live Layer Diagnostics</MicroLabel>
          </div>
          <button
            onClick={() => refetchDiag()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded transition-all hover:brightness-110"
            style={{ fontSize: "9px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: C.outline, backgroundColor: C.card, border: `1px solid ${C.border}` }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>refresh</span>
            Refresh
          </button>
        </div>

        {diagLoading && (
          <div className="text-center py-8">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ backgroundColor: C.primary }} />
          </div>
        )}

        {diag && (
          <div className="space-y-3">
            {/* Summary bar */}
            <div className="rounded px-4 py-3 flex items-center justify-between" style={{
              backgroundColor: diag.system_status === "healthy" ? "rgba(156,255,147,0.05)" : diag.system_status === "partial" ? "rgba(251,191,36,0.05)" : "rgba(255,113,98,0.05)",
              border: `1px solid ${diag.system_status === "healthy" ? "rgba(156,255,147,0.2)" : diag.system_status === "partial" ? "rgba(251,191,36,0.2)" : "rgba(255,113,98,0.2)"}`,
            }}>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: diag.system_status === "healthy" ? C.primary : diag.system_status === "partial" ? "#fbbf24" : C.tertiary }} />
                <span className="font-headline font-bold text-xs uppercase tracking-widest">System {diag.system_status}</span>
              </div>
              <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
                {new Date(diag.timestamp).toLocaleTimeString()}
              </span>
            </div>

            {/* Layer grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {Object.entries(diag.layers).map(([key, layer]) => {
                const color = layer.status === "live" ? C.primary : layer.status === "degraded" ? "#fbbf24" : C.tertiary;
                return (
                  <div key={key} className="rounded p-4 flex items-start gap-3" style={{
                    backgroundColor: C.card,
                    border: `1px solid ${layer.status === "live" ? "rgba(156,255,147,0.1)" : layer.status === "degraded" ? "rgba(251,191,36,0.1)" : "rgba(255,113,98,0.1)"}`,
                  }}>
                    <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}12` }}>
                      <span className="material-symbols-outlined" style={{ fontSize: "16px", color }}>{LAYER_ICONS[key] ?? "circle"}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-headline font-bold text-xs">{LAYER_LABELS[key] ?? key}</span>
                        <StatusPill status={layer.status} />
                      </div>
                      <p style={{ fontSize: "10px", color: C.muted, lineHeight: "1.5" }}>{layer.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Recommendations */}
            {diag.recommendations.length > 0 && (
              <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid rgba(251,191,36,0.15)` }}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-sm" style={{ color: "#fbbf24" }}>tips_and_updates</span>
                  <MicroLabel>Recommendations</MicroLabel>
                </div>
                <ul className="space-y-2">
                  {diag.recommendations.map((r, i) => (
                    <li key={i} className="flex items-start gap-2" style={{ fontSize: "11px", color: C.muted }}>
                      <span style={{ color: "#fbbf24", marginTop: "2px" }}>›</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pipeline Layers (from system status) */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <span className="material-symbols-outlined text-base" style={{ color: C.secondary }}>account_tree</span>
          <MicroLabel>Pipeline Layer Status</MicroLabel>
        </div>
        <div className="space-y-2">
          {data.layers.map((layer, index) => {
            const isActive = layer.status === "active";
            const isWarn = layer.status === "warning";
            const color = isActive ? C.primary : isWarn ? "#fbbf24" : C.tertiary;
            return (
              <div key={layer.name} className="rounded p-4 flex gap-4 items-center hover:brightness-105 transition-all" style={{ backgroundColor: C.card, border: `1px solid ${isActive ? "rgba(156,255,147,0.08)" : C.border}` }}>
                <div className="w-8 h-8 flex items-center justify-center rounded relative flex-shrink-0" style={{ backgroundColor: "rgba(14,14,15,0.6)", border: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>{String(index + 1).padStart(2, "0")}</span>
                </div>
                <div className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}12` }}>
                  <span className="material-symbols-outlined" style={{ fontSize: "16px", color }}>{PIPELINE_ICONS[index] ?? "circle"}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-headline font-bold text-sm">{layer.name}</div>
                  <div style={{ fontSize: "10px", color: C.muted, marginTop: "2px" }}>{layer.message}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={layer.status} />
                  {layer.last_update && (
                    <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
                      {format(new Date(layer.last_update), "HH:mm:ss")}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Runtime Risk Controls */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <MicroLabel>Kill Switch</MicroLabel>
              <div className="font-headline font-bold text-lg mt-1">
                {killSwitchActive ? "ACTIVE" : "INACTIVE"}
              </div>
            </div>
            <button
              onClick={() => toggleKillSwitchMutation.mutate(!killSwitchActive)}
              disabled={toggleKillSwitchMutation.isPending || riskLoading}
              className={cn("px-4 py-2 rounded text-xs uppercase tracking-wider", "disabled:opacity-50")}
              style={{
                backgroundColor: killSwitchActive ? "rgba(156,255,147,0.15)" : "rgba(255,113,98,0.15)",
                border: `1px solid ${killSwitchActive ? "rgba(156,255,147,0.35)" : "rgba(255,113,98,0.35)"}`,
                color: killSwitchActive ? C.primary : C.tertiary,
              }}
            >
              {killSwitchActive ? "Deactivate" : "Activate"}
            </button>
          </div>
          <div className="mt-3 text-[10px]" style={{ color: C.muted }}>
            Updated: {riskSnapshot?.runtime.updatedAt ? format(new Date(riskSnapshot.runtime.updatedAt), "yyyy-MM-dd HH:mm:ss") : "n/a"}
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => retrainMutation.mutate()}
              disabled={retrainMutation.isPending}
              className={cn("px-3 py-2 rounded text-[10px] uppercase tracking-wider border", "disabled:opacity-50")}
              style={{ borderColor: "rgba(102,157,255,0.35)", color: C.secondary, backgroundColor: "rgba(102,157,255,0.12)" }}
            >
              {retrainMutation.isPending ? "Retraining..." : "Retrain ML Model"}
            </button>
            <button
              onClick={() => resetRuntimeMutation.mutate()}
              disabled={resetRuntimeMutation.isPending}
              className={cn("px-3 py-2 rounded text-[10px] uppercase tracking-wider border", "disabled:opacity-50")}
              style={{ borderColor: "rgba(173,170,171,0.35)", color: C.muted, backgroundColor: "rgba(173,170,171,0.12)" }}
            >
              {resetRuntimeMutation.isPending ? "Resetting..." : "Reset Runtime State"}
            </button>
          </div>
        </div>

        <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between mb-3">
            <MicroLabel>Risk Controls</MicroLabel>
            <button
              onClick={() => draft && saveRiskMutation.mutate(draft)}
              disabled={!draft || saveRiskMutation.isPending}
              className={cn("px-3 py-2 rounded text-[10px] uppercase tracking-wider border", "disabled:opacity-50")}
              style={{ borderColor: "rgba(156,255,147,0.35)", color: C.primary, backgroundColor: "rgba(156,255,147,0.12)" }}
            >
              {saveRiskMutation.isPending ? "Saving..." : "Save Controls"}
            </button>
          </div>
          {draft ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] space-y-1" style={{ color: C.muted }}>
                Max Risk/Trade
                <input
                  type="number"
                  step="0.001"
                  value={draft.maxRiskPerTradePct}
                  onChange={(e) => setDraft({ ...draft, maxRiskPerTradePct: Number(e.target.value) })}
                  className="w-full rounded px-2 py-1 bg-[#111113] border border-[#333] text-zinc-100"
                />
              </label>
              <label className="text-[10px] space-y-1" style={{ color: C.muted }}>
                Max Daily Loss USD
                <input
                  type="number"
                  step="1"
                  value={draft.maxDailyLossUsd}
                  onChange={(e) => setDraft({ ...draft, maxDailyLossUsd: Number(e.target.value) })}
                  className="w-full rounded px-2 py-1 bg-[#111113] border border-[#333] text-zinc-100"
                />
              </label>
              <label className="text-[10px] space-y-1" style={{ color: C.muted }}>
                Max Exposure %
                <input
                  type="number"
                  step="0.01"
                  value={draft.maxOpenExposurePct}
                  onChange={(e) => setDraft({ ...draft, maxOpenExposurePct: Number(e.target.value) })}
                  className="w-full rounded px-2 py-1 bg-[#111113] border border-[#333] text-zinc-100"
                />
              </label>
              <label className="text-[10px] space-y-1" style={{ color: C.muted }}>
                Max Positions
                <input
                  type="number"
                  step="1"
                  value={draft.maxConcurrentPositions}
                  onChange={(e) => setDraft({ ...draft, maxConcurrentPositions: Number(e.target.value) })}
                  className="w-full rounded px-2 py-1 bg-[#111113] border border-[#333] text-zinc-100"
                />
              </label>
              <label className="text-[10px] space-y-1" style={{ color: C.muted }}>
                Max Trades/Session
                <input
                  type="number"
                  step="1"
                  value={draft.maxTradesPerSession}
                  onChange={(e) => setDraft({ ...draft, maxTradesPerSession: Number(e.target.value) })}
                  className="w-full rounded px-2 py-1 bg-[#111113] border border-[#333] text-zinc-100"
                />
              </label>
              <label className="text-[10px] space-y-1" style={{ color: C.muted }}>
                Cooldown Minutes
                <input
                  type="number"
                  step="1"
                  value={draft.cooldownMinutes}
                  onChange={(e) => setDraft({ ...draft, cooldownMinutes: Number(e.target.value) })}
                  className="w-full rounded px-2 py-1 bg-[#111113] border border-[#333] text-zinc-100"
                />
              </label>
            </div>
          ) : (
            <div className="text-xs" style={{ color: C.muted }}>
              Loading risk controls...
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="pt-6 border-t flex items-center justify-between" style={{ borderColor: "rgba(72,72,73,0.15)" }}>
        <div style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: C.outlineVar, letterSpacing: "0.2em", textTransform: "uppercase" }}>
          Auth Profile: Redacted
        </div>
        <div style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
          KERNEL V2.4.0 · GODSVIEW
        </div>
      </div>
    </div>
  );
}
