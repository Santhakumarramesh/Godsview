import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  border: "rgba(72,72,73,0.2)",
  accent: "#9cff93",
  text: "#ffffff",
  muted: "#767576",
};

interface Condition {
  id: string;
  type: "entry" | "exit";
  rule: string;
  confirmation?: string;
}

interface Strategy {
  name: string;
  conditions: Condition[];
  filters: string[];
  riskRules: { maxLoss: number; positionSize: number; stopType: string };
}

export default function StrategyBuilder() {
  const [strategy, setStrategy] = useState<Strategy>({
    name: "New Strategy",
    conditions: [{ id: "1", type: "entry", rule: "", confirmation: "" }],
    filters: [],
    riskRules: { maxLoss: 0.02, positionSize: 1, stopType: "ATR" },
  });

  const [showSaveAlert, setShowSaveAlert] = useState(false);

  const { data: strategiesData } = useQuery({
    queryKey: ["strategies"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/strategies`);
      return res.json();
    },
  });

  const { data: paramsData } = useQuery({
    queryKey: ["strategy-params"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/brain/strategy/params`);
      return res.json();
    },
  });

  const addCondition = (type: "entry" | "exit") => {
    const newCondition: Condition = {
      id: Date.now().toString(),
      type,
      rule: "",
      confirmation: "",
    };
    setStrategy({
      ...strategy,
      conditions: [...strategy.conditions, newCondition],
    });
  };

  const updateCondition = (id: string, field: string, value: string) => {
    setStrategy({
      ...strategy,
      conditions: strategy.conditions.map((c) => (c.id === id ? { ...c, [field]: value } : c)),
    });
  };

  const removeCondition = (id: string) => {
    setStrategy({
      ...strategy,
      conditions: strategy.conditions.filter((c) => c.id !== id),
    });
  };

  const saveStrategy = async () => {
    try {
      await fetch(`${API}/api/brain/strategy/params`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(strategy),
      });
      setShowSaveAlert(true);
      setTimeout(() => setShowSaveAlert(false), 3000);
    } catch (err) {
      console.error("Failed to save strategy", err);
    }
  };

  return (
    <div style={{ backgroundColor: C.bg, minHeight: "100vh", padding: "24px", color: C.text }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "32px" }}>
          Strategy Builder
        </h1>

        {/* Strategy Name */}
        <div
          style={{
            backgroundColor: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <label style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: C.muted }}>STRATEGY NAME</label>
          <input
            type="text"
            value={strategy.name}
            onChange={(e) => setStrategy({ ...strategy, name: e.target.value })}
            style={{
              width: "100%",
              padding: "12px",
              marginTop: "8px",
              backgroundColor: "#0e0e0f",
              border: `1px solid ${C.border}`,
              color: C.text,
              borderRadius: "8px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          />
        </div>

        {/* Entry Conditions */}
        <div
          style={{
            backgroundColor: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", marginBottom: "16px" }}>ENTRY CONDITIONS</h2>
          {strategy.conditions
            .filter((c) => c.type === "entry")
            .map((condition) => (
              <div key={condition.id} style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: `1px solid ${C.border}` }}>
                <input
                  type="text"
                  placeholder="Entry rule (e.g., Price > EMA20)"
                  value={condition.rule}
                  onChange={(e) => updateCondition(condition.id, "rule", e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px",
                    marginBottom: "8px",
                    backgroundColor: "#0e0e0f",
                    border: `1px solid ${C.border}`,
                    color: C.text,
                    borderRadius: "8px",
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: "12px",
                  }}
                />
                <input
                  type="text"
                  placeholder="Confirmation signal (optional)"
                  value={condition.confirmation || ""}
                  onChange={(e) => updateCondition(condition.id, "confirmation", e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px",
                    marginBottom: "8px",
                    backgroundColor: "#0e0e0f",
                    border: `1px solid ${C.border}`,
                    color: C.text,
                    borderRadius: "8px",
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: "12px",
                  }}
                />
                <button
                  onClick={() => removeCondition(condition.id)}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#ff7162",
                    border: "none",
                    borderRadius: "6px",
                    color: "white",
                    fontFamily: "Space Grotesk",
                    cursor: "pointer",
                    fontSize: "12px",
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          <button
            onClick={() => addCondition("entry")}
            style={{
              padding: "10px 20px",
              backgroundColor: C.accent,
              border: "none",
              borderRadius: "6px",
              color: "#000",
              fontFamily: "Space Grotesk",
              cursor: "pointer",
              fontWeight: "600",
            }}
          >
            + Add Entry Condition
          </button>
        </div>

        {/* Exit Conditions */}
        <div
          style={{
            backgroundColor: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", marginBottom: "16px" }}>EXIT CONDITIONS</h2>
          {strategy.conditions
            .filter((c) => c.type === "exit")
            .map((condition) => (
              <div key={condition.id} style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: `1px solid ${C.border}` }}>
                <input
                  type="text"
                  placeholder="Exit rule"
                  value={condition.rule}
                  onChange={(e) => updateCondition(condition.id, "rule", e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px",
                    marginBottom: "8px",
                    backgroundColor: "#0e0e0f",
                    border: `1px solid ${C.border}`,
                    color: C.text,
                    borderRadius: "8px",
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: "12px",
                  }}
                />
                <button
                  onClick={() => removeCondition(condition.id)}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#ff7162",
                    border: "none",
                    borderRadius: "6px",
                    color: "white",
                    fontFamily: "Space Grotesk",
                    cursor: "pointer",
                    fontSize: "12px",
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          <button
            onClick={() => addCondition("exit")}
            style={{
              padding: "10px 20px",
              backgroundColor: C.accent,
              border: "none",
              borderRadius: "6px",
              color: "#000",
              fontFamily: "Space Grotesk",
              cursor: "pointer",
              fontWeight: "600",
            }}
          >
            + Add Exit Condition
          </button>
        </div>

        {/* Risk Rules */}
        <div
          style={{
            backgroundColor: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", marginBottom: "16px" }}>RISK PARAMETERS</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div>
              <label style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: C.muted }}>Max Loss %</label>
              <input
                type="number"
                value={strategy.riskRules.maxLoss}
                onChange={(e) =>
                  setStrategy({
                    ...strategy,
                    riskRules: { ...strategy.riskRules, maxLoss: parseFloat(e.target.value) },
                  })
                }
                style={{
                  width: "100%",
                  padding: "12px",
                  marginTop: "8px",
                  backgroundColor: "#0e0e0f",
                  border: `1px solid ${C.border}`,
                  color: C.text,
                  borderRadius: "8px",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              />
            </div>
            <div>
              <label style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: C.muted }}>Position Size</label>
              <input
                type="number"
                value={strategy.riskRules.positionSize}
                onChange={(e) =>
                  setStrategy({
                    ...strategy,
                    riskRules: { ...strategy.riskRules, positionSize: parseFloat(e.target.value) },
                  })
                }
                style={{
                  width: "100%",
                  padding: "12px",
                  marginTop: "8px",
                  backgroundColor: "#0e0e0f",
                  border: `1px solid ${C.border}`,
                  color: C.text,
                  borderRadius: "8px",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              />
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={saveStrategy}
            style={{
              padding: "12px 32px",
              backgroundColor: C.accent,
              border: "none",
              borderRadius: "8px",
              color: "#000",
              fontFamily: "Space Grotesk",
              fontWeight: "600",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            Save Strategy
          </button>
        </div>

        {showSaveAlert && (
          <div
            style={{
              marginTop: "16px",
              padding: "12px 16px",
              backgroundColor: C.accent,
              color: "#000",
              borderRadius: "8px",
              fontFamily: "Space Grotesk",
            }}
          >
            Strategy saved successfully!
          </div>
        )}
      </div>
    </div>
  );
}
