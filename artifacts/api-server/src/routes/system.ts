import { Router, type IRouter } from "express";
import { db, accuracyResultsTable, auditEventsTable, signalsTable, tradesTable, siDecisionsTable } from "@workspace/db";
import { and, desc, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { StockBrainStateSchema, type StockBrainState } from "@workspace/common-types";
import { getTypedPositions, getAccount, hasValidTradingKey, isBrokerKey } from "../lib/alpaca";
import { getModelDiagnostics, getModelStatus, retrainModel } from "../lib/ml_model";
import { resolveSystemMode, canWriteOrders, isLiveMode } from "@workspace/strategy-core";
import { getCurrentTradingSession, getRiskEngineSnapshot, isKillSwitchActive, isSessionAllowed, resetRiskEngineRuntime, setKillSwitchActive, updateRiskConfig } from "../lib/risk_engine";
import { runBrainCycle } from "../lib/brain_bridge";
import { requireOperator } from "../lib/auth_guard";
import { withDegradation } from "../lib/degradation";

const router: IRouter = Router();
const LEGACY_LIVE_TRADING_ENABLED = String(process.env.GODSVIEW_ENABLE_LIVE_TRADING ?? "").toLowerCase() === "true";
const SYSTEM_MODE = resolveSystemMode(process.env.GODSVIEW_SYSTEM_MODE, {
  liveTradingEnabled: LEGACY_LIVE_TRADING_ENABLED,
});
const CREATE_AUDIT_EVENTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS audit_events (
    id SERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    decision_state TEXT,
    system_mode TEXT,
    instrument TEXT,
    setup_type TEXT,
    symbol TEXT,
    actor TEXT NOT NULL DEFAULT 'system',
    reason TEXT,
    payload_json TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;
let auditEventsTableReady = false;

// ── Server-side cache for Alpaca data (avoid 429 rate limits) ───────────────
let _alpacaCache: { positions: any[]; account: any; ts: number } = { positions: [], account: null, ts: 0 };
const ALPACA_CACHE_TTL = 15_000; // 15 seconds
const GOV_MIN_TRADES = 30;
const GOV_MIN_PROFIT_FACTOR = 1.5;
const GOV_MAX_DRAWDOWN_PCT = 20;
const GOV_MIN_EXPECTANCY_R = 0.2;
const GOV_MIN_WIN_RATE = 0.4;

type JsonRecord = Record<string, unknown>;

type GovernanceMetrics = {
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

function parseNum(value: unknown, fallback = 0): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumOrNull(value: unknown): number | null {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntSafe(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asRecord(value: unknown): JsonRecord | null {
  if (typeof value === "object" && value !== null) return value as JsonRecord;
  return null;
}

function parseIsoToMs(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function normalizeSession(raw: unknown): "premarket" | "open" | "midday" | "power_hour" | "after_hours" | "closed" {
  const key = String(raw ?? "").toLowerCase();
  if (key.includes("open")) return "open";
  if (key.includes("power")) return "power_hour";
  if (key.includes("pre")) return "premarket";
  if (key.includes("after")) return "after_hours";
  if (key.includes("mid")) return "midday";
  return "closed";
}

function normalizeRegime(raw: unknown): "risk_on" | "risk_off" | "neutral" | "high_vol" | "low_vol" {
  const key = String(raw ?? "").toLowerCase();
  if (key.includes("bull") || key.includes("trend")) return "risk_on";
  if (key.includes("bear")) return "risk_off";
  if (key.includes("high")) return "high_vol";
  if (key.includes("low")) return "low_vol";
  return "neutral";
}

function toReasoningVerdict(rawAction: string, approved: boolean): "strong_long" | "watch_long" | "strong_short" | "watch_short" | "wait" | "block" {
  if (!approved) return "block";
  if (rawAction === "buy") return "watch_long";
  if (rawAction === "sell") return "watch_short";
  return "wait";
}

function toTupleReasonList(value: unknown): Array<{ reason: string; count: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (Array.isArray(entry) && entry.length >= 2) {
        return {
          reason: String(entry[0] ?? "unknown"),
          count: parseIntSafe(entry[1], 0),
        };
      }
      if (typeof entry === "object" && entry !== null) {
        const row = entry as JsonRecord;
        return {
          reason: String(row.reason ?? "unknown"),
          count: parseIntSafe(row.count, 0),
        };
      }
      return null;
    })
    .filter((row): row is { reason: string; count: number } => row !== null && row.reason.length > 0);
}

function evaluateReplayRecordsMetrics(recordsRaw: unknown): GovernanceMetrics {
  const records = Array.isArray(recordsRaw) ? (recordsRaw as JsonRecord[]) : [];
  if (!records.length) {
    return {
      trades: 0,
      closed_trades: 0,
      wins: 0,
      losses: 0,
      win_rate: 0,
      profit_factor: 0,
      expectancy_r: 0,
      max_drawdown_pct: 0,
      total_pnl_pct: 0,
    };
  }

  let wins = 0;
  let losses = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let totalR = 0;
  let totalPnl = 0;
  let equity = 100;
  let peak = equity;
  let maxDrawdown = 0;

  for (const row of records) {
    const outcome = String(row.outcome ?? "").toLowerCase();
    const rr = parseNum(row.rr, 0);
    const pnlPct = parseNum(row.pnl_pct, 0);
    totalPnl += pnlPct;

    if (outcome === "win") {
      wins += 1;
      grossWin += Math.max(pnlPct, 0);
      totalR += rr;
    } else if (outcome === "loss") {
      losses += 1;
      grossLoss += Math.abs(Math.min(pnlPct, 0));
      totalR -= 1;
    }

    equity = equity * (1 + pnlPct / 100);
    peak = Math.max(peak, equity);
    const drawdown = ((peak - equity) / Math.max(peak, 1e-9)) * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }

  const closed = wins + losses;
  return {
    trades: records.length,
    closed_trades: closed,
    wins,
    losses,
    win_rate: closed > 0 ? wins / closed : 0,
    profit_factor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0,
    expectancy_r: closed > 0 ? totalR / closed : 0,
    max_drawdown_pct: maxDrawdown,
    total_pnl_pct: totalPnl,
  };
}

function normalizeGovernanceMetrics(orchestrator: JsonRecord | null, replay: JsonRecord | null): GovernanceMetrics {
  const strategyControl = (orchestrator?.data as JsonRecord | undefined)?.strategy_control as JsonRecord | undefined;
  const strategyMetrics = strategyControl?.metrics as JsonRecord | undefined;
  if (strategyMetrics) {
    return {
      trades: parseIntSafe(strategyMetrics.trades, 0),
      closed_trades: parseIntSafe(strategyMetrics.closed_trades ?? strategyMetrics.trades, 0),
      wins: parseIntSafe(strategyMetrics.wins, 0),
      losses: parseIntSafe(strategyMetrics.losses, 0),
      win_rate: parseNum(strategyMetrics.win_rate, 0),
      profit_factor: parseNum(strategyMetrics.profit_factor, 0),
      expectancy_r: parseNum(strategyMetrics.expectancy_r, 0),
      max_drawdown_pct: parseNum(strategyMetrics.max_drawdown_pct, 0),
      total_pnl_pct: parseNum(strategyMetrics.total_pnl_pct, 0),
    };
  }
  return evaluateReplayRecordsMetrics(replay?.records);
}

function resolveProcessedArtifactsDir(): string {
  return path.resolve(process.cwd(), "godsview-openbb", "data", "processed");
}

async function readJsonArtifact(filename: string): Promise<{
  exists: boolean;
  path: string;
  data: JsonRecord | null;
  error: string | null;
}> {
  const artifactPath = path.join(resolveProcessedArtifactsDir(), filename);
  try {
    const raw = await readFile(artifactPath, "utf8");
    const parsed = JSON.parse(raw) as JsonRecord;
    return { exists: true, path: artifactPath, data: parsed, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { exists: false, path: artifactPath, data: null, error };
  }
}

async function getCachedAlpacaData() {
  if (Date.now() - _alpacaCache.ts < ALPACA_CACHE_TTL) {
    return { positions: _alpacaCache.positions, account: _alpacaCache.account };
  }
  const [positions, account] = await Promise.all([
    getTypedPositions().catch(() => [] as Awaited<ReturnType<typeof getTypedPositions>>),
    getAccount().catch(() => null),
  ]);
  _alpacaCache = { positions, account, ts: Date.now() };
  return { positions, account };
}

type AccuracyProofRow = {
  setup_type: string;
  regime: string | null;
  symbol: string;
  outcome: string | null;
  tp_ticks: number | null;
  sl_ticks: number | null;
  final_quality: unknown;
  created_at: Date;
};

type CohortMetrics = {
  totalSignals: number;
  closedSignals: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
  avgFinalQuality: number;
};

function parseIntRange(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseNumberSafe(value: unknown): number {
  const n = Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

function computeCohortMetrics(rows: AccuracyProofRow[]): CohortMetrics {
  if (!rows.length) {
    return {
      totalSignals: 0,
      closedSignals: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      profitFactor: 0,
      expectancyR: 0,
      avgFinalQuality: 0,
    };
  }

  let wins = 0;
  let losses = 0;
  let grossWinTicks = 0;
  let grossLossTicks = 0;
  let expectancySum = 0;
  let qualitySum = 0;

  for (const row of rows) {
    const outcome = String(row.outcome ?? "");
    const tpTicks = Number(row.tp_ticks ?? 0);
    const slTicks = Number(row.sl_ticks ?? 0);
    const rr = slTicks > 0 ? tpTicks / slTicks : 1;
    qualitySum += parseNumberSafe(row.final_quality);

    if (outcome === "win") {
      wins += 1;
      grossWinTicks += tpTicks;
      expectancySum += rr;
    } else if (outcome === "loss") {
      losses += 1;
      grossLossTicks += Math.max(slTicks, 1);
      expectancySum -= 1;
    }
  }

  const closedSignals = wins + losses;
  const winRate = closedSignals > 0 ? wins / closedSignals : 0;
  const profitFactor = grossLossTicks > 0 ? grossWinTicks / grossLossTicks : grossWinTicks > 0 ? 999 : 0;
  const expectancyR = closedSignals > 0 ? expectancySum / closedSignals : 0;
  const avgFinalQuality = rows.length > 0 ? qualitySum / rows.length : 0;

  return {
    totalSignals: rows.length,
    closedSignals,
    wins,
    losses,
    winRate,
    profitFactor,
    expectancyR,
    avgFinalQuality,
  };
}

function bucketizeProofRows(
  rows: AccuracyProofRow[],
  keySelector: (row: AccuracyProofRow) => string,
  minSignals: number,
): Array<{
  key: string;
  totalSignals: number;
  closedSignals: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
  avgFinalQuality: number;
}> {
  const groups = new Map<string, AccuracyProofRow[]>();
  for (const row of rows) {
    const key = keySelector(row);
    const existing = groups.get(key) ?? [];
    existing.push(row);
    groups.set(key, existing);
  }

  return Array.from(groups.entries())
    .map(([key, groupedRows]) => ({ key, ...computeCohortMetrics(groupedRows) }))
    .filter((row) => row.closedSignals >= minSignals)
    .sort((a, b) => {
      if (b.expectancyR !== a.expectancyR) return b.expectancyR - a.expectancyR;
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      return b.closedSignals - a.closedSignals;
    });
}

router.get("/system/status", async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [signalsRow, tradesRow, { positions, account }, orchestratorArtifact, reviewArtifact, consciousnessArtifact] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(signalsTable).where(gte(signalsTable.created_at, today)),
      db.select({ count: sql<number>`count(*)` }).from(tradesTable).where(gte(tradesTable.created_at, today)),
      getCachedAlpacaData(),
      readJsonArtifact("latest_orchestrator_run.json"),
      readJsonArtifact("latest_review_snapshot.json"),
      readJsonArtifact("latest_consciousness_board.json"),
    ]);

    const unrealizedPnl = positions.reduce((sum, p) => sum + parseFloat(p.unrealized_pl ?? "0"), 0);
    const equity = parseFloat((account as Record<string, string> | null)?.equity ?? "0");
    const buyingPower = parseFloat((account as Record<string, string> | null)?.buying_power ?? "0");
    const accountNumber = (account as Record<string, string> | null)?.account_number ?? null;
    const accountMode = accountNumber ? (accountNumber.startsWith("PA") ? "paper" : "live") : null;
    const accountHasError = typeof account === "object" && account !== null && "error" in account;
    const orchestratorData = asRecord(orchestratorArtifact.data);
    const reviewData = asRecord(reviewArtifact.data);
    const recallDbCount = Number(signalsRow[0].count);
    const nowMs = Date.now();
    const consciousnessData = asRecord(consciousnessArtifact.data);
    const recallArtifactTs =
      parseIsoToMs(orchestratorData?.generated_at) ??
      parseIsoToMs(reviewData?.recorded_at) ??
      parseIsoToMs(consciousnessData?.generated_at);
    const recallArtifactFresh = recallArtifactTs !== null && nowMs - recallArtifactTs <= 24 * 60 * 60 * 1000;
    const recallFromArtifacts = Boolean((orchestratorArtifact.exists || reviewArtifact.exists || consciousnessArtifact.exists) && recallArtifactFresh);
    const recallActive = recallDbCount > 0 || recallFromArtifacts;

    // Derive active instrument from open positions or default to BTC
    const activeInstrument = positions.length > 0
      ? positions[0].symbol.replace("/", "")
      : "BTCUSD";

    const riskState = getRiskEngineSnapshot();
    const controls = riskState.config;
    const active_session = getCurrentTradingSession();
    const session_allowed = isSessionAllowed(active_session, controls);
    const killSwitchActive = isKillSwitchActive();
    const tradingApiStatus = hasValidTradingKey ? "active" : isBrokerKey ? "warning" : "error";
    const riskLayerStatus = killSwitchActive || !canWriteOrders(SYSTEM_MODE)
      ? ("warning" as const)
      : tradingApiStatus;
    const claudeOnline = Boolean(process.env.ANTHROPIC_API_KEY);
    const layers = [
      { name: "TradingView Structure", status: "active" as const, message: "Monitoring order blocks, S/R, VWAP, session levels", last_update: new Date().toISOString() },
      { name: "Order Flow", status: "active" as const, message: "Tracking absorption, delta shifts, sweeps, CVD divergence", last_update: new Date().toISOString() },
      {
        name: "Recall Engine",
        status: recallActive ? ("active" as const) : ("warning" as const),
        message: recallDbCount > 0
          ? `Recall context ready from ${recallDbCount} fresh signal(s) today`
          : recallFromArtifacts
          ? "Recall context refreshed from latest pipeline/backtest artifacts"
          : "No fresh signals today — run scan/backtest to refresh recall context",
        last_update: new Date().toISOString(),
      },
      {
        name: "ML Model",
        status: getModelStatus().status,
        message: getModelStatus().message,
        last_update: new Date().toISOString(),
      },
      {
        name: "Claude Reasoning",
        status: claudeOnline ? ("active" as const) : ("warning" as const),
        message: claudeOnline
          ? "Context-aware filter online — final gate before execution"
          : "Claude key missing — using deterministic fallback scoring",
        last_update: new Date().toISOString(),
      },
      {
        name: "Risk Engine",
        status: riskLayerStatus,
        message: killSwitchActive
          ? "Runtime kill switch is active — all trading write actions are blocked"
          : controls.newsLockoutActive
          ? "News lockout is active — trade entry is blocked by policy"
          : !session_allowed
          ? `Session allowlist blocked current '${active_session}' window`
          : !canWriteOrders(SYSTEM_MODE)
          ? `System mode '${SYSTEM_MODE}' is read-only — trading writes are disabled`
          : hasValidTradingKey
          ? "Position sizing, daily loss limits, and execution controls active"
          : isBrokerKey
          ? "Broker keys detected — switch to Trading API keys for full execution controls"
          : "Trading API keys missing — execution routes remain restricted",
        last_update: new Date().toISOString(),
      },
    ];
    const overall = layers.some((layer) => layer.status === "error")
      ? "degraded"
      : layers.some((layer) => layer.status === "warning")
      ? "degraded"
      : "healthy";

    res.json({
      overall,
      system_mode: SYSTEM_MODE,
      live_writes_enabled: canWriteOrders(SYSTEM_MODE) && !killSwitchActive,
      live_mode: isLiveMode(SYSTEM_MODE),
      trading_kill_switch: killSwitchActive,
      layers,
      news_lockout_active: controls.newsLockoutActive,
      active_instrument: activeInstrument,
      active_session,
      session_allowed,
      signals_today: Number(signalsRow[0].count),
      trades_today: Number(tradesRow[0].count),
      unrealized_pnl: unrealizedPnl,
      live_positions: positions.length,
      equity,
      buying_power: buyingPower,
      account_connected: Boolean(account) && !accountHasError,
      account_mode: accountMode,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get system status");
    res.status(503).json({ error: "internal_error", message: "Failed to fetch system status" });
  }
});

// ─── POST /api/system/recall/refresh — run replay cycle to refresh context ──
router.post("/system/recall/refresh", requireOperator, async (req, res) => {
  try {
    const requestedSymbol = String(req.body?.symbol ?? "").trim().toUpperCase();
    const symbol = requestedSymbol.length > 0 ? requestedSymbol : "AAPL";
    const withReplay = req.body?.with_replay !== false;
    const cycle = await runBrainCycle({
      symbol,
      withReplay,
      live: false,
      dryRun: true,
      approve: false,
    });

    const [orchestratorArtifact, reviewArtifact, consciousnessArtifact] = await Promise.all([
      readJsonArtifact("latest_orchestrator_run.json"),
      readJsonArtifact("latest_review_snapshot.json"),
      readJsonArtifact("latest_consciousness_board.json"),
    ]);
    const orchestratorData = asRecord(orchestratorArtifact.data);
    const reviewData = asRecord(reviewArtifact.data);
    const consciousnessData = asRecord(consciousnessArtifact.data);
    const latestTs =
      parseIsoToMs(orchestratorData?.generated_at) ??
      parseIsoToMs(reviewData?.recorded_at) ??
      parseIsoToMs(consciousnessData?.generated_at);
    const recallFresh = latestTs !== null && Date.now() - latestTs <= 24 * 60 * 60 * 1000;

    const blocked = Boolean(asRecord(cycle.snapshot)?.blocked ?? false);
    const blockReason = String(asRecord(cycle.snapshot)?.block_reason ?? "");
    const statusCode = cycle.ok ? 200 : 502;
    res.status(statusCode).json({
      ok: cycle.ok,
      symbol,
      with_replay: withReplay,
      blocked,
      block_reason: blockReason,
      recall_context_ready: recallFresh,
      generated_at: new Date().toISOString(),
      artifacts: {
        orchestrator: { exists: orchestratorArtifact.exists, path: orchestratorArtifact.path, error: orchestratorArtifact.error },
        review: { exists: reviewArtifact.exists, path: reviewArtifact.path, error: reviewArtifact.error },
        consciousness: { exists: consciousnessArtifact.exists, path: consciousnessArtifact.path, error: consciousnessArtifact.error },
      },
      command: cycle.command,
      stderr: cycle.stderr,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to refresh recall context");
    res.status(503).json({ error: "recall_refresh_failed", message: "Failed to refresh recall context" });
  }
});

// ─── POST /api/system/retrain — retrain ML model on demand ──────────────────
router.post("/system/retrain", requireOperator, async (req, res) => {
  try {
    const result = await retrainModel();
    res.json(result);
  } catch (err) {
    res.status(503).json({ success: false, message: String(err) });
  }
});

// ─── GET /api/system/learning — continuous learning loop state ───────────────
router.get("/system/learning", async (_req, res) => {
  try {
    const { getLearningState } = await import("../lib/continuous_learning");
    res.json(getLearningState());
  } catch (err) {
    res.status(503).json({ error: "learning_state_failed", message: String(err) });
  }
});

// ─── POST /api/system/learning/retrain — force learning retrain ─────────────
router.post("/system/learning/retrain", requireOperator, async (req, res) => {
  try {
    const { forceRetrain } = await import("../lib/continuous_learning");
    const reason = String(req.body?.reason ?? "manual");
    const result = await forceRetrain(reason);
    res.json(result);
  } catch (err) {
    res.status(503).json({ success: false, message: String(err) });
  }
});

// ─── GET /api/system/learning/promotions — strategy promotion candidates ────
router.get("/system/learning/promotions", async (_req, res) => {
  try {
    const { evaluatePromotions } = await import("../lib/continuous_learning");
    const candidates = await evaluatePromotions();
    res.json({ candidates, evaluatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ error: "promotion_eval_failed", message: String(err) });
  }
});

// ─── GET /api/system/model/diagnostics — CV + drift + model status ─────────
router.get("/system/model/diagnostics", async (req, res) => {
  try {
    const diagnostics = await getModelDiagnostics();
    res.json({
      ...diagnostics,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch model diagnostics");
    res.status(503).json({ error: "model_diagnostics_failed", message: "Failed to fetch model diagnostics" });
  }
});

// ─── GET /api/system/proof/by-setup — proof metrics bucketed by setup ──────
router.get("/system/proof/by-setup", async (req, res) => {
  try {
    const days = parseIntRange(req.query.days, 30, 3, 365);
    const minSignals = parseIntRange(req.query.min_signals, 20, 1, 5000);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows: AccuracyProofRow[] = await db
      .select({
        setup_type: accuracyResultsTable.setup_type,
        regime: accuracyResultsTable.regime,
        symbol: accuracyResultsTable.symbol,
        outcome: accuracyResultsTable.outcome,
        tp_ticks: accuracyResultsTable.tp_ticks,
        sl_ticks: accuracyResultsTable.sl_ticks,
        final_quality: accuracyResultsTable.final_quality,
        created_at: accuracyResultsTable.created_at,
      })
      .from(accuracyResultsTable)
      .where(
        and(
          gte(accuracyResultsTable.created_at, since),
          or(eq(accuracyResultsTable.outcome, "win"), eq(accuracyResultsTable.outcome, "loss")),
          isNotNull(accuracyResultsTable.final_quality),
        ),
      )
      .orderBy(desc(accuracyResultsTable.created_at))
      .limit(120_000);

    const buckets = bucketizeProofRows(rows, (row) => String(row.setup_type ?? "unknown"), minSignals);

    res.json({
      days,
      since: since.toISOString(),
      totalRows: rows.length,
      minSignals,
      overall: computeCohortMetrics(rows),
      rows: buckets,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch proof metrics by setup");
    res.status(503).json({ error: "proof_by_setup_failed", message: "Failed to fetch proof metrics by setup" });
  }
});

// ─── GET /api/system/proof/by-regime — proof metrics bucketed by regime ─────
router.get("/system/proof/by-regime", async (req, res) => {
  try {
    const days = parseIntRange(req.query.days, 30, 3, 365);
    const minSignals = parseIntRange(req.query.min_signals, 20, 1, 5000);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows: AccuracyProofRow[] = await db
      .select({
        setup_type: accuracyResultsTable.setup_type,
        regime: accuracyResultsTable.regime,
        symbol: accuracyResultsTable.symbol,
        outcome: accuracyResultsTable.outcome,
        tp_ticks: accuracyResultsTable.tp_ticks,
        sl_ticks: accuracyResultsTable.sl_ticks,
        final_quality: accuracyResultsTable.final_quality,
        created_at: accuracyResultsTable.created_at,
      })
      .from(accuracyResultsTable)
      .where(
        and(
          gte(accuracyResultsTable.created_at, since),
          or(eq(accuracyResultsTable.outcome, "win"), eq(accuracyResultsTable.outcome, "loss")),
          isNotNull(accuracyResultsTable.final_quality),
        ),
      )
      .orderBy(desc(accuracyResultsTable.created_at))
      .limit(120_000);

    const buckets = bucketizeProofRows(rows, (row) => String(row.regime ?? "unknown"), minSignals);

    res.json({
      days,
      since: since.toISOString(),
      totalRows: rows.length,
      minSignals,
      overall: computeCohortMetrics(rows),
      rows: buckets,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch proof metrics by regime");
    res.status(503).json({ error: "proof_by_regime_failed", message: "Failed to fetch proof metrics by regime" });
  }
});

// ─── GET /api/system/proof/oos-vs-is — in-sample vs out-of-sample view ─────
router.get("/system/proof/oos-vs-is", async (req, res) => {
  try {
    const lookbackDays = parseIntRange(req.query.lookback_days, 90, 14, 730);
    const oosDays = parseIntRange(req.query.oos_days, 14, 3, 120);
    const minSignals = parseIntRange(req.query.min_signals, 10, 1, 5000);
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const oosSince = new Date(Date.now() - oosDays * 24 * 60 * 60 * 1000);

    const rows: AccuracyProofRow[] = await db
      .select({
        setup_type: accuracyResultsTable.setup_type,
        regime: accuracyResultsTable.regime,
        symbol: accuracyResultsTable.symbol,
        outcome: accuracyResultsTable.outcome,
        tp_ticks: accuracyResultsTable.tp_ticks,
        sl_ticks: accuracyResultsTable.sl_ticks,
        final_quality: accuracyResultsTable.final_quality,
        created_at: accuracyResultsTable.created_at,
      })
      .from(accuracyResultsTable)
      .where(
        and(
          gte(accuracyResultsTable.created_at, since),
          or(eq(accuracyResultsTable.outcome, "win"), eq(accuracyResultsTable.outcome, "loss")),
          isNotNull(accuracyResultsTable.final_quality),
        ),
      )
      .orderBy(desc(accuracyResultsTable.created_at))
      .limit(150_000);

    const inSampleRows = rows.filter((row) => row.created_at < oosSince);
    const outOfSampleRows = rows.filter((row) => row.created_at >= oosSince);
    const inSample = computeCohortMetrics(inSampleRows);
    const outOfSample = computeCohortMetrics(outOfSampleRows);

    const inSampleBySetup = bucketizeProofRows(inSampleRows, (row) => String(row.setup_type ?? "unknown"), minSignals).slice(0, 12);
    const outOfSampleBySetup = bucketizeProofRows(outOfSampleRows, (row) => String(row.setup_type ?? "unknown"), minSignals).slice(0, 12);
    const oosMap = new Map(outOfSampleBySetup.map((row) => [row.key, row]));

    const setupDelta = inSampleBySetup.map((isRow) => {
      const oosRow = oosMap.get(isRow.key);
      return {
        setup: isRow.key,
        inSampleWinRate: Number(isRow.winRate.toFixed(4)),
        outOfSampleWinRate: Number((oosRow?.winRate ?? 0).toFixed(4)),
        winRateDelta: Number(((oosRow?.winRate ?? 0) - isRow.winRate).toFixed(4)),
        inSampleExpectancyR: Number(isRow.expectancyR.toFixed(4)),
        outOfSampleExpectancyR: Number((oosRow?.expectancyR ?? 0).toFixed(4)),
        expectancyDeltaR: Number(((oosRow?.expectancyR ?? 0) - isRow.expectancyR).toFixed(4)),
        inSampleClosed: isRow.closedSignals,
        outOfSampleClosed: oosRow?.closedSignals ?? 0,
      };
    });

    res.json({
      lookbackDays,
      oosDays,
      since: since.toISOString(),
      oosSince: oosSince.toISOString(),
      totalRows: rows.length,
      inSample,
      outOfSample,
      deltas: {
        winRateDelta: Number((outOfSample.winRate - inSample.winRate).toFixed(4)),
        expectancyDeltaR: Number((outOfSample.expectancyR - inSample.expectancyR).toFixed(4)),
        avgFinalQualityDelta: Number((outOfSample.avgFinalQuality - inSample.avgFinalQuality).toFixed(4)),
      },
      bySetup: {
        inSample: inSampleBySetup,
        outOfSample: outOfSampleBySetup,
        delta: setupDelta,
      },
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch OOS vs IS proof metrics");
    res.status(503).json({ error: "proof_oos_vs_is_failed", message: "Failed to fetch OOS vs IS proof metrics" });
  }
});

// ─── GET /api/system/risk — current runtime risk controls ───────────────────
router.get("/system/risk", (_req, res) => {
  res.json({
    ...getRiskEngineSnapshot(),
    fetched_at: new Date().toISOString(),
  });
});

// ─── PUT /api/system/risk — update runtime risk controls ────────────────────
router.put("/system/risk", requireOperator, (req, res) => {
  try {
    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, unknown>;
    const updated = updateRiskConfig({
      maxRiskPerTradePct: body.maxRiskPerTradePct as number | undefined,
      maxDailyLossUsd: body.maxDailyLossUsd as number | undefined,
      maxOpenExposurePct: body.maxOpenExposurePct as number | undefined,
      maxConcurrentPositions: body.maxConcurrentPositions as number | undefined,
      maxTradesPerSession: body.maxTradesPerSession as number | undefined,
      cooldownAfterLosses: body.cooldownAfterLosses as number | undefined,
      cooldownMinutes: body.cooldownMinutes as number | undefined,
      blockOnDegradedData: body.blockOnDegradedData as boolean | undefined,
      allowAsianSession: body.allowAsianSession as boolean | undefined,
      allowLondonSession: body.allowLondonSession as boolean | undefined,
      allowNySession: body.allowNySession as boolean | undefined,
      newsLockoutActive: body.newsLockoutActive as boolean | undefined,
    });
    res.json({
      ...updated,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update runtime risk controls");
    res.status(503).json({ error: "risk_update_failed", message: "Failed to update runtime risk controls" });
  }
});

// ─── POST /api/system/risk/reset — reset runtime risk state ─────────────────
router.post("/system/risk/reset", requireOperator, (_req, res) => {
  const state = resetRiskEngineRuntime();
  res.json({
    ...state,
    reset_at: new Date().toISOString(),
  });
});

// POST /system/kill-switch removed — handled by routes/kill_switch.ts
// (the new handler takes {reason} body and writes to lib/kill_switch state
// which is the store the webhook gate reads).


// ─── GET /api/system/audit — recent audit events ─────────────────────────────
router.get("/system/audit", async (req, res) => {
  try {
    if (!auditEventsTableReady) {
      await db.execute(sql.raw(CREATE_AUDIT_EVENTS_TABLE_SQL));
      auditEventsTableReady = true;
    }
    const limitRaw = Number(req.query.limit ?? 100);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 100, 1), 500);
    const eventType = String(req.query.event_type ?? "").trim();
    const decisionState = String(req.query.decision_state ?? "").trim();
    const symbol = String(req.query.symbol ?? "").trim().toUpperCase();

    let events;
    if (eventType && decisionState && symbol) {
      events = await db
        .select()
        .from(auditEventsTable)
        .where(
          and(
            eq(auditEventsTable.event_type, eventType),
            eq(auditEventsTable.decision_state, decisionState),
            eq(auditEventsTable.symbol, symbol),
          ),
        )
        .orderBy(desc(auditEventsTable.created_at))
        .limit(limit);
    } else if (eventType && decisionState) {
      events = await db
        .select()
        .from(auditEventsTable)
        .where(and(eq(auditEventsTable.event_type, eventType), eq(auditEventsTable.decision_state, decisionState)))
        .orderBy(desc(auditEventsTable.created_at))
        .limit(limit);
    } else if (eventType && symbol) {
      events = await db
        .select()
        .from(auditEventsTable)
        .where(and(eq(auditEventsTable.event_type, eventType), eq(auditEventsTable.symbol, symbol)))
        .orderBy(desc(auditEventsTable.created_at))
        .limit(limit);
    } else if (decisionState && symbol) {
      events = await db
        .select()
        .from(auditEventsTable)
        .where(and(eq(auditEventsTable.decision_state, decisionState), eq(auditEventsTable.symbol, symbol)))
        .orderBy(desc(auditEventsTable.created_at))
        .limit(limit);
    } else if (eventType) {
      events = await db
        .select()
        .from(auditEventsTable)
        .where(eq(auditEventsTable.event_type, eventType))
        .orderBy(desc(auditEventsTable.created_at))
        .limit(limit);
    } else if (decisionState) {
      events = await db
        .select()
        .from(auditEventsTable)
        .where(eq(auditEventsTable.decision_state, decisionState))
        .orderBy(desc(auditEventsTable.created_at))
        .limit(limit);
    } else if (symbol) {
      events = await db
        .select()
        .from(auditEventsTable)
        .where(eq(auditEventsTable.symbol, symbol))
        .orderBy(desc(auditEventsTable.created_at))
        .limit(limit);
    } else {
      events = await db
        .select()
        .from(auditEventsTable)
        .orderBy(desc(auditEventsTable.created_at))
        .limit(limit);
    }

    res.json({
      events,
      count: events.length,
      limit,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch audit events");
    res.status(503).json({ error: "audit_fetch_failed", message: "Failed to fetch audit events" });
  }
});

// ─── GET /api/system/audit/summary — aggregate audit health metrics ─────────
router.get("/system/audit/summary", async (req, res) => {
  try {
    if (!auditEventsTableReady) {
      await db.execute(sql.raw(CREATE_AUDIT_EVENTS_TABLE_SQL));
      auditEventsTableReady = true;
    }
    const hoursRaw = Number(req.query.hours ?? 24);
    const hours = Math.min(Math.max(Number.isFinite(hoursRaw) ? Math.trunc(hoursRaw) : 24, 1), 24 * 30);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const rows = await db
      .select()
      .from(auditEventsTable)
      .where(gte(auditEventsTable.created_at, since))
      .orderBy(desc(auditEventsTable.created_at))
      .limit(3000);

    const totals = {
      events: rows.length,
      trade: 0,
      blocked: 0,
      rejected: 0,
      degraded: 0,
      pass: 0,
    };
    const byEventType: Record<string, number> = {};
    const byReason: Record<string, number> = {};

    for (const row of rows) {
      const decision = String(row.decision_state ?? "");
      if (decision === "TRADE") totals.trade += 1;
      if (decision === "BLOCKED_BY_RISK") totals.blocked += 1;
      if (decision === "REJECTED") totals.rejected += 1;
      if (decision === "DEGRADED_DATA") totals.degraded += 1;
      if (decision === "PASS") totals.pass += 1;

      const eventType = String(row.event_type ?? "unknown");
      byEventType[eventType] = (byEventType[eventType] ?? 0) + 1;

      const reason = String(row.reason ?? "").trim();
      if (reason) byReason[reason] = (byReason[reason] ?? 0) + 1;
    }

    const topReasons = Object.entries(byReason)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reason, count]) => ({ reason, count }));
    const topEventTypes = Object.entries(byEventType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([event_type, count]) => ({ event_type, count }));

    res.json({
      hours,
      since: since.toISOString(),
      totals,
      top_reasons: topReasons,
      top_event_types: topEventTypes,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch audit summary");
    res.status(503).json({ error: "audit_summary_failed", message: "Failed to fetch audit summary" });
  }
});

// ─── GET /api/system/governance/overview — strict market-readiness gates ───
router.get("/system/governance/overview", async (req, res) => {
  try {
    const [orchestratorArtifact, replayArtifact, dailyArtifact] = await Promise.all([
      readJsonArtifact("latest_orchestrator_run.json"),
      readJsonArtifact("replay_latest.json"),
      readJsonArtifact("daily_report_latest.json"),
    ]);

    const orchestrator = orchestratorArtifact.data;
    const replay = replayArtifact.data;
    const daily = dailyArtifact.data;
    const strategyControl = ((orchestrator?.data as JsonRecord | undefined)?.strategy_control as JsonRecord | undefined) ?? null;
    const metrics = normalizeGovernanceMetrics(orchestrator, replay);
    const strategyStatus = String(strategyControl?.status ?? "UNKNOWN").toUpperCase();
    const promotionReady = Boolean(strategyControl?.promotion_ready ?? false);
    const strategyReasons = Array.isArray(strategyControl?.reasons)
      ? (strategyControl?.reasons as unknown[]).map((reason) => String(reason))
      : [];
    const dailyTopReasons = toTupleReasonList(daily?.top_reasons);
    const replayGeneratedAt = typeof replay?.generated_at === "string" ? replay.generated_at : null;
    const orchestratorGeneratedAt = typeof orchestrator?.generated_at === "string" ? orchestrator.generated_at : null;
    const dailyGeneratedAt = typeof daily?.generated_at === "string" ? daily.generated_at : null;
    const checks = [
      {
        id: "strategy_active",
        label: "Strategy state is ACTIVE",
        pass: strategyStatus === "ACTIVE",
        actual: strategyStatus,
        target: "ACTIVE",
      },
      {
        id: "promotion_ready",
        label: "Promotion gate ready",
        pass: promotionReady,
        actual: promotionReady,
        target: true,
      },
      {
        id: "sample_size",
        label: "Closed trades sample size",
        pass: metrics.closed_trades >= GOV_MIN_TRADES,
        actual: metrics.closed_trades,
        target: `>= ${GOV_MIN_TRADES}`,
      },
      {
        id: "profit_factor",
        label: "Profit factor",
        pass: metrics.profit_factor >= GOV_MIN_PROFIT_FACTOR,
        actual: Number(metrics.profit_factor.toFixed(4)),
        target: `>= ${GOV_MIN_PROFIT_FACTOR}`,
      },
      {
        id: "expectancy_r",
        label: "Expectancy (R)",
        pass: metrics.expectancy_r >= GOV_MIN_EXPECTANCY_R,
        actual: Number(metrics.expectancy_r.toFixed(4)),
        target: `>= ${GOV_MIN_EXPECTANCY_R}`,
      },
      {
        id: "drawdown",
        label: "Max drawdown (%)",
        pass: metrics.max_drawdown_pct <= GOV_MAX_DRAWDOWN_PCT,
        actual: Number(metrics.max_drawdown_pct.toFixed(4)),
        target: `<= ${GOV_MAX_DRAWDOWN_PCT}`,
      },
      {
        id: "win_rate",
        label: "Win rate",
        pass: metrics.win_rate >= GOV_MIN_WIN_RATE,
        actual: Number(metrics.win_rate.toFixed(4)),
        target: `>= ${GOV_MIN_WIN_RATE}`,
      },
      {
        id: "daily_health",
        label: "Daily system health",
        pass: String(daily?.system_health ?? "").toUpperCase() !== "DEGRADED",
        actual: String(daily?.system_health ?? "UNKNOWN").toUpperCase(),
        target: "GOOD",
      },
    ];

    const missingArtifacts: string[] = [];
    if (!orchestratorArtifact.exists) missingArtifacts.push("latest_orchestrator_run.json");
    if (!replayArtifact.exists) missingArtifacts.push("replay_latest.json");
    if (!dailyArtifact.exists) missingArtifacts.push("daily_report_latest.json");

    const failedChecks = checks.filter((check) => !check.pass).map((check) => check.id);
    const pass = failedChecks.length === 0 && missingArtifacts.length === 0;
    const reasons = [
      ...missingArtifacts.map((name) => `missing_artifact:${name}`),
      ...failedChecks.map((id) => `failed_check:${id}`),
      ...strategyReasons.map((reason) => `strategy_reason:${reason}`),
    ];

    res.json({
      pass,
      status: pass ? "market_ready" : "needs_work",
      generated_at: new Date().toISOString(),
      strict_thresholds: {
        min_closed_trades: GOV_MIN_TRADES,
        min_profit_factor: GOV_MIN_PROFIT_FACTOR,
        min_expectancy_r: GOV_MIN_EXPECTANCY_R,
        max_drawdown_pct: GOV_MAX_DRAWDOWN_PCT,
        min_win_rate: GOV_MIN_WIN_RATE,
      },
      strategy_control: {
        status: strategyStatus,
        promotion_ready: promotionReady,
        reasons: strategyReasons,
      },
      metrics: {
        trades: metrics.trades,
        closed_trades: metrics.closed_trades,
        wins: metrics.wins,
        losses: metrics.losses,
        win_rate: Number(metrics.win_rate.toFixed(6)),
        profit_factor: Number(metrics.profit_factor.toFixed(6)),
        expectancy_r: Number(metrics.expectancy_r.toFixed(6)),
        max_drawdown_pct: Number(metrics.max_drawdown_pct.toFixed(6)),
        total_pnl_pct: Number(metrics.total_pnl_pct.toFixed(6)),
      },
      daily_report: {
        date: String(daily?.date ?? ""),
        symbol: String(daily?.symbol ?? "ALL"),
        trades_taken: parseIntSafe(daily?.trades_taken, 0),
        trades_skipped_or_blocked: parseIntSafe(daily?.trades_skipped_or_blocked, 0),
        system_health: String(daily?.system_health ?? "UNKNOWN").toUpperCase(),
        top_reasons: dailyTopReasons,
      },
      checks,
      reasons,
      sources: {
        orchestrator: {
          exists: orchestratorArtifact.exists,
          path: orchestratorArtifact.path,
          generated_at: orchestratorGeneratedAt,
          error: orchestratorArtifact.error,
        },
        replay: {
          exists: replayArtifact.exists,
          path: replayArtifact.path,
          generated_at: replayGeneratedAt,
          error: replayArtifact.error,
        },
        daily_report: {
          exists: dailyArtifact.exists,
          path: dailyArtifact.path,
          generated_at: dailyGeneratedAt,
          error: dailyArtifact.error,
        },
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch governance overview");
    res.status(503).json({ error: "governance_overview_failed", message: "Failed to fetch governance overview" });
  }
});

// ─── GET /api/system/pipeline/latest — latest staged decision trace ─────────
router.get("/system/pipeline/latest", async (req, res) => {
  try {
    const [orchestratorArtifact, reviewArtifact] = await Promise.all([
      readJsonArtifact("latest_orchestrator_run.json"),
      readJsonArtifact("latest_review_snapshot.json"),
    ]);

    const orchestrator = orchestratorArtifact.data;
    const reviewSnapshot = reviewArtifact.data;
    const pipeline = asRecord(orchestrator?.pipeline) ?? {};
    const data = asRecord(orchestrator?.data) ?? {};
    const signal = asRecord(data.signal) ?? {};
    const scoring = asRecord(data.scoring) ?? {};
    const reasoning = asRecord(data.reasoning) ?? {};
    const hardGates = asRecord(data.hard_gates) ?? {};
    const risk = asRecord(data.risk) ?? {};
    const execution = asRecord(data.execution) ?? {};
    const monitor = asRecord(data.monitor) ?? {};
    const stageOrder = [
      { id: "market_data_news_sentiment", label: "Market Data + News + Sentiment" },
      { id: "hard_gates", label: "Hard Gates" },
      { id: "setup_engine", label: "Setup Engine" },
      { id: "scoring_engine", label: "Scoring Engine" },
      { id: "ai_reasoner", label: "AI Reasoner" },
      { id: "risk_policy_engine", label: "Risk Policy Engine" },
      { id: "approval_or_execution", label: "Human Approval or Paper Execution" },
      { id: "journal_memory_review", label: "Journal + Memory + Review" },
    ];
    const stages = stageOrder.map(({ id, label }) => {
      const raw = asRecord(pipeline[id]) ?? {};
      const status = String(raw.status ?? "unknown");
      return {
        id,
        label,
        status,
        details: raw,
      };
    });
    const failedStageIds = stages
      .filter((stage) => {
        const normalized = stage.status.toLowerCase();
        return ["fail", "failed", "blocked", "error"].includes(normalized);
      })
      .map((stage) => stage.id);

    res.json({
      has_data: orchestratorArtifact.exists,
      generated_at: String(orchestrator?.generated_at ?? ""),
      symbol: String(orchestrator?.symbol ?? ""),
      live: Boolean(orchestrator?.live ?? false),
      dry_run: Boolean(orchestrator?.dry_run ?? true),
      human_approval: Boolean(orchestrator?.human_approval ?? false),
      blocked: Boolean(orchestrator?.blocked ?? false),
      block_reason: String(orchestrator?.block_reason ?? ""),
      errors: Array.isArray(orchestrator?.errors) ? orchestrator?.errors : [],
      failed_stages: failedStageIds,
      stages,
      summary: {
        signal: {
          action: String(signal.action ?? "skip"),
          setup: String(signal.setup ?? "unknown"),
          confidence: Number(parseNum(signal.confidence, 0).toFixed(6)),
          close_price: Number(parseNum(signal.close_price, 0).toFixed(6)),
        },
        hard_gates: {
          pass: Boolean(hardGates.pass ?? false),
          failed_reasons: Array.isArray(hardGates.failed_reasons) ? hardGates.failed_reasons : [],
          pass_ratio: Number(parseNum(hardGates.pass_ratio, 0).toFixed(6)),
        },
        scoring: {
          pass: Boolean(scoring.pass ?? false),
          final_score: Number(parseNum(scoring.final_score, 0).toFixed(6)),
          grade: String(scoring.grade ?? "C"),
          reasons: Array.isArray(scoring.reasons) ? scoring.reasons : [],
        },
        reasoning: {
          approved: Boolean(reasoning.approved ?? false),
          final_action: String(reasoning.final_action ?? "skip"),
          final_score: Number(parseNum(reasoning.final_score, 0).toFixed(6)),
          reasons: Array.isArray(reasoning.reasons) ? reasoning.reasons : [],
          challenge_points: Array.isArray(reasoning.challenge_points) ? reasoning.challenge_points : [],
        },
        risk: {
          allowed: Boolean(risk.allowed ?? false),
          reason: String(risk.reason ?? ""),
          qty: parseIntSafe(risk.qty, 0),
        },
        execution: {
          status: String(execution.status ?? "unknown"),
          side: String(execution.side ?? ""),
          qty: parseIntSafe(execution.qty, 0),
          order_id: String(execution.order_id ?? ""),
        },
        monitor: {
          recorded_at: String(monitor.recorded_at ?? ""),
          trade_outcome: String(monitor.trade_outcome ?? ""),
        },
      },
      review_snapshot: reviewSnapshot,
      sources: {
        orchestrator: {
          exists: orchestratorArtifact.exists,
          path: orchestratorArtifact.path,
          error: orchestratorArtifact.error,
        },
        review_snapshot: {
          exists: reviewArtifact.exists,
          path: reviewArtifact.path,
          error: reviewArtifact.error,
        },
      },
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch latest pipeline trace");
    res.status(503).json({ error: "pipeline_trace_failed", message: "Failed to fetch latest pipeline trace" });
  }
});

// ─── GET /api/system/consciousness/latest — normalized stock brain snapshot ─
router.get("/system/consciousness/latest", async (req, res) => {
  try {
    const orchestratorArtifact = await readJsonArtifact("latest_orchestrator_run.json");
    const orchestrator = orchestratorArtifact.data;
    if (!orchestratorArtifact.exists || !orchestrator) {
      res.json({
        has_data: false,
        generated_at: "",
        board: [],
        source: {
          exists: orchestratorArtifact.exists,
          path: orchestratorArtifact.path,
          error: orchestratorArtifact.error,
        },
        fetched_at: new Date().toISOString(),
      });
      return;
    }

    const data = asRecord(orchestrator.data) ?? {};
    const signal = asRecord(data.signal) ?? {};
    const scoring = asRecord(data.scoring) ?? asRecord(signal.scoring) ?? {};
    const scoringComponents = asRecord(scoring.components) ?? {};
    const hardGates = asRecord(data.hard_gates) ?? {};
    const session = asRecord(data.session) ?? {};
    const market = asRecord(data.market) ?? {};
    const sentiment = asRecord(data.sentiment) ?? {};
    const macro = asRecord(data.macro) ?? {};
    const reasoning = asRecord(data.reasoning) ?? {};
    const risk = asRecord(data.risk) ?? {};
    const monitor = asRecord(data.monitor) ?? {};
    const learning = asRecord(monitor.learning) ?? {};

    const symbol = String(orchestrator.symbol ?? signal.symbol ?? monitor.symbol ?? "UNKNOWN").toUpperCase();
    const generatedAt = String(orchestrator.generated_at ?? new Date().toISOString());
    const signalAction = String(signal.action ?? "skip").toLowerCase();
    const decisionDirection = signalAction === "buy" ? "long" : signalAction === "sell" ? "short" : "none";
    const sessionAllowed = Boolean(session.allowed ?? hardGates.session_allowed ?? false);
    const macroBlackout = Boolean(macro.blackout ?? false);

    const structureScore = clamp01(parseNum(scoringComponents.structure_score, 0));
    const orderflowScore = clamp01(parseNum(hardGates.liquidity_score, parseNum(scoringComponents.setup_pattern_quality, 0)));
    const sentimentScore = parseNum(sentiment.sentiment_score, 0);
    const contextScore = clamp01(
      (sessionAllowed ? 0.45 : 0.15) +
        (macroBlackout ? 0.0 : 0.25) +
        (1 - clamp01(Math.abs(sentimentScore))) * 0.3,
    );
    const memoryWinRate = clamp01(parseNum(learning.win_rate, 0));
    const memorySamples = parseIntSafe(learning.trades, 0);
    const memoryScore = memorySamples > 0 ? memoryWinRate : 0.25;
    const reasoningScore = clamp01(parseNum(reasoning.final_score, parseNum(scoring.final_score, 0)));
    const riskScore = clamp01(parseNum(scoring.risk_score, 0.5));
    const attentionScore = clamp01(
      structureScore * 0.30 +
        orderflowScore * 0.22 +
        contextScore * 0.12 +
        memoryScore * 0.16 +
        reasoningScore * 0.10 +
        riskScore * 0.10,
    );

    const tradeAllowed = Boolean(risk.allowed ?? false);
    const blockReasons = Array.isArray(reasoning.reasons)
      ? reasoning.reasons.map((item) => String(item))
      : orchestrator.blocked
      ? [String(orchestrator.block_reason ?? "pipeline_blocked")]
      : [];
    const finalState: "allow" | "watch" | "block" = tradeAllowed && signalAction !== "skip" ? "allow" : orchestrator.blocked ? "block" : "watch";

    const stockBrainCandidate = {
      symbol,
      ts: generatedAt,
      session: normalizeSession(session.session),
      timeframes: {
        "1m": {
          symbol,
          timeframe: "1m",
          ts: generatedAt,
          bias: parseNum(market.trend_20, 0) >= 0 ? "bullish" : "bearish",
          confidence: clamp01(parseNum(signal.confidence, 0)),
          trendStrength: clamp01(Math.abs(parseNum(market.trend_20, 0)) * 5),
          momentumScore: clamp01(Math.abs(parseNum(market.trend_20, 0)) * 8),
          structureScore,
          volatilityScore: clamp01(1 - parseNum(market.volatility_100, 0)),
          invalidationLevel: null,
          activeZone: null,
          activeSetup: String(signal.setup ?? scoringComponents.setup ?? "none"),
        },
      },
      tick: {
        symbol,
        ts: generatedAt,
        lastPrice: parseNum(market.last_price, parseNum(signal.close_price, 0)),
        bid: parseNum(market.last_price, parseNum(signal.close_price, 0)),
        ask: parseNum(market.last_price, parseNum(signal.close_price, 0)),
        spread: parseNum(hardGates.spread_quality_score, 0),
        tickVelocity: clamp01(parseNum(market.volatility_100, 0) * 15),
        aggressionScore: orderflowScore,
        burstProbability: clamp01(parseNum(scoringComponents.model_confidence, 0)),
        reversalProbability: clamp01(1 - parseNum(scoringComponents.model_confidence, 0)),
        quoteImbalance: 0,
        microVolatility: clamp01(parseNum(market.volatility_100, 0) * 10),
      },
      structure: {
        symbol,
        ts: generatedAt,
        htfBias: parseNum(market.trend_20, 0) >= 0 ? "bullish" : "bearish",
        itfBias: parseNum(market.trend_20, 0) >= 0 ? "bullish" : "bearish",
        ltfBias: signalAction === "buy" ? "bullish_pullback" : signalAction === "sell" ? "bearish_pullback" : "neutral",
        bosCount: 0,
        chochDetected: false,
        liquiditySweepDetected: String(signal.setup ?? "").toLowerCase().includes("sweep"),
        sweepSide: "none",
        orderBlockType: signalAction === "buy" ? "bullish" : signalAction === "sell" ? "bearish" : "none",
        orderBlockTimeframe: null,
        fairValueGapDetected: false,
        premiumDiscountState: "equilibrium",
        structureScore,
        setupFamily: String(signal.setup ?? scoringComponents.setup ?? "none").toLowerCase().includes("sweep")
          ? "sweep_reclaim"
          : String(signal.setup ?? scoringComponents.setup ?? "none").toLowerCase().includes("continuation")
          ? "breakout_continuation"
          : "none",
      },
      orderflow: {
        symbol,
        ts: generatedAt,
        deltaScore: orderflowScore,
        cvdSlope: parseNum(market.trend_20, 0),
        cvdTrend: parseNum(market.trend_20, 0) > 0 ? "up" : parseNum(market.trend_20, 0) < 0 ? "down" : "flat",
        aggressionBuyScore: signalAction === "buy" ? orderflowScore : clamp01(orderflowScore * 0.5),
        aggressionSellScore: signalAction === "sell" ? orderflowScore : clamp01(orderflowScore * 0.5),
        imbalanceScore: clamp01(parseNum(hardGates.pass_ratio, 0)),
        absorptionScore: clamp01(parseNum(scoringComponents.setup_pattern_quality, 0)),
        exhaustionScore: clamp01(1 - parseNum(scoringComponents.model_confidence, 0)),
        orderflowScore,
        supportiveDirection: decisionDirection,
      },
      context: {
        symbol,
        ts: generatedAt,
        session: normalizeSession(session.session),
        marketRegime: normalizeRegime(market.regime),
        sectorStrength: 0,
        indexAlignmentScore: clamp01(parseNum(hardGates.pass_ratio, 0)),
        earningsProximityMinutes: null,
        macroPressure: macroBlackout ? "headwind" : "neutral",
        newsHeatScore: clamp01(Math.abs(sentimentScore)),
        newsSentimentScore: sentimentScore,
        contextScore,
      },
      memory: {
        symbol,
        ts: generatedAt,
        closestSetupCluster: String(signal.setup ?? scoringComponents.setup ?? "unknown"),
        similarityScore: memorySamples > 0 ? clamp01(0.5 + memoryWinRate * 0.5) : 0.25,
        historicalWinRate: memorySamples > 0 ? memoryWinRate : null,
        historicalProfitFactor: null,
        avgMAE: null,
        avgMFE: null,
        sampleSize: memorySamples,
        personalityTag: "unknown",
        memoryScore,
      },
      reasoning: {
        symbol,
        ts: generatedAt,
        verdict: toReasoningVerdict(String(reasoning.final_action ?? signalAction), Boolean(reasoning.approved ?? !orchestrator.blocked)),
        confidence: clamp01(parseNum(reasoning.confidence, parseNum(signal.confidence, 0))),
        thesis: Array.isArray(reasoning.reasons) ? reasoning.reasons.map((item) => String(item)).join("; ") : "no_reasoning_output",
        contradictions: Array.isArray(reasoning.challenge_points) ? reasoning.challenge_points.map((item) => String(item)) : [],
        triggerConditions: signalAction === "buy" || signalAction === "sell" ? ["hard_gates_pass", "setup_valid", "risk_allowed"] : [],
        blockConditions: blockReasons,
        recommendedDirection: decisionDirection,
        recommendedEntryType: signalAction === "skip" ? "none" : "market",
        reasoningScore,
      },
      risk: {
        symbol,
        ts: generatedAt,
        tradeAllowed,
        blockReasons,
        sizingMultiplier: tradeAllowed ? 1 : 0,
        maxRiskDollars: parseNum(risk.account_equity, 0) * 0.01,
        stopDistance: null,
        targetDistance: null,
        slippageRiskScore: clamp01(1 - parseNum(hardGates.spread_quality_score, 0)),
        exposureRiskScore: clamp01(1 - riskScore),
        drawdownGuardActive: !tradeAllowed && blockReasons.includes("risk_blocked"),
        riskScore,
      },
      finalDecision: {
        signalId: String(orchestrator.generated_at ?? generatedAt),
        symbol,
        ts: generatedAt,
        direction: decisionDirection,
        state: finalState,
        setupFamily: String(signal.setup ?? scoringComponents.setup ?? "none"),
        timeframe: "1m",
        entryPrice: parseNumOrNull(signal.close_price),
        stopPrice: null,
        targetPrice: null,
        confidence: clamp01(parseNum(signal.confidence, 0)),
        attentionScore,
        layerScores: {
          structure: structureScore,
          orderflow: orderflowScore,
          context: contextScore,
          memory: memoryScore,
          reasoning: reasoningScore,
          risk: riskScore,
        },
        explanation: Array.isArray(scoring.reasons) ? scoring.reasons.map((item) => String(item)).join("; ") : "no_explanation",
        tags: [
          `setup:${String(signal.setup ?? "none")}`,
          `regime:${String(market.regime ?? "unknown")}`,
          `session:${String(session.session ?? "OFF")}`,
        ],
      },
    };

    // Normalize with shared contracts so UI and backend agree on shapes.
    const brainResult = StockBrainStateSchema.safeParse(stockBrainCandidate);
    if (!brainResult.success) {
      req.log.warn({ issues: brainResult.error.issues }, "Consciousness state validation failed");
      res.status(503).json({
        error: "consciousness_validation_failed",
        message: "Failed to normalize latest stock brain state",
      });
      return;
    }
    const stockBrain: StockBrainState = brainResult.data;

    const board = [
      {
        symbol: stockBrain.symbol,
        attention_score: stockBrain.finalDecision?.attentionScore ?? attentionScore,
        readiness: stockBrain.finalDecision?.state ?? "watch",
        setup_family: stockBrain.structure.setupFamily,
        direction: stockBrain.finalDecision?.direction ?? "none",
        structure_score: stockBrain.structure.structureScore,
        orderflow_score: stockBrain.orderflow.orderflowScore,
        context_score: stockBrain.context.contextScore,
        memory_score: stockBrain.memory.memoryScore,
        reasoning_score: stockBrain.reasoning?.reasoningScore ?? 0,
        risk_score: stockBrain.risk.riskScore,
        reasoning_verdict: stockBrain.reasoning?.verdict ?? "wait",
        risk_state: stockBrain.risk.tradeAllowed ? "allowed" : "blocked",
        block_reason: orchestrator.block_reason ? String(orchestrator.block_reason) : "",
      },
    ];

    res.json({
      has_data: true,
      generated_at: generatedAt,
      board,
      stock_brain: stockBrain,
      source: {
        exists: orchestratorArtifact.exists,
        path: orchestratorArtifact.path,
        error: orchestratorArtifact.error,
      },
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to build consciousness board snapshot");
    res.status(503).json({ error: "consciousness_snapshot_failed", message: "Failed to fetch consciousness snapshot" });
  }
});

router.get("/market-readiness", async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const approvedTrades = await db
      .select({
        outcome: siDecisionsTable.outcome,
        realized_pnl: siDecisionsTable.realized_pnl,
        final_quality: siDecisionsTable.final_quality,
        created_at: siDecisionsTable.created_at,
        regime: siDecisionsTable.regime,
        enhanced_quality: siDecisionsTable.enhanced_quality,
        edge_score: siDecisionsTable.edge_score,
        win_probability: siDecisionsTable.win_probability,
      })
      .from(siDecisionsTable)
      .where(
        and(
          eq(siDecisionsTable.approved, true),
          gte(siDecisionsTable.created_at, thirtyDaysAgo)
        )
      );

    if (!approvedTrades.length) {
      res.json({
        status: "CAUTION",
        color: "yellow",
        regime: "no_data",
        metrics: {
          win_rate: 0,
          profit_factor: 0,
          sharpe_ratio: 0,
          max_drawdown_pct: 0,
          active_positions: 0,
          daily_trades: 0,
          max_daily_trades: 20,
        },
        conditions: [
          {
            name: "Minimum Trade History",
            met: false,
            description: "No approved trades in the last 30 days",
          },
        ],
        recommended_position_size: 0.5,
        reasoning: "Insufficient trade history. Run backtest or live trades to establish metrics.",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    let wins = 0;
    let losses = 0;
    let totalPnl = 0;
    let totalPnlPct = 0;
    let maxDrawdownPct = 0;
    let dailyTrades = 0;

    const regimeMap = new Map<string, number>();
    let mostCommonRegime = "neutral";

    for (const trade of approvedTrades) {
      const outcome = String(trade.outcome ?? "").toLowerCase();
      if (outcome === "win") {
        wins += 1;
      } else if (outcome === "loss") {
        losses += 1;
      }

      const pnl = parseNum(trade.realized_pnl);
      totalPnl += pnl;
      totalPnlPct += pnl > 0 ? 1 : -1;

      const regime = String(trade.regime ?? "neutral");
      regimeMap.set(regime, (regimeMap.get(regime) ?? 0) + 1);

      const quality = parseNum(trade.final_quality);
      if (quality < 30) {
        maxDrawdownPct = Math.max(maxDrawdownPct, Math.abs(quality - 50));
      }
    }

    const closedTrades = wins + losses;
    const winRate = closedTrades > 0 ? wins / closedTrades : 0;
    const profitFactor = losses > 0 ? (totalPnl > 0 ? Math.abs(totalPnl) / losses : 0) : totalPnl > 0 ? 999 : 0;
    const sharpeRatio = closedTrades > 0 ? (totalPnl / Math.sqrt(Math.abs(totalPnl) || 1)) * Math.sqrt(252) : 0;

    if (regimeMap.size > 0) {
      mostCommonRegime = Array.from(regimeMap.entries()).sort((a, b) => b[1] - a[1])[0][0];
    }

    const { positions } = await getCachedAlpacaData();
    const activePositions = positions.length;
    dailyTrades = approvedTrades.filter((t: { created_at: Date | string | null }) => {
      const tradeDate = new Date(t.created_at ?? 0);
      const today = new Date();
      return (
        tradeDate.getFullYear() === today.getFullYear() &&
        tradeDate.getMonth() === today.getMonth() &&
        tradeDate.getDate() === today.getDate()
      );
    }).length;

    const conditions: Array<{
      name: string;
      met: boolean;
      description: string;
    }> = [
      {
        name: "Win Rate Threshold",
        met: winRate > 0.45,
        description: `Win rate: ${(winRate * 100).toFixed(1)}% (requirement: > 45%)`,
      },
      {
        name: "Profit Factor",
        met: profitFactor > 0.9,
        description: `Profit factor: ${profitFactor.toFixed(2)} (requirement: > 0.9)`,
      },
      {
        name: "Max Drawdown",
        met: maxDrawdownPct < 15,
        description: `Max drawdown: ${maxDrawdownPct.toFixed(1)}% (requirement: < 15%)`,
      },
      {
        name: "Active Positions",
        met: activePositions > 0,
        description: `${activePositions} position(s) currently open`,
      },
      {
        name: "Daily Trade Limit",
        met: dailyTrades < 20,
        description: `${dailyTrades} trades today (max: 20)`,
      },
    ];

    let status: "READY" | "CAUTION" | "STAND_DOWN" = "STAND_DOWN";
    let color: "green" | "yellow" | "red" = "red";

    const readyConditions = winRate > 0.55 && profitFactor > 1.2 && maxDrawdownPct < 10;
    const cautionConditions = winRate > 0.45 && profitFactor > 0.9;

    if (readyConditions) {
      status = "READY";
      color = "green";
    } else if (cautionConditions) {
      status = "CAUTION";
      color = "yellow";
    }

    const basePositionSize = 1.0;
    let positionSizeAdjustment = 0.5;

    if (status === "READY") {
      positionSizeAdjustment = 2.0;
    } else if (status === "CAUTION") {
      positionSizeAdjustment = 1.0;
    }

    const recommendedPositionSize = Math.min(5.0, basePositionSize * positionSizeAdjustment);

    const reasoning =
      status === "READY"
        ? `Excellent conditions: ${(winRate * 100).toFixed(1)}% win rate, ${profitFactor.toFixed(2)} profit factor, ${maxDrawdownPct.toFixed(1)}% drawdown. Recommend normal to elevated position sizes.`
        : status === "CAUTION"
        ? `Fair conditions: ${(winRate * 100).toFixed(1)}% win rate, ${profitFactor.toFixed(2)} profit factor. Recommend reduced position sizes until metrics improve.`
        : `Poor conditions: Win rate ${(winRate * 100).toFixed(1)}%, profit factor ${profitFactor.toFixed(2)}%. Recommend stand-down or minimal position sizes.`;

    res.json({
      status,
      color,
      regime: mostCommonRegime,
      metrics: {
        win_rate: parseFloat(winRate.toFixed(4)),
        profit_factor: parseFloat(profitFactor.toFixed(2)),
        sharpe_ratio: parseFloat(sharpeRatio.toFixed(2)),
        max_drawdown_pct: parseFloat(maxDrawdownPct.toFixed(2)),
        active_positions: activePositions,
        daily_trades: dailyTrades,
        max_daily_trades: 20,
      },
      conditions,
      recommended_position_size: parseFloat(recommendedPositionSize.toFixed(2)),
      reasoning,
      timestamp: new Date().toISOString(),
    });
    return;
  } catch (err) {
    req.log.error({ err }, "Failed to calculate market readiness");
    res.status(503).json({ error: "market_readiness_failed", message: "Failed to calculate market readiness assessment" });
    return;
  }
});

// ─── System Manifest (Phase 62) ───────────────────────────────────────────────
// Single endpoint that enumerates every registered engine/subsystem with status.

const ENGINE_REGISTRY = [
  { name: "risk_engine", module: "../lib/risk_engine" },
  { name: "circuit_breaker", module: "../lib/circuit_breaker" },
  { name: "context_fusion", module: "../engines/context_fusion_engine" },
  { name: "adaptive_learning", module: "../engines/adaptive_learning_engine" },
  { name: "execution_intelligence", module: "../engines/execution_intelligence" },
  { name: "strategy_registry", module: "../engines/strategy_registry" },
  { name: "godsview_lab", module: "../engines/godsview_lab" },
  { name: "walk_forward_stress", module: "../engines/walk_forward_stress" },
  { name: "live_intelligence_monitor", module: "../engines/live_intelligence_monitor" },
  { name: "position_sizing", module: "../engines/position_sizing_oracle" },
  { name: "trade_journal", module: "../lib/trade_journal" },
  { name: "system_orchestrator", module: "../engines/system_orchestrator" },
  { name: "api_gateway", module: "../engines/api_gateway" },
  { name: "equity_engine", module: "../lib/equity_engine" },
  { name: "attribution_engine", module: "../lib/attribution_engine" },
] as const;

router.get("/api/system/manifest", async (_req, res) => {
  const engines: Array<{ name: string; loaded: boolean; error?: string }> = [];

  for (const entry of ENGINE_REGISTRY) {
    try {
      await import(entry.module);
      engines.push({ name: entry.name, loaded: true });
    } catch (err: any) {
      engines.push({ name: entry.name, loaded: false, error: err.message });
    }
  }

  const totalRoutes = 57;
  const loadedEngines = engines.filter((e) => e.loaded).length;

  res.json({
    version: "62.0.0",
    phase: 62,
    codename: "GodsView Production",
    totalRoutes,
    engines,
    engineSummary: { total: engines.length, loaded: loadedEngines, failed: engines.length - loadedEngines },
    systemMode: SYSTEM_MODE,
    uptime: process.uptime(),
    nodeVersion: process.version,
    memoryMB: Math.round(process.memoryUsage.rss() / 1024 / 1024),
    generatedAt: new Date().toISOString(),
  });
});

export default router;
