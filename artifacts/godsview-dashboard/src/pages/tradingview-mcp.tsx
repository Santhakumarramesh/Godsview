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
  danger: "#ff6b6b",
  warn: "#ffb347",
  info: "#6496ff",
};

interface MCPTool {
  name: string;
  description: string;
  active: boolean;
  category?: string;
  last_invoked?: string;
  invocation_count?: number;
  avg_latency_ms?: number;
}

interface WebhookMapping {
  eventType: string;
  endpoint: string;
  enabled?: boolean;
  last_triggered?: string;
  trigger_count?: number;
}

interface MCPAction {
  id: string;
  name: string;
  description: string;
  category: string;
  params?: Array<{ name: string; type: string; required: boolean }>;
}

const MCP_ACTIONS: MCPAction[] = [
  { id: "analyze_current", name: "Analyze Current Symbol", description: "Deep analysis of the currently viewed symbol", category: "Analysis", params: [{ name: "symbol", type: "string", required: true }] },
  { id: "compare_historical", name: "Compare Historical Setups", description: "Find similar setups in recall engine memory", category: "Memory", params: [{ name: "symbol", type: "string", required: true }] },
  { id: "save_chart_state", name: "Save Chart State", description: "Snapshot current chart annotations to memory vault", category: "Memory" },
  { id: "launch_backtest", name: "Launch Backtest", description: "Start a backtest for the current setup pattern", category: "Quant", params: [{ name: "symbol", type: "string", required: true }, { name: "strategy", type: "string", required: true }] },
  { id: "send_to_queue", name: "Send to Approval Queue", description: "Push current symbol to assisted live trading queue", category: "Execution", params: [{ name: "symbol", type: "string", required: true }] },
  { id: "fetch_order_flow", name: "Fetch Order Flow", description: "Pull latest order flow data for confluence analysis", category: "Analysis", params: [{ name: "symbol", type: "string", required: true }] },
];

function StatusDot({ active, size = 8 }: { active: boolean; size?: number }) {
  return (
    <span style={{
      display: "inline-block", width: size, height: size, borderRadius: "50%",
      backgroundColor: active ? C.accent : C.danger,
      boxShadow: active ? `0 0 6px ${C.accent}` : "none",
    }} />
  );
}

