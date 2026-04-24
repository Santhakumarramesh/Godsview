import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  border: "rgba(72,72,73,0.2)",
  accent: "#9cff93",
  text: "#ffffff",
  muted: "#767576",
  danger: "#ff6464",
  warn: "#ffb347",
};

interface WebhookEvent {
  id?: string;
  timestamp: string;
  source: string;
  event_type: string;
  route_target: string;
  status: "success" | "failed" | "pending" | "retrying";
  latency_ms?: number;
  payload?: Record<string, unknown>;
  error_message?: string;
  retry_count?: number;
}

interface RouteConfig {
  id: string;
  name: string;
  pattern: string;
  target: string;
  enabled: boolean;
  priority: number;
  filter_conditions?: Record<string, string>;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    success: { bg: "rgba(156,255,147,0.15)", fg: C.accent },
    failed: { bg: "rgba(255,100,100,0.15)", fg: C.danger },
    pending: { bg: "rgba(255,179,71,0.15)", fg: C.warn },
    retrying: { bg: "rgba(100,150,255,0.15)", fg: "#6496ff" },
  };
  const c = colors[status] || colors.pending;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "4px 10px",
        borderRadius: "6px",
        fontSize: "11px",
        fontFamily: "Space Grotesk",
        backgroundColor: c.bg,
        color: c.fg,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: c.fg,
          animation: status === "retrying" ? "pulse 1.5s infinite" : undefined,
        }}
      />
      {status.toUpperCase()}
    </span>
  );
}

function MetricCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "16px" }}>
      <div style={{ fontSize: "12px", color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
        {label}
      </div>
      <div style={{ fontSize: "24px", fontWeight: "700", color: color || C.accent, fontFamily: "Space Grotesk" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: "11px", color: C.muted, marginTop: "4px" }}>{sub}</div>}
    </div>
  );
}

