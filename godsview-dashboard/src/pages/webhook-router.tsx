import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function WebhookRouter() {
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);

  const { data: webhooks = [] } = useQuery({
    queryKey: ["webhooks"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/tradingview-mcp/webhooks`);
      if (!res.ok) throw new Error("Failed to fetch webhooks");
      return res.json();
    },
  });

  const eventLogs = Array.isArray(webhooks) ? webhooks : [];

  return (
    <div style={{ backgroundColor: "#0e0e0f", minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", color: "#ffffff", marginBottom: "8px" }}>
            Webhook Event Router
          </h1>
          <p style={{ color: "#767576", fontSize: "14px" }}>Monitor and route TradingView webhook events</p>
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
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#ffffff", marginBottom: "16px" }}>
            Event Logs ({eventLogs.length})
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                  <th style={{ textAlign: "left", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Timestamp
                  </th>
                  <th style={{ textAlign: "left", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Source
                  </th>
                  <th style={{ textAlign: "left", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Event Type
                  </th>
                  <th style={{ textAlign: "left", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Route Target
                  </th>
                  <th style={{ textAlign: "left", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {eventLogs.map((event: any, idx: number) => (
                  <tr
                    key={idx}
                    style={{
                      borderBottom: "1px solid rgba(72,72,73,0.2)",
                      cursor: "pointer",
                      backgroundColor: selectedEvent === String(idx) ? "rgba(156,255,147,0.05)" : "transparent",
                    }}
                    onClick={() => setSelectedEvent(selectedEvent === String(idx) ? null : String(idx))}
                  >
                    <td style={{ padding: "12px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#ffffff" }}>
                      {event.timestamp || "—"}
                    </td>
                    <td style={{ padding: "12px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#ffffff" }}>
                      {event.source || "—"}
                    </td>
                    <td style={{ padding: "12px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#ffffff" }}>
                      {event.event_type || "—"}
                    </td>
                    <td style={{ padding: "12px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#ffffff" }}>
                      {event.route_target || "—"}
                    </td>
                    <td style={{ padding: "12px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          fontSize: "11px",
                          fontFamily: "Space Grotesk",
                          backgroundColor: event.status === "success" ? "rgba(156,255,147,0.2)" : "rgba(255,100,100,0.2)",
                          color: event.status === "success" ? "#9cff93" : "#ff6464",
                        }}
                      >
                        {event.status || "unknown"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {selectedEvent !== null && eventLogs[parseInt(selectedEvent)] && (
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "16px" }}>
              Payload Preview
            </h2>
            <pre
              style={{
                backgroundColor: "#0e0e0f",
                padding: "12px",
                borderRadius: "8px",
                overflow: "auto",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: "12px",
                color: "#767576",
              }}
            >
              {JSON.stringify(eventLogs[parseInt(selectedEvent)].payload || {}, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
