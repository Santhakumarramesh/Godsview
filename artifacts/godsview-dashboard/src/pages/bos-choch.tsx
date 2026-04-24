import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function BOSCHOCHEngine() {
  const [symbol, setSymbol] = useState("BTCUSD");
  const [eventType, setEventType] = useState("all");
  const [direction, setDirection] = useState("all");
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);

  const { data: marketStructure, isLoading, error } = useQuery({
    queryKey: ["market-structure", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/market-structure?symbol=${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch market structure");
      return res.json();
    },
    refetchInterval: 45000,
  });

  const bosEvents = marketStructure?.bosEvents || [];
  const chochEvents = marketStructure?.chochEvents || [];

  const allEvents = useMemo(() => {
    const events = [
      ...bosEvents.map((e: any) => ({ ...e, type: "BOS", direction: e.direction || "up" })),
      ...chochEvents.map((e: any) => ({ ...e, type: "CHOCH", direction: e.direction || "down" })),
    ].sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return events;
  }, [bosEvents, chochEvents]);

  const filtered = useMemo(() => {
    return allEvents.filter((e: any) => {
      const typeMatch = eventType === "all" || e.type === eventType;
      const dirMatch = direction === "all" ||
        (direction === "bullish" && e.direction === "up") ||
        (direction === "bearish" && e.direction === "down");
      return typeMatch && dirMatch;
    });
  }, [allEvents, eventType, direction]);

  const stats = useMemo(() => {
    const bullish = filtered.filter((e: any) => e.direction === "up").length;
    const bearish = filtered.filter((e: any) => e.direction === "down").length;
    const avgConf = filtered.length
      ? (filtered.reduce((sum: number, e: any) => sum + (e.confidence || 0), 0) / filtered.length).toFixed(0)
      : "0";
    const latest = filtered[0]?.timestamp ? new Date(filtered[0].timestamp).toLocaleString() : "—";
    const strongest = filtered.length
      ? Math.max(...filtered.map((e: any) => e.confidence || 0))
      : 0;
    return { bullish, bearish, avgConf, latest, strongest };
  }, [filtered]);

  if (isLoading) {
    return (
      <div style={{ backgroundColor: "#0e0e0f", color: "#ffffff", minHeight: "100vh", padding: "24px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "16px", marginBottom: "12px" }}>Loading market structure...</div>
          <div style={{ width: "40px", height: "40px", border: "2px solid rgba(156, 255, 147, 0.3)", borderTopColor: "#9cff93", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ backgroundColor: "#0e0e0f", color: "#ffffff", minHeight: "100vh", padding: "24px" }}>
        <div style={{ backgroundColor: "rgba(255, 107, 107, 0.1)", border: "1px solid #ff6b6b", borderRadius: "8px", padding: "16px", marginBottom: "24px" }}>
          <div style={{ color: "#ff6b6b", fontWeight: "500", marginBottom: "8px" }}>Error Loading Data</div>
          <div style={{ color: "#767576", fontSize: "14px" }}>
            Unable to fetch market structure. Please check your connection or try another symbol.
          </div>
        </div>
      </div>
    );
  }

  const eventById = (id: string) => filtered.find((e: any) => e.timestamp === id);

  return (
    <div style={{ backgroundColor: "#0e0e0f", color: "#ffffff", minHeight: "100vh", padding: "24px", fontFamily: '"Space Grotesk", sans-serif' }}>
      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: "700", marginBottom: "8px" }}>BOS/CHOCH Engine</h1>
        <p style={{ fontSize: "14px", color: "#767576", marginBottom: "20px" }}>
          Track breaks of structure (BOS) and changes of character (CHOCH) — identify trend continuations and reversals in real-time
        </p>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Symbol (e.g., BTCUSD)"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "8px",
              padding: "10px 14px",
              color: "#ffffff",
              fontSize: "13px",
              fontFamily: '"JetBrains Mono", monospace',
              flex: "1 1 150px",
            }}
          />
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "8px",
              padding: "10px 14px",
              color: "#ffffff",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            <option value="all">All Types</option>
            <option value="BOS">BOS Only</option>
            <option value="CHOCH">CHOCH Only</option>
          </select>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "8px",
              padding: "10px 14px",
              color: "#ffffff",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            <option value="all">All Directions</option>
            <option value="bullish">Bullish</option>
            <option value="bearish">Bearish</option>
          </select>
        </div>
      </div>

      {/* Stats Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px", marginBottom: "24px" }}>
        {[
          { label: "Total Events", value: filtered.length, color: "#9cff93" },
          { label: "Bullish", value: stats.bullish, color: "#9cff93" },
          { label: "Bearish", value: stats.bearish, color: "#ff6b6b" },
          { label: "Avg Confidence", value: `${stats.avgConf}%`, color: "#9cff93" },
          { label: "Latest Event", value: stats.latest, color: "#ffcc00" },
          { label: "Strongest Signal", value: `${stats.strongest}%`, color: "#9cff93" },
        ].map((stat, idx) => (
          <div
            key={idx}
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            <div style={{ fontSize: "11px", color: "#767576", textTransform: "uppercase", marginBottom: "8px" }}>
              {stat.label}
            </div>
            <div style={{ fontSize: "20px", fontWeight: "700", color: stat.color, fontFamily: '"JetBrains Mono", monospace' }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: selectedEvent ? "1fr 320px" : "1fr", gap: "20px" }}>
        {/* Events Table */}
        <div>
          {filtered.length === 0 ? (
            <div
              style={{
                backgroundColor: "#1a191b",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "8px",
                padding: "40px 20px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "16px", color: "#ffffff", marginBottom: "8px" }}>No events found</div>
              <div style={{ fontSize: "13px", color: "#767576", marginBottom: "16px" }}>
                Try adjusting your filters or check back for new market structure breaks.
              </div>
              <div style={{ fontSize: "12px", color: "#767576" }}>
                Tip: BOS indicates trend continuation, CHOCH suggests a reversal.
              </div>
            </div>
          ) : (
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
                    <th style={{ padding: "12px", textAlign: "left", color: "#767576", fontWeight: "500" }}>Time</th>
                    <th style={{ padding: "12px", textAlign: "left", color: "#767576", fontWeight: "500" }}>Type</th>
                    <th style={{ padding: "12px", textAlign: "left", color: "#767576", fontWeight: "500" }}>Direction</th>
                    <th style={{ padding: "12px", textAlign: "left", color: "#767576", fontWeight: "500" }}>Confidence</th>
                    <th style={{ padding: "12px", textAlign: "left", color: "#767576", fontWeight: "500" }}>Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 50).map((event: any) => (
                    <tr
                      key={event.timestamp}
                      onClick={() => setSelectedEvent(selectedEvent === event.timestamp ? null : event.timestamp)}
                      style={{
                        borderBottom: "1px solid rgba(72,72,73,0.2)",
                        backgroundColor: selectedEvent === event.timestamp ? "rgba(156, 255, 147, 0.05)" : "transparent",
                        cursor: "pointer",
                        transition: "background-color 0.2s",
                      }}
                      onMouseEnter={(e) => {
                        if (selectedEvent !== event.timestamp) {
                          (e.currentTarget as HTMLTableRowElement).style.backgroundColor = "rgba(72,72,73,0.1)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedEvent !== event.timestamp) {
                          (e.currentTarget as HTMLTableRowElement).style.backgroundColor = "transparent";
                        }
                      }}
                    >
                      <td style={{ padding: "12px", color: "#767576" }}>
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: "12px" }}>
                        <span
                          style={{
                            padding: "4px 8px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            fontWeight: "600",
                            backgroundColor: event.type === "BOS" ? "rgba(156, 255, 147, 0.2)" : "rgba(255, 107, 107, 0.2)",
                            color: event.type === "BOS" ? "#9cff93" : "#ff6b6b",
                          }}
                        >
                          {event.type}
                        </span>
                      </td>
                      <td style={{ padding: "12px", color: "#ffffff" }}>
                        <span style={{ color: event.direction === "up" ? "#9cff93" : "#ff6b6b" }}>
                          {event.direction === "up" ? "↑" : "↓"} {event.direction.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: "12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div
                            style={{
                              width: "60px",
                              height: "4px",
                              backgroundColor: "rgba(72,72,73,0.3)",
                              borderRadius: "2px",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${event.confidence || 0}%`,
                                height: "100%",
                                backgroundColor: event.confidence > 80 ? "#9cff93" : event.confidence > 50 ? "#ffcc00" : "#ff6b6b",
                                transition: "width 0.3s",
                              }}
                            />
                          </div>
                          <span style={{ color: "#767576", fontSize: "11px" }}>{event.confidence || 0}%</span>
                        </div>
                      </td>
                      <td style={{ padding: "12px", color: "#767576" }}>
                        {event.symbol}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div
            style={{
              padding: "12px",
              textAlign: "center",
              fontSize: "12px",
              color: "#767576",
              borderTop: "1px solid rgba(72,72,73,0.2)",
              backgroundColor: "#1a191b",
              borderRadius: "0 0 8px 8px",
            }}
          >
            Showing {Math.min(50, filtered.length)} of {filtered.length} events
          </div>
        </div>

        {/* Detail Panel */}
        {selectedEvent && eventById(selectedEvent) && (
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "8px",
              padding: "16px",
              height: "fit-content",
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "12px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ fontSize: "13px", fontWeight: "600", color: "#ffffff" }}>Event Details</div>
              <button
                onClick={() => setSelectedEvent(null)}
                style={{
                  backgroundColor: "transparent",
                  border: "none",
                  color: "#767576",
                  cursor: "pointer",
                  fontSize: "18px",
                }}
              >
                ×
              </button>
            </div>
            {(() => {
              const event = eventById(selectedEvent);
              return (
                <>
                  <div style={{ marginBottom: "16px" }}>
                    <div style={{ color: "#767576", fontSize: "11px", marginBottom: "4px" }}>TYPE</div>
                    <div
                      style={{
                        color: event.type === "BOS" ? "#9cff93" : "#ff6b6b",
                        fontSize: "14px",
                        fontWeight: "600",
                      }}
                    >
                      {event.type}
                    </div>
                  </div>
                  <div style={{ marginBottom: "16px" }}>
                    <div style={{ color: "#767576", fontSize: "11px", marginBottom: "4px" }}>DIRECTION</div>
                    <div style={{ color: event.direction === "up" ? "#9cff93" : "#ff6b6b", fontSize: "14px", fontWeight: "600" }}>
                      {event.direction === "up" ? "BULLISH ↑" : "BEARISH ↓"}
                    </div>
                  </div>
                  <div style={{ marginBottom: "16px" }}>
                    <div style={{ color: "#767576", fontSize: "11px", marginBottom: "4px" }}>PRICE LEVEL</div>
                    <div style={{ color: "#ffffff", fontSize: "14px", fontWeight: "600" }}>
                      {event.priceLevel ? event.priceLevel.toFixed(2) : "—"}
                    </div>
                  </div>
                  <div style={{ marginBottom: "16px" }}>
                    <div style={{ color: "#767576", fontSize: "11px", marginBottom: "4px" }}>CONFIDENCE</div>
                    <div
                      style={{
                        color: event.confidence > 80 ? "#9cff93" : event.confidence > 50 ? "#ffcc00" : "#ff6b6b",
                        fontSize: "14px",
                        fontWeight: "600",
                      }}
                    >
                      {event.confidence || 0}%
                    </div>
                  </div>
                  <div style={{ marginBottom: "16px" }}>
                    <div style={{ color: "#767576", fontSize: "11px", marginBottom: "4px" }}>TIMEFRAME</div>
                    <div style={{ color: "#ffffff", fontSize: "14px", fontWeight: "600" }}>
                      {event.timeframe || "—"}
                    </div>
                  </div>
                  <div style={{ marginBottom: "16px" }}>
                    <div style={{ color: "#767576", fontSize: "11px", marginBottom: "4px" }}>VOLUME CONTEXT</div>
                    <div style={{ color: "#ffffff", fontSize: "14px", fontWeight: "600" }}>
                      {event.volumeContext || "—"}
                    </div>
                  </div>
                  <div style={{ marginBottom: "0" }}>
                    <div style={{ color: "#767576", fontSize: "11px", marginBottom: "4px" }}>STRUCTURAL SIGNIFICANCE</div>
                    <div style={{ color: "#ffffff", fontSize: "13px", lineHeight: "1.5" }}>
                      {event.structuralSignificance || "N/A"}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
