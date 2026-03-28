import { Router, type IRouter } from "express";
import { db, tradesTable } from "@workspace/db";
import { eq, and, sql, gte } from "drizzle-orm";
import { GetPerformanceQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/performance", async (req, res) => {
  try {
    const query = GetPerformanceQueryParams.parse(req.query);
    const days = query.days ?? 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const conditions: ReturnType<typeof eq>[] = [gte(tradesTable.created_at, since) as ReturnType<typeof eq>];
    if (query.instrument) conditions.push(eq(tradesTable.instrument, query.instrument));
    if (query.setup_type) conditions.push(eq(tradesTable.setup_type, query.setup_type));

    const trades = await db
      .select()
      .from(tradesTable)
      .where(and(...conditions));

    const closedTrades = trades.filter((t) => t.outcome !== "open" && t.pnl !== null);
    const wins = closedTrades.filter((t) => t.outcome === "win");
    const losses = closedTrades.filter((t) => t.outcome === "loss");

    const totalTrades = closedTrades.length;
    const winRate = totalTrades > 0 ? wins.length / totalTrades : 0;
    const totalPnl = closedTrades.reduce((sum, t) => sum + Number(t.pnl ?? 0), 0);
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + Number(t.pnl ?? 0), 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + Number(t.pnl ?? 0), 0) / losses.length) : 0;
    const grossProfit = wins.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + Number(t.pnl ?? 0), 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
    const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;
    const avgMfe = closedTrades.length > 0 ? closedTrades.reduce((s, t) => s + Number(t.mfe ?? 0), 0) / closedTrades.length : 0;
    const avgMae = closedTrades.length > 0 ? closedTrades.reduce((s, t) => s + Number(t.mae ?? 0), 0) / closedTrades.length : 0;
    const avgSlippage = closedTrades.length > 0 ? closedTrades.reduce((s, t) => s + Number(t.slippage ?? 0), 0) / closedTrades.length : 0;

    // Max drawdown
    let peak = 0, equity = 0, maxDrawdown = 0;
    for (const t of closedTrades) {
      equity += Number(t.pnl ?? 0);
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    // By setup
    const setupMap: Record<string, { wins: number; losses: number; pnl: number; grossWin: number; grossLoss: number }> = {};
    for (const t of closedTrades) {
      if (!setupMap[t.setup_type]) setupMap[t.setup_type] = { wins: 0, losses: 0, pnl: 0, grossWin: 0, grossLoss: 0 };
      const pnl = Number(t.pnl ?? 0);
      setupMap[t.setup_type].pnl += pnl;
      if (t.outcome === "win") { setupMap[t.setup_type].wins++; setupMap[t.setup_type].grossWin += pnl; }
      if (t.outcome === "loss") { setupMap[t.setup_type].losses++; setupMap[t.setup_type].grossLoss += Math.abs(pnl); }
    }
    const by_setup = Object.entries(setupMap).map(([setup_type, d]) => {
      const tot = d.wins + d.losses;
      const pf = d.grossLoss > 0 ? d.grossWin / d.grossLoss : d.grossWin > 0 ? 999 : 0;
      const wr = tot > 0 ? d.wins / tot : 0;
      const exp = wr * (tot > 0 ? d.grossWin / Math.max(d.wins, 1) : 0) - (1 - wr) * (tot > 0 ? d.grossLoss / Math.max(d.losses, 1) : 0);
      return { setup_type, total_trades: tot, win_rate: wr, profit_factor: pf, expectancy: exp, total_pnl: d.pnl };
    });

    // By session
    const sessionMap: Record<string, { wins: number; losses: number; pnl: number; grossWin: number; grossLoss: number }> = {};
    for (const t of closedTrades) {
      const s = t.session ?? "Unknown";
      if (!sessionMap[s]) sessionMap[s] = { wins: 0, losses: 0, pnl: 0, grossWin: 0, grossLoss: 0 };
      const pnl = Number(t.pnl ?? 0);
      sessionMap[s].pnl += pnl;
      if (t.outcome === "win") { sessionMap[s].wins++; sessionMap[s].grossWin += pnl; }
      if (t.outcome === "loss") { sessionMap[s].losses++; sessionMap[s].grossLoss += Math.abs(pnl); }
    }
    const by_session = Object.entries(sessionMap).map(([session, d]) => {
      const tot = d.wins + d.losses;
      const pf = d.grossLoss > 0 ? d.grossWin / d.grossLoss : d.grossWin > 0 ? 999 : 0;
      return { session, total_trades: tot, win_rate: tot > 0 ? d.wins / tot : 0, profit_factor: pf, total_pnl: d.pnl };
    });

    // By regime
    const regimeMap: Record<string, { wins: number; losses: number; pnl: number; grossWin: number; grossLoss: number }> = {};
    for (const t of closedTrades) {
      const r = t.regime ?? "Unknown";
      if (!regimeMap[r]) regimeMap[r] = { wins: 0, losses: 0, pnl: 0, grossWin: 0, grossLoss: 0 };
      const pnl = Number(t.pnl ?? 0);
      regimeMap[r].pnl += pnl;
      if (t.outcome === "win") { regimeMap[r].wins++; regimeMap[r].grossWin += pnl; }
      if (t.outcome === "loss") { regimeMap[r].losses++; regimeMap[r].grossLoss += Math.abs(pnl); }
    }
    const by_regime = Object.entries(regimeMap).map(([regime, d]) => {
      const tot = d.wins + d.losses;
      const pf = d.grossLoss > 0 ? d.grossWin / d.grossLoss : d.grossWin > 0 ? 999 : 0;
      return { regime, total_trades: tot, win_rate: tot > 0 ? d.wins / tot : 0, profit_factor: pf, total_pnl: d.pnl };
    });

    // Equity curve by day
    const dayMap: Record<string, number> = {};
    for (const t of closedTrades) {
      const day = t.created_at.toISOString().split("T")[0];
      dayMap[day] = (dayMap[day] ?? 0) + Number(t.pnl ?? 0);
    }
    let runningEquity = 0, runningPeak = 0;
    const equity_curve = Object.entries(dayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, pnl]) => {
        runningEquity += pnl;
        if (runningEquity > runningPeak) runningPeak = runningEquity;
        return { date, equity: runningEquity, drawdown: runningPeak - runningEquity };
      });

    res.json({
      total_trades: totalTrades,
      win_rate: winRate,
      profit_factor: profitFactor,
      expectancy,
      total_pnl: totalPnl,
      avg_win: avgWin,
      avg_loss: avgLoss,
      max_drawdown: maxDrawdown,
      avg_mfe: avgMfe,
      avg_mae: avgMae,
      avg_slippage: avgSlippage,
      by_setup,
      by_session,
      by_regime,
      equity_curve,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get performance");
    res.status(500).json({ error: "internal_error", message: "Failed to fetch performance" });
  }
});

export default router;
