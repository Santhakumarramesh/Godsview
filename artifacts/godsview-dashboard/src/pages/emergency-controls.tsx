import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type ExecutionStatus = {
  trading_enabled: boolean;
  kill_switch_active: boolean;
  strategies_paused: string[];
  symbols_paused: string[];
  last_updated: string;
};

type BreakerStatus = {
  daily_breaker_triggered: boolean;
  weekly_breaker_triggered: boolean;
  circuit_breaker_active: boolean;
  open_positions_count: number;
  total_exposure: number;
};

export default function EmergencyControlsPage() {
  const queryClient = useQueryClient();
  const [confirmFlatten, setConfirmFlatten] = useState(false);
  const [confirmKillSwitch, setConfirmKillSwitch] = useState(false);
  const [pausedSymbol, setPausedSymbol] = useState("");
  const [pausedStrategy, setPausedStrategy] = useState("");

  const { data: executionData, isLoading } = useQuery({
    queryKey: ["execution-status"],
    queryFn: () => fetch(`${API}/api/execution-status`).then((r) => r.json()),
    refetchInterval: 2000,
  });

  const { data: breakerData } = useQuery({
    queryKey: ["breaker"],
    queryFn: () => fetch(`${API}/api/breaker`).then((r) => r.json()),
    refetchInterval: 2000,
  });

  const flattenMutation = useMutation({
    mutationFn: () =>
      fetch(`${API}/api/emergency-close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["execution-status"] });
      setConfirmFlatten(false);
    },
  });

  const killSwitchMutation = useMutation({
    mutationFn: () =>
      fetch(`${API}/api/kill-switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: true }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["execution-status"] });
      setConfirmKillSwitch(false);
    },
  });

  const pauseStrategyMutation = useMutation({
    mutationFn: (strategy: string) =>
      fetch(`${API}/api/execution/pause-strategy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy_id: strategy }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["execution-status"] });
      setPausedStrategy("");
    },
  });

  const pauseSymbolMutation = useMutation({
    mutationFn: (symbol: string) =>
      fetch(`${API}/api/execution/pause-symbol`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["execution-status"] });
      setPausedSymbol("");
    },
  });

  if (isLoading) {
    return <div style={{ padding: "32px", color: "#767576" }}>Loading emergency controls...</div>;
  }

  const status: ExecutionStatus = executionData?.status || {
    trading_enabled: false,
    kill_switch_active: false,
    strategies_paused: [],
    symbols_paused: [],
    last_updated: new Date().toISOString(),
  };

  const breaker: BreakerStatus = breakerData?.breaker || {
    daily_breaker_triggered: false,
    weekly_breaker_triggered: false,
    circuit_breaker_active: false,
    open_positions_count: 0,
    total_exposure: 0,
  };

  return (
    <div style={{ padding: "32px", backgroundColor: "#0e0e0f" }}>
      <h1
        style={{
          fontSize: "28px",
          fontWeight: "600",
          color: "#ffffff",
          marginBottom: "32px",
          fontFamily: "Space Grotesk",
        }}
      >
        Emergency Controls / Kill Switch
      </h1>

      <div
        style={{
          backgroundColor:
            status.kill_switch_active || status.trading_enabled === false
              ? "rgba(255, 107, 107, 0.15)"
              : "rgba(45, 90, 45, 0.2)",
          border:
            status.kill_switch_active || status.trading_enabled === false
              ? "2px solid #ff6b6b"
              : "1px solid rgba(156, 255, 147, 0.2)",
          borderRadius: "12px",
          padding: "32px",
          marginBottom: "32px",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px", marginBottom: "24px" }}>
          <div>
            <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Trading Status</div>
            <div
              style={{
                fontSize: "20px",
                fontWeight: "600",
                color: status.trading_enabled ? "#9cff93" : "#ff6b6b",
                marginTop: "8px",
                fontFamily: "Space Grotesk",
              }}
            >
              {status.trading_enabled ? "ENABLED" : "DISABLED"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Kill Switch</div>
            <div
              style={{
                fontSize: "20px",
                fontWeight: "600",
                color: status.kill_switch_active ? "#ff6b6b" : "#9cff93",
                marginTop: "8px",
                fontFamily: "Space Grotesk",
              }}
            >
              {status.kill_switch_active ? "ACTIVE" : "INACTIVE"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Last Updated</div>
            <div
              style={{
                fontSize: "12px",
                color: "#767576",
                marginTop: "8px",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {new Date(status.last_updated).toLocaleTimeString()}
            </div>
          </div>
        </div>
      </div>

      <h2
        style={{
          fontSize: "18px",
          fontWeight: "600",
          color: "#ff6b6b",
          marginBottom: "16px",
          fontFamily: "Space Grotesk",
        }}
      >
        Flatten All Positions
      </h2>
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "2px solid #ff6b6b",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "32px",
        }}
      >
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "13px", color: "#ffffff", marginBottom: "8px", fontFamily: "Space Grotesk" }}>
            Open Positions: {breaker.open_positions_count}
          </div>
          <div style={{ fontSize: "13px", color: "#ffffff", marginBottom: "16px", fontFamily: "Space Grotesk" }}>
            Total Exposure: ${breaker.total_exposure.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </div>
        </div>

        {!confirmFlatten ? (
          <button
            onClick={() => setConfirmFlatten(true)}
            style={{
              width: "100%",
              backgroundColor: "#ff6b6b",
              border: "none",
              color: "#0e0e0f",
              padding: "16px",
              borderRadius: "6px",
              fontWeight: "700",
              cursor: "pointer",
              fontFamily: "Space Grotesk",
              fontSize: "14px",
            }}
          >
            FLATTEN ALL POSITIONS
          </button>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <button
              onClick={() => {
                flattenMutation.mutate();
              }}
              style={{
                backgroundColor: "#ff6b6b",
                border: "none",
                color: "#0e0e0f",
                padding: "16px",
                borderRadius: "6px",
                fontWeight: "700",
                cursor: "pointer",
                fontFamily: "Space Grotesk",
                fontSize: "13px",
              }}
            >
              CONFIRM FLATTEN
            </button>
            <button
              onClick={() => setConfirmFlatten(false)}
              style={{
                backgroundColor: "rgba(72,72,73,0.2)",
                border: "1px solid rgba(72,72,73,0.3)",
                color: "#ffffff",
                padding: "16px",
                borderRadius: "6px",
                fontWeight: "600",
                cursor: "pointer",
                fontFamily: "Space Grotesk",
                fontSize: "13px",
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <h2
        style={{
          fontSize: "18px",
          fontWeight: "600",
          color: "#ff6b6b",
          marginBottom: "16px",
          fontFamily: "Space Grotesk",
        }}
      >
        Kill Switch
      </h2>
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "2px solid #ff6b6b",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "32px",
        }}
      >
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "13px", color: "#ff8a8a", marginBottom: "8px", fontFamily: "Space Grotesk" }}>
            WARNING: This will immediately halt all trading and close all positions
          </div>
        </div>

        {!confirmKillSwitch ? (
          <button
            onClick={() => setConfirmKillSwitch(true)}
            style={{
              width: "100%",
              backgroundColor: "#ff6b6b",
              border: "none",
              color: "#0e0e0f",
              padding: "16px",
              borderRadius: "6px",
              fontWeight: "700",
              cursor: "pointer",
              fontFamily: "Space Grotesk",
              fontSize: "14px",
            }}
          >
            ACTIVATE KILL SWITCH
          </button>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <button
              onClick={() => {
                killSwitchMutation.mutate();
              }}
              style={{
                backgroundColor: "#ff6b6b",
                border: "none",
                color: "#0e0e0f",
                padding: "16px",
                borderRadius: "6px",
                fontWeight: "700",
                cursor: "pointer",
                fontFamily: "Space Grotesk",
                fontSize: "13px",
              }}
            >
              CONFIRM KILL SWITCH
            </button>
            <button
              onClick={() => setConfirmKillSwitch(false)}
              style={{
                backgroundColor: "rgba(72,72,73,0.2)",
                border: "1px solid rgba(72,72,73,0.3)",
                color: "#ffffff",
                padding: "16px",
                borderRadius: "6px",
                fontWeight: "600",
                cursor: "pointer",
                fontFamily: "Space Grotesk",
                fontSize: "13px",
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px", marginBottom: "32px" }}>
        <div>
          <h2
            style={{
              fontSize: "18px",
              fontWeight: "600",
              color: "#ffffff",
              marginBottom: "16px",
              fontFamily: "Space Grotesk",
            }}
          >
            Pause Strategy
          </h2>
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <div style={{ marginBottom: "12px" }}>
              <input
                type="text"
                value={pausedStrategy}
                onChange={(e) => setPausedStrategy(e.target.value.toUpperCase())}
                placeholder="Strategy ID"
                style={{
                  width: "100%",
                  backgroundColor: "#0e0e0f",
                  border: "1px solid rgba(72,72,73,0.2)",
                  color: "#ffffff",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  marginBottom: "12px",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "12px",
                  boxSizing: "border-box",
                }}
              />
              <button
                onClick={() => {
                  if (pausedStrategy) {
                    pauseStrategyMutation.mutate(pausedStrategy);
                  }
                }}
                style={{
                  width: "100%",
                  backgroundColor: "#ffd93d",
                  border: "none",
                  color: "#0e0e0f",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  fontWeight: "600",
                  cursor: "pointer",
                  fontFamily: "Space Grotesk",
                  fontSize: "12px",
                }}
              >
                Pause Strategy
              </button>
            </div>

            {status.strategies_paused.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#767576",
                    marginBottom: "8px",
                    fontFamily: "Space Grotesk",
                  }}
                >
                  Paused Strategies:
                </div>
                {status.strategies_paused.map((strat) => (
                  <div
                    key={strat}
                    style={{
                      backgroundColor: "rgba(255, 217, 61, 0.1)",
                      color: "#ffd93d",
                      padding: "6px 8px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      marginBottom: "4px",
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  >
                    {strat}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <h2
            style={{
              fontSize: "18px",
              fontWeight: "600",
              color: "#ffffff",
              marginBottom: "16px",
              fontFamily: "Space Grotesk",
            }}
          >
            Pause Symbol
          </h2>
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <div style={{ marginBottom: "12px" }}>
              <input
                type="text"
                value={pausedSymbol}
                onChange={(e) => setPausedSymbol(e.target.value.toUpperCase())}
                placeholder="Symbol"
                style={{
                  width: "100%",
                  backgroundColor: "#0e0e0f",
                  border: "1px solid rgba(72,72,73,0.2)",
                  color: "#ffffff",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  marginBottom: "12px",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "12px",
                  boxSizing: "border-box",
                }}
              />
              <button
                onClick={() => {
                  if (pausedSymbol) {
                    pauseSymbolMutation.mutate(pausedSymbol);
                  }
                }}
                style={{
                  width: "100%",
                  backgroundColor: "#ffd93d",
                  border: "none",
                  color: "#0e0e0f",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  fontWeight: "600",
                  cursor: "pointer",
                  fontFamily: "Space Grotesk",
                  fontSize: "12px",
                }}
              >
                Pause Symbol
              </button>
            </div>

            {status.symbols_paused.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#767576",
                    marginBottom: "8px",
                    fontFamily: "Space Grotesk",
                  }}
                >
                  Paused Symbols:
                </div>
                {status.symbols_paused.map((sym) => (
                  <div
                    key={sym}
                    style={{
                      backgroundColor: "rgba(255, 217, 61, 0.1)",
                      color: "#ffd93d",
                      padding: "6px 8px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      marginBottom: "4px",
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  >
                    {sym}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <h2
        style={{
          fontSize: "18px",
          fontWeight: "600",
          color: "#ffffff",
          marginBottom: "16px",
          fontFamily: "Space Grotesk",
        }}
      >
        Circuit Breaker Status
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "16px",
        }}
      >
        <div
          style={{
            backgroundColor: breaker.daily_breaker_triggered ? "#5a2d2d" : "#1a191b",
            border: breaker.daily_breaker_triggered ? "2px solid #ff6b6b" : "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <div style={{ fontSize: "13px", color: "#ffffff", marginBottom: "8px", fontFamily: "Space Grotesk" }}>
            Daily Breaker
          </div>
          <div
            style={{
              fontSize: "16px",
              fontWeight: "600",
              color: breaker.daily_breaker_triggered ? "#ff6b6b" : "#9cff93",
              fontFamily: "Space Grotesk",
            }}
          >
            {breaker.daily_breaker_triggered ? "TRIGGERED" : "OFF"}
          </div>
        </div>
        <div
          style={{
            backgroundColor: breaker.weekly_breaker_triggered ? "#5a2d2d" : "#1a191b",
            border: breaker.weekly_breaker_triggered ? "2px solid #ff6b6b" : "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <div style={{ fontSize: "13px", color: "#ffffff", marginBottom: "8px", fontFamily: "Space Grotesk" }}>
            Weekly Breaker
          </div>
          <div
            style={{
              fontSize: "16px",
              fontWeight: "600",
              color: breaker.weekly_breaker_triggered ? "#ff6b6b" : "#9cff93",
              fontFamily: "Space Grotesk",
            }}
          >
            {breaker.weekly_breaker_triggered ? "TRIGGERED" : "OFF"}
          </div>
        </div>
        <div
          style={{
            backgroundColor: breaker.circuit_breaker_active ? "#5a2d2d" : "#1a191b",
            border: breaker.circuit_breaker_active ? "2px solid #ff6b6b" : "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <div style={{ fontSize: "13px", color: "#ffffff", marginBottom: "8px", fontFamily: "Space Grotesk" }}>
            Circuit Breaker
          </div>
          <div
            style={{
              fontSize: "16px",
              fontWeight: "600",
              color: breaker.circuit_breaker_active ? "#ff6b6b" : "#9cff93",
              fontFamily: "Space Grotesk",
            }}
          >
            {breaker.circuit_breaker_active ? "ACTIVE" : "INACTIVE"}
          </div>
        </div>
      </div>
    </div>
  );
}
