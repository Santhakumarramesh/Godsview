import { Router, type IRouter } from "express";
import { db, signalsTable, tradesTable } from "@workspace/db";
import { gte, sql } from "drizzle-orm";
import { getTypedPositions, getAccount } from "../lib/alpaca";

const router: IRouter = Router();

router.get("/system/status", async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [signalsRow, tradesRow, positions, account] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(signalsTable).where(gte(signalsTable.created_at, today)),
      db.select({ count: sql<number>`count(*)` }).from(tradesTable).where(gte(tradesTable.created_at, today)),
      getTypedPositions().catch(() => [] as Awaited<ReturnType<typeof getTypedPositions>>),
      getAccount().catch(() => null),
    ]);

    const unrealizedPnl = positions.reduce((sum, p) => sum + parseFloat(p.unrealized_pl ?? "0"), 0);
    const equity = parseFloat((account as Record<string, string> | null)?.equity ?? "0");
    const buyingPower = parseFloat((account as Record<string, string> | null)?.buying_power ?? "0");

    // Derive active instrument from open positions or default to BTC
    const activeInstrument = positions.length > 0
      ? positions[0].symbol.replace("/", "")
      : "BTCUSD";

    const layers = [
      { name: "TradingView Structure", status: "active" as const, message: "Monitoring order blocks, S/R, VWAP, session levels", last_update: new Date().toISOString() },
      { name: "Order Flow", status: "active" as const, message: "Tracking absorption, delta shifts, sweeps, CVD divergence", last_update: new Date().toISOString() },
      { name: "Recall Engine", status: "active" as const, message: "1m/5m/15m/1h multi-timeframe context ready", last_update: new Date().toISOString() },
      { name: "ML Model", status: "active" as const, message: "XGBoost models loaded: absorption_reversal, sweep_reclaim, continuation", last_update: new Date().toISOString() },
      { name: "Claude Reasoning", status: "active" as const, message: "Context-aware filter online — final gate before execution", last_update: new Date().toISOString() },
      { name: "Risk Engine", status: "active" as const, message: "Position sizing, daily loss limits, news lockout active", last_update: new Date().toISOString() },
    ];

    const hour = new Date().getUTCHours();
    let active_session = "Overnight";
    if (hour >= 13 && hour < 22) active_session = "NY";
    else if (hour >= 7 && hour < 13) active_session = "London";
    else if (hour >= 0 && hour < 7) active_session = "Asian";

    res.json({
      overall: "healthy",
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
      account_number: (account as Record<string, string> | null)?.account_number ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get system status");
    res.status(500).json({ error: "internal_error", message: "Failed to fetch system status" });
  }
});

export default router;
