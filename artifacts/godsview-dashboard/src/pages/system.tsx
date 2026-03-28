import { useGetSystemStatus } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
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
  const { data, isLoading } = useGetSystemStatus();
  const { data: diag, isLoading: diagLoading, refetch: refetchDiag } = useQuery<Diagnostics>({
    queryKey: ["diagnostics"],
    queryFn: () => fetch("/api/system/diagnostics").then((r) => r.json()),
    refetchInterval: 30000,
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: C.primary }} />
      </div>
    );
  }

  const healthy = data.overall === "healthy";

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
