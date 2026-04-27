import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toArray, safeNum, safeFixed } from "@/lib/safe";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type RiskPolicy = {
  policy_id: string;
  policy_name: string;
  description: string;
  current_value: number;
  limit_value: number;
  unit: string;
  is_violated: boolean;
};

export default function RiskPoliciesPage() {
  const queryClient = useQueryClient();
  const [editingPolicy, setEditingPolicy] = useState<string | null>(null);

  const { data: policiesData, isLoading } = useQuery({
    queryKey: ["risk", "policies"],
    queryFn: () => fetch(`${API}/api/risk/policies`).then((r) => r.json()),
    refetchInterval: 30000,
  });

  const { data: limitsData } = useQuery({
    queryKey: ["risk", "limits"],
    queryFn: () => fetch(`${API}/api/risk/limits`).then((r) => r.json()),
    refetchInterval: 30000,
  });

  const updatePolicyMutation = useMutation({
    mutationFn: (data: { policy_id: string; new_limit: number }) =>
      fetch(`${API}/api/risk/policies/${data.policy_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: data.new_limit }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["risk", "policies"] });
      setEditingPolicy(null);
    },
  });

  if (isLoading) {
    return <div style={{ padding: "32px", color: "#767576" }}>Loading risk policies...</div>;
  }

  const policies: RiskPolicy[] = toArray<RiskPolicy>(policiesData, "policies");

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
        Risk Policy Center
      </h1>

      <h2
        style={{
          fontSize: "18px",
          fontWeight: "600",
          color: "#ffffff",
          marginBottom: "16px",
          fontFamily: "Space Grotesk",
        }}
      >
        Active Risk Rules
      </h2>
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          overflowX: "auto",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "JetBrains Mono, monospace",
            fontSize: "12px",
            minWidth: "1000px",
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
              <th style={{ textAlign: "left", padding: "12px", color: "#767576" }}>Policy Name</th>
              <th style={{ textAlign: "left", padding: "12px", color: "#767576" }}>Description</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Current Value</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Limit</th>
              <th style={{ textAlign: "center", padding: "12px", color: "#767576" }}>Status</th>
              <th style={{ textAlign: "center", padding: "12px", color: "#767576" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((policy) => (
              <tr key={policy.policy_id} style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                <td style={{ padding: "12px", color: "#ffffff", fontWeight: "600" }}>
                  {policy.policy_name}
                </td>
                <td style={{ padding: "12px", color: "#767576", fontSize: "11px" }}>
                  {policy.description}
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: "#9cff93" }}>
                  {safeFixed(policy.current_value, 2)} {policy.unit}
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: "#ffffff" }}>
                  {editingPolicy === policy.policy_id ? (
                    <input
                      type="number"
                      defaultValue={policy.limit_value}
                      style={{
                        backgroundColor: "#0e0e0f",
                        border: "1px solid #9cff93",
                        color: "#9cff93",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        fontFamily: "JetBrains Mono, monospace",
                        width: "80px",
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const value = (e.target as HTMLInputElement).value;
                          updatePolicyMutation.mutate({
                            policy_id: policy.policy_id,
                            new_limit: parseFloat(value),
                          });
                        } else if (e.key === "Escape") {
                          setEditingPolicy(null);
                        }
                      }}
                    />
                  ) : (
                    <>
                      {safeFixed(policy.limit_value, 2)} {policy.unit}
                    </>
                  )}
                </td>
                <td
                  style={{
                    padding: "12px",
                    textAlign: "center",
                    color: policy.is_violated ? "#ff6b6b" : "#9cff93",
                  }}
                >
                  <span
                    style={{
                      backgroundColor: policy.is_violated ? "rgba(255, 107, 107, 0.2)" : "rgba(156, 255, 147, 0.2)",
                      padding: "4px 8px",
                      borderRadius: "4px",
                      fontSize: "11px",
                    }}
                  >
                    {policy.is_violated ? "VIOLATED" : "OK"}
                  </span>
                </td>
                <td style={{ padding: "12px", textAlign: "center" }}>
                  {editingPolicy === policy.policy_id ? (
                    <button
                      onClick={() => setEditingPolicy(null)}
                      style={{
                        backgroundColor: "rgba(156, 255, 147, 0.2)",
                        border: "1px solid #9cff93",
                        color: "#9cff93",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "11px",
                        fontFamily: "Space Grotesk",
                      }}
                    >
                      Cancel
                    </button>
                  ) : (
                    <button
                      onClick={() => setEditingPolicy(policy.policy_id)}
                      style={{
                        backgroundColor: "rgba(156, 255, 147, 0.1)",
                        border: "1px solid rgba(156, 255, 147, 0.3)",
                        color: "#9cff93",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "11px",
                        fontFamily: "Space Grotesk",
                      }}
                    >
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
        Policy Details
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "16px",
        }}
      >
        {policies.map((policy) => (
          <div
            key={`detail-${policy.policy_id}`}
            style={{
              backgroundColor: "#1a191b",
              border: policy.is_violated ? "2px solid #ff6b6b" : "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "13px", color: "#ffffff", fontWeight: "600", fontFamily: "Space Grotesk" }}>
                {policy.policy_name}
              </div>
              <div style={{ fontSize: "11px", color: "#767576", marginTop: "4px" }}>
                {policy.description}
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "11px", color: "#767576", marginBottom: "4px", fontFamily: "Space Grotesk" }}>
                Current / Limit
              </div>
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: "600",
                  color: policy.is_violated ? "#ff6b6b" : "#9cff93",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                {safeFixed(policy.current_value, 2)} / {safeFixed(policy.limit_value, 2)} {policy.unit}
              </div>
            </div>

            <div
              style={{
                height: "4px",
                backgroundColor: "rgba(72,72,73,0.2)",
                borderRadius: "2px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  backgroundColor: policy.is_violated ? "#ff6b6b" : "#9cff93",
                  width: `${Math.min((safeNum(policy.current_value) / Math.max(safeNum(policy.limit_value), 0.0001)) * 100, 100)}%`,
                }}
              />
            </div>

            <div
              style={{
                marginTop: "12px",
                padding: "8px",
                backgroundColor: policy.is_violated ? "rgba(255, 107, 107, 0.1)" : "rgba(156, 255, 147, 0.1)",
                borderRadius: "6px",
                textAlign: "center",
                fontSize: "11px",
                color: policy.is_violated ? "#ff6b6b" : "#9cff93",
                fontFamily: "Space Grotesk",
              }}
            >
              {policy.is_violated ? "VIOLATION DETECTED" : "COMPLIANT"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
