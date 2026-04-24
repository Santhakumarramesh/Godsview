import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

interface SweepEvent {
  id?: string;
  level: number;
  participantCount: number;
  outcome: "reversal" | "continuation" | "pending";
  probability: number;
  volume: number;
  timestamp?: string;
  direction?: "above" | "below";
}

export default function LiquiditySweep() {
  const [symbol, setSymbol] = useState("BTCUSD");
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "reversal" | "continuation" | "pending">("all");
  const [sortBy, setSortBy] = useState<"probability" | "participants" | "time">("probability");

  const { data: signals, isLoading, error } = useQuery({
    queryKey: ["signals", symbol, "sweeps"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/signals?symbol=${symbol}&type=sweep&limit=80`);
      if (!res.ok) throw new Error("Failed to fetch sweeps");
      return res.json();
    },
    refetchInterval: 45000,
  });

  const sweepEvents: SweepEvent[] = signals?.signals || [];

  // Filtered and sorted events using useMemo
  const filteredAndSorted = useMemo(() => {
    let filtered = sweepEvents;

    if (outcomeFilter !== "all") {
      filtered = filtered.filter((e) => e.outcome === outcomeFilter);
    }

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "probability") return b.probability - a.probability;
      if (sortBy === "participants") return b.participantCount - a.participantCount;
      if (sortBy === "time") {
        const aTime = new Date(a.timestamp || 0).getTime();
        const bTime = new Date(b.timestamp || 0).getTime();
        return bTime - aTime;
      }
      return 0;
    });

    return sorted;
  }, [sweepEvents, outcomeFilter, sortBy]);

  // Calculate stats
  const stats = useMemo(() => {
    const total = sweepEvents.length;
    const reversals = sweepEvents.filter((e) => e.outcome === "reversal").length;
    const continuations = sweepEvents.filter((e) => e.outcome === "continuation").length;
    const avgParticipants = Math.round(
      sweepEvents.reduce((sum, e) => sum + (e.participantCount || 0), 0) / (total || 1)
    );
    const avgProbability = Math.round(
      sweepEvents.reduce((sum, e) => sum + (e.probability || 0), 0) / (total || 1)
    );
    return { total, reversals, continuations, avgParticipants, avgProbability };
  }, [sweepEvents]);

  // Pagination state for truncation
  const displayedCount = 12;
  const totalCount = filteredAndSorted.length;
  const displayedEvents = filteredAndSorted.slice(0, displayedCount);
  const isTruncated = totalCount > displayedCount;

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
      {/* Page Header */}
      <div style={{ marginBottom: "32px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: "700", marginBottom: "8px" }}>Liquidity Sweep Detector</h1>
        <p style={{ color: "#767576", fontSize: "14px", lineHeight: "1.5", marginBottom: "16px" }}>
          Detect sweep/trap events — identify liquidity grabs, trapped participants, and likely reversal/continuation
          outcomes
        </p>

        {/* Symbol Input */}
        <div style={{ display: "flex", gap: "12px", alignItems: "center", maxWidth: "400px" }}>
          <label style={{ fontSize: "12px", color: "#767576", textTransform: "uppercase", fontWeight: "600" }}>
            Symbol
          </label>
          <input
            type="text"
            placeholder="Enter symbol (e.g., BTCUSD)"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "6px",
              padding: "8px 12px",
              color: "#ffffff",
              fontSize: "14px",
              flex: 1,
              fontFamily: 'inherit',
            }}
          />
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "32px",
            textAlign: "center",
          }}
        >
          <p style={{ color: "#767576" }}>Loading sweep events...</p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid #ff6b6b",
            borderRadius: "12px",
            padding: "16px",
            marginBottom: "24px",
          }}
        >
          <p style={{ color: "#ff6b6b", fontSize: "14px" }}>
            Error loading sweeps: {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      )}

      {/* Stats Grid */}
      {!isLoading && !error && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "16px",
              marginBottom: "32px",
            }}
          >
            <StatCard label="Total Sweeps" value={stats.total} accent="#9cff93" />
            <StatCard label="Reversals" value={stats.reversals} accent="#9cff93" />
            <StatCard label="Continuations" value={stats.continuations} accent="#ff6b6b" />
            <StatCard label="Avg Participants" value={stats.avgParticipants} accent="#9cff93" />
            <StatCard label="Avg Probability" value={`${stats.avgProbability}%`} accent="#9cff93" />
          </div>

          {/* Filter & Sort Row */}
          <div
            style={{
              display: "flex",
              gap: "16px",
              marginBottom: "24px",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <label style={{ fontSize: "12px", color: "#767576", textTransform: "uppercase", fontWeight: "600" }}>
                Outcome
              </label>
              <select
                value={outcomeFilter}
                onChange={(e) => setOutcomeFilter(e.target.value as any)}
                style={{
                  backgroundColor: "#1a191b",
                  border: "1px solid rgba(72,72,73,0.2)",
                  borderRadius: "6px",
                  padding: "6px 10px",
                  color: "#ffffff",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                <option value="all">All</option>
                <option value="reversal">Reversal</option>
                <option value="continuation">Continuation</option>
                <option value="pending">Pending</option>
              </select>
            </div>

            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <label style={{ fontSize: "12px", color: "#767576", textTransform: "uppercase", fontWeight: "600" }}>
                Sort By
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                style={{
                  backgroundColor: "#1a191b",
                  border: "1px solid rgba(72,72,73,0.2)",
                  borderRadius: "6px",
                  padding: "6px 10px",
                  color: "#ffffff",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                <option value="probability">Probability (High to Low)</option>
                <option value="participants">Participants (High to Low)</option>
                <option value="time">Timestamp (Recent First)</option>
              </select>
            </div>
          </div>

          {/* Empty State */}
          {filteredAndSorted.length === 0 ? (
            <div
              style={{
                backgroundColor: "#1a191b",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "12px",
                padding: "48px 24px",
                textAlign: "center",
              }}
            >
              <p style={{ color: "#767576", fontSize: "14px" }}>No sweep events found for this filter.</p>
            </div>
          ) : (
            <>
              {/* Event Cards Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px", marginBottom: "24px" }}>
                {displayedEvents.map((event, idx) => (
                  <SweepCard key={event.id || idx} event={event} />
                ))}
              </div>

              {/* Footer: Showing X of Y */}
              {isTruncated && (
                <div
                  style={{
                    backgroundColor: "#1a191b",
                    border: "1px solid rgba(72,72,73,0.2)",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    textAlign: "center",
                    fontSize: "12px",
                    color: "#767576",
                  }}
                >
                  Showing {displayedCount} of {totalCount} sweep events
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// Stat Card Component
function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: string;
}) {
  return (
    <div
      style={{
        backgroundColor: "#1a191b",
        border: "1px solid rgba(72,72,73,0.2)",
        borderRadius: "12px",
        padding: "20px",
      }}
    >
      <div style={{ fontSize: "11px", color: "#767576", textTransform: "uppercase", fontWeight: "600", marginBottom: "8px" }}>
        {label}
      </div>
      <div
        style={{
          fontSize: "24px",
          fontWeight: "700",
          color: accent,
          fontFamily: '"JetBrains Mono", monospace',
        }}
      >
        {value}
      </div>
    </div>
  );
}

// Sweep Event Card Component
function SweepCard({ event }: { event: SweepEvent }) {
  const getOutcomeColor = (outcome: string) => {
    if (outcome === "reversal") return "#9cff93";
    if (outcome === "continuation") return "#ff6b6b";
    return "#767576";
  };

  const getConfidenceBadgeColor = (probability: number) => {
    if (probability >= 80) return "#9cff93";
    if (probability >= 60) return "#f0ad4e";
    return "#ff6b6b";
  };

  const volumePercent = Math.min((event.volume || 0) / 10000, 100);

  return (
    <div
      style={{
        backgroundColor: "#1a191b",
        border: "1px solid rgba(72,72,73,0.2)",
        borderRadius: "12px",
        padding: "16px",
      }}
    >
      {/* Header: Level + Confidence Badge */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <div>
          <div style={{ fontSize: "10px", color: "#767576", textTransform: "uppercase", fontWeight: "600", marginBottom: "4px" }}>
            Level
          </div>
          <div
            style={{
              fontSize: "18px",
              fontWeight: "700",
              color: "#9cff93",
              fontFamily: '"JetBrains Mono", monospace',
            }}
          >
            ${event.level?.toFixed(2) || "N/A"}
          </div>
        </div>
        <div
          style={{
            backgroundColor: getConfidenceBadgeColor(event.probability),
            color: "#0e0e0f",
            padding: "4px 10px",
            borderRadius: "4px",
            fontSize: "11px",
            fontWeight: "700",
            textTransform: "uppercase",
          }}
        >
          {event.probability}% Conf
        </div>
      </div>

      {/* Direction indicator */}
      {event.direction && (
        <div style={{ marginBottom: "12px" }}>
          <div
            style={{
              fontSize: "10px",
              color: "#767576",
              textTransform: "uppercase",
              fontWeight: "600",
              marginBottom: "4px",
            }}
          >
            Direction
          </div>
          <div
            style={{
              fontSize: "12px",
              fontWeight: "600",
              color: event.direction === "above" ? "#9cff93" : "#ff6b6b",
              textTransform: "uppercase",
            }}
          >
            {event.direction === "above" ? "↑ Above" : "↓ Below"}
          </div>
        </div>
      )}

      {/* Timestamp */}
      {event.timestamp && (
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontSize: "10px", color: "#767576", textTransform: "uppercase", fontWeight: "600", marginBottom: "4px" }}>
            Timestamp
          </div>
          <div style={{ fontSize: "12px", color: "#ffffff", fontFamily: '"JetBrains Mono", monospace' }}>
            {new Date(event.timestamp).toLocaleString()}
          </div>
        </div>
      )}

      {/* Volume Indicator Bar */}
      {event.volume !== undefined && (
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "10px", color: "#767576", textTransform: "uppercase", fontWeight: "600", marginBottom: "6px" }}>
            Volume
          </div>
          <div
            style={{
              backgroundColor: "rgba(72,72,73,0.2)",
              borderRadius: "4px",
              height: "8px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                backgroundColor: "#9cff93",
                height: "100%",
                width: `${volumePercent}%`,
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <div style={{ fontSize: "10px", color: "#767576", marginTop: "4px" }}>
            {event.volume?.toLocaleString() || "0"}
          </div>
        </div>
      )}

      {/* Trapped Participants */}
      <div style={{ marginBottom: "12px" }}>
        <div style={{ fontSize: "10px", color: "#767576", textTransform: "uppercase", fontWeight: "600", marginBottom: "4px" }}>
          Trapped Participants
        </div>
        <div style={{ fontSize: "14px", fontWeight: "600", color: "#ffffff", fontFamily: '"JetBrains Mono", monospace' }}>
          {event.participantCount || "0"}
        </div>
      </div>

      {/* Outcome Badge */}
      <div
        style={{
          padding: "8px 12px",
          backgroundColor: `${getOutcomeColor(event.outcome)}20`,
          borderRadius: "6px",
          borderLeft: `3px solid ${getOutcomeColor(event.outcome)}`,
        }}
      >
        <div style={{ fontSize: "10px", color: "#767576", textTransform: "uppercase", fontWeight: "600", marginBottom: "2px" }}>
          Likely Outcome
        </div>
        <div
          style={{
            fontSize: "13px",
            fontWeight: "700",
            color: getOutcomeColor(event.outcome),
            textTransform: "uppercase",
          }}
        >
          {event.outcome || "PENDING"}
        </div>
      </div>
    </div>
  );
}