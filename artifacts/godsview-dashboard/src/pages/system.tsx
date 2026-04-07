import { useEffect, useState } from "react";
import { useGetSystemStatus } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  cardHigh: "#201f21",
  border: "rgba(72,72,73,0.25)",
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  muted: "#adaaab",
  outline: "#767576",
  outlineVar: "#484849",
};

type DiagnosticsLayer = { status: "live" | "degraded" | "offline"; detail: string };
type Diagnostics = {
  system_status: string;
  timestamp: string;
  layers: Record<string, DiagnosticsLayer>;
  recommendations: string[];
};
type StreamStatus = {
  pollingMode?: boolean;
  authenticated?: boolean;
  wsState?: number;
  wsConnectedAt?: number | null;
  ticksReceived?: number;
  quotesReceived?: number;
  listenersCount?: number;
};
type RiskConfig = {
  maxRiskPerTradePct: number;
  maxDailyLossUsd: number;
  maxOpenExposurePct: number;
  maxConcurrentPositions: number;
  maxTradesPerSession: number;
  cooldownAfterLosses: number;
  cooldownMinutes: number;
  blockOnDegradedData: boolean;
  allowAsianSession: boolean;
  allowLondonSession: boolean;
  allowNySession: boolean;
  newsLockoutActive: boolean;
};
type RuntimeRiskSnapshot = {
  runtime: {
    killSwitchActive: boolean;
    updatedAt: string;
  };
  config: RiskConfig;
  fetched_at?: string;
};
type LiveRiskSnapshot = {
  accountEquityUsd: number;
  realizedPnlTodayUsd: number;
  openExposureUsd: number;
  openExposurePct: number;
  openPositions: number;
  closedTradesToday: number;
  consecutiveLosses: number;
  cooldownThreshold: number;
  cooldownMinutes: number;
  cooldownActive: boolean;
  cooldownRemainingMs: number;
  cooldownUntil: string | null;
  limits: {
    maxDailyLossUsd: number;
    maxOpenExposurePct: number;
    maxConcurrentPositions: number;
    maxTradesPerSession: number;
  };
};
type LiveRiskStatus = {
  symbol?: string;
  system_mode: string;
  trading_kill_switch: boolean;
  live_writes_enabled: boolean;
  active_session?: "Asian" | "London" | "NY";
  session_allowed?: boolean;
  news_lockout_active?: boolean;
  gate_state: "PASS" | "BLOCKED_BY_RISK";
  gate_reasons?: string[];
  data_health?: {
    healthy: boolean;
    reasons: string[];
    latestBarAgeMs: number | null;
    lastBarTime: string | null;
  } | null;
  risk: LiveRiskSnapshot;
};
type AuditEventRow = {
  id: number;
  event_type: string;
  decision_state: string | null;
  symbol: string | null;
  reason: string | null;
  created_at: string;
};
type AuditResponse = {
  events: AuditEventRow[];
  count: number;
  limit: number;
  fetched_at: string;
};
type AuditSummary = {
  hours: number;
  since: string;
  totals: {
    events: number;
    trade: number;
    blocked: number;
    rejected: number;
    degraded: number;
    pass: number;
  };
  top_reasons: Array<{ reason: string; count: number }>;
  top_event_types: Array<{ event_type: string; count: number }>;
  fetched_at: string;
};
type ProofBucketRow = {
  key: string;
  totalSignals: number;
  closedSignals: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
  avgFinalQuality: number;
};
type ProofResponse = {
  days: number;
  since: string;
  totalRows: number;
  minSignals: number;
  overall: {
    totalSignals: number;
    closedSignals: number;
    wins: number;
    losses: number;
    winRate: number;
    profitFactor: number;
    expectancyR: number;
    avgFinalQuality: number;
  };
  rows: ProofBucketRow[];
  fetched_at: string;
};
type OosResponse = {
  lookbackDays: number;
  oosDays: number;
  deltas: {
    winRateDelta: number;
    expectancyDeltaR: number;
    avgFinalQualityDelta: number;
  };
};
type ModelDiagnostics = {
  status: {
    status: "active" | "warning" | "error";
    message: string;
    meta: {
      samples: number;
      accuracy: number;
      auc: number;
      winRate: number;
      purgedCv: {
        folds: number;
        embargoPct: number;
        purgeWindow: number;
        evaluatedSamples: number;
        accuracy: number;
        auc: number;
      } | null;
      trainedAt: string;
    } | null;
  };
  validation: {
    folds: number;
    embargoPct: number;
    purgeWindow: number;
    evaluatedSamples: number;
    accuracy: number;
    auc: number;
  } | null;
  drift: {
    status: "stable" | "watch" | "drift";
    sampleRecent: number;
    sampleBaseline: number;
    recentWinRate: number;
    baselineWinRate: number;
    winRateDelta: number;
    recentAvgQuality: number;
    baselineAvgQuality: number;
    qualityDelta: number;
    computedAt: string;
  } | null;
  fetched_at: string;
};
type GovernanceCheck = {
  id: string;
  label: string;
  pass: boolean;
  actual: string | number | boolean;
  target: string | number | boolean;
};
type GovernanceOverview = {
  pass: boolean;
  status: "market_ready" | "needs_work";
  generated_at: string;
  strict_thresholds: {
    min_closed_trades: number;
    min_profit_factor: number;
    min_expectancy_r: number;
    max_drawdown_pct: number;
    min_win_rate: number;
  };
  strategy_control: {
    status: string;
    promotion_ready: boolean;
    reasons: string[];
  };
  metrics: {
    trades: number;
    closed_trades: number;
    wins: number;
    losses: number;
    win_rate: number;
    profit_factor: number;
    expectancy_r: number;
    max_drawdown_pct: number;
    total_pnl_pct: number;
  };
  daily_report: {
    date: string;
    symbol: string;
    trades_taken: number;
    trades_skipped_or_blocked: number;
    system_health: string;
    top_reasons: Array<{ reason: string; count: number }>;
  };
  checks: GovernanceCheck[];
  reasons: string[];
  sources: {
    orchestrator: {
      exists: boolean;
      path: string;
      generated_at: string | null;
      error: string | null;
    };
    replay: {
      exists: boolean;
      path: string;
      generated_at: string | null;
      error: string | null;
    };
    daily_report: {
      exists: boolean;
      path: string;
      generated_at: string | null;
      error: string | null;
    };
  };
};
type PipelineStage = {
  id: string;
  label: string;
  status: string;
  details: Record<string, unknown>;
};
type PipelineTraceResponse = {
  has_data: boolean;
  generated_at: string;
  symbol: string;
  live: boolean;
  dry_run: boolean;
  human_approval: boolean;
  blocked: boolean;
  block_reason: string;
  errors: string[];
  failed_stages: string[];
  stages: PipelineStage[];
  summary: {
    signal: {
      action: string;
      setup: string;
      confidence: number;
      close_price: number;
    };
    hard_gates: {
      pass: boolean;
      failed_reasons: string[];
      pass_ratio: number;
    };
    scoring: {
      pass: boolean;
      final_score: number;
      grade: string;
      reasons: string[];
    };
    reasoning: {
      approved: boolean;
      final_action: string;
      final_score: number;
      reasons: string[];
      challenge_points: string[];
    };
    risk: {
      allowed: boolean;
      reason: string;
      qty: number;
    };
    execution: {
      status: string;
      side: string;
      qty: number;
      order_id: string;
    };
    monitor: {
      recorded_at: string;
      trade_outcome: string;
    };
  };
  review_snapshot: Record<string, unknown> | null;
  sources: {
    orchestrator: {
      exists: boolean;
      path: string;
      error: string | null;
    };
    review_snapshot: {
      exists: boolean;
      path: string;
      error: string | null;
    };
  };
  fetched_at: string;
};
type ConsciousnessBoardRow = {
  symbol: string;
  attention_score: number;
  readiness: "allow" | "watch" | "block";
  setup_family: string;
  direction: "long" | "short" | "none";
  structure_score: number;
  orderflow_score: number;
  context_score: number;
  memory_score: number;
  reasoning_score: number;
  risk_score: number;
  reasoning_verdict: string;
  risk_state: "allowed" | "blocked";
  block_reason: string;
};
type ConsciousnessSnapshot = {
  has_data: boolean;
  generated_at: string;
  board: ConsciousnessBoardRow[];
  fetched_at: string;
  source: {
    exists: boolean;
    path: string;
    error: string | null;
  };
};
type BrainCycleResponse = {
  ok: boolean;
  symbol: string;
  command: string;
  stdout?: string;
  stderr?: string;
  snapshot_generated_at?: string;
  blocked?: boolean;
  block_reason?: string;
  mode?: string;
};
type RecallRefreshResponse = {
  ok: boolean;
  symbol: string;
  with_replay: boolean;
  blocked?: boolean;
  block_reason?: string;
  recall_context_ready: boolean;
  generated_at: string;
  stderr?: string;
};

