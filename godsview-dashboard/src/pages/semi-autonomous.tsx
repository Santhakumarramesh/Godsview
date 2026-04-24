import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type ActionApprovalSetting = {
  action_name: string;
  is_auto_approved: boolean;
  requires_confirmation: boolean;
  max_per_day?: number;
  current_count?: number;
};

type ModeStatus = {
  current_mode: "manual" | "semi_autonomous" | "autonomous";
  auto_actions: ActionApprovalSetting[];
  manual_actions: ActionApprovalSetting[];
};

export default function SemiAutonomousPage() {
  const queryClient = useQueryClient();
  const [editingAction, setEditingAction] = useState<string | null>(null);

  const { data: modeData, isLoading } = useQuery({
    queryKey: ["autonomous", "status"],
    queryFn: () => fetch(`${API}/api/autonomous/status`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const { data: executionData } = useQuery({
    queryKey: ["execution", "mode"],
    queryFn: () => fetch(`${API}/api/execution/mode`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const toggleAutoApprovalMutation = useMutation({
    mutationFn: (data: { action_name: string; auto_approve: boolean }) =>
      fetch(`${API}/api/autonomous/toggle-action`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["autonomous", "status"] });
      setEditingAction(null);
    },
  });

  if (isLoading) {
    return <div style={{ padding: "32px", color: "#767576" }}>Loading mode settings...</div>;
  }

  const mode: ModeStatus = modeData?.mode || {
    current_mode: "manual",
    auto_actions: [],
    manual_actions: [],
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
        Semi-Autonomous Mode
      </h1>

      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "32px",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "24px" }}>
          <div>
            <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Current Mode</div>
            <div
              style={{
                fontSize: "20px",
                fontWeight: "600",
                color: "#9cff93",
                marginTop: "8px",
                fontFamily: "Space Grotesk",
              }}
            >
              {mode.current_mode.replace(/_/g, " ").toUpperCase()}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Auto-Approved Actions</div>
            <div
              style={{
                fontSize: "20px",
                fontWeight: "600",
                color: "#9cff93",
                marginTop: "8px",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {mode.auto_actions.filter((a) => a.is_auto_approved).length} / {mode.auto_actions.length + mode.manual_actions.length}
            </div>
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
        Auto-Approved Actions
      </h2>
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "32px",
        }}
      >
        {mode.auto_actions.length === 0 ? (
          <div style={{ color: "#767576" }}>No auto-approved actions configured</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
            {mode.auto_actions.map((action) => (
              <div
                key={action.action_name}
                style={{
                  backgroundColor: "#0e0e0f",
                  border: "1px solid rgba(156, 255, 147, 0.2)",
                  borderRadius: "8px",
                  padding: "16px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div style={{ fontSize: "13px", color: "#ffffff", fontWeight: "600", fontFamily: "Space Grotesk" }}>
                    {action.action_name}
                  </div>
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      backgroundColor: "#2d5a2d",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#9cff93",
                      fontSize: "12px",
                    }}
                  >
                    ✓
                  </div>
                </div>
                {action.max_per_day && (
                  <div style={{ fontSize: "11px", color: "#767576" }}>
                    Max per day: {action.current_count || 0} / {action.max_per_day}
                  </div>
                )}
                <button
                  onClick={() => {
                    toggleAutoApprovalMutation.mutate({
                      action_name: action.action_name,
                      auto_approve: false,
                    });
                  }}
                  style={{
                    marginTop: "8px",
                    width: "100%",
                    backgroundColor: "rgba(156, 255, 147, 0.1)",
                    border: "1px solid rgba(156, 255, 147, 0.2)",
                    color: "#9cff93",
                    padding: "6px 8px",
                    borderRadius: "4px",
                    fontSize: "10px",
                    cursor: "pointer",
                    fontFamily: "Space Grotesk",
                  }}
                >
                  Disable Auto
                </button>
              </div>
            ))}
          </div>
        )}
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
        Manual Approval Required
      </h2>
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        {mode.manual_actions.length === 0 ? (
          <div style={{ color: "#767576" }}>No manual approval actions</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
            {mode.manual_actions.map((action) => (
              <div
                key={action.action_name}
                style={{
                  backgroundColor: "#0e0e0f",
                  border: "1px solid rgba(255, 138, 138, 0.2)",
                  borderRadius: "8px",
                  padding: "16px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div style={{ fontSize: "13px", color: "#ffffff", fontWeight: "600", fontFamily: "Space Grotesk" }}>
                    {action.action_name}
                  </div>
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      backgroundColor: "#5a2d2d",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ff8a8a",
                      fontSize: "12px",
                    }}
                  >
                    ✗
                  </div>
                </div>
                {action.max_per_day && (
                  <div style={{ fontSize: "11px", color: "#767576" }}>
                    Max per day: {action.current_count || 0} / {action.max_per_day}
                  </div>
                )}
                <button
                  onClick={() => {
                    toggleAutoApprovalMutation.mutate({
                      action_name: action.action_name,
                      auto_approve: true,
                    });
                  }}
                  style={{
                    marginTop: "8px",
                    width: "100%",
                    backgroundColor: "rgba(255, 138, 138, 0.1)",
                    border: "1px solid rgba(255, 138, 138, 0.2)",
                    color: "#ff8a8a",
                    padding: "6px 8px",
                    borderRadius: "4px",
                    fontSize: "10px",
                    cursor: "pointer",
                    fontFamily: "Space Grotesk",
                  }}
                >
                  Enable Auto
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <h2
        style={{
          fontSize: "18px",
          fontWeight: "600",
          color: "#ffffff",
          marginTop: "32px",
          marginBottom: "16px",
          fontFamily: "Space Grotesk",
        }}
      >
        Policy Rules Summary
      </h2>
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
          {[
            { name: "Position Sizing", description: "Max position size enforcement" },
            { name: "Daily Limit", description: "Max daily P&L loss limit" },
            { name: "Risk Per Trade", description: "Max risk per individual trade" },
            { name: "Correlation Check", description: "Avoid highly correlated entries" },
            { name: "Drawdown Protection", description: "Halt on drawdown threshold" },
            { name: "Session Hours", description: "Trade only during market hours" },
          ].map((rule) => (
            <div
              key={rule.name}
              style={{
                padding: "12px",
                backgroundColor: "rgba(72,72,73,0.1)",
                borderRadius: "8px",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  color: "#ffffff",
                  fontWeight: "600",
                  fontFamily: "Space Grotesk",
                }}
              >
                {rule.name}
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: "#767576",
                  marginTop: "4px",
                }}
              >
                {rule.description}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
