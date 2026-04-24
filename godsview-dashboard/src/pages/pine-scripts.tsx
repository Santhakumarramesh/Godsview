import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function PineScripts() {
  const [filterStatus, setFilterStatus] = useState("all");

  const { data: tvcScripts } = useQuery({
    queryKey: ["tradingview-mcp", "signals"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/tradingview-mcp/signals`);
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: signals } = useQuery({
    queryKey: ["signals", "tradingview"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/signals?source=tradingview&limit=100`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  const scripts = tvcScripts?.scripts || [];
  const filtered =
    filterStatus === "all"
      ? scripts
      : scripts.filter((s: any) => (s.active ? "active" : "inactive") === filterStatus);

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
        <h1 style={{ marginBottom: "16px" }}>Pine Script Signal Registry</h1>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "8px",
            padding: "8px 12px",
            color: "#ffffff",
          }}
        >
          <option value="all">All Scripts</option>
          <option value="active">Active Only</option>
          <option value="inactive">Inactive Only</option>
        </select>
      </div>

      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "24px",
        }}
      >
        <h2 style={{ fontSize: "14px", color: "#767576", marginBottom: "16px", textTransform: "uppercase" }}>
          Registry Statistics
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "12px", color: "#767576" }}>Total Scripts</div>
            <div style={{ fontSize: "20px", fontWeight: "700", color: "#9cff93" }}>
              {filtered.length}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#767576" }}>Active</div>
            <div style={{ fontSize: "20px", fontWeight: "700", color: "#9cff93" }}>
              {filtered.filter((s: any) => s.active).length}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#767576" }}>Inactive</div>
            <div style={{ fontSize: "20px", fontWeight: "700", color: "#ff6b6b" }}>
              {filtered.filter((s: any) => !s.active).length}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#767576" }}>Recent Signals</div>
            <div style={{ fontSize: "20px", fontWeight: "700", color: "#9cff93" }}>
              {signals?.signals?.length || 0}
            </div>
          </div>
        </div>
      </div>

      <div style={{ overflowX: "auto", marginBottom: "24px" }}>
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
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Script Name</th>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Version</th>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Status</th>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Last Signal</th>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Signal Count</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 15).map((script: any, idx: number) => (
              <tr key={idx} style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                <td style={{ padding: "12px", color: "#9cff93", fontWeight: "600" }}>
                  {script.name}
                </td>
                <td style={{ padding: "12px", color: "#ffffff" }}>
                  {script.version || "1.0"}
                </td>
                <td style={{ padding: "12px" }}>
                  <span
                    style={{
                      padding: "4px 8px",
                      backgroundColor: script.active ? "rgba(156, 255, 147, 0.1)" : "rgba(255, 107, 107, 0.1)",
                      color: script.active ? "#9cff93" : "#ff6b6b",
                      borderRadius: "4px",
                      fontSize: "11px",
                    }}
                  >
                    {script.active ? "ACTIVE" : "INACTIVE"}
                  </span>
                </td>
                <td style={{ padding: "12px", color: "#767576", fontSize: "11px" }}>
                  {script.lastSignalTime
                    ? new Date(script.lastSignalTime).toLocaleString()
                    : "Never"}
                </td>
                <td style={{ padding: "12px", color: "#9cff93" }}>
                  {script.signalCount || 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <h2 style={{ fontSize: "14px", color: "#767576", marginBottom: "16px", textTransform: "uppercase" }}>
            Signal Definitions
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
            {filtered.slice(0, 6).map((script: any, idx: number) => (
              <div
                key={idx}
                style={{
                  backgroundColor: "#0e0e0f",
                  border: "1px solid rgba(72,72,73,0.2)",
                  borderRadius: "8px",
                  padding: "16px",
                }}
              >
                <h3 style={{ fontSize: "13px", fontWeight: "700", color: "#9cff93", marginBottom: "8px" }}>
                  {script.name}
                </h3>
                <div style={{ fontSize: "11px", color: "#767576", lineHeight: "1.6", marginBottom: "8px" }}>
                  {script.description || "No description available"}
                </div>
                <div style={{ fontSize: "11px", color: "#9cff93", fontFamily: '"JetBrains Mono", monospace' }}>
                  v{script.version || "1.0"} • {script.signalCount || 0} signals
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
