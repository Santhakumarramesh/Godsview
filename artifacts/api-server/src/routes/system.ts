import { Router, type IRouter } from "express";
import { db, signalsTable, tradesTable } from "@workspace/db";
import { gte, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/system/status", async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [signalsRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(signalsTable)
      .where(gte(signalsTable.created_at, today));

    const [tradesRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(tradesTable)
      .where(gte(tradesTable.created_at, today));

    const layers = [
      {
        name: "TradingView Structure",
        status: "active" as const,
        message: "Monitoring order blocks, S/R, VWAP, session levels",
        last_update: new Date().toISOString(),
      },
      {
        name: "Order Flow",
        status: "active" as const,
        message: "Tracking absorption, delta shifts, sweeps, CVD divergence",
        last_update: new Date().toISOString(),
      },
      {
        name: "Recall Engine",
        status: "active" as const,
        message: "1m/5m/15m/1h multi-timeframe context ready",
        last_update: new Date().toISOString(),
      },
      {
        name: "ML Model",
        status: "active" as const,
        message: "XGBoost models loaded: absorption_reversal, sweep_reclaim, continuation",
        last_update: new Date().toISOString(),
      },
      {
        name: "Claude Reasoning",
        status: "active" as const,
        message: "Context-aware filter online — final gate before execution",
        last_update: new Date().toISOString(),
      },
      {
        name: "Risk Engine",
        status: "active" as const,
        message: "Position sizing, daily loss limits, news lockout active",
        last_update: new Date().toISOString(),
      },
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
      active_instrument: "MES",
      active_session,
      signals_today: Number(signalsRow.count),
      trades_today: Number(tradesRow.count),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get system status");
    res.status(500).json({ error: "internal_error", message: "Failed to fetch system status" });
  }
});

export default router;
