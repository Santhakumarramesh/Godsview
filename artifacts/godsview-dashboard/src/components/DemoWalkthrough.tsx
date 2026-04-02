import { useState, useCallback } from "react";

const C = {
  card: "#1a191b",
  border: "rgba(72,72,73,0.25)",
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  amber: "#ffb84d",
  muted: "#adaaab",
  outline: "#767576",
};

interface WalkthroughStep {
  title: string;
  description: string;
  highlight: string; // what area this step refers to
  icon: string;
  detail?: string;
}

const STEPS: WalkthroughStep[] = [
  {
    title: "Welcome to Godsview",
    description: "An AI-assisted order-flow trading terminal that combines structure-first filtering, order-flow confirmation, and risk-aware execution to surface higher-quality trades.",
    highlight: "overview",
    icon: "rocket_launch",
    detail: "Godsview runs a 6-layer hybrid AI pipeline: Structure → Order Flow → Recall → ML → Claude Reasoning → Risk Engine. Every trade is vetted through all 6 layers before approval.",
  },
  {
    title: "Default Watchlist Loaded",
    description: "Your watchlist starts with BTC/USD and ETH/USD on Alpaca Crypto. The live chart streams real-time Coinbase data through TradingView.",
    highlight: "chart",
    icon: "visibility",
    detail: "Add symbols in System → Configuration. All supported Alpaca crypto pairs work out of the box. Equity and forex pairs available with upgraded Alpaca keys.",
  },
  {
    title: "Run a Scan",
    description: "Navigate to the Alpaca page and click 'Scan Now' to analyze current market structure. The pipeline evaluates every setup against 6 layers.",
    highlight: "scan",
    icon: "search",
    detail: "Each scan checks: SK structure zones, order flow absorption/sweeps, historical recall patterns, ML win probability, Claude reasoning veto, and risk engine gates.",
  },
  {
    title: "Approved Setup — Why It Passed",
    description: "When a setup is approved, you see exactly why. Each layer's score is shown: Structure 82%, Order Flow 74%, Recall 68%, ML 61%, Claude APPROVED (0.78).",
    highlight: "signal",
    icon: "check_circle",
    detail: "Click any signal in the feed to see the full decision breakdown: layer scores, Claude's reasoning, entry/SL/TP levels, R:R ratio, and regime context.",
  },
  {
    title: "Risk Block Example",
    description: "When the risk engine blocks a trade, you see the exact reason: kill switch active, daily loss limit reached, cooldown after losses, or news lockout.",
    highlight: "risk",
    icon: "shield",
    detail: "Decision states: TRADE (approved), PASS (below threshold), REJECTED (Claude veto), BLOCKED_BY_RISK (risk engine), DEGRADED_DATA (data quality issue).",
  },
  {
    title: "One-Click Execution",
    description: "Approved setups show entry, stop-loss, and take-profit levels. In paper mode, click 'Execute' to place the trade through Alpaca. Position sizing is automatic.",
    highlight: "execute",
    icon: "bolt",
    detail: "System modes: demo (no orders), paper (paper trading), live_disabled (read-only live), live_enabled (real money). Kill switch stops all execution instantly.",
  },
  {
    title: "Auto Journal & Performance",
    description: "Every decision is logged to the audit trail. Performance tracks win rate, profit factor, expectancy, drawdown, and 'trades avoided' by risk engine.",
    highlight: "journal",
    icon: "auto_stories",
    detail: "View proof of edge on the Performance page: by-setup breakdown, by-session, by-regime, by-symbol. The equity curve shows both growth and drawdown.",
  },
];

const DEMO_STORAGE_KEY = "godsview_demo_completed";

export function useDemoWalkthrough() {
  const [active, setActive] = useState(() => {
    try {
      return !sessionStorage.getItem(DEMO_STORAGE_KEY);
    } catch {
      return true;
    }
  });

  const dismiss = useCallback(() => {
    setActive(false);
    try { sessionStorage.setItem(DEMO_STORAGE_KEY, "1"); } catch {}
  }, []);

  const restart = useCallback(() => {
    setActive(true);
    try { sessionStorage.removeItem(DEMO_STORAGE_KEY); } catch {}
  }, []);

  return { active, dismiss, restart };
}

export default function DemoWalkthrough({ onDismiss }: { onDismiss: () => void }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 pointer-events-none" style={{ background: step === 0 ? "rgba(0,0,0,0.6)" : "transparent" }}>
      <div
        className="pointer-events-auto w-full max-w-2xl rounded-lg overflow-hidden"
        style={{
          backgroundColor: "#181719",
          border: `1px solid rgba(156,255,147,0.2)`,
          boxShadow: "0 -4px 40px rgba(156,255,147,0.08), 0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        {/* Progress bar */}
        <div className="h-0.5 w-full" style={{ backgroundColor: "rgba(72,72,73,0.3)" }}>
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%`, backgroundColor: C.primary }}
          />
        </div>

        <div className="p-5">
          {/* Step indicator */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ fontSize: "18px", color: C.primary }}>{current.icon}</span>
              <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", color: C.outline }}>
                Step {step + 1} of {STEPS.length}
              </span>
            </div>
            <button
              onClick={onDismiss}
              style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: C.outline, letterSpacing: "0.1em", textTransform: "uppercase" }}
              className="hover:opacity-80 transition-opacity"
            >
              Skip Tour
            </button>
          </div>

          {/* Content */}
          <h3 className="font-headline font-bold text-lg mb-2" style={{ color: "#ffffff" }}>{current.title}</h3>
          <p style={{ fontSize: "12px", color: C.muted, lineHeight: "1.6", fontFamily: "Space Grotesk" }}>{current.description}</p>

          {current.detail && (
            <div className="mt-3 rounded p-3" style={{ backgroundColor: "rgba(156,255,147,0.04)", border: "1px solid rgba(156,255,147,0.1)" }}>
              <p style={{ fontSize: "10px", color: C.outline, lineHeight: "1.5", fontFamily: "Space Grotesk" }}>{current.detail}</p>
            </div>
          )}

          {/* Highlight indicator dots */}
          <div className="flex items-center gap-1.5 mt-4 mb-4">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className="rounded-full transition-all"
                style={{
                  width: i === step ? "16px" : "6px",
                  height: "6px",
                  backgroundColor: i === step ? C.primary : i < step ? "rgba(156,255,147,0.3)" : "rgba(72,72,73,0.4)",
                }}
              />
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep(Math.max(0, step - 1))}
              disabled={step === 0}
              className="px-4 py-2 rounded transition-all"
              style={{
                fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                backgroundColor: step === 0 ? "transparent" : "rgba(72,72,73,0.2)",
                color: step === 0 ? "transparent" : C.muted,
                border: step === 0 ? "1px solid transparent" : `1px solid ${C.border}`,
                cursor: step === 0 ? "default" : "pointer",
              }}
            >
              Back
            </button>

            <button
              onClick={() => {
                if (isLast) {
                  onDismiss();
                } else {
                  setStep(step + 1);
                }
              }}
              className="px-6 py-2 rounded transition-all hover:brightness-110"
              style={{
                fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                backgroundColor: isLast ? "rgba(156,255,147,0.15)" : "rgba(156,255,147,0.1)",
                color: C.primary,
                border: `1px solid rgba(156,255,147,0.25)`,
              }}
            >
              {isLast ? "Start Trading" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
