import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

const colors = {
  bg: "#0e0e0f",
  card: "#1a191b",
  border: "rgba(72,72,73,0.2)",
  accent: "#9cff93",
  text: "#ffffff",
  muted: "#767576",
  bearish: "#ff6b6b",
};

const fonts = {
  label: '"Space Grotesk", sans-serif',
  data: '"JetBrains Mono", monospace',
};

interface PineScript {
  id: string;
  name: string;
  version: string;
  active: boolean;
  signalCount: number;
  lastSignalTime: string;
  description?: string;
  signalsPerHour?: number;
  last24hCount?: number;
}

interface Signal {
  id: string;
  scriptId: string;
  timestamp: string;
  type: string;
  price: number;
}

function LoadingSkeleton() {
  return (
    <div style={{ animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite" }}>
      <div
        style={{
          backgroundColor: colors.card,
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "24px",
          height: "120px",
          opacity: 0.5,
        }}
      />
      <div
        style={{
          backgroundColor: colors.card,
          borderRadius: "12px",
          padding: "24px",
          height: "300px",
          opacity: 0.5,
        }}
      />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      style={{
        backgroundColor: `rgba(255, 107, 107, 0.1)`,
        border: `1px solid ${colors.bearish}`,
        borderRadius: "12px",
        padding: "24px",
        marginBottom: "24px",
      }}
    >
      <h3 style={{ color: colors.bearish, marginBottom: "8px", fontSize: "14px", fontWeight: "600" }}>
        Error Loading Pine Scripts
      </h3>
      <p style={{ color: colors.muted, fontSize: "12px", margin: 0 }}>
        {message}
      </p>
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      style={{
        backgroundColor: colors.card,
        border: `1px solid ${colors.border}`,
        borderRadius: "12px",
        padding: "48px 24px",
        textAlign: "center",
        marginBottom: "24px",
      }}
    >
      <h3 style={{ color: colors.muted, fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>
        {title}
      </h3>
      <p style={{ color: colors.muted, fontSize: "12px", margin: 0 }}>
        {subtitle}
      </p>
    </div>
  );
}

export default function PineScripts() {
  const [filterStatus, setFilterStatus] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);

  const { data: tvcScripts, isLoading: isLoadingScripts, error: scriptError } = useQuery({
    queryKey: ["tradingview-mcp", "signals"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/tradingview-mcp/signals`);
      if (!res.ok) throw new Error("Failed to fetch scripts");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: signals, isLoading: isLoadingSignals, error: signalError } = useQuery({
    queryKey: ["signals", "tradingview"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/signals?source=tradingview&limit=500`);
      if (!res.ok) throw new Error("Failed to fetch signals");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const isLoading = isLoadingScripts || isLoadingSignals;
  const error = scriptError || signalError;

  const scripts: PineScript[] = useMemo(() => {
    const base = tvcScripts?.scripts || [];
    const signalMap = new Map<string, Signal[]>();

    signals?.signals?.forEach((sig: Signal) => {
      if (!signalMap.has(sig.scriptId)) {
        signalMap.set(sig.scriptId, []);
      }
      signalMap.get(sig.scriptId)?.push(sig);
    });

    return base.map((script: any) => ({
      ...script,
      last24hCount: signalMap.get(script.id)?.filter((s) => {
        const sigTime = new Date(s.timestamp).getTime();
        const now = new Date().getTime();
        return now - sigTime < 86400000;
      }).length || 0,
      signalsPerHour: signalMap.get(script.id) ? (signalMap.get(script.id)!.length / 24).toFixed(2) : "0",
    }));
  }, [tvcScripts?.scripts, signals?.signals]);

  const filtered = useMemo(() => {
    return scripts.filter((s) => {
      const statusMatch =
        filterStatus === "all" || (s.active ? "active" : "inactive") === filterStatus;
      const nameMatch = s.name.toLowerCase().includes(searchTerm.toLowerCase());
      return statusMatch && nameMatch;
    });
  }, [scripts, filterStatus, searchTerm]);

  const selectedScript = selectedScriptId ? scripts.find((s) => s.id === selectedScriptId) : null;
  const selectedScriptSignals = selectedScript
    ? signals?.signals?.filter((s: Signal) => s.scriptId === selectedScript.id) || []
    : [];

  const totalSignals = signals?.signals?.length || 0;
  const lastSignalTime = signals?.signals?.[0]?.timestamp
    ? new Date(signals.signals[0].timestamp).toLocaleString()
    : "Never";
  const avgSignalsPerScript = scripts.length > 0 ? (totalSignals / scripts.length).toFixed(1) : "0";

  return (
    <div style={{ backgroundColor: colors.bg, color: colors.text, minHeight: "100vh", padding: "24px" }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      <div style={{ marginBottom: "32px" }}>
        <h1 style={{ marginBottom: "8px", fontSize: "28px", fontWeight: "700" }}>Pine Script Signals</h1>
        <p style={{ color: colors.muted, fontSize: "13px", marginBottom: "24px" }}>
          Store and manage Pine Script signal definitions — track active scripts, versions, and signal history
        </p>

        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Search scripts by name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              flex: "1 1 auto",
              minWidth: "200px",
              backgroundColor: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: "8px",
              padding: "10px 12px",
              color: colors.text,
              fontFamily: fonts.label,
              fontSize: "12px",
            }}
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{
              backgroundColor: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: "8px",
              padding: "10px 12px",
              color: colors.text,
              fontFamily: fonts.label,
              fontSize: "12px",
            }}
          >
            <option value="all">All Scripts</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
        </div>
      </div>

      {isLoading && <LoadingSkeleton />}
      {error && <ErrorState message={error instanceof Error ? error.message : "Unknown error occurred"} />}

      {!isLoading && !error && (
        <>
          <div
            style={{
              backgroundColor: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: "12px",
              padding: "24px",
              marginBottom: "24px",
            }}
          >
            <h2
              style={{
                fontSize: "11px",
                color: colors.muted,
                marginBottom: "16px",
                textTransform: "uppercase",
                fontFamily: fonts.label,
                fontWeight: "600",
              }}
            >
              Registry Statistics
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: "16px",
              }}
            >
              <div>
                <div style={{ fontSize: "11px", color: colors.muted, marginBottom: "4px" }}>
                  Total Scripts
                </div>
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: "700",
                    color: colors.accent,
                    fontFamily: fonts.data,
                  }}
                >
                  {scripts.length}
                </div>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: colors.muted, marginBottom: "4px" }}>
                  Active Scripts
                </div>
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: "700",
                    color: colors.accent,
                    fontFamily: fonts.data,
                  }}
                >
                  {scripts.filter((s) => s.active).length}
                </div>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: colors.muted, marginBottom: "4px" }}>
                  Total Signals Generated
                </div>
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: "700",
                    color: colors.accent,
                    fontFamily: fonts.data,
                  }}
                >
                  {totalSignals}
                </div>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: colors.muted, marginBottom: "4px" }}>
                  Last Signal Time
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: colors.accent,
                    fontFamily: fonts.data,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {lastSignalTime}
                </div>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: colors.muted, marginBottom: "4px" }}>
                  Avg Signals/Script
                </div>
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: "700",
                    color: colors.accent,
                    fontFamily: fonts.data,
                  }}
                >
                  {avgSignalsPerScript}
                </div>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: colors.muted, marginBottom: "4px" }}>
                  Inactive Scripts
                </div>
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: "700",
                    color: colors.bearish,
                    fontFamily: fonts.data,
                  }}
                >
                  {scripts.filter((s) => !s.active).length}
                </div>
              </div>
            </div>
          </div>

          {filtered.length === 0 && (
            <EmptyState
              title="No scripts found"
              subtitle={
                searchTerm
                  ? "Try adjusting your search criteria"
                  : "No Pine scripts available"
              }
            />
          )}

          {filtered.length > 0 && (
            <div style={{ overflowX: "auto", marginBottom: "24px" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontFamily: fonts.data,
                  fontSize: "11px",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <th style={{ padding: "12px", textAlign: "left", color: colors.muted, fontWeight: "600" }}>
                      Script Name
                    </th>
                    <th style={{ padding: "12px", textAlign: "left", color: colors.muted, fontWeight: "600" }}>
                      Version
                    </th>
                    <th style={{ padding: "12px", textAlign: "left", color: colors.muted, fontWeight: "600" }}>
                      Status
                    </th>
                    <th style={{ padding: "12px", textAlign: "left", color: colors.muted, fontWeight: "600" }}>
                      Signals/Hour
                    </th>
                    <th style={{ padding: "12px", textAlign: "left", color: colors.muted, fontWeight: "600" }}>
                      Last 24h
                    </th>
                    <th style={{ padding: "12px", textAlign: "left", color: colors.muted, fontWeight: "600" }}>
                      Last Signal
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((script) => (
                    <tr
                      key={script.id}
                      onClick={() => setSelectedScriptId(script.id)}
                      style={{
                        borderBottom: `1px solid ${colors.border}`,
                        cursor: "pointer",
                        backgroundColor:
                          selectedScriptId === script.id
                            ? "rgba(156, 255, 147, 0.05)"
                            : "transparent",
                        transition: "background-color 0.15s",
                      }}
                    >
                      <td style={{ padding: "12px", color: colors.accent, fontWeight: "600" }}>
                        {script.name}
                      </td>
                      <td style={{ padding: "12px", color: colors.text }}>
                        v{script.version || "1.0"}
                      </td>
                      <td style={{ padding: "12px" }}>
                        <span
                          style={{
                            padding: "4px 8px",
                            backgroundColor: script.active
                              ? "rgba(156, 255, 147, 0.1)"
                              : "rgba(255, 107, 107, 0.1)",
                            color: script.active ? colors.accent : colors.bearish,
                            borderRadius: "4px",
                            fontSize: "10px",
                            fontWeight: "600",
                          }}
                        >
                          {script.active ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </td>
                      <td style={{ padding: "12px", color: colors.accent }}>
                        {script.signalsPerHour}
                      </td>
                      <td style={{ padding: "12px", color: colors.accent }}>
                        {script.last24hCount}
                      </td>
                      <td style={{ padding: "12px", color: colors.muted, fontSize: "10px" }}>
                        {script.lastSignalTime
                          ? new Date(script.lastSignalTime).toLocaleString()
                          : "Never"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedScript && (
            <div
              style={{
                backgroundColor: colors.card,
                border: `1px solid ${colors.border}`,
                borderRadius: "12px",
                padding: "24px",
                marginBottom: "24px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                <div>
                  <h2
                    style={{
                      fontSize: "16px",
                      fontWeight: "700",
                      color: colors.accent,
                      marginBottom: "4px",
                    }}
                  >
                    {selectedScript.name}
                  </h2>
                  <p style={{ fontSize: "12px", color: colors.muted, margin: 0 }}>
                    {selectedScript.description || "No description available"}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedScriptId(null)}
                  style={{
                    backgroundColor: colors.card,
                    border: `1px solid ${colors.border}`,
                    color: colors.text,
                    padding: "6px 12px",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontFamily: fonts.label,
                  }}
                >
                  Close
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "16px", marginBottom: "24px" }}>
                <div>
                  <div style={{ fontSize: "11px", color: colors.muted, marginBottom: "4px" }}>
                    Version
                  </div>
                  <div style={{ fontSize: "14px", fontWeight: "600", color: colors.accent, fontFamily: fonts.data }}>
                    v{selectedScript.version || "1.0"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: colors.muted, marginBottom: "4px" }}>
                    Total Signals
                  </div>
                  <div style={{ fontSize: "14px", fontWeight: "600", color: colors.accent, fontFamily: fonts.data }}>
                    {selectedScript.signalCount}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: colors.muted, marginBottom: "4px" }}>
                    Status
                  </div>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: "600",
                      color: selectedScript.active ? colors.accent : colors.bearish,
                    }}
                  >
                    {selectedScript.active ? "Active" : "Inactive"}
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: "24px" }}>
                <h3
                  style={{
                    fontSize: "12px",
                    color: colors.muted,
                    textTransform: "uppercase",
                    marginBottom: "12px",
                    fontWeight: "600",
                    fontFamily: fonts.label,
                  }}
                >
                  Activation Control
                </h3>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedScript.active}
                    onChange={() => {}}
                    style={{ cursor: "pointer" }}
                  />
                  <span style={{ fontSize: "12px", color: colors.text }}>
                    {selectedScript.active ? "Script is active" : "Script is inactive"}
                  </span>
                </label>
              </div>

              <div>
                <h3
                  style={{
                    fontSize: "12px",
                    color: colors.muted,
                    textTransform: "uppercase",
                    marginBottom: "12px",
                    fontWeight: "600",
                    fontFamily: fonts.label,
                  }}
                >
                  Signal History ({selectedScriptSignals.length})
                </h3>
                {selectedScriptSignals.length === 0 ? (
                  <p style={{ fontSize: "12px", color: colors.muted, margin: 0 }}>
                    No signals yet
                  </p>
                ) : (
                  <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                    {selectedScriptSignals.slice(0, 10).map((sig: Signal, idx: number) => (
                      <div
                        key={idx}
                        style={{
                          padding: "8px 12px",
                          borderBottom: `1px solid ${colors.border}`,
                          fontSize: "11px",
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span style={{ color: colors.muted }}>
                          {new Date(sig.timestamp).toLocaleString()}
                        </span>
                        <span style={{ color: colors.accent, fontFamily: fonts.data }}>
                          {sig.type}
                        </span>
                        <span style={{ color: colors.accent, fontFamily: fonts.data }}>
                          ${sig.price.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {filtered.length > 0 && (
            <div
              style={{
                backgroundColor: colors.card,
                border: `1px solid ${colors.border}`,
                borderRadius: "12px",
                padding: "24px",
              }}
            >
              <h2
                style={{
                  fontSize: "11px",
                  color: colors.muted,
                  marginBottom: "16px",
                  textTransform: "uppercase",
                  fontFamily: fonts.label,
                  fontWeight: "600",
                }}
              >
                Signal Definitions ({filtered.length})
              </h2>
              {filtered.length === 0 ? (
                <p style={{ color: colors.muted, fontSize: "12px", margin: 0 }}>
                  No signal definitions available
                </p>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                    gap: "16px",
                  }}
                >
                  {filtered.slice(0, 6).map((script) => (
                    <div
                      key={script.id}
                      style={{
                        backgroundColor: colors.bg,
                        border: `1px solid ${colors.border}`,
                        borderRadius: "8px",
                        padding: "16px",
                      }}
                    >
                      <h3
                        style={{
                          fontSize: "12px",
                          fontWeight: "700",
                          color: colors.accent,
                          marginBottom: "8px",
                          fontFamily: fonts.label,
                        }}
                      >
                        {script.name}
                      </h3>
                      <p style={{ fontSize: "11px", color: colors.muted, lineHeight: "1.5", marginBottom: "8px" }}>
                        {script.description || "No description available"}
                      </p>
                      <div
                        style={{
                          fontSize: "10px",
                          color: colors.muted,
                          fontFamily: fonts.data,
                        }}
                      >
                        <span>v{script.version || "1.0"}</span>
                        <span style={{ margin: "0 8px" }}>•</span>
                        <span>{script.signalCount} signals</span>
                        <span style={{ margin: "0 8px" }}>•</span>
                        <span>{script.active ? "Active" : "Inactive"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
