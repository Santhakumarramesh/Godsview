import { Router, type IRouter } from "express";
import { db, auditEventsTable, signalsTable, tradesTable } from "@workspace/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getTypedPositions, getAccount, hasValidTradingKey, isBrokerKey } from "../lib/alpaca";
import { getModelStatus, retrainModel } from "../lib/ml_model";
import { resolveSystemMode, canWriteOrders, isLiveMode } from "@workspace/strategy-core";
import { getRiskEngineSnapshot, isKillSwitchActive, resetRiskEngineRuntime, setKillSwitchActive, updateRiskConfig } from "../lib/risk_engine";

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

    const tradingApiStatus = hasValidTradingKey ? "active" : isBrokerKey ? "warning" : "error";
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
        status: tradingApiStatus,
        message: hasValidTradingKey
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

    const hour = new Date().getUTCHours();
    let active_session = "Overnight";
    if (hour >= 13 && hour < 22) active_session = "NY";
    else if (hour >= 7 && hour < 13) active_session = "London";
    else if (hour >= 0 && hour < 7) active_session = "Asian";
    const killSwitchActive = isKillSwitchActive();

    res.json({
      overall,
      system_mode: SYSTEM_MODE,
      live_writes_enabled: canWriteOrders(SYSTEM_MODE) && !killSwitchActive,
      live_mode: isLiveMode(SYSTEM_MODE),
      trading_kill_switch: killSwitchActive,
      layers,
      news_lockout_active: false,
      active_instrument: activeInstrument,
      active_session,
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

export default router;
