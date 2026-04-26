import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function ChartAnnotations() {
  const [symbol, setSymbol] = useState("BTCUSD");
  const [note, setNote] = useState("");
  const [tradeId, setTradeId] = useState("");

  const { data: annotations, isLoading: loadingJournal, error: errorJournal } = useQuery({
    queryKey: ["journal", "annotations"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/journal`);
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: savedAnnotations, isLoading: loadingMemory, error: errorMemory } = useQuery({
    queryKey: ["memory", "annotations"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/memory/annotations`);
      return res.json();
    },
    refetchInterval: 60000,
  });

  const annotationsList = savedAnnotations?.annotations || [];

  const handleSaveAnnotation = async () => {
    if (!note) return;
    const payload = {
      symbol,
      note,
      tradeId: tradeId || undefined,
      timestamp: new Date().toISOString(),
    };
    await fetch(`${API}/api/memory/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setNote("");
    setTradeId("");
  };

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
        <h1 style={{ marginBottom: "16px" }}>Chart Annotation Studio</h1>
      </div>

      {(loadingJournal || loadingMemory) && (
        <div style={{ textAlign: "center", padding: "40px", color: "#767576" }}>Loading data...</div>
      )}

      {(errorJournal || errorMemory) && (
        <div style={{ backgroundColor: "#1a191b", border: "1px solid rgba(255,107,107,0.3)", borderRadius: "12px", padding: "20px", marginBottom: "24px" }}>
          <div style={{ color: "#ff6b6b", fontSize: "14px" }}>Failed to load data</div>
          <div style={{ color: "#767576", fontSize: "12px", marginTop: "4px" }}>Check API connection</div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "24px" }}>
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <h2 style={{ fontSize: "14px", color: "#767576", marginBottom: "16px", textTransform: "uppercase" }}>
            Create Annotation
          </h2>

          <div style={{ marginBottom: "16px" }}>
            <label style={{ fontSize: "12px", color: "#767576", display: "block", marginBottom: "4px" }}>
              Symbol
            </label>
            <input
              type="text"
              placeholder="e.g., BTCUSD"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              style={{
                width: "100%",
                backgroundColor: "#0e0e0f",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "8px",
                padding: "8px",
                color: "#ffffff",
              }}
            />
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label style={{ fontSize: "12px", color: "#767576", display: "block", marginBottom: "4px" }}>
              Trade ID (optional)
            </label>
            <input
              type="text"
              placeholder="Link to trade ID"
              value={tradeId}
              onChange={(e) => setTradeId(e.target.value)}
              style={{
                width: "100%",
                backgroundColor: "#0e0e0f",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "8px",
                padding: "8px",
                color: "#ffffff",
              }}
            />
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label style={{ fontSize: "12px", color: "#767576", display: "block", marginBottom: "4px" }}>
              Note
            </label>
            <textarea
              placeholder="Write your annotation..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{
                width: "100%",
                minHeight: "120px",
                backgroundColor: "#0e0e0f",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "8px",
                padding: "8px",
                color: "#ffffff",
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: "12px",
                resize: "vertical",
              }}
            />
          </div>

          <button
            onClick={handleSaveAnnotation}
            style={{
              width: "100%",
              backgroundColor: "#9cff93",
              color: "#0e0e0f",
              border: "none",
              borderRadius: "8px",
              padding: "10px",
              fontWeight: "700",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            Save Annotation
          </button>
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
            Summary
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
            <div style={{ paddingBottom: "12px", borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
              <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px" }}>Total Annotations</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#9cff93" }}>
                {annotationsList.length}
              </div>
            </div>
            <div style={{ paddingBottom: "12px", borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
              <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px" }}>Linked Trades</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#9cff93" }}>
                {annotationsList.filter((a: any) => a.tradeId).length}
              </div>
            </div>
            <div style={{ paddingBottom: "12px", borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
              <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px" }}>Unique Symbols</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#9cff93" }}>
                {new Set(annotationsList.map((a: any) => a.symbol)).size}
              </div>
            </div>
            <div style={{ paddingBottom: "12px" }}>
              <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px" }}>Latest</div>
              <div
                style={{
                  fontSize: "12px",
                  color: "#767576",
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                {annotationsList[0]
                  ? new Date(annotationsList[0].timestamp).toLocaleDateString()
                  : "None"}
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
        }}
      >
        <h2 style={{ fontSize: "14px", color: "#767576", marginBottom: "16px", textTransform: "uppercase" }}>
          Saved Annotations
        </h2>
        <div style={{ maxHeight: "400px", overflowY: "auto" }}>
          {annotationsList.length === 0 ? (
            <div style={{ color: "#767576", fontSize: "12px" }}>No annotations yet</div>
          ) : (
            annotationsList.slice(0, 20).map((anno: any, idx: number) => (
              <div
                key={idx}
                style={{
                  padding: "12px",
                  borderBottom: "1px solid rgba(72,72,73,0.2)",
                  marginBottom: "12px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ fontWeight: "700", color: "#9cff93" }}>{anno.symbol}</span>
                  <span style={{ fontSize: "11px", color: "#767576" }}>
                    {new Date(anno.timestamp).toLocaleString()}
                  </span>
                </div>
                {anno.tradeId && (
                  <div style={{ fontSize: "11px", color: "#9cff93", marginBottom: "4px" }}>
                    Trade ID: {anno.tradeId}
                  </div>
                )}
                <div style={{ fontSize: "12px", color: "#ffffff", fontFamily: '"JetBrains Mono", monospace' }}>
                  {anno.note}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