const LAYER_LABELS: Record<string, string> = {
  data_feed: "Data Feed (Alpaca)",
  trading_api: "Trading API Keys",
  strategy_engine: "Strategy Engine",
  database: "PostgreSQL Database",
  recall_engine: "Recall / Accuracy DB",
  ml_model: "ML Model Layer",
  claude_reasoning: "Claude Reasoning",
};

const LAYER_ICONS: Record<string, string> = {
  data_feed: "wifi",
  trading_api: "vpn_key",
  strategy_engine: "account_tree",
  database: "storage",
  recall_engine: "psychology",
  ml_model: "smart_toy",
  claude_reasoning: "auto_awesome",
};

function MicroLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", color: C.outline }}>{children}</span>;
}

function StatusPill({ status }: { status: string }) {
  const color = status === "live" ? C.primary : status === "degraded" ? "#fbbf24" : C.tertiary;
  return (
    <span className="px-2 py-0.5 rounded" style={{
      fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
      backgroundColor: `${color}12`, color, border: `1px solid ${color}30`,
    }}>
      {status}
    </span>
  );
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const PIPELINE_ICONS = ["sensors", "account_tree", "psychology", "smart_toy", "auto_awesome", "shield"];

export default function System() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetSystemStatus();
  const { data: diag, isLoading: diagLoading, refetch: refetchDiag } = useQuery<Diagnostics>({
    queryKey: ["diagnostics"],
    queryFn: () => fetch("/api/system/diagnostics").then((r) => r.json()),
    refetchInterval: 30000,
  });
  const { data: streamStatus } = useQuery<StreamStatus>({
    queryKey: ["stream-status"],
    queryFn: () => fetch("/api/alpaca/stream-status").then((r) => r.json()),
    refetchInterval: 30_000,
    staleTime: 25_000,
  });
  const { data: riskSnapshot, isLoading: riskLoading } = useQuery<RuntimeRiskSnapshot>({
    queryKey: ["system-risk-controls"],
    queryFn: async () => {
      const r = await fetch("/api/system/risk");
      if (!r.ok) throw new Error(`risk controls fetch failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
  });
  const { data: liveRisk } = useQuery<LiveRiskStatus>({
    queryKey: ["live-risk-status"],
    queryFn: async () => {
      const r = await fetch("/api/alpaca/risk/status");
      if (!r.ok) throw new Error(`live risk status fetch failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const { data: audit } = useQuery<AuditResponse>({
    queryKey: ["system-audit-feed"],
    queryFn: async () => {
      const r = await fetch("/api/system/audit?limit=12");
      if (!r.ok) throw new Error(`audit feed fetch failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 20_000,
    staleTime: 15_000,
  });
  const { data: auditSummary } = useQuery<AuditSummary>({
    queryKey: ["system-audit-summary"],
    queryFn: async () => {
      const r = await fetch("/api/system/audit/summary?hours=24");
      if (!r.ok) throw new Error(`audit summary fetch failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  const { data: modelDiagnostics } = useQuery<ModelDiagnostics>({
    queryKey: ["system-model-diagnostics"],
    queryFn: async () => {
      const r = await fetch("/api/system/model/diagnostics");
      if (!r.ok) throw new Error(`model diagnostics fetch failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 45_000,
    staleTime: 30_000,
  });
  const { data: proofBySetup } = useQuery<ProofResponse>({
    queryKey: ["proof-by-setup"],
    queryFn: async () => {
      const r = await fetch("/api/system/proof/by-setup?days=30&min_signals=20");
      if (!r.ok) throw new Error(`proof by setup fetch failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
  });
  const { data: proofByRegime } = useQuery<ProofResponse>({
    queryKey: ["proof-by-regime"],
    queryFn: async () => {
      const r = await fetch("/api/system/proof/by-regime?days=30&min_signals=20");
      if (!r.ok) throw new Error(`proof by regime fetch failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
  });
  const { data: oosProof } = useQuery<OosResponse>({
    queryKey: ["proof-oos-vs-is"],
    queryFn: async () => {
      const r = await fetch("/api/system/proof/oos-vs-is?lookback_days=90&oos_days=14&min_signals=20");
      if (!r.ok) throw new Error(`proof oos fetch failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
  });
  const { data: governanceOverview } = useQuery<GovernanceOverview>({
    queryKey: ["system-governance-overview"],
    queryFn: async () => {
      const r = await fetch("/api/system/governance/overview");
      if (!r.ok) throw new Error(`governance overview fetch failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 45_000,
    staleTime: 30_000,
  });
  const { data: pipelineTrace } = useQuery<PipelineTraceResponse>({
    queryKey: ["system-pipeline-trace"],
    queryFn: async () => {
      const r = await fetch("/api/system/pipeline/latest");
      if (!r.ok) throw new Error(`pipeline trace fetch failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 20_000,
    staleTime: 12_000,
  });
  const { data: consciousness } = useQuery<ConsciousnessSnapshot>({
    queryKey: ["system-consciousness-latest"],
    queryFn: async () => {
      const r = await fetch("/api/system/consciousness/latest");
      if (!r.ok) throw new Error(`consciousness snapshot fetch failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 20_000,
    staleTime: 12_000,
  });
  const [brainCycleFeedback, setBrainCycleFeedback] = useState<BrainCycleResponse | null>(null);
  const [recallRefreshFeedback, setRecallRefreshFeedback] = useState<RecallRefreshResponse | null>(null);
  const [draft, setDraft] = useState<RiskConfig | null>(null);
  useEffect(() => {
    if (riskSnapshot && !draft) {
      setDraft(riskSnapshot.config);
    }
  }, [riskSnapshot, draft]);

  const retrainMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/system/retrain", { method: "POST" });
      if (!r.ok) throw new Error(`retrain failed: ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["diagnostics"] });
      queryClient.invalidateQueries({ queryKey: ["system-status"] });
      queryClient.invalidateQueries({ queryKey: ["system-model-diagnostics"] });
      queryClient.invalidateQueries({ queryKey: ["proof-by-setup"] });
      queryClient.invalidateQueries({ queryKey: ["proof-by-regime"] });
      queryClient.invalidateQueries({ queryKey: ["proof-oos-vs-is"] });
      queryClient.invalidateQueries({ queryKey: ["system-governance-overview"] });
      queryClient.invalidateQueries({ queryKey: ["system-pipeline-trace"] });
      queryClient.invalidateQueries({ queryKey: ["system-consciousness-latest"] });
    },
  });
  const toggleKillSwitchMutation = useMutation({
    mutationFn: async (active: boolean) => {
      const r = await fetch("/api/system/kill-switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!r.ok) throw new Error(`kill switch update failed: ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-risk-controls"] });
      queryClient.invalidateQueries({ queryKey: ["system-status"] });
      queryClient.invalidateQueries({ queryKey: ["live-risk-status"] });
      queryClient.invalidateQueries({ queryKey: ["system-audit-summary"] });
      queryClient.invalidateQueries({ queryKey: ["system-governance-overview"] });
      queryClient.invalidateQueries({ queryKey: ["system-pipeline-trace"] });
      queryClient.invalidateQueries({ queryKey: ["system-consciousness-latest"] });
    },
  });
  const saveRiskMutation = useMutation({
    mutationFn: async (payload: RiskConfig) => {
      const r = await fetch("/api/system/risk", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`risk controls save failed: ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-risk-controls"] });
      queryClient.invalidateQueries({ queryKey: ["live-risk-status"] });
      queryClient.invalidateQueries({ queryKey: ["system-audit-summary"] });
      queryClient.invalidateQueries({ queryKey: ["system-governance-overview"] });
      queryClient.invalidateQueries({ queryKey: ["system-pipeline-trace"] });
      queryClient.invalidateQueries({ queryKey: ["system-consciousness-latest"] });
    },
  });
  const resetRuntimeMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/system/risk/reset", { method: "POST" });
      if (!r.ok) throw new Error(`risk runtime reset failed: ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-risk-controls"] });
      queryClient.invalidateQueries({ queryKey: ["live-risk-status"] });
      queryClient.invalidateQueries({ queryKey: ["system-audit-summary"] });
      queryClient.invalidateQueries({ queryKey: ["system-governance-overview"] });
      queryClient.invalidateQueries({ queryKey: ["system-pipeline-trace"] });
      queryClient.invalidateQueries({ queryKey: ["system-consciousness-latest"] });
    },
  });
  const brainUpdateMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/brain/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: data?.active_instrument || "AAPL", dry_run: true, with_replay: false }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.message || `brain update failed: ${r.status}`);
      return body as BrainCycleResponse;
    },
    onSuccess: (payload) => {
      setBrainCycleFeedback(payload);
      queryClient.invalidateQueries({ queryKey: ["system-consciousness-latest"] });
      queryClient.invalidateQueries({ queryKey: ["system-pipeline-trace"] });
      queryClient.invalidateQueries({ queryKey: ["system-governance-overview"] });
    },
  });
  const brainEvolveMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/brain/evolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: data?.active_instrument || "AAPL" }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.message || `brain evolve failed: ${r.status}`);
      return body as BrainCycleResponse;
    },
    onSuccess: (payload) => {
      setBrainCycleFeedback(payload);
      queryClient.invalidateQueries({ queryKey: ["system-consciousness-latest"] });
      queryClient.invalidateQueries({ queryKey: ["system-pipeline-trace"] });
      queryClient.invalidateQueries({ queryKey: ["system-governance-overview"] });
    },
  });
  const recallRefreshMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/system/recall/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: data?.active_instrument || "AAPL",
          with_replay: true,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.message || `recall refresh failed: ${r.status}`);
      return body as RecallRefreshResponse;
    },
    onSuccess: (payload) => {
      setRecallRefreshFeedback(payload);
      queryClient.invalidateQueries({ queryKey: ["system-status"] });
      queryClient.invalidateQueries({ queryKey: ["diagnostics"] });
      queryClient.invalidateQueries({ queryKey: ["system-pipeline-trace"] });
      queryClient.invalidateQueries({ queryKey: ["system-consciousness-latest"] });
      queryClient.invalidateQueries({ queryKey: ["system-governance-overview"] });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: C.primary }} />
      </div>
    );
  }

  const healthy = data.overall === "healthy";
  const wsHealthy = Boolean(!streamStatus?.pollingMode && streamStatus?.authenticated && streamStatus?.wsState === 1);
  const killSwitchActive = Boolean(riskSnapshot?.runtime.killSwitchActive);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: "6px" }}>
          Godsview · System Diagnostics
        </div>
        <h1 className="font-headline font-bold text-2xl tracking-tight">System Core</h1>
      </div>

      {/* Global Status Hero */}
      <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${healthy ? "rgba(156,255,147,0.15)" : "rgba(255,113,98,0.15)"}` }}>
        <div className="h-0.5 w-full" style={{ backgroundColor: healthy ? C.primary : C.tertiary, boxShadow: `0 0 8px ${healthy ? C.primary : C.tertiary}` }} />
        <div className="p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <MicroLabel>Global Engine Status</MicroLabel>
            <div className="flex items-center gap-3 mt-2">
              <span className="w-3 h-3 rounded-full animate-pulse" style={{ backgroundColor: healthy ? C.primary : C.tertiary }} />
              <span className="font-headline font-bold text-3xl tracking-tight uppercase" style={{ color: healthy ? C.primary : C.tertiary }}>
                {data.overall}
              </span>
            </div>
          </div>
          <div className="flex gap-8">
            <div>
              <MicroLabel>Active Target</MicroLabel>
              <div className="font-headline font-bold text-lg mt-1" style={{ color: C.primary }}>{data.active_instrument || "Awaiting Scan"}</div>
            </div>
            <div>
              <MicroLabel>Session</MicroLabel>
              <div className="font-headline font-bold text-lg mt-1">{data.active_session || "None"}</div>
            </div>
          </div>
        </div>
      </div>

      {/* News Lockout */}
      {data.news_lockout_active && (
        <div className="rounded p-4 flex items-center gap-4" style={{ backgroundColor: "rgba(255,113,98,0.08)", border: "1px solid rgba(255,113,98,0.25)" }}>
          <span className="material-symbols-outlined" style={{ color: C.tertiary }}>warning</span>
          <div>
            <div className="font-headline font-bold" style={{ color: C.tertiary, fontSize: "11px", letterSpacing: "0.1em" }}>NEWS LOCKOUT ACTIVE</div>
            <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>Trading disabled — high-impact economic event window.</div>
          </div>
        </div>
      )}

      {/* Stream Core Health */}
      <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${wsHealthy ? "rgba(156,255,147,0.16)" : "rgba(251,191,36,0.22)"}` }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: "14px", color: wsHealthy ? C.primary : "#fbbf24" }}>hub</span>
            <MicroLabel>Realtime Stream Core</MicroLabel>
            <StatusPill status={wsHealthy ? "live" : "degraded"} />
          </div>
          <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
            ticks {streamStatus?.ticksReceived ?? 0} · quotes {streamStatus?.quotesReceived ?? 0}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
            <MicroLabel>Transport</MicroLabel>
            <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: wsHealthy ? C.primary : "#fbbf24" }}>
              {wsHealthy ? "WebSocket" : "REST Fallback"}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
            <MicroLabel>Auth</MicroLabel>
            <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: streamStatus?.authenticated ? C.primary : C.tertiary }}>
              {streamStatus?.authenticated ? "OK" : "PENDING"}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
            <MicroLabel>WS State</MicroLabel>
            <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
              {streamStatus?.wsState ?? "-"}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
            <MicroLabel>Listeners</MicroLabel>
            <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.secondary }}>
              {streamStatus?.listenersCount ?? 0}
            </div>
          </div>
        </div>
      </div>

      {/* Proof + Drift */}
      <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: "14px", color: C.secondary }}>analytics</span>
            <MicroLabel>Proof Of Edge + Drift</MicroLabel>
          </div>
          <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
            {modelDiagnostics?.drift?.computedAt ? format(new Date(modelDiagnostics.drift.computedAt), "HH:mm:ss") : "n/a"}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
            <MicroLabel>Model</MicroLabel>
            <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: modelDiagnostics?.status.status === "active" ? C.primary : modelDiagnostics?.status.status === "warning" ? "#fbbf24" : C.tertiary }}>
              {(modelDiagnostics?.status.status ?? "unknown").toUpperCase()}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
            <MicroLabel>Purged CV AUC</MicroLabel>
            <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.secondary }}>
              {modelDiagnostics?.validation ? modelDiagnostics.validation.auc.toFixed(3) : "n/a"}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
            <MicroLabel>Drift Status</MicroLabel>
            <div style={{
              marginTop: "6px",
              fontSize: "10px",
              fontFamily: "JetBrains Mono, monospace",
              color: modelDiagnostics?.drift?.status === "drift" ? C.tertiary : modelDiagnostics?.drift?.status === "watch" ? "#fbbf24" : C.primary,
            }}>
              {(modelDiagnostics?.drift?.status ?? "n/a").toUpperCase()}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
            <MicroLabel>OOS Win Δ</MicroLabel>
            <div style={{
              marginTop: "6px",
              fontSize: "10px",
              fontFamily: "JetBrains Mono, monospace",
              color: (oosProof?.deltas.winRateDelta ?? 0) >= 0 ? C.primary : C.tertiary,
            }}>
              {oosProof ? `${(oosProof.deltas.winRateDelta * 100).toFixed(2)}%` : "n/a"}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
          <div className="rounded p-3" style={{ backgroundColor: "#0f0f10", border: `1px solid ${C.border}` }}>
            <div className="flex items-center justify-between mb-2">
              <MicroLabel>Top Setups (30d)</MicroLabel>
              <span style={{ fontSize: "9px", color: C.outlineVar, fontFamily: "JetBrains Mono, monospace" }}>
                {proofBySetup?.overall.closedSignals ?? 0} closed
              </span>
            </div>
            <div className="space-y-1.5">
              {(proofBySetup?.rows ?? []).slice(0, 5).map((row: any) => (
                <div key={row.key} className="rounded px-2 py-1.5 flex items-center justify-between" style={{ border: `1px solid ${C.border}`, backgroundColor: "#131314" }}>
                  <div>
                    <div style={{ fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 700 }}>{row.key.replace(/_/g, " ")}</div>
                    <div style={{ fontSize: "9px", color: C.muted, fontFamily: "JetBrains Mono, monospace" }}>
                      {(row.winRate * 100).toFixed(1)}% win · PF {row.profitFactor.toFixed(2)}
                    </div>
                  </div>
                  <span style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: row.expectancyR >= 0 ? C.primary : C.tertiary }}>
                    {row.expectancyR >= 0 ? "+" : ""}{row.expectancyR.toFixed(2)}R
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded p-3" style={{ backgroundColor: "#0f0f10", border: `1px solid ${C.border}` }}>
            <div className="flex items-center justify-between mb-2">
              <MicroLabel>Top Regimes (30d)</MicroLabel>
              <span style={{ fontSize: "9px", color: C.outlineVar, fontFamily: "JetBrains Mono, monospace" }}>
                {proofByRegime?.overall.closedSignals ?? 0} closed
              </span>
            </div>
            <div className="space-y-1.5">
              {(proofByRegime?.rows ?? []).slice(0, 5).map((row: any) => (
                <div key={row.key} className="rounded px-2 py-1.5 flex items-center justify-between" style={{ border: `1px solid ${C.border}`, backgroundColor: "#131314" }}>
                  <div>
                    <div style={{ fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 700 }}>{row.key.replace(/_/g, " ")}</div>
                    <div style={{ fontSize: "9px", color: C.muted, fontFamily: "JetBrains Mono, monospace" }}>
                      {(row.winRate * 100).toFixed(1)}% win · PF {row.profitFactor.toFixed(2)}
                    </div>
                  </div>
                  <span style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: row.expectancyR >= 0 ? C.primary : C.tertiary }}>
                    {row.expectancyR >= 0 ? "+" : ""}{row.expectancyR.toFixed(2)}R
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ML Auto-Retrain Scheduler */}
      <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: "14px", color: data.ml_scheduler?.running ? C.primary : C.outline }}>model_training</span>
            <MicroLabel>ML Auto-Retrain Scheduler</MicroLabel>
            <StatusPill status={data.ml_scheduler?.running ? "live" : "degraded"} />
            {data.ml_scheduler?.isRetraining && (
              <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: "#fbbf24", animation: "pulse 1.5s infinite" }}>
                ● RETRAINING…
              </span>
            )}
          </div>
          <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
            threshold {data.ml_scheduler?.newDataThreshold ?? 100} rows · poll {Math.round((data.ml_scheduler?.pollIntervalMs ?? 1800000) / 60000)}m
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
            <MicroLabel>Scheduler State</MicroLabel>
            <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: data.ml_scheduler?.running ? C.primary : C.tertiary }}>
              {data.ml_scheduler?.running ? "RUNNING" : "STOPPED"}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
            <MicroLabel>Total Retrains</MicroLabel>
            <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.secondary }}>
              {data.ml_scheduler?.totalRetrains ?? 0}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
            <MicroLabel>High Water Mark</MicroLabel>
            <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
              {data.ml_scheduler?.highWaterMark ?? 0} rows
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
            <MicroLabel>Last Retrain</MicroLabel>
            <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
              {data.ml_scheduler?.lastTrainedAt
                ? format(new Date(data.ml_scheduler.lastTrainedAt), "HH:mm:ss")
                : "n/a"}
            </div>
          </div>
        </div>
      </div>

      {/* Governance Readiness */}
      <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: "14px", color: governanceOverview?.pass ? C.primary : "#fbbf24" }}>gavel</span>
            <MicroLabel>Governance Readiness</MicroLabel>
            <StatusPill status={governanceOverview?.pass ? "live" : "degraded"} />
          </div>
          <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
            {governanceOverview?.generated_at ? format(new Date(governanceOverview.generated_at), "HH:mm:ss") : "n/a"}
          </span>
        </div>
        {governanceOverview ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
                <MicroLabel>Strategy State</MicroLabel>
                <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: governanceOverview.strategy_control.status === "ACTIVE" ? C.primary : governanceOverview.strategy_control.status === "WEAK" ? "#fbbf24" : C.tertiary }}>
                  {governanceOverview.strategy_control.status}
                </div>
              </div>
              <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
                <MicroLabel>Closed Trades</MicroLabel>
                <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.secondary }}>
                  {governanceOverview.metrics.closed_trades}
                </div>
              </div>
              <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
                <MicroLabel>Profit Factor</MicroLabel>
                <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: governanceOverview.metrics.profit_factor >= governanceOverview.strict_thresholds.min_profit_factor ? C.primary : C.tertiary }}>
                  {governanceOverview.metrics.profit_factor.toFixed(3)}
                </div>
              </div>
              <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
                <MicroLabel>Max Drawdown</MicroLabel>
                <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: governanceOverview.metrics.max_drawdown_pct <= governanceOverview.strict_thresholds.max_drawdown_pct ? C.primary : C.tertiary }}>
                  {governanceOverview.metrics.max_drawdown_pct.toFixed(2)}%
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
              <div className="rounded p-3" style={{ backgroundColor: "#0f0f10", border: `1px solid ${C.border}` }}>
                <div className="flex items-center justify-between mb-2">
                  <MicroLabel>Strict Checks</MicroLabel>
                  <span style={{ fontSize: "9px", color: C.outlineVar, fontFamily: "JetBrains Mono, monospace" }}>
                    {governanceOverview.checks.filter((c: any) => c.pass).length}/{governanceOverview.checks.length} pass
                  </span>
                </div>
                <div className="space-y-1.5">
                  {governanceOverview.checks.map((check: any) => (
                    <div key={check.id} className="rounded px-2 py-1.5 flex items-center justify-between" style={{ border: `1px solid ${C.border}`, backgroundColor: "#131314" }}>
                      <div>
                        <div style={{ fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 700 }}>{check.label}</div>
                        <div style={{ fontSize: "9px", color: C.muted, fontFamily: "JetBrains Mono, monospace" }}>
                          actual {String(check.actual)} · target {String(check.target)}
                        </div>
                      </div>
                      <StatusPill status={check.pass ? "live" : "degraded"} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded p-3" style={{ backgroundColor: "#0f0f10", border: `1px solid ${C.border}` }}>
                <div className="flex items-center justify-between mb-2">
                  <MicroLabel>Data Sources</MicroLabel>
                  <span style={{ fontSize: "9px", color: C.outlineVar, fontFamily: "JetBrains Mono, monospace" }}>
                    latest artifacts
                  </span>
                </div>
                <div className="space-y-1.5">
                  {Object.entries(governanceOverview.sources).map(([key, source]) => (
                    <div key={key} className="rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#131314" }}>
                      <div className="flex items-center justify-between">
                        <span style={{ fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 700 }}>{key.replace(/_/g, " ")}</span>
                        <StatusPill status={source.exists ? "live" : "offline"} />
                      </div>
                      <div style={{ fontSize: "9px", color: C.muted, fontFamily: "JetBrains Mono, monospace", marginTop: "2px" }}>
                        {source.generated_at ? format(new Date(source.generated_at), "yyyy-MM-dd HH:mm:ss") : "not generated"}
                      </div>
                      {!source.exists && source.error && (
                        <div style={{ fontSize: "9px", color: "#fbbf24", fontFamily: "JetBrains Mono, monospace", marginTop: "2px" }}>
                          {source.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {governanceOverview.reasons.length > 0 && (
                  <div className="mt-2 text-[9px]" style={{ color: C.muted }}>
                    Reasons: {governanceOverview.reasons.slice(0, 8).join(", ")}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="text-xs" style={{ color: C.muted }}>
            Governance overview unavailable.
          </div>
        )}
      </div>

      {/* Latest Pipeline Trace */}
      <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: "14px", color: pipelineTrace?.blocked ? "#fbbf24" : C.primary }}>route</span>
            <MicroLabel>Latest Pipeline Trace</MicroLabel>
            <StatusPill status={pipelineTrace && !pipelineTrace.blocked && (pipelineTrace.failed_stages?.length ?? 0) === 0 ? "live" : "degraded"} />
          </div>
          <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
            {pipelineTrace?.generated_at ? format(new Date(pipelineTrace.generated_at), "HH:mm:ss") : "n/a"}
          </span>
        </div>
        {pipelineTrace?.has_data ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
                <MicroLabel>Symbol</MicroLabel>
                <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.secondary }}>
                  {pipelineTrace.symbol || "n/a"}
                </div>
              </div>
              <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
                <MicroLabel>Execution Mode</MicroLabel>
                <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: pipelineTrace.live ? "#fbbf24" : C.primary }}>
                  {pipelineTrace.live ? "LIVE" : "PAPER"}
                </div>
              </div>
              <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
                <MicroLabel>Score / Grade</MicroLabel>
                <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: pipelineTrace.summary.scoring.pass ? C.primary : C.tertiary }}>
                  {pipelineTrace.summary.scoring.final_score.toFixed(3)} · {pipelineTrace.summary.scoring.grade}
                </div>
              </div>
              <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
                <MicroLabel>Execution Status</MicroLabel>
                <div style={{ marginTop: "6px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: pipelineTrace.summary.execution.status === "submitted" || pipelineTrace.summary.execution.status === "simulated" ? C.primary : "#fbbf24" }}>
                  {pipelineTrace.summary.execution.status}
                </div>
              </div>
            </div>
            <div className="mt-3 rounded p-3" style={{ backgroundColor: "#0f0f10", border: `1px solid ${C.border}` }}>
              <div className="flex items-center justify-between mb-2">
                <MicroLabel>Stage Outcomes</MicroLabel>
                <span style={{ fontSize: "9px", color: C.outlineVar, fontFamily: "JetBrains Mono, monospace" }}>
                  failed: {pipelineTrace.failed_stages.length}
                </span>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-1.5">
                {pipelineTrace.stages.map((stage: any) => {
                  const normalized = stage.status.toLowerCase();
                  const status = normalized === "pass" || normalized === "submitted" || normalized === "simulated"
                    ? "live"
                    : normalized === "unknown"
                    ? "offline"
                    : "degraded";
                  return (
                    <div key={stage.id} className="rounded px-2 py-1.5 flex items-center justify-between" style={{ border: `1px solid ${C.border}`, backgroundColor: "#131314" }}>
                      <div>
                        <div style={{ fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 700 }}>{stage.label}</div>
                        <div style={{ fontSize: "9px", color: C.muted, fontFamily: "JetBrains Mono, monospace" }}>
                          {stage.status}
                        </div>
                      </div>
                      <StatusPill status={status} />
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
              <div className="rounded p-3" style={{ backgroundColor: "#0f0f10", border: `1px solid ${C.border}` }}>
                <MicroLabel>Decision Summary</MicroLabel>
                <div className="mt-2 text-[10px] font-mono" style={{ color: C.muted }}>
                  {pipelineTrace.summary.signal.action} · {pipelineTrace.summary.signal.setup} · conf {(pipelineTrace.summary.signal.confidence * 100).toFixed(1)}%
                </div>
                <div className="mt-1 text-[10px] font-mono" style={{ color: pipelineTrace.summary.reasoning.approved ? C.primary : C.tertiary }}>
                  reasoner: {pipelineTrace.summary.reasoning.final_action} · score {pipelineTrace.summary.reasoning.final_score.toFixed(3)}
                </div>
                <div className="mt-1 text-[10px] font-mono" style={{ color: pipelineTrace.summary.risk.allowed ? C.primary : C.tertiary }}>
                  risk: {pipelineTrace.summary.risk.allowed ? "allowed" : "blocked"} · qty {pipelineTrace.summary.risk.qty}
                </div>
                {pipelineTrace.block_reason && (
                  <div className="mt-1 text-[10px] font-mono" style={{ color: "#fbbf24" }}>
                    block reason: {pipelineTrace.block_reason}
                  </div>
                )}
              </div>
              <div className="rounded p-3" style={{ backgroundColor: "#0f0f10", border: `1px solid ${C.border}` }}>
                <MicroLabel>Trace Sources</MicroLabel>
                <div className="space-y-1.5 mt-2">
                  {Object.entries(pipelineTrace.sources).map(([key, source]) => (
                    <div key={key} className="rounded px-2 py-1.5 flex items-center justify-between" style={{ border: `1px solid ${C.border}`, backgroundColor: "#131314" }}>
                      <span style={{ fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 700 }}>{key.replace(/_/g, " ")}</span>
                      <StatusPill status={source.exists ? "live" : "offline"} />
                    </div>
                  ))}
                </div>
                {(pipelineTrace.summary.reasoning.challenge_points?.length ?? 0) > 0 && (
                  <div className="mt-2 text-[9px]" style={{ color: C.muted }}>
                    challenge points: {pipelineTrace.summary.reasoning.challenge_points.join(", ")}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="text-xs" style={{ color: C.muted }}>
            Pipeline trace unavailable. Run orchestrator to generate `latest_orchestrator_run.json`.
          </div>
        )}
      </div>

      {/* Consciousness Board */}
      <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: "14px", color: C.secondary }}>psychology_alt</span>
            <MicroLabel>Consciousness Board</MicroLabel>
            <StatusPill status={consciousness?.has_data ? "live" : "offline"} />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => brainUpdateMutation.mutate()}
              disabled={brainUpdateMutation.isPending || brainEvolveMutation.isPending}
              className="rounded px-2 py-1 text-[9px]"
              style={{ border: `1px solid ${C.border}`, color: C.secondary }}
            >
              {brainUpdateMutation.isPending ? "UPDATING..." : "UPDATE"}
            </button>
            <button
              onClick={() => brainEvolveMutation.mutate()}
              disabled={brainUpdateMutation.isPending || brainEvolveMutation.isPending}
              className="rounded px-2 py-1 text-[9px]"
              style={{ border: `1px solid ${C.border}`, color: C.primary }}
            >
              {brainEvolveMutation.isPending ? "EVOLVING..." : "EVOLVE"}
            </button>
            <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
              {consciousness?.generated_at ? format(new Date(consciousness.generated_at), "HH:mm:ss") : "n/a"}
            </span>
          </div>
        </div>
        {brainCycleFeedback && (
          <div className="mb-3 rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#101011" }}>
            <div style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: brainCycleFeedback.ok ? C.primary : C.tertiary }}>
              cycle {brainCycleFeedback.ok ? "ok" : "failed"} · {brainCycleFeedback.symbol} · {brainCycleFeedback.blocked ? `blocked (${brainCycleFeedback.block_reason || "n/a"})` : "not blocked"}
            </div>
          </div>
        )}
        {(brainUpdateMutation.error || brainEvolveMutation.error) && (
          <div className="mb-3 text-[9px]" style={{ color: C.tertiary }}>
            {(brainUpdateMutation.error as Error | null)?.message || (brainEvolveMutation.error as Error | null)?.message}
          </div>
        )}
        {consciousness?.has_data ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {(consciousness.board ?? []).map((row: any) => {
              const readinessColor = row.readiness === "allow" ? C.primary : row.readiness === "watch" ? "#fbbf24" : C.tertiary;
              const directionColor = row.direction === "long" ? C.primary : row.direction === "short" ? C.tertiary : C.muted;
              return (
                <div key={row.symbol} className="rounded p-3" style={{ backgroundColor: "#0f0f10", border: `1px solid ${C.border}` }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div style={{ fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 700 }}>{row.symbol}</div>
                      <div style={{ fontSize: "9px", color: C.muted, fontFamily: "JetBrains Mono, monospace" }}>
                        setup {row.setup_family} · verdict {row.reasoning_verdict}
                      </div>
                    </div>
                    <div className="text-right">
                      <div style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: readinessColor }}>
                        {row.readiness.toUpperCase()}
                      </div>
                      <div style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: directionColor }}>
                        {row.direction}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 mt-2">
                    <div className="rounded px-2 py-1" style={{ border: `1px solid ${C.border}`, backgroundColor: "#131314" }}>
                      <MicroLabel>Attention</MicroLabel>
                      <div style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.secondary }}>
                        {(row.attention_score * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="rounded px-2 py-1" style={{ border: `1px solid ${C.border}`, backgroundColor: "#131314" }}>
                      <MicroLabel>Risk</MicroLabel>
                      <div style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: row.risk_state === "allowed" ? C.primary : C.tertiary }}>
                        {row.risk_state}
                      </div>
                    </div>
                    <div className="rounded px-2 py-1" style={{ border: `1px solid ${C.border}`, backgroundColor: "#131314" }}>
                      <MicroLabel>Scores</MicroLabel>
                      <div style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
                        S {row.structure_score.toFixed(2)} · O {row.orderflow_score.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-[9px]" style={{ color: C.muted, fontFamily: "JetBrains Mono, monospace" }}>
                    Ctx {row.context_score.toFixed(2)} · Mem {row.memory_score.toFixed(2)} · Rsn {row.reasoning_score.toFixed(2)} · Risk {row.risk_score.toFixed(2)}
                  </div>
                  {row.block_reason && (
                    <div className="mt-1 text-[9px]" style={{ color: "#fbbf24", fontFamily: "JetBrains Mono, monospace" }}>
                      block: {row.block_reason}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs" style={{ color: C.muted }}>
            Consciousness snapshot unavailable. Run orchestrator to generate `latest_orchestrator_run.json`.
          </div>
        )}
      </div>

      {/* Live Layer Diagnostics */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-base" style={{ color: C.primary }}>monitor_heart</span>
            <MicroLabel>Live Layer Diagnostics</MicroLabel>
          </div>
          <button
            onClick={() => refetchDiag()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded transition-all hover:brightness-110"
            style={{ fontSize: "9px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: C.outline, backgroundColor: C.card, border: `1px solid ${C.border}` }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>refresh</span>
            Refresh
          </button>
        </div>

        {diagLoading && (
          <div className="text-center py-8">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ backgroundColor: C.primary }} />
          </div>
        )}

        {diag && (
          <div className="space-y-3">
            {/* Summary bar */}
            <div className="rounded px-4 py-3 flex items-center justify-between" style={{
              backgroundColor: diag.system_status === "healthy" ? "rgba(156,255,147,0.05)" : diag.system_status === "partial" ? "rgba(251,191,36,0.05)" : "rgba(255,113,98,0.05)",
              border: `1px solid ${diag.system_status === "healthy" ? "rgba(156,255,147,0.2)" : diag.system_status === "partial" ? "rgba(251,191,36,0.2)" : "rgba(255,113,98,0.2)"}`,
            }}>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: diag.system_status === "healthy" ? C.primary : diag.system_status === "partial" ? "#fbbf24" : C.tertiary }} />
                <span className="font-headline font-bold text-xs uppercase tracking-widest">System {diag.system_status}</span>
              </div>
              <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
                {new Date(diag.timestamp).toLocaleTimeString()}
              </span>
            </div>

            {/* Layer grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {Object.entries(diag.layers).map(([key, layer]) => {
                const color = layer.status === "live" ? C.primary : layer.status === "degraded" ? "#fbbf24" : C.tertiary;
                return (
                  <div key={key} className="rounded p-4 flex items-start gap-3" style={{
                    backgroundColor: C.card,
                    border: `1px solid ${layer.status === "live" ? "rgba(156,255,147,0.1)" : layer.status === "degraded" ? "rgba(251,191,36,0.1)" : "rgba(255,113,98,0.1)"}`,
                  }}>
                    <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}12` }}>
                      <span className="material-symbols-outlined" style={{ fontSize: "16px", color }}>{LAYER_ICONS[key] ?? "circle"}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-headline font-bold text-xs">{LAYER_LABELS[key] ?? key}</span>
                        <StatusPill status={layer.status} />
                      </div>
                      <p style={{ fontSize: "10px", color: C.muted, lineHeight: "1.5" }}>{layer.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Recommendations */}
            {diag.recommendations.length > 0 && (
              <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid rgba(251,191,36,0.15)` }}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-sm" style={{ color: "#fbbf24" }}>tips_and_updates</span>
                  <MicroLabel>Recommendations</MicroLabel>
                </div>
                <ul className="space-y-2">
                  {diag.recommendations.map((r, i) => (
                    <li key={i} className="flex items-start gap-2" style={{ fontSize: "11px", color: C.muted }}>
                      <span style={{ color: "#fbbf24", marginTop: "2px" }}>›</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pipeline Layers (from system status) */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-base" style={{ color: C.secondary }}>account_tree</span>
            <MicroLabel>Pipeline Layer Status</MicroLabel>
          </div>
          <button
            onClick={() => recallRefreshMutation.mutate()}
            disabled={recallRefreshMutation.isPending}
            className="rounded px-2 py-1 text-[9px] uppercase tracking-wider disabled:opacity-50"
            style={{ border: `1px solid ${C.border}`, color: C.secondary, backgroundColor: "rgba(102,157,255,0.12)" }}
          >
            {recallRefreshMutation.isPending ? "Refreshing..." : "Refresh Recall"}
          </button>
        </div>
        {(recallRefreshFeedback || recallRefreshMutation.error) && (
          <div className="mb-3 rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#101011" }}>
            {recallRefreshMutation.error ? (
              <div style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.tertiary }}>
                {(recallRefreshMutation.error as Error).message}
              </div>
            ) : recallRefreshFeedback ? (
              <div style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: recallRefreshFeedback.ok ? C.primary : C.tertiary }}>
                recall refresh {recallRefreshFeedback.ok ? "ok" : "failed"} · {recallRefreshFeedback.symbol} · {recallRefreshFeedback.recall_context_ready ? "context ready" : "context stale"}
                {recallRefreshFeedback.blocked ? ` · blocked (${recallRefreshFeedback.block_reason || "n/a"})` : ""}
              </div>
            ) : null}
          </div>
        )}
        <div className="space-y-2">
          {data.layers.map((layer: any, index: any) => {
            const isActive = layer.status === "active";
            const isWarn = layer.status === "warning";
            const color = isActive ? C.primary : isWarn ? "#fbbf24" : C.tertiary;
            return (
              <div key={layer.name} className="rounded p-4 flex gap-4 items-center hover:brightness-105 transition-all" style={{ backgroundColor: C.card, border: `1px solid ${isActive ? "rgba(156,255,147,0.08)" : C.border}` }}>
                <div className="w-8 h-8 flex items-center justify-center rounded relative flex-shrink-0" style={{ backgroundColor: "rgba(14,14,15,0.6)", border: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>{String(index + 1).padStart(2, "0")}</span>
                </div>
                <div className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}12` }}>
                  <span className="material-symbols-outlined" style={{ fontSize: "16px", color }}>{PIPELINE_ICONS[index] ?? "circle"}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-headline font-bold text-sm">{layer.name}</div>
                  <div style={{ fontSize: "10px", color: C.muted, marginTop: "2px" }}>{layer.message}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={layer.status} />
                  {layer.last_update && (
                    <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
                      {format(new Date(layer.last_update), "HH:mm:ss")}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Runtime Risk Controls */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <MicroLabel>Kill Switch</MicroLabel>
              <div className="font-headline font-bold text-lg mt-1">
                {killSwitchActive ? "ACTIVE" : "INACTIVE"}
              </div>
            </div>
            <button
              onClick={() => toggleKillSwitchMutation.mutate(!killSwitchActive)}
              disabled={toggleKillSwitchMutation.isPending || riskLoading}
              className={cn("px-4 py-2 rounded text-xs uppercase tracking-wider", "disabled:opacity-50")}
              style={{
                backgroundColor: killSwitchActive ? "rgba(156,255,147,0.15)" : "rgba(255,113,98,0.15)",
                border: `1px solid ${killSwitchActive ? "rgba(156,255,147,0.35)" : "rgba(255,113,98,0.35)"}`,
                color: killSwitchActive ? C.primary : C.tertiary,
              }}
            >
              {killSwitchActive ? "Deactivate" : "Activate"}
            </button>
          </div>
          <div className="mt-3 text-[10px]" style={{ color: C.muted }}>
            Updated: {riskSnapshot?.runtime.updatedAt ? format(new Date(riskSnapshot.runtime.updatedAt), "yyyy-MM-dd HH:mm:ss") : "n/a"}
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => retrainMutation.mutate()}
              disabled={retrainMutation.isPending}
              className={cn("px-3 py-2 rounded text-[10px] uppercase tracking-wider border", "disabled:opacity-50")}
              style={{ borderColor: "rgba(102,157,255,0.35)", color: C.secondary, backgroundColor: "rgba(102,157,255,0.12)" }}
            >
              {retrainMutation.isPending ? "Retraining..." : "Retrain ML Model"}
            </button>
            <button
              onClick={() => resetRuntimeMutation.mutate()}
              disabled={resetRuntimeMutation.isPending}
              className={cn("px-3 py-2 rounded text-[10px] uppercase tracking-wider border", "disabled:opacity-50")}
              style={{ borderColor: "rgba(173,170,171,0.35)", color: C.muted, backgroundColor: "rgba(173,170,171,0.12)" }}
            >
              {resetRuntimeMutation.isPending ? "Resetting..." : "Reset Runtime State"}
            </button>
          </div>
        </div>

        <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between mb-3">
            <MicroLabel>Risk Controls</MicroLabel>
            <button
              onClick={() => draft && saveRiskMutation.mutate(draft)}
              disabled={!draft || saveRiskMutation.isPending}
              className={cn("px-3 py-2 rounded text-[10px] uppercase tracking-wider border", "disabled:opacity-50")}
              style={{ borderColor: "rgba(156,255,147,0.35)", color: C.primary, backgroundColor: "rgba(156,255,147,0.12)" }}
            >
              {saveRiskMutation.isPending ? "Saving..." : "Save Controls"}
            </button>
          </div>
          {draft ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] space-y-1" style={{ color: C.muted }}>
                Max Risk/Trade
                <input
                  type="number"
                  step="0.001"
                  value={draft.maxRiskPerTradePct}
                  onChange={(e) => setDraft({ ...draft, maxRiskPerTradePct: Number(e.target.value) })}
                  className="w-full rounded px-2 py-1 bg-[#111113] border border-[#333] text-zinc-100"
                />
              </label>
              <label className="text-[10px] space-y-1" style={{ color: C.muted }}>
                Max Daily Loss USD
                <input
                  type="number"
                  step="1"
                  value={draft.maxDailyLossUsd}
                  onChange={(e) => setDraft({ ...draft, maxDailyLossUsd: Number(e.target.value) })}
                  className="w-full rounded px-2 py-1 bg-[#111113] border border-[#333] text-zinc-100"
                />
              </label>
              <label className="text-[10px] space-y-1" style={{ color: C.muted }}>
                Max Exposure %
                <input
                  type="number"
                  step="0.01"
                  value={draft.maxOpenExposurePct}
                  onChange={(e) => setDraft({ ...draft, maxOpenExposurePct: Number(e.target.value) })}
                  className="w-full rounded px-2 py-1 bg-[#111113] border border-[#333] text-zinc-100"
                />
              </label>
              <label className="text-[10px] space-y-1" style={{ color: C.muted }}>
                Max Positions
                <input
                  type="number"
                  step="1"
                  value={draft.maxConcurrentPositions}
                  onChange={(e) => setDraft({ ...draft, maxConcurrentPositions: Number(e.target.value) })}
                  className="w-full rounded px-2 py-1 bg-[#111113] border border-[#333] text-zinc-100"
                />
              </label>
              <label className="text-[10px] space-y-1" style={{ color: C.muted }}>
                Max Trades/Session
                <input
                  type="number"
                  step="1"
                  value={draft.maxTradesPerSession}
                  onChange={(e) => setDraft({ ...draft, maxTradesPerSession: Number(e.target.value) })}
                  className="w-full rounded px-2 py-1 bg-[#111113] border border-[#333] text-zinc-100"
                />
              </label>
              <label className="text-[10px] space-y-1" style={{ color: C.muted }}>
                Cooldown Minutes
                <input
                  type="number"
                  step="1"
                  value={draft.cooldownMinutes}
                  onChange={(e) => setDraft({ ...draft, cooldownMinutes: Number(e.target.value) })}
                  className="w-full rounded px-2 py-1 bg-[#111113] border border-[#333] text-zinc-100"
                />
              </label>
              <label className="text-[10px] space-y-1" style={{ color: C.muted }}>
                Cooldown After Losses
                <input
                  type="number"
                  step="1"
                  value={draft.cooldownAfterLosses}
                  onChange={(e) => setDraft({ ...draft, cooldownAfterLosses: Number(e.target.value) })}
                  className="w-full rounded px-2 py-1 bg-[#111113] border border-[#333] text-zinc-100"
                />
              </label>
              <label className="text-[10px] flex items-center gap-2 col-span-2 mt-1" style={{ color: C.muted }}>
                <input
                  type="checkbox"
                  checked={draft.blockOnDegradedData}
                  onChange={(e) => setDraft({ ...draft, blockOnDegradedData: e.target.checked })}
                  className="accent-emerald-400"
                />
                Block Trading On Degraded Data
              </label>
              <label className="text-[10px] flex items-center gap-2 col-span-2" style={{ color: C.muted }}>
                <input
                  type="checkbox"
                  checked={Boolean(draft.newsLockoutActive)}
                  onChange={(e) => setDraft({ ...draft, newsLockoutActive: e.target.checked })}
                  className="accent-red-400"
                />
                News Lockout Active (block new trades)
              </label>
              <div className="col-span-2 mt-1">
                <MicroLabel>Session Allowlist</MicroLabel>
                <div className="mt-2 flex flex-wrap gap-3 text-[10px]" style={{ color: C.muted }}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.allowAsianSession)}
                      onChange={(e) => setDraft({ ...draft, allowAsianSession: e.target.checked })}
                      className="accent-emerald-400"
                    />
                    Asian
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.allowLondonSession)}
                      onChange={(e) => setDraft({ ...draft, allowLondonSession: e.target.checked })}
                      className="accent-emerald-400"
                    />
                    London
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.allowNySession)}
                      onChange={(e) => setDraft({ ...draft, allowNySession: e.target.checked })}
                      className="accent-emerald-400"
                    />
                    New York
                  </label>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs" style={{ color: C.muted }}>
              Loading risk controls...
            </div>
          )}
        </div>
      </div>

      {/* Live Risk + Audit Observability */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between mb-3">
            <MicroLabel>Live Session Risk</MicroLabel>
            <StatusPill status={liveRisk?.gate_state === "PASS" ? "live" : "degraded"} />
          </div>
          {liveRisk?.risk ? (
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="rounded p-2" style={{ backgroundColor: "#0f0f10", border: `1px solid ${C.border}` }}>
                <MicroLabel>Daily PnL</MicroLabel>
                <div className="mt-1 font-mono" style={{ color: liveRisk.risk.realizedPnlTodayUsd >= 0 ? C.primary : C.tertiary }}>
                  ${liveRisk.risk.realizedPnlTodayUsd.toFixed(2)}
                </div>
              </div>
              <div className="rounded p-2" style={{ backgroundColor: "#0f0f10", border: `1px solid ${C.border}` }}>
                <MicroLabel>Exposure</MicroLabel>
                <div className="mt-1 font-mono" style={{ color: C.muted }}>
                  {(liveRisk.risk.openExposurePct * 100).toFixed(1)}%
                </div>
              </div>
              <div className="rounded p-2" style={{ backgroundColor: "#0f0f10", border: `1px solid ${C.border}` }}>
                <MicroLabel>Closed Trades</MicroLabel>
                <div className="mt-1 font-mono" style={{ color: C.secondary }}>
                  {liveRisk.risk.closedTradesToday}
                </div>
              </div>
              <div className="rounded p-2" style={{ backgroundColor: "#0f0f10", border: `1px solid ${C.border}` }}>
                <MicroLabel>Loss Streak</MicroLabel>
                <div className="mt-1 font-mono" style={{ color: liveRisk.risk.consecutiveLosses >= liveRisk.risk.cooldownThreshold ? C.tertiary : C.muted }}>
                  {liveRisk.risk.consecutiveLosses} / {liveRisk.risk.cooldownThreshold}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs" style={{ color: C.muted }}>
              Live risk status unavailable.
            </div>
          )}
          {liveRisk?.risk?.cooldownActive && (
            <div className="mt-3 rounded p-2 text-[10px]" style={{ border: "1px solid rgba(255,113,98,0.35)", backgroundColor: "rgba(255,113,98,0.12)", color: C.tertiary }}>
              Cooldown active: {formatDurationMs(liveRisk.risk.cooldownRemainingMs)} remaining
            </div>
          )}
          {(liveRisk?.gate_reasons?.length ?? 0) > 0 && (
            <div className="mt-3 rounded p-2 text-[10px]" style={{ border: "1px solid rgba(251,191,36,0.35)", backgroundColor: "rgba(251,191,36,0.12)", color: "#fbbf24" }}>
              Gate reasons: {liveRisk?.gate_reasons?.join(", ")}
            </div>
          )}
          {liveRisk?.data_health && (
            <div className="mt-3 text-[10px]" style={{ color: C.muted }}>
              Data health: {liveRisk.data_health.healthy ? "healthy" : "degraded"} · bar age {formatDurationMs(liveRisk.data_health.latestBarAgeMs ?? 0)}
            </div>
          )}
          <div className="mt-3 text-[10px]" style={{ color: C.muted }}>
            Session: {liveRisk?.active_session ?? "n/a"} · {liveRisk?.session_allowed === false ? "blocked" : "allowed"} · News lockout: {liveRisk?.news_lockout_active ? "on" : "off"}
          </div>
        </div>

        <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between mb-3">
            <MicroLabel>Recent Audit Events</MicroLabel>
            <span style={{ fontSize: "10px", color: C.outlineVar }}>
              {audit?.count ?? 0} events
            </span>
          </div>
          {auditSummary && (
            <div className="mb-3 grid grid-cols-3 gap-2 text-[10px]">
              <div className="rounded p-2" style={{ backgroundColor: "#0f0f10", border: `1px solid ${C.border}` }}>
                <MicroLabel>Trades</MicroLabel>
                <div className="mt-1 font-mono" style={{ color: C.primary }}>{auditSummary.totals.trade}</div>
              </div>
              <div className="rounded p-2" style={{ backgroundColor: "#0f0f10", border: `1px solid ${C.border}` }}>
                <MicroLabel>Blocked</MicroLabel>
                <div className="mt-1 font-mono" style={{ color: C.tertiary }}>{auditSummary.totals.blocked}</div>
              </div>
              <div className="rounded p-2" style={{ backgroundColor: "#0f0f10", border: `1px solid ${C.border}` }}>
                <MicroLabel>Degraded</MicroLabel>
                <div className="mt-1 font-mono" style={{ color: "#fbbf24" }}>{auditSummary.totals.degraded}</div>
              </div>
              {auditSummary.top_reasons.length > 0 && (
                <div className="col-span-3 text-[9px]" style={{ color: C.muted }}>
                  Top reasons: {auditSummary.top_reasons.slice(0, 3).map((r: any) => `${r.reason} (${r.count})`).join(", ")}
                </div>
              )}
            </div>
          )}
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {(audit?.events ?? []).map((event: any) => (
              <div
                key={event.id}
                className="rounded p-2"
                style={{ backgroundColor: "#0f0f10", border: `1px solid ${C.border}` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span style={{ fontSize: "10px", fontWeight: 700, color: C.secondary }}>{event.event_type}</span>
                  <span style={{ fontSize: "9px", color: C.outlineVar }}>
                    {format(new Date(event.created_at), "HH:mm:ss")}
                  </span>
                </div>
                <div style={{ fontSize: "9px", marginTop: "3px", color: C.muted }}>
                  {event.symbol ?? "N/A"} · {event.decision_state ?? "n/a"} · {event.reason ?? "no-reason"}
                </div>
              </div>
            ))}
            {(audit?.events?.length ?? 0) === 0 && (
              <div className="text-xs" style={{ color: C.muted }}>
                No recent audit events.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="pt-6 border-t flex items-center justify-between" style={{ borderColor: "rgba(72,72,73,0.15)" }}>
        <div style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: C.outlineVar, letterSpacing: "0.2em", textTransform: "uppercase" }}>
          Auth Profile: Redacted
        </div>
        <div style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
          GODSVIEW v0.4.0-BRAIN
        </div>
      </div>
    </div>
  );
}
