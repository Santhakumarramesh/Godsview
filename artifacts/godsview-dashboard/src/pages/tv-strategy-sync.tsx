import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

interface Strategy {
  id?: string;
  name: string;
  status: "active" | "inactive" | "error" | string;
  parameters?: any[];
  createdAt?: string;
  [key: string]: any;
}

const StatusBadge = ({ status }: { status: string }) => {
  const colors: Record<string, { bg: string; text: string }> = {
    active: { bg: "rgba(156, 255, 147, 0.1)", text: "#9cff93" },
    inactive: { bg: "rgba(118, 117, 118, 0.1)", text: "#767576" },
    error: { bg: "rgba(255, 107, 107, 0.1)", text: "#ff6b6b" },
  };
  const color = colors[status] || colors.inactive;
  return (
    <span
      style={{
        backgroundColor: color.bg,
        color: color.text,
        padding: "4px 8px",
        borderRadius: "4px",
        fontSize: "11px",
        fontFamily: "Space Grotesk",
        fontWeight: "500",
      }}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
};

const LoadingState = () => (
  <div style={{ padding: "32px", textAlign: "center" }}>
    <div
      style={{
        display: "inline-block",
        width: "24px",
        height: "24px",
        border: "2px solid rgba(156, 255, 147, 0.2)",
        borderTop: "2px solid #9cff93",
        borderRadius: "50%",
        animation: "spin 1s linear infinite",
      }}
    />
    <p style={{ color: "#767576", fontSize: "14px", marginTop: "12px" }}>Loading strategies...</p>
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

const ErrorState = ({ error }: { error: Error | null }) => (
  <div
    style={{
      backgroundColor: "rgba(255, 107, 107, 0.1)",
      border: "1px solid rgba(255, 107, 107, 0.3)",
      borderRadius: "8px",
      padding: "16px",
      marginBottom: "24px",
    }}
  >
    <p style={{ color: "#ff6b6b", fontSize: "13px", fontFamily: "Space Grotesk", fontWeight: "500", margin: "0 0 8px 0" }}>
      Error loading data
    </p>
    <p style={{ color: "#767576", fontSize: "12px", fontFamily: "JetBrains Mono, monospace", margin: 0 }}>
      {error?.message || "An unexpected error occurred"}
    </p>
  </div>
);

const EmptyState = ({ source }: { source: string }) => (
  <div style={{ padding: "24px", textAlign: "center" }}>
    <p style={{ color: "#767576", fontSize: "13px", fontFamily: "Space Grotesk" }}>
      No {source} strategies found
    </p>
  </div>
);

export default function TVStrategySync() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: tvStrategies = [], isLoading: tvLoading, error: tvError } = useQuery({
    queryKey: ["tv-strategies"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/tradingview-mcp/strategies`);
      if (!res.ok) throw new Error("Failed to fetch TradingView strategies");
      return res.json();
    },
  });

  const { data: gvStrategies = [], isLoading: gvLoading, error: gvError } = useQuery({
    queryKey: ["gv-strategies"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/strategies`);
      if (!res.ok) throw new Error("Failed to fetch GodsView strategies");
      return res.json();
    },
  });

  const tvActive = useMemo(() => tvStrategies.filter((s: Strategy) => s.status === "active").length, [tvStrategies]);
  const gvActive = useMemo(() => gvStrategies.filter((s: Strategy) => s.status === "active").length, [gvStrategies]);
  const syncedCount = useMemo(() => Math.min(tvStrategies.length, gvStrategies.length), [tvStrategies, gvStrategies]);
  const totalCount = useMemo(() => Math.max(tvStrategies.length, gvStrategies.length), [tvStrategies, gvStrategies]);
  const syncPercentage = useMemo(
    () => (totalCount > 0 ? Math.round((syncedCount / totalCount) * 100) : 0),
    [syncedCount, totalCount]
  );

  const isLoading = tvLoading || gvLoading;
  const hasError = tvError || gvError;

  const StrategyCard = ({ strat, index, source }: { strat: Strategy; index: number; source: string }) => {
    const expandKey = `${source}-${index}`;
    const isExpanded = expandedId === expandKey;

    return (
      <div
        style={{
          backgroundColor: "#0e0e0f",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "8px",
          padding: "16px",
          cursor: "pointer",
          transition: "all 0.2s ease",
          marginBottom: "12px",
        }}
        onClick={() => setExpandedId(isExpanded ? null : expandKey)}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(156, 255, 147, 0.4)")}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(72,72,73,0.2)")}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
          <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: "#ffffff", margin: 0 }}>
            {strat.name || `Strategy ${index + 1}`}
          </p>
          <StatusBadge status={strat.status || "unknown"} />
        </div>
        <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#767576", margin: 0 }}>
          {strat.parameters?.length || 0} params {strat.createdAt && `• ${new Date(strat.createdAt).toLocaleDateString()}`}
        </p>
        {isExpanded && (
          <pre
            style={{
              marginTop: "12px",
              backgroundColor: "#1a191b",
              padding: "12px",
              borderRadius: "6px",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "10px",
              color: "#767576",
              overflow: "auto",
              maxHeight: "300px",
              border: "1px solid rgba(72,72,73,0.2)",
            }}
          >
            {JSON.stringify(strat, null, 2)}
          </pre>
        )}
      </div>
    );
  };

  return (
    <div style={{ backgroundColor: "#0e0e0f", minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontFamily: "Space Grotesk", fontSize: "32px", color: "#ffffff", marginBottom: "8px", fontWeight: "600" }}>
            TV Strategy Sync
          </h1>
          <p style={{ color: "#767576", fontSize: "14px", margin: 0 }}>
            Synchronize and monitor TradingView strategies across GodsView platform
          </p>
        </div>

        {/* Error States */}
        {tvError && <ErrorState error={tvError} />}
        {gvError && <ErrorState error={gvError} />}

        {/* Stats Bar */}
        {!isLoading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "32px" }}>
            <div
              style={{
                backgroundColor: "#1a191b",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "12px",
                padding: "20px",
              }}
            >
              <p style={{ color: "#767576", fontSize: "12px", fontFamily: "Space Grotesk", margin: "0 0 8px 0" }}>TV Total</p>
              <p style={{ color: "#9cff93", fontSize: "28px", fontFamily: "Space Grotesk", fontWeight: "600", margin: 0 }}>
                {tvStrategies.length}
              </p>
              <p style={{ color: "#767576", fontSize: "11px", fontFamily: "JetBrains Mono, monospace", margin: "8px 0 0 0" }}>
                {tvActive} active
              </p>
            </div>
            <div
              style={{
                backgroundColor: "#1a191b",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "12px",
                padding: "20px",
              }}
            >
              <p style={{ color: "#767576", fontSize: "12px", fontFamily: "Space Grotesk", margin: "0 0 8px 0" }}>GV Total</p>
              <p style={{ color: "#9cff93", fontSize: "28px", fontFamily: "Space Grotesk", fontWeight: "600", margin: 0 }}>
                {gvStrategies.length}
              </p>
              <p style={{ color: "#767576", fontSize: "11px", fontFamily: "JetBrains Mono, monospace", margin: "8px 0 0 0" }}>
                {gvActive} active
              </p>
            </div>
            <div
              style={{
                backgroundColor: "#1a191b",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "12px",
                padding: "20px",
              }}
            >
              <p style={{ color: "#767576", fontSize: "12px", fontFamily: "Space Grotesk", margin: "0 0 8px 0" }}>Synced</p>
              <p style={{ color: "#9cff93", fontSize: "28px", fontFamily: "Space Grotesk", fontWeight: "600", margin: 0 }}>
                {syncedCount}
              </p>
              <p style={{ color: "#767576", fontSize: "11px", fontFamily: "JetBrains Mono, monospace", margin: "8px 0 0 0" }}>
                of {totalCount}
              </p>
            </div>
            <div
              style={{
                backgroundColor: "#1a191b",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "12px",
                padding: "20px",
              }}
            >
              <p style={{ color: "#767576", fontSize: "12px", fontFamily: "Space Grotesk", margin: "0 0 8px 0" }}>Sync %</p>
              <p style={{ color: syncPercentage === 100 ? "#9cff93" : syncPercentage > 75 ? "#9cff93" : "#ff6b6b", fontSize: "28px", fontFamily: "Space Grotesk", fontWeight: "600", margin: 0 }}>
                {syncPercentage}%
              </p>
              <div style={{ height: "4px", backgroundColor: "rgba(72,72,73,0.2)", borderRadius: "2px", marginTop: "8px" }}>
                <div
                  style={{
                    height: "100%",
                    backgroundColor: syncPercentage === 100 ? "#9cff93" : "#ff6b6b",
                    borderRadius: "2px",
                    width: `${syncPercentage}%`,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {isLoading && <LoadingState />}

        {/* Strategy Cards */}
        {!isLoading && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
            {/* TradingView Strategies */}
            <div
              style={{
                backgroundColor: "#1a191b",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "12px",
                padding: "24px",
              }}
            >
              <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "16px", margin: "0 0 16px 0" }}>
                TradingView Strategies
              </h2>
              {tvStrategies.length === 0 ? (
                <EmptyState source="TradingView" />
              ) : (
                <div>
                  {tvStrategies.map((strat: Strategy, idx: number) => (
                    <StrategyCard key={idx} strat={strat} index={idx} source="tv" />
                  ))}
                </div>
              )}
            </div>

            {/* GodsView Strategies */}
            <div
              style={{
                backgroundColor: "#1a191b",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "12px",
                padding: "24px",
              }}
            >
              <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "16px", margin: "0 0 16px 0" }}>
                GodsView Strategies
              </h2>
              {gvStrategies.length === 0 ? (
                <EmptyState source="GodsView" />
              ) : (
                <div>
                  {gvStrategies.map((strat: Strategy, idx: number) => (
                    <StrategyCard key={idx} strat={strat} index={idx} source="gv" />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sync Summary */}
        {!isLoading && (
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#ffffff", margin: "0 0 16px 0" }}>
              Sync Summary
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
              <div>
                <p style={{ color: "#767576", fontSize: "12px", fontFamily: "Space Grotesk", margin: "0 0 8px 0" }}>Total Strategies</p>
                <p style={{ color: "#ffffff", fontSize: "18px", fontFamily: "Space Grotesk", fontWeight: "600", margin: 0 }}>
                  {totalCount}
                </p>
              </div>
              <div>
                <p style={{ color: "#767576", fontSize: "12px", fontFamily: "Space Grotesk", margin: "0 0 8px 0" }}>Synced</p>
                <p style={{ color: "#9cff93", fontSize: "18px", fontFamily: "Space Grotesk", fontWeight: "600", margin: 0 }}>
                  {syncedCount} of {totalCount}
                </p>
              </div>
              <div>
                <p style={{ color: "#767576", fontSize: "12px", fontFamily: "Space Grotesk", margin: "0 0 8px 0" }}>Pending Sync</p>
                <p style={{ color: totalCount - syncedCount > 0 ? "#ff6b6b" : "#9cff93", fontSize: "18px", fontFamily: "Space Grotesk", fontWeight: "600", margin: 0 }}>
                  {totalCount - syncedCount}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
