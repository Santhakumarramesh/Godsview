import { Router, type IRouter } from "express";
import { db, accuracyResultsTable, auditEventsTable, signalsTable, tradesTable } from "@workspace/db";
import { and, desc, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import { getTypedPositions, getAccount, hasValidTradingKey, isBrokerKey } from "../lib/alpaca";
import { getModelDiagnostics, getModelStatus, retrainModel } from "../lib/ml_model";
import { resolveSystemMode, canWriteOrders, isLiveMode } from "@workspace/strategy-core";
import { getCurrentTradingSession, getRiskEngineSnapshot, isKillSwitchActive, isSessionAllowed, resetRiskEngineRuntime, setKillSwitchActive, updateRiskConfig } from "../lib/risk_engine";

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

    const [signalsRow, tradesRow, { positions, account }] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(signalsTable).where(gte(signalsTable.created_at, today)),
      db.select({ count: sql<number>`count(*)` }).from(tradesTable).where(gte(tradesTable.created_at, today)),
      getCachedAlpacaData(),
    ]);

    const unrealizedPnl = positions.reduce((sum, p) => sum + parseFloat(p.unrealized_pl ?? "0"), 0);
    const equity = parseFloat((account as Record<string, string> | null)?.equity ?? "0");
    const buyingPower = parseFloat((account as Record<string, string> | null)?.buying_power ?? "0");
    const accountNumber = (account as Record<string, string> | null)?.account_number ?? null;
    const accountMode = accountNumber ? (accountNumber.startsWith("PA") ? "paper" : "live") : null;
    const accountHasError = typeof account === "object" && account !== null && "error" in account;

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
        status: Number(signalsRow[0].count) > 0 ? ("active" as const) : ("warning" as const),
        message: Number(signalsRow[0].count) > 0
          ? "1m/5m/15m/1h multi-timeframe context ready"
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
    res.status(500).json({ error: "internal_error", message: "Failed to fetch system status" });
  }
});

// ─── POST /api/system/retrain — retrain ML model on demand ──────────────────
router.post("/system/retrain", async (req, res) => {
  try {
    const result = await retrainModel();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
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
    res.status(500).json({ error: "model_diagnostics_failed", message: "Failed to fetch model diagnostics" });
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
    res.status(500).json({ error: "proof_by_setup_failed", message: "Failed to fetch proof metrics by setup" });
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
    res.status(500).json({ error: "proof_by_regime_failed", message: "Failed to fetch proof metrics by regime" });
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
    res.status(500).json({ error: "proof_oos_vs_is_failed", message: "Failed to fetch OOS vs IS proof metrics" });
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
router.put("/system/risk", (req, res) => {
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
    res.status(500).json({ error: "risk_update_failed", message: "Failed to update runtime risk controls" });
  }
});

// ─── POST /api/system/risk/reset — reset runtime risk state ─────────────────
router.post("/system/risk/reset", (_req, res) => {
  const state = resetRiskEngineRuntime();
  res.json({
    ...state,
    reset_at: new Date().toISOString(),
  });
});

// ─── POST /api/system/kill-switch — toggle runtime kill switch ──────────────
router.post("/system/kill-switch", (req, res) => {
  const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const active = Boolean(body.active);
  const state = setKillSwitchActive(active);
  res.json({
    ...state,
    active,
    updated_at: new Date().toISOString(),
  });
});

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
    res.status(500).json({ error: "audit_fetch_failed", message: "Failed to fetch audit events" });
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
    res.status(500).json({ error: "audit_summary_failed", message: "Failed to fetch audit summary" });
  }
});

export default router;
