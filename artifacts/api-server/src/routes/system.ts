import { Router, type IRouter } from "express";
import { db, signalsTable, tradesTable } from "@workspace/db";
import { gte, sql } from "drizzle-orm";
import { getTypedPositions, getAccount, hasValidTradingKey, isBrokerKey } from "../lib/alpaca";
import { getModelStatus, retrainModel } from "../lib/ml_model";

const router: IRouter = Router();

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

    res.json({
      overall,
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

export default router;