export default function TradingViewMCP() {
  const [enableMCP, setEnableMCP] = useState(true);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"tools" | "actions" | "webhooks" | "logs">("tools");
  const [actionSymbol, setActionSymbol] = useState("BTCUSD");
  const queryClient = useQueryClient();

  const { data: mcpStatus, isLoading: statusLoading } = useQuery({
    queryKey: ["tradingview-mcp", "status"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/tradingview-mcp/status`);
      return res.json();
    },
    refetchInterval: 15000,
  });

  const { data: mcpTools } = useQuery({
    queryKey: ["tradingview-mcp", "tools"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/tradingview-mcp/tools`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: recentLogs = [] } = useQuery({
    queryKey: ["tradingview-mcp", "logs"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/tradingview-mcp/logs?limit=20`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 10000,
  });

  const executeAction = useMutation({
    mutationFn: async (action: { id: string; params?: Record<string, string> }) => {
      const res = await fetch(`${API}/api/tradingview-mcp/actions/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tradingview-mcp"] }),
  });

  const tools: MCPTool[] = mcpTools?.tools || [];
  const isConnected = mcpStatus?.connected || false;
  const webhookMappings: WebhookMapping[] = mcpStatus?.webhookMappings || [];
  const uptime = mcpStatus?.uptime_seconds || 0;
  const logs = Array.isArray(recentLogs) ? recentLogs : [];

  const toolCategories = useMemo(() => {
    const cats: Record<string, MCPTool[]> = {};
    tools.forEach((t) => {
      const cat = t.category || "General";
      if (!cats[cat]) cats[cat] = [];
      cats[cat].push(t);
    });
    return cats;
  }, [tools]);

  const tabs = [
    { id: "tools" as const, label: "Tools Registry", count: tools.length },
    { id: "actions" as const, label: "Action Bridge", count: MCP_ACTIONS.length },
    { id: "webhooks" as const, label: "Webhook Mappings", count: webhookMappings.length },
    { id: "logs" as const, label: "Activity Log", count: logs.length },
  ];

  return (
    <div style={{ backgroundColor: C.bg, color: C.text, minHeight: "100vh", padding: "24px", fontFamily: '"Space Grotesk", sans-serif' }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ fontSize: "28px", marginBottom: "8px" }}>TradingView MCP Control</h1>
          <p style={{ color: C.muted, fontSize: "14px" }}>
            Model Context Protocol bridge — connect TradingView actions to the GodsView intelligence pipeline
          </p>
        </div>

        {/* Connection Status + Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "24px" }}>
          <div style={{ backgroundColor: C.card, border: `1px solid ${isConnected ? C.accent : C.danger}`, borderRadius: "12px", padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <StatusDot active={isConnected} size={10} />
              <span style={{ fontSize: "14px", fontWeight: "600", color: isConnected ? C.accent : C.danger }}>
                {statusLoading ? "Checking..." : isConnected ? "CONNECTED" : "DISCONNECTED"}
              </span>
            </div>
            <div style={{ fontSize: "11px", color: C.muted }}>
              Last heartbeat: {mcpStatus?.lastHeartbeat ? new Date(mcpStatus.lastHeartbeat).toLocaleTimeString() : "Never"}
            </div>
            {uptime > 0 && (
              <div style={{ fontSize: "11px", color: C.muted, marginTop: "4px" }}>
                Uptime: {Math.floor(uptime / 3600)}h {Math.floor((uptime % 3600) / 60)}m
              </div>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", fontSize: "12px", color: C.muted, cursor: "pointer" }}>
              <input type="checkbox" checked={enableMCP} onChange={(e) => setEnableMCP(e.target.checked)} style={{ cursor: "pointer" }} />
              Enable MCP
            </label>
          </div>

          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "20px" }}>
            <div style={{ fontSize: "12px", color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>Registered Tools</div>
            <div style={{ fontSize: "28px", fontWeight: "700", color: C.accent }}>{tools.length}</div>
            <div style={{ fontSize: "11px", color: C.muted, marginTop: "4px" }}>{tools.filter((t) => t.active).length} active</div>
          </div>

          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "20px" }}>
            <div style={{ fontSize: "12px", color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>Webhook Routes</div>
            <div style={{ fontSize: "28px", fontWeight: "700", color: C.accent }}>{webhookMappings.length}</div>
            <div style={{ fontSize: "11px", color: C.muted, marginTop: "4px" }}>Event → action mappings</div>
          </div>

          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "20px" }}>
            <div style={{ fontSize: "12px", color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>Version</div>
            <div style={{ fontSize: "16px", fontWeight: "600", color: C.accent, fontFamily: "JetBrains Mono, monospace" }}>{mcpStatus?.version || "—"}</div>
            <div style={{ fontSize: "11px", color: C.muted, marginTop: "4px" }}>TradingView Bridge</div>
          </div>
        </div>

        {/* Tab Bar */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "20px", borderBottom: `1px solid ${C.border}`, paddingBottom: "4px" }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                backgroundColor: activeTab === tab.id ? "rgba(156,255,147,0.1)" : "transparent",
                border: "none",
                borderBottom: activeTab === tab.id ? `2px solid ${C.accent}` : "2px solid transparent",
                padding: "10px 16px",
                color: activeTab === tab.id ? C.accent : C.muted,
                cursor: "pointer",
                fontFamily: "Space Grotesk",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {tab.label}
              <span style={{ fontSize: "11px", backgroundColor: "rgba(255,255,255,0.08)", padding: "2px 6px", borderRadius: "4px" }}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Tools Tab */}
        {activeTab === "tools" && (
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px" }}>
            {Object.keys(toolCategories).length > 0 ? (
              Object.entries(toolCategories).map(([category, catTools]) => (
                <div key={category} style={{ marginBottom: "24px" }}>
                  <h3 style={{ fontSize: "12px", color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>
                    {category} ({catTools.length})
                  </h3>
                  <div style={{ display: "grid", gap: "8px" }}>
                    {catTools.map((tool, idx) => (
                      <div
                        key={idx}
                        onClick={() => setSelectedTool(selectedTool === tool.name ? null : tool.name)}
                        style={{
                          backgroundColor: selectedTool === tool.name ? "rgba(156,255,147,0.05)" : C.bg,
                          border: `1px solid ${selectedTool === tool.name ? C.accent : C.border}`,
                          borderRadius: "8px",
                          padding: "12px 16px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          transition: "all 0.15s",
                        }}
                      >
                        <StatusDot active={tool.active} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "13px", color: C.accent, fontWeight: "500" }}>{tool.name}</div>
                          <div style={{ fontSize: "12px", color: C.muted, marginTop: "2px" }}>{tool.description || "—"}</div>
                        </div>
                        {tool.invocation_count != null && (
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: C.text }}>{tool.invocation_count}</div>
                            <div style={{ fontSize: "10px", color: C.muted }}>invocations</div>
                          </div>
                        )}
                        {tool.avg_latency_ms != null && (
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: C.text }}>{tool.avg_latency_ms}ms</div>
                            <div style={{ fontSize: "10px", color: C.muted }}>avg latency</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ textAlign: "center", padding: "40px", color: C.muted }}>
                <div style={{ fontSize: "14px", marginBottom: "8px" }}>No tools registered</div>
                <div style={{ fontSize: "12px" }}>Connect the TradingView bridge service to register tools</div>
              </div>
            )}
          </div>
        )}

        {/* Actions Tab */}
        {activeTab === "actions" && (
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
              <label style={{ fontSize: "12px", color: C.muted }}>Symbol:</label>
              <input
                type="text"
                value={actionSymbol}
                onChange={(e) => setActionSymbol(e.target.value.toUpperCase())}
                style={{
                  backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: "8px",
                  padding: "8px 12px", color: C.text, fontFamily: "JetBrains Mono, monospace", width: "120px",
                }}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" }}>
              {MCP_ACTIONS.map((action) => (
                <div
                  key={action.id}
                  style={{
                    backgroundColor: C.bg,
                    border: `1px solid ${C.border}`,
                    borderRadius: "10px",
                    padding: "16px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: "500", color: C.text }}>{action.name}</div>
                      <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>{action.description}</div>
                    </div>
                    <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "4px", backgroundColor: "rgba(100,150,255,0.1)", color: C.info }}>
                      {action.category}
                    </span>
                  </div>
                  <button
                    onClick={() => executeAction.mutate({ id: action.id, params: { symbol: actionSymbol } })}
                    disabled={!isConnected || executeAction.isPending}
                    style={{
                      marginTop: "8px",
                      backgroundColor: isConnected ? "rgba(156,255,147,0.1)" : "rgba(118,117,118,0.1)",
                      border: `1px solid ${isConnected ? C.accent : C.muted}`,
                      borderRadius: "6px",
                      padding: "6px 14px",
                      color: isConnected ? C.accent : C.muted,
                      cursor: isConnected ? "pointer" : "not-allowed",
                      fontFamily: "Space Grotesk",
                      fontSize: "12px",
                      width: "100%",
                    }}
                  >
                    {executeAction.isPending ? "Executing..." : "Execute"}
                  </button>
                </div>
              ))}
            </div>
            {executeAction.isSuccess && (
              <div style={{ marginTop: "16px", padding: "12px", backgroundColor: "rgba(156,255,147,0.08)", border: `1px solid rgba(156,255,147,0.2)`, borderRadius: "8px", fontSize: "12px", color: C.accent }}>
                Action executed successfully
              </div>
            )}
          </div>
        )}

        {/* Webhooks Tab */}
        {activeTab === "webhooks" && (
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px" }}>
            {webhookMappings.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" }}>
                {webhookMappings.map((mapping, idx) => (
                  <div key={idx} style={{ backgroundColor: C.bg, borderRadius: "10px", border: `1px solid ${C.border}`, padding: "16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                      <StatusDot active={mapping.enabled !== false} size={6} />
                      <span style={{ fontSize: "13px", fontWeight: "500", color: C.text }}>{mapping.eventType}</span>
                    </div>
                    <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: C.accent, wordBreak: "break-all", marginBottom: "8px" }}>
                      → {mapping.endpoint}
                    </div>
                    <div style={{ display: "flex", gap: "16px" }}>
                      {mapping.trigger_count != null && (
                        <span style={{ fontSize: "11px", color: C.muted }}>{mapping.trigger_count} triggers</span>
                      )}
                      {mapping.last_triggered && (
                        <span style={{ fontSize: "11px", color: C.muted }}>Last: {new Date(mapping.last_triggered).toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "40px", color: C.muted }}>
                <div style={{ fontSize: "14px", marginBottom: "8px" }}>No webhook mappings configured</div>
                <div style={{ fontSize: "12px" }}>Set up TradingView alerts to POST to your GodsView webhook endpoint</div>
              </div>
            )}
          </div>
        )}

        {/* Logs Tab */}
        {activeTab === "logs" && (
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px" }}>
            {logs.length > 0 ? (
              <div style={{ display: "grid", gap: "6px" }}>
                {logs.map((log: any, idx: number) => (
                  <div key={idx} style={{ display: "flex", gap: "12px", padding: "8px 12px", backgroundColor: idx % 2 === 0 ? C.bg : "transparent", borderRadius: "6px", fontSize: "12px", fontFamily: "JetBrains Mono, monospace" }}>
                    <span style={{ color: C.muted, minWidth: "160px" }}>{log.timestamp ? new Date(log.timestamp).toLocaleString() : "—"}</span>
                    <span style={{ color: log.level === "error" ? C.danger : log.level === "warn" ? C.warn : C.accent, minWidth: "50px" }}>
                      {(log.level || "info").toUpperCase()}
                    </span>
                    <span style={{ color: C.text }}>{log.message || "—"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "40px", color: C.muted, fontSize: "13px" }}>
                No recent activity. Actions, webhooks, and tool invocations will appear here.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
