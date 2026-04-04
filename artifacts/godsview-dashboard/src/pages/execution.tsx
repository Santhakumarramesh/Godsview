import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";

type BreakerLevel = "NORMAL" | "WARNING" | "THROTTLE" | "HALT";

type BreakerSnapshot = {
  level: BreakerLevel;
  realized_pnl_today: number;
  unrealized_pnl: number;
  total_pnl: number;
  daily_loss_limit: number;
  consecutive_losses: number;
  cooldown_active: boolean;
  cooldown_until: string | null;
  position_size_multiplier: number;
  trades_today: number;
  wins_today: number;
  losses_today: number;
  hourly_pnl_velocity: number;
  peak_equity: number;
  drawdown_from_peak: number;
  last_updated: string;
};

type ManagedPosition = {
  symbol: string;
  direction: string;
  entry: number;
  current_stop: number;
  peak_price: number;
  trail_active: boolean;
  remaining_qty: number;
  targets_hit: number;
};

type CorrelatedPair = {
  symbol_a: string;
  symbol_b: string;
  correlation: number;
};

type PortfolioRiskPosition = {
  symbol: string;
  side: string;
  qty: number;
  market_value: number;
  weight: number;
};

type PortfolioRiskSnapshot = {
  generated_at: string;
  account_equity: number;
  peak_equity: number;
  drawdown_pct: number;
  one_day_var_usd: number;
  one_day_var_pct: number;
  var_confidence: number;
  avg_pair_correlation: number;
  max_pair_correlation: number;
  correlated_pairs: CorrelatedPair[];
  open_positions: PortfolioRiskPosition[];
  limits: {
    max_drawdown_pct: number;
    max_var_pct: number;
    max_avg_correlation: number;
    max_pair_correlation: number;
  };
  breaches: string[];
  risk_state: "NORMAL" | "ELEVATED" | "CRITICAL" | "HALT";
  candidate_symbol: string | null;
  candidate_max_correlation: number;
};

type ExecutionStatus = {
  mode: { mode: string; canWrite: boolean; isLive: boolean };
  kill_switch: boolean;
  breaker: BreakerSnapshot;
  reconciliation: {
    fills_today: number;
    realized_pnl_today: number;
    unmatched_fills: number;
    is_running: boolean;
  };
  managed_positions: number;
  positions: ManagedPosition[];
  portfolio_risk: PortfolioRiskSnapshot;
  gate_stats: {
    daily_trades: number;
    max_daily_trades: number;
  };
  incident_guard: {
    level: "NORMAL" | "WATCH" | "HALT";
    halt_active: boolean;
    consecutive_failures: number;
    window_failures: number;
    window_rejections: number;
    window_slippage_spikes: number;
    last_halt_reason: string | null;
  };
  market_guard: {
    level: "NORMAL" | "WATCH" | "HALT";
    halt_active: boolean;
    consecutive_critical: number;
    window_critical: number;
    window_warn: number;
    last_halt_reason: string | null;
    last_evaluation: {
      symbol: string | null;
      metrics: {
        spread_bps: number | null;
        top_book_notional_usd: number | null;
        bar_age_ms: number | null;
        rv_1m_pct: number | null;
      } | null;
    };
  };
  idempotency: {
    entries: number;
    hits: number;
    misses: number;
    conflicts: number;
    replays: number;
    policy: {
      ttl_ms: number;
      require_key_in_live_mode: boolean;
    };
  };
  last_liquidation: null | {
    triggered_by: string;
    timestamp: string;
    positions_closed: number;
    positions_failed: number;
  };
};

type ReconciledFill = {
  fill_id: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  timestamp: string;
  matched_position: boolean;
  realized_pnl: number | null;
};

const LEVEL_COLORS: Record<BreakerLevel, string> = {
  NORMAL: "#9cff93",
  WARNING: "#fbbf24",
  THROTTLE: "#fb923c",
  HALT: "#ff7162",
};

