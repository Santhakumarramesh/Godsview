import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function TradingViewMCP() {
  const [enableMCP, setEnableMCP] = useState(true);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);

  const { data: mcpStatus } = useQuery({
    queryKey: ["tradingview-mcp", "status"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/tradingview-mcp/status`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: mcpTools } = useQuery({
    queryKey: ["tradingview-mcp", "tools"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/tradingview-mcp/tools`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  const tools = mcpTools?.tools || [];
  const isConnected = mcpStatus?.connected || false;
  const webhookMappings = mcpStatus?.webhookMappings || [];

  return (
    <div
      style={{
        backgroundColor: "#0e0e0f",
        color: "#ffffff",
        minHeight: "100vh",
        padding: "24px",
        fontFamily: '"Space Grotesk", sans-serif',
      }}
    >
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ marginBottom: "16px" }}>TradingView MCP Control</h1>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" }}>
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <h2 style={{ fontSize: "14px", color: "#767576", marginBottom: "16px", textTransform: "uppercase" }}>
            MCP Status
          </h2>

          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "12px", color: "#767576", marginBottom: "8px" }}>Connection State</div>
            <div
              style={{
                padding: "12px",
                backgroundColor: isConnected ? "rgba(156, 255, 147, 0.1)" : "rgba(255, 107, 107, 0.1)",
                border: `1px solid ${isConnected ? "#9cff93" : "#ff6b6b"}`,
                borderRadius: "8px",
                color: isConnected ? "#9cff93" : "#ff6b6b",
                fontSize: "14px",
                fontWeight: "700",
              }}
            >
              {isConnected ? "CONNECTED" : "DISCONNECTED"}
            </div>
          </div>

          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "12px", color: "#767576", marginBottom: "8px" }}>Last Heartbeat</div>
            <div
              style={{
                fontSize: "12px",
                color: "#9cff93",
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              {mcpStatus?.lastHeartbeat
                ? new Date(mcpStatus.lastHeartbeat).toLocaleString()
                : "Never"}
            </div>
          </div>

          <div>
            <label style={{ fontSize: "12px", color: "#767576", display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="checkbox"
                checked={enableMCP}
                onChange={(e) => setEnableMCP(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              Enable MCP Features
            </label>
          </div>
        </div>

        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <h2 style={{ fontSize: "14px", color: "#767576", marginBottom: "16px", textTransform: "uppercase" }}>
            Tools Summary
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
            <div style={{ paddingBottom: "12px", borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
              <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px" }}>Registered Tools</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#9cff93" }}>
                {tools.length}
              </div>
            </div>
            <div style={{ paddingBottom: "12px", borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
              <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px" }}>Active Commands</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#9cff93" }}>
                {tools.filter((t: any) => t.active).length}
              </div>
            </div>
            <div style={{ paddingBottom: "12px", borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
              <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px" }}>Webhooks</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#9cff93" }}>
                {webhookMappings.length}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px" }}>Version</div>
              <div
                style={{
                  fontSize: "12px",
                  color: "#9cff93",
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                {mcpStatus?.version || "N/A"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          marginTop: "20px",
        }}
      >
        <h2 style={{ fontSize: "14px", color: "#767576", marginBottom: "16px", textTransform: "uppercase" }}>
          Registered Tools
        </h2>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "12px",
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Tool Name</th>
                <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Status</th>
                <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Description</th>
              </tr>
            </thead>
            <tbody>
              {tools.slice(0, 10).map((tool: any, idx: number) => (
                <tr key={idx} style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                  <td style={{ padding: "12px", color: "#9cff93", fontWeight: "600" }}>
                    {tool.name}
                  </td>
                  <td style={{ padding: "12px" }}>
                    <span
                      style={{
                        padding: "4px 8px",
                        backgroundColor: tool.active ? "rgba(156, 255, 147, 0.1)" : "rgba(255, 107, 107, 0.1)",
                        color: tool.active ? "#9cff93" : "#ff6b6b",
                        borderRadius: "4px",
                        fontSize: "11px",
                      }}
                    >
                      {tool.active ? "ACTIVE" : "INACTIVE"}
                    </span>
                  </td>
                  <td style={{ padding: "12px", color: "#767576", maxWidth: "250px" }}>
                    {tool.description || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {webhookMappings.length > 0 && (
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
            marginTop: "20px",
          }}
        >
          <h2 style={{ fontSize: "14px", color: "#767576", marginBottom: "16px", textTransform: "uppercase" }}>
            Webhook Mappings
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px" }}>
            {webhookMappings.map((mapping: any, idx: number) => (
              <div
                key={idx}
                style={{
                  padding: "12px",
                  backgroundColor: "#0e0e0f",
                  borderRadius: "8px",
                  border: "1px solid rgba(72,72,73,0.2)",
                }}
              >
                <div style={{ fontSize: "11px", color: "#767576", marginBottom: "4px" }}>
                  {mapping.eventType}
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "#9cff93",
                    fontFamily: '"JetBrains Mono", monospace',
                    wordBreak: "break-all",
                  }}
                >
                  {mapping.endpoint}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