export default function WebhookRouter() {
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [showRouteConfig, setShowRouteConfig] = useState(false);
  const [testPayload, setTestPayload] = useState('{\n  "symbol": "BTCUSD",\n  "action": "buy",\n  "price": 67500\n}');
  const queryClient = useQueryClient();

  const { data: webhooks = [], isLoading, error } = useQuery({
    queryKey: ["webhooks"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/tradingview-mcp/webhooks`);
      if (!res.ok) throw new Error("Failed to fetch webhooks");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const { data: routeConfigs = [] } = useQuery<RouteConfig[]>({
    queryKey: ["webhook-routes"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/tradingview-mcp/routes`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const testWebhook = useMutation({
    mutationFn: async (payload: string) => {
      const res = await fetch(`${API}/api/tradingview-mcp/webhooks/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["webhooks"] }),
  });

  const eventLogs: WebhookEvent[] = Array.isArray(webhooks) ? webhooks : [];

  const filteredLogs = useMemo(() => {
    return eventLogs.filter((e) => {
      if (filterStatus !== "all" && e.status !== filterStatus) return false;
      if (filterSource !== "all" && e.source !== filterSource) return false;
      return true;
    });
  }, [eventLogs, filterStatus, filterSource]);

  const sources = useMemo(() => [...new Set(eventLogs.map((e) => e.source).filter(Boolean))], [eventLogs]);

  const stats = useMemo(() => {
    const total = eventLogs.length;
    const success = eventLogs.filter((e) => e.status === "success").length;
    const failed = eventLogs.filter((e) => e.status === "failed").length;
    const avgLatency = eventLogs.length > 0
      ? Math.round(eventLogs.reduce((s, e) => s + (e.latency_ms || 0), 0) / eventLogs.length)
      : 0;
    const rate = total > 0 ? ((success / total) * 100).toFixed(1) : "0.0";
    return { total, success, failed, avgLatency, rate };
  }, [eventLogs]);

  return (
    <div style={{ backgroundColor: C.bg, minHeight: "100vh", padding: "24px" }}>
      <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "32px" }}>
          <div>
            <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", color: C.text, marginBottom: "8px" }}>
              Webhook Event Router
            </h1>
            <p style={{ color: C.muted, fontSize: "14px" }}>
              Route TradingView alerts through the GodsView signal pipeline
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => setShowRouteConfig(!showRouteConfig)}
              style={{
                backgroundColor: showRouteConfig ? "rgba(156,255,147,0.15)" : C.card,
                border: `1px solid ${showRouteConfig ? C.accent : C.border}`,
                borderRadius: "8px",
                padding: "8px 16px",
                color: showRouteConfig ? C.accent : C.text,
                cursor: "pointer",
                fontFamily: "Space Grotesk",
                fontSize: "13px",
              }}
            >
              Route Config
            </button>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ["webhooks"] })}
              style={{
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: "8px",
                padding: "8px 16px",
                color: C.text,
                cursor: "pointer",
                fontFamily: "Space Grotesk",
                fontSize: "13px",
              }}
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Metrics */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px", marginBottom: "24px" }}>
          <MetricCard label="Total Events" value={stats.total} sub="All time" />
          <MetricCard label="Success Rate" value={`${stats.rate}%`} sub={`${stats.success} succeeded`} color={parseFloat(stats.rate) > 95 ? C.accent : C.warn} />
          <MetricCard label="Failed" value={stats.failed} sub="Require attention" color={stats.failed > 0 ? C.danger : C.accent} />
          <MetricCard label="Avg Latency" value={`${stats.avgLatency}ms`} sub="Parse + route" color={stats.avgLatency < 100 ? C.accent : C.warn} />
        </div>

        {/* Route Configuration Panel */}
        {showRouteConfig && (
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px", marginBottom: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: C.text }}>
                Route Configuration ({routeConfigs.length} routes)
              </h2>
            </div>
            {routeConfigs.length > 0 ? (
              <div style={{ display: "grid", gap: "12px" }}>
                {routeConfigs.map((route) => (
                  <div
                    key={route.id}
                    style={{
                      backgroundColor: C.bg,
                      border: `1px solid ${C.border}`,
                      borderRadius: "8px",
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      gap: "16px",
                    }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: route.enabled ? C.accent : C.muted,
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: "Space Grotesk", fontSize: "14px", color: C.text }}>{route.name}</div>
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: C.muted, marginTop: "4px" }}>
                        Pattern: {route.pattern} → {route.target}
                      </div>
                    </div>
                    <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: C.muted }}>
                      Priority: {route.priority}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: C.muted, fontSize: "13px", padding: "16px", textAlign: "center" }}>
                No routes configured. Incoming webhooks will use default signal pipeline routing.
              </div>
            )}

            {/* Test Webhook */}
            <div style={{ marginTop: "20px", borderTop: `1px solid ${C.border}`, paddingTop: "20px" }}>
              <h3 style={{ fontFamily: "Space Grotesk", fontSize: "14px", color: C.muted, marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Test Webhook
              </h3>
              <textarea
                value={testPayload}
                onChange={(e) => setTestPayload(e.target.value)}
                rows={5}
                style={{
                  width: "100%",
                  backgroundColor: C.bg,
                  border: `1px solid ${C.border}`,
                  borderRadius: "8px",
                  padding: "12px",
                  color: C.text,
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "12px",
                  resize: "vertical",
                }}
              />
              <button
                onClick={() => testWebhook.mutate(testPayload)}
                disabled={testWebhook.isPending}
                style={{
                  marginTop: "12px",
                  backgroundColor: "rgba(156,255,147,0.15)",
                  border: `1px solid ${C.accent}`,
                  borderRadius: "8px",
                  padding: "8px 20px",
                  color: C.accent,
                  cursor: testWebhook.isPending ? "wait" : "pointer",
                  fontFamily: "Space Grotesk",
                  fontSize: "13px",
                }}
              >
                {testWebhook.isPending ? "Sending..." : "Send Test Webhook"}
              </button>
              {testWebhook.isSuccess && (
                <span style={{ marginLeft: "12px", fontSize: "12px", color: C.accent }}>Test sent successfully</span>
              )}
              {testWebhook.isError && (
                <span style={{ marginLeft: "12px", fontSize: "12px", color: C.danger }}>Test failed — check API connection</span>
              )}
            </div>
          </div>
        )}

        {/* Filters */}
        <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{
              backgroundColor: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: "8px",
              padding: "8px 12px",
              color: C.text,
              fontFamily: "Space Grotesk",
              fontSize: "13px",
            }}
          >
            <option value="all">All Status</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
            <option value="retrying">Retrying</option>
          </select>
          <select
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
            style={{
              backgroundColor: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: "8px",
              padding: "8px 12px",
              color: C.text,
              fontFamily: "Space Grotesk",
              fontSize: "13px",
            }}
          >
            <option value="all">All Sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <div style={{ marginLeft: "auto", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: C.muted, alignSelf: "center" }}>
            {filteredLogs.length} / {eventLogs.length} events
          </div>
        </div>

        {/* Event Logs */}
        {error ? (
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "40px", textAlign: "center" }}>
            <div style={{ fontSize: "14px", color: C.danger, marginBottom: "8px" }}>Failed to load webhook events</div>
            <div style={{ fontSize: "12px", color: C.muted }}>Check API connection at {API || "localhost:3001"}</div>
          </div>
        ) : isLoading ? (
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "40px", textAlign: "center" }}>
            <div style={{ fontSize: "14px", color: C.muted }}>Loading webhook events...</div>
          </div>
        ) : (
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {["Timestamp", "Source", "Event Type", "Route Target", "Latency", "Status"].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: h === "Latency" ? "right" : "left",
                          padding: "12px",
                          fontFamily: "Space Grotesk",
                          color: C.accent,
                          fontSize: "12px",
                          fontWeight: "500",
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: "32px", textAlign: "center", color: C.muted, fontSize: "13px" }}>
                        {eventLogs.length === 0
                          ? "No webhook events yet. Configure a TradingView alert to send webhooks here."
                          : "No events match current filters."}
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((event, idx) => (
                      <tr
                        key={event.id || idx}
                        style={{
                          borderBottom: `1px solid ${C.border}`,
                          cursor: "pointer",
                          backgroundColor: selectedEvent === String(idx) ? "rgba(156,255,147,0.05)" : "transparent",
                          transition: "background-color 0.15s",
                        }}
                        onClick={() => setSelectedEvent(selectedEvent === String(idx) ? null : String(idx))}
                      >
                        <td style={{ padding: "12px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: C.text }}>
                          {event.timestamp ? new Date(event.timestamp).toLocaleString() : "—"}
                        </td>
                        <td style={{ padding: "12px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: C.text }}>
                          {event.source || "—"}
                        </td>
                        <td style={{ padding: "12px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: C.text }}>
                          {event.event_type || "—"}
                        </td>
                        <td style={{ padding: "12px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: C.text }}>
                          {event.route_target || "—"}
                        </td>
                        <td style={{ padding: "12px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: C.muted, textAlign: "right" }}>
                          {event.latency_ms != null ? `${event.latency_ms}ms` : "—"}
                        </td>
                        <td style={{ padding: "12px" }}>
                          <StatusBadge status={event.status || "pending"} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Payload Detail */}
        {selectedEvent !== null && filteredLogs[parseInt(selectedEvent)] && (
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px", marginTop: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: C.accent }}>
                Event Detail
              </h2>
              <button
                onClick={() => setSelectedEvent(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: C.muted,
                  cursor: "pointer",
                  fontSize: "18px",
                }}
              >
                ×
              </button>
            </div>
            {filteredLogs[parseInt(selectedEvent)].error_message && (
              <div
                style={{
                  backgroundColor: "rgba(255,100,100,0.1)",
                  border: "1px solid rgba(255,100,100,0.2)",
                  borderRadius: "8px",
                  padding: "12px",
                  marginBottom: "16px",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "12px",
                  color: C.danger,
                }}
              >
                Error: {filteredLogs[parseInt(selectedEvent)].error_message}
                {filteredLogs[parseInt(selectedEvent)].retry_count != null && (
                  <span style={{ color: C.muted, marginLeft: "12px" }}>
                    (Retries: {filteredLogs[parseInt(selectedEvent)].retry_count})
                  </span>
                )}
              </div>
            )}
            <pre
              style={{
                backgroundColor: C.bg,
                padding: "16px",
                borderRadius: "8px",
                overflow: "auto",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: "12px",
                color: C.muted,
                maxHeight: "300px",
              }}
            >
              {JSON.stringify(filteredLogs[parseInt(selectedEvent)].payload || filteredLogs[parseInt(selectedEvent)], null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