const RISK_STATE_COLORS: Record<PortfolioRiskSnapshot["risk_state"], string> = {
  NORMAL: "#9cff93",
  ELEVATED: "#fbbf24",
  CRITICAL: "#fb923c",
  HALT: "#ff7162",
};

function StatusBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded px-4 py-3" style={{ backgroundColor: "rgba(255,255,255,0.03)", border: `1px solid ${color}33` }}>
      <div style={{ fontSize: "9px", color: "#767576", fontFamily: "Space Grotesk", letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</div>
      <div className="mt-1 font-bold font-headline" style={{ fontSize: "18px", color }}>{value}</div>
    </div>
  );
}

function KillSwitchButton({ active, onToggle }: { active: boolean; onToggle: (v: boolean) => void }) {
  const [confirm, setConfirm] = useState(false);

  if (active && !confirm) {
    return (
      <div className="flex gap-2">
        <div className="rounded px-4 py-3 flex items-center gap-2" style={{ backgroundColor: "rgba(255,113,98,0.15)", border: "1px solid rgba(255,113,98,0.4)" }}>
          <span className="material-symbols-outlined" style={{ color: "#ff7162", fontSize: "18px" }}>emergency</span>
          <span className="font-headline font-bold" style={{ color: "#ff7162", fontSize: "12px" }}>KILL SWITCH ACTIVE</span>
        </div>
        <button onClick={() => onToggle(false)} className="rounded px-3 py-2" style={{ backgroundColor: "rgba(156,255,147,0.1)", border: "1px solid rgba(156,255,147,0.3)", color: "#9cff93", fontSize: "10px", fontFamily: "Space Grotesk" }}>
          Deactivate
        </button>
      </div>
    );
  }

  if (confirm) {
    return (
      <div className="flex items-center gap-2">
        <span style={{ fontSize: "10px", color: "#ff7162" }}>Confirm kill switch?</span>
        <button onClick={() => { onToggle(true); setConfirm(false); }} className="rounded px-3 py-1.5" style={{ backgroundColor: "rgba(255,113,98,0.2)", border: "1px solid rgba(255,113,98,0.5)", color: "#ff7162", fontSize: "10px" }}>
          YES — HALT ALL
        </button>
        <button onClick={() => setConfirm(false)} className="rounded px-3 py-1.5" style={{ backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(72,72,73,0.3)", color: "#767576", fontSize: "10px" }}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirm(true)} className="rounded px-4 py-2 flex items-center gap-2" style={{ backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(72,72,73,0.3)" }}>
      <span className="material-symbols-outlined" style={{ color: "#767576", fontSize: "16px" }}>power_settings_new</span>
      <span style={{ color: "#adaaab", fontSize: "10px", fontFamily: "Space Grotesk" }}>Kill Switch</span>
    </button>
  );
}

export default function ExecutionPage() {
  const { data: status, refetch: refetchStatus } = useQuery<ExecutionStatus>({
    queryKey: ["execution-status"],
    queryFn: () => fetch("/api/execution/execution-status").then((r) => r.json()),
    refetchInterval: 3000,
  });

  const { data: fillsData } = useQuery<{ fills: ReconciledFill[] }>({
    queryKey: ["execution-fills"],
    queryFn: () => fetch("/api/execution/fills?limit=20").then((r) => r.json()),
    refetchInterval: 5000,
  });

  const killMutation = useMutation({
    mutationFn: (active: boolean) =>
      fetch("/api/execution/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active, liquidate: active, reason: "dashboard_manual" }),
      }).then((r) => r.json()),
    onSuccess: () => refetchStatus(),
  });

  const emergencyMutation = useMutation({
    mutationFn: () =>
      fetch("/api/execution/emergency-close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "dashboard_emergency" }),
      }).then((r) => r.json()),
    onSuccess: () => refetchStatus(),
  });

  const riskEvalMutation = useMutation({
    mutationFn: (autoHalt: boolean) =>
      fetch("/api/execution/risk-guard/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_halt: autoHalt }),
      }).then((r) => r.json()),
    onSuccess: () => refetchStatus(),
  });

  const breaker = status?.breaker;
  const mode = status?.mode;
  const positions = status?.positions ?? [];
  const portfolioRisk = status?.portfolio_risk;
  const fills = fillsData?.fills ?? [];
  const levelColor = LEVEL_COLORS[breaker?.level ?? "NORMAL"];
  const incident = status?.incident_guard;
  const market = status?.market_guard;
  const idempotency = status?.idempotency;
  const incidentColor =
    incident?.level === "HALT" ? "#ff7162" :
    incident?.level === "WATCH" ? "#fbbf24" : "#9cff93";
  const marketColor =
    market?.level === "HALT" ? "#ff7162" :
    market?.level === "WATCH" ? "#fbbf24" : "#9cff93";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline font-bold text-xl tracking-wide" style={{ color: "#ffffff" }}>Execution Command</h1>
          <p style={{ fontSize: "11px", color: "#767576", fontFamily: "Space Grotesk" }}>
            Live execution pipeline · Fill reconciliation · Circuit breaker
          </p>
        </div>
        <div className="flex items-center gap-3">
          <KillSwitchButton
            active={status?.kill_switch ?? false}
            onToggle={(v) => killMutation.mutate(v)}
          />
        </div>
      </div>

      {/* Status Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-10 gap-3">
        <StatusBadge label="Mode" value={mode?.mode ?? "—"} color={mode?.isLive ? "#ff7162" : "#9cff93"} />
        <StatusBadge label="Breaker" value={breaker?.level ?? "—"} color={levelColor} />
        <StatusBadge label="Incident" value={incident?.level ?? "—"} color={incidentColor} />
        <StatusBadge label="Market" value={market?.level ?? "—"} color={marketColor} />
        <StatusBadge label="Realized PnL" value={`$${(breaker?.realized_pnl_today ?? 0).toFixed(2)}`} color={(breaker?.realized_pnl_today ?? 0) >= 0 ? "#9cff93" : "#ff7162"} />
        <StatusBadge label="Unrealized" value={`$${(breaker?.unrealized_pnl ?? 0).toFixed(2)}`} color={(breaker?.unrealized_pnl ?? 0) >= 0 ? "#9cff93" : "#ff7162"} />
        <StatusBadge label="Trades" value={`${breaker?.trades_today ?? 0}`} color="#67e8f9" />
        <StatusBadge label="Win/Loss" value={`${breaker?.wins_today ?? 0}/${breaker?.losses_today ?? 0}`} color="#fbbf24" />
        <StatusBadge label="Size Multi" value={`${((breaker?.position_size_multiplier ?? 1) * 100).toFixed(0)}%`} color={(breaker?.position_size_multiplier ?? 1) >= 0.75 ? "#9cff93" : "#fb923c"} />
        <StatusBadge label="Positions" value={`${status?.managed_positions ?? 0}`} color="#67e8f9" />
      </div>

      {/* Portfolio Risk Guard */}
      {portfolioRisk && (
        <div className="rounded-lg p-4" style={{ backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid rgba(72,72,73,0.2)" }}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ color: RISK_STATE_COLORS[portfolioRisk.risk_state], fontSize: "18px" }}>policy</span>
              <span className="font-headline font-bold text-sm" style={{ color: "#ffffff" }}>Portfolio Risk Guard</span>
              <span
                className="rounded px-2 py-0.5"
                style={{
                  fontSize: "9px",
                  fontFamily: "Space Grotesk",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: RISK_STATE_COLORS[portfolioRisk.risk_state],
                  border: `1px solid ${RISK_STATE_COLORS[portfolioRisk.risk_state]}55`,
                  backgroundColor: `${RISK_STATE_COLORS[portfolioRisk.risk_state]}14`,
                }}
              >
                {portfolioRisk.risk_state}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => riskEvalMutation.mutate(false)}
                disabled={riskEvalMutation.isPending}
                className="rounded px-3 py-1.5"
                style={{ backgroundColor: "rgba(102,157,255,0.12)", border: "1px solid rgba(102,157,255,0.35)", color: "#669dff", fontSize: "10px", fontFamily: "Space Grotesk" }}
              >
                {riskEvalMutation.isPending ? "EVALUATING..." : "EVALUATE"}
              </button>
              <button
                onClick={() => riskEvalMutation.mutate(true)}
                disabled={riskEvalMutation.isPending}
                className="rounded px-3 py-1.5"
                style={{ backgroundColor: "rgba(255,113,98,0.12)", border: "1px solid rgba(255,113,98,0.35)", color: "#ff7162", fontSize: "10px", fontFamily: "Space Grotesk" }}
              >
                {riskEvalMutation.isPending ? "RUNNING..." : "EVAL + AUTO HALT"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <StatusBadge
              label="Drawdown"
              value={`${(portfolioRisk.drawdown_pct * 100).toFixed(2)}%`}
              color={portfolioRisk.drawdown_pct >= portfolioRisk.limits.max_drawdown_pct ? "#ff7162" : "#9cff93"}
            />
            <StatusBadge
              label="1D VaR"
              value={`${(portfolioRisk.one_day_var_pct * 100).toFixed(2)}%`}
              color={portfolioRisk.one_day_var_pct >= portfolioRisk.limits.max_var_pct ? "#ff7162" : "#9cff93"}
            />
            <StatusBadge
              label="Avg Corr"
              value={portfolioRisk.avg_pair_correlation.toFixed(2)}
              color={portfolioRisk.avg_pair_correlation >= portfolioRisk.limits.max_avg_correlation ? "#fbbf24" : "#9cff93"}
            />
            <StatusBadge
              label="Max Corr"
              value={portfolioRisk.max_pair_correlation.toFixed(2)}
              color={portfolioRisk.max_pair_correlation >= portfolioRisk.limits.max_pair_correlation ? "#ff7162" : "#9cff93"}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded p-3" style={{ backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid rgba(72,72,73,0.2)" }}>
              <div style={{ fontSize: "9px", color: "#767576", fontFamily: "Space Grotesk", letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: "8px" }}>
                Breach Reasons
              </div>
              {portfolioRisk.breaches.length === 0 ? (
                <div style={{ fontSize: "11px", color: "#9cff93", fontFamily: "JetBrains Mono, monospace" }}>No active breaches</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {portfolioRisk.breaches.map((reason) => (
                    <span
                      key={reason}
                      className="rounded px-2 py-1"
                      style={{
                        fontSize: "9px",
                        fontFamily: "JetBrains Mono, monospace",
                        color: "#ff7162",
                        border: "1px solid rgba(255,113,98,0.35)",
                        backgroundColor: "rgba(255,113,98,0.10)",
                      }}
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ fontSize: "10px", color: "#767576", fontFamily: "JetBrains Mono, monospace", marginTop: "8px" }}>
                VaR USD: ${portfolioRisk.one_day_var_usd.toFixed(2)} @ {(portfolioRisk.var_confidence * 100).toFixed(1)}%
              </div>
            </div>

            <div className="rounded p-3" style={{ backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid rgba(72,72,73,0.2)" }}>
              <div style={{ fontSize: "9px", color: "#767576", fontFamily: "Space Grotesk", letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: "8px" }}>
                Highest Correlated Pairs
              </div>
              {(portfolioRisk.correlated_pairs ?? []).length === 0 ? (
                <div style={{ fontSize: "11px", color: "#767576", fontFamily: "JetBrains Mono, monospace" }}>Not enough open positions</div>
              ) : (
                <div className="space-y-1.5">
                  {portfolioRisk.correlated_pairs
                    .slice()
                    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
                    .slice(0, 5)
                    .map((pair) => {
                      const absCorr = Math.abs(pair.correlation);
                      const color = absCorr >= 0.9 ? "#ff7162" : absCorr >= 0.7 ? "#fbbf24" : "#9cff93";
                      return (
                        <div key={`${pair.symbol_a}-${pair.symbol_b}`} className="flex justify-between" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace" }}>
                          <span style={{ color: "#adaaab" }}>{pair.symbol_a}/{pair.symbol_b}</span>
                          <span style={{ color }}>{pair.correlation.toFixed(2)}</span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Breaker + Gate Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Breaker Detail */}
        <div className="rounded-lg p-4" style={{ backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid rgba(72,72,73,0.2)" }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined" style={{ color: levelColor, fontSize: "18px" }}>shield</span>
            <span className="font-headline font-bold text-sm" style={{ color: "#ffffff" }}>Circuit Breaker</span>
          </div>
          <div className="space-y-2" style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace" }}>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>Daily Loss Limit</span><span style={{ color: "#ffffff" }}>${breaker?.daily_loss_limit ?? 250}</span></div>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>Consecutive Losses</span><span style={{ color: (breaker?.consecutive_losses ?? 0) >= 3 ? "#ff7162" : "#ffffff" }}>{breaker?.consecutive_losses ?? 0}</span></div>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>Cooldown</span><span style={{ color: breaker?.cooldown_active ? "#fb923c" : "#9cff93" }}>{breaker?.cooldown_active ? "ACTIVE" : "None"}</span></div>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>PnL Velocity (1hr)</span><span style={{ color: (breaker?.hourly_pnl_velocity ?? 0) < 0 ? "#ff7162" : "#9cff93" }}>${(breaker?.hourly_pnl_velocity ?? 0).toFixed(2)}/hr</span></div>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>Peak Equity</span><span style={{ color: "#ffffff" }}>${(breaker?.peak_equity ?? 0).toFixed(0)}</span></div>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>Drawdown from Peak</span><span style={{ color: "#ffffff" }}>{((breaker?.drawdown_from_peak ?? 0) * 100).toFixed(2)}%</span></div>
          </div>

          {/* Breaker level bar */}
          <div className="mt-3 flex gap-1">
            {(["NORMAL", "WARNING", "THROTTLE", "HALT"] as BreakerLevel[]).map((lvl) => (
              <div key={lvl} className="flex-1 h-2 rounded-sm" style={{
                backgroundColor: breaker?.level === lvl || (["NORMAL", "WARNING", "THROTTLE", "HALT"].indexOf(lvl) <= ["NORMAL", "WARNING", "THROTTLE", "HALT"].indexOf(breaker?.level ?? "NORMAL"))
                  ? LEVEL_COLORS[lvl] : "rgba(72,72,73,0.2)",
                opacity: breaker?.level === lvl ? 1 : 0.4,
              }} />
            ))}
          </div>
          <div className="flex justify-between mt-1" style={{ fontSize: "7px", color: "#484849" }}>
            <span>NORMAL</span><span>WARNING</span><span>THROTTLE</span><span>HALT</span>
          </div>
        </div>

        {/* Gate Stats + Reconciliation */}
        <div className="rounded-lg p-4" style={{ backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid rgba(72,72,73,0.2)" }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined" style={{ color: "#67e8f9", fontSize: "18px" }}>sync</span>
            <span className="font-headline font-bold text-sm" style={{ color: "#ffffff" }}>Reconciliation & Gate</span>
          </div>
          <div className="space-y-2" style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace" }}>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>Reconciler</span><span style={{ color: status?.reconciliation?.is_running ? "#9cff93" : "#ff7162" }}>{status?.reconciliation?.is_running ? "RUNNING" : "STOPPED"}</span></div>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>Fills Today</span><span style={{ color: "#ffffff" }}>{status?.reconciliation?.fills_today ?? 0}</span></div>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>Unmatched</span><span style={{ color: (status?.reconciliation?.unmatched_fills ?? 0) > 0 ? "#fbbf24" : "#9cff93" }}>{status?.reconciliation?.unmatched_fills ?? 0}</span></div>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>Gate Trades</span><span style={{ color: "#ffffff" }}>{status?.gate_stats?.daily_trades ?? 0} / {status?.gate_stats?.max_daily_trades ?? 15}</span></div>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>Incident Level</span><span style={{ color: incidentColor }}>{incident?.level ?? "NORMAL"}</span></div>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>Incident Window</span><span style={{ color: "#ffffff" }}>{incident?.window_failures ?? 0} fail · {incident?.window_rejections ?? 0} rej · {incident?.window_slippage_spikes ?? 0} slip</span></div>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>Consecutive Failures</span><span style={{ color: (incident?.consecutive_failures ?? 0) >= 2 ? "#fb923c" : "#ffffff" }}>{incident?.consecutive_failures ?? 0}</span></div>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>Market Guard</span><span style={{ color: marketColor }}>{market?.level ?? "NORMAL"}</span></div>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>Market Window</span><span style={{ color: "#ffffff" }}>{market?.window_critical ?? 0} critical · {market?.window_warn ?? 0} warn</span></div>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>Spread / Bar Age</span><span style={{ color: "#ffffff" }}>{market?.last_evaluation?.metrics?.spread_bps !== null && market?.last_evaluation?.metrics?.spread_bps !== undefined ? `${market.last_evaluation.metrics.spread_bps.toFixed(1)}bps` : "n/a"} · {market?.last_evaluation?.metrics?.bar_age_ms !== null && market?.last_evaluation?.metrics?.bar_age_ms !== undefined ? `${Math.round(market.last_evaluation.metrics.bar_age_ms / 1000)}s` : "n/a"}</span></div>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>Idempotency</span><span style={{ color: "#ffffff" }}>{idempotency?.entries ?? 0} keys · {idempotency?.replays ?? 0} replay</span></div>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>Hit/Miss/Conflict</span><span style={{ color: "#ffffff" }}>{idempotency?.hits ?? 0}/{idempotency?.misses ?? 0}/{idempotency?.conflicts ?? 0}</span></div>
            <div className="flex justify-between"><span style={{ color: "#767576" }}>Live Key Req</span><span style={{ color: idempotency?.policy?.require_key_in_live_mode ? "#9cff93" : "#fbbf24" }}>{idempotency?.policy?.require_key_in_live_mode ? "ENFORCED" : "OPTIONAL"}</span></div>
          </div>

          {status?.last_liquidation && (
            <div className="mt-3 rounded p-2" style={{ backgroundColor: "rgba(255,113,98,0.08)", border: "1px solid rgba(255,113,98,0.2)" }}>
              <div style={{ fontSize: "8px", color: "#ff7162", fontFamily: "Space Grotesk", letterSpacing: "0.1em", textTransform: "uppercase" }}>Last Liquidation</div>
              <div style={{ fontSize: "10px", color: "#adaaab", fontFamily: "JetBrains Mono, monospace", marginTop: "4px" }}>
                {status.last_liquidation.triggered_by} · {status.last_liquidation.positions_closed} closed
                {status.last_liquidation.positions_failed > 0 && ` · ${status.last_liquidation.positions_failed} failed`}
              </div>
            </div>
          )}

          <button
            onClick={() => emergencyMutation.mutate()}
            disabled={emergencyMutation.isPending}
            className="mt-3 w-full rounded py-2 font-headline font-bold text-xs"
            style={{ backgroundColor: "rgba(255,113,98,0.1)", border: "1px solid rgba(255,113,98,0.3)", color: "#ff7162" }}
          >
            {emergencyMutation.isPending ? "LIQUIDATING..." : "EMERGENCY CLOSE ALL"}
          </button>
        </div>
      </div>

      {/* Managed Positions */}
      {positions.length > 0 && (
        <div className="rounded-lg p-4" style={{ backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid rgba(72,72,73,0.2)" }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined" style={{ color: "#fbbf24", fontSize: "18px" }}>monitoring</span>
            <span className="font-headline font-bold text-sm" style={{ color: "#ffffff" }}>Managed Positions</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace" }}>
              <thead>
                <tr style={{ color: "#767576", borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                  <th className="text-left py-2 pr-4">Symbol</th>
                  <th className="text-left py-2 pr-4">Dir</th>
                  <th className="text-right py-2 pr-4">Entry</th>
                  <th className="text-right py-2 pr-4">Stop</th>
                  <th className="text-right py-2 pr-4">Peak</th>
                  <th className="text-center py-2 pr-4">Trail</th>
                  <th className="text-right py-2 pr-4">Qty</th>
                  <th className="text-right py-2">Targets</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.symbol} style={{ borderBottom: "1px solid rgba(72,72,73,0.1)" }}>
                    <td className="py-2 pr-4 font-bold" style={{ color: "#ffffff" }}>{p.symbol}</td>
                    <td className="py-2 pr-4" style={{ color: p.direction === "long" ? "#9cff93" : "#ff7162" }}>{p.direction.toUpperCase()}</td>
                    <td className="text-right py-2 pr-4" style={{ color: "#adaaab" }}>${p.entry.toFixed(2)}</td>
                    <td className="text-right py-2 pr-4" style={{ color: "#fb923c" }}>${p.current_stop.toFixed(2)}</td>
                    <td className="text-right py-2 pr-4" style={{ color: "#67e8f9" }}>${p.peak_price.toFixed(2)}</td>
                    <td className="text-center py-2 pr-4"><span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.trail_active ? "#9cff93" : "#484849" }} /></td>
                    <td className="text-right py-2 pr-4" style={{ color: "#ffffff" }}>{p.remaining_qty}</td>
                    <td className="text-right py-2" style={{ color: "#fbbf24" }}>{p.targets_hit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Fills */}
      <div className="rounded-lg p-4" style={{ backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid rgba(72,72,73,0.2)" }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined" style={{ color: "#9cff93", fontSize: "18px" }}>receipt_long</span>
          <span className="font-headline font-bold text-sm" style={{ color: "#ffffff" }}>Recent Fills</span>
          <span style={{ fontSize: "9px", color: "#484849", fontFamily: "JetBrains Mono, monospace" }}>{fills.length} shown</span>
        </div>
        {fills.length === 0 ? (
          <div style={{ fontSize: "11px", color: "#484849", fontFamily: "Space Grotesk", padding: "16px 0", textAlign: "center" }}>
            No fills today. Reconciler polls every 10 seconds.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace" }}>
              <thead>
                <tr style={{ color: "#767576", borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                  <th className="text-left py-2 pr-4">Time</th>
                  <th className="text-left py-2 pr-4">Symbol</th>
                  <th className="text-left py-2 pr-4">Side</th>
                  <th className="text-right py-2 pr-4">Qty</th>
                  <th className="text-right py-2 pr-4">Price</th>
                  <th className="text-center py-2 pr-4">Matched</th>
                  <th className="text-right py-2">PnL</th>
                </tr>
              </thead>
              <tbody>
                {fills.map((f) => (
                  <tr key={f.fill_id} style={{ borderBottom: "1px solid rgba(72,72,73,0.1)" }}>
                    <td className="py-2 pr-4" style={{ color: "#484849" }}>{new Date(f.timestamp).toLocaleTimeString()}</td>
                    <td className="py-2 pr-4 font-bold" style={{ color: "#ffffff" }}>{f.symbol}</td>
                    <td className="py-2 pr-4" style={{ color: f.side === "buy" ? "#9cff93" : "#ff7162" }}>{f.side.toUpperCase()}</td>
                    <td className="text-right py-2 pr-4" style={{ color: "#adaaab" }}>{f.quantity}</td>
                    <td className="text-right py-2 pr-4" style={{ color: "#ffffff" }}>${f.price.toFixed(2)}</td>
                    <td className="text-center py-2 pr-4"><span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: f.matched_position ? "#9cff93" : "#fbbf24" }} /></td>
                    <td className="text-right py-2" style={{ color: f.realized_pnl !== null ? (f.realized_pnl >= 0 ? "#9cff93" : "#ff7162") : "#484849" }}>
                      {f.realized_pnl !== null ? `$${f.realized_pnl.toFixed(2)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
