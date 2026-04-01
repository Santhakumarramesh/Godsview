/**
 * routes/leaderboard.ts — Phase 22: Strategy Performance Leaderboard API
 *
 * Endpoints:
 *   GET /api/leaderboard/setups     — Setup rankings by EV/expectancy
 *   GET /api/leaderboard/symbols    — Symbol rankings by EV/expectancy
 *   GET /api/leaderboard/regimes    — Regime rankings by EV/expectancy
 *   GET /api/leaderboard/summary    — Top performers + decaying edges
 */

import { Router, type IRouter } from "express";
import {
  getSetupLeaderboard,
  getSymbolLeaderboard,
  getRegimeLeaderboard,
  getLeaderboardSummary,
} from "../lib/strategy_leaderboard";

const router: IRouter = Router();

/* ── Setup Rankings ───────────────────────────────────────────────────────── */

/**
 * GET /api/leaderboard/setups?min_trades=3
 */
router.get("/leaderboard/setups", (req, res) => {
  const minTrades = parseMinTrades(req.query.min_trades, 3);
  const leaderboard = getSetupLeaderboard(minTrades);
  res.json({ leaderboard, count: leaderboard.length, category: "setup" });
});

/* ── Symbol Rankings ──────────────────────────────────────────────────────── */

/**
 * GET /api/leaderboard/symbols?min_trades=3
 */
router.get("/leaderboard/symbols", (req, res) => {
  const minTrades = parseMinTrades(req.query.min_trades, 3);
  const leaderboard = getSymbolLeaderboard(minTrades);
  res.json({ leaderboard, count: leaderboard.length, category: "symbol" });
});

/* ── Regime Rankings ──────────────────────────────────────────────────────── */

/**
 * GET /api/leaderboard/regimes?min_trades=5
 */
router.get("/leaderboard/regimes", (req, res) => {
  const minTrades = parseMinTrades(req.query.min_trades, 5);
  const leaderboard = getRegimeLeaderboard(minTrades);
  res.json({ leaderboard, count: leaderboard.length, category: "regime" });
});

/* ── Summary ──────────────────────────────────────────────────────────────── */

/**
 * GET /api/leaderboard/summary
 *
 * Returns a pre-computed dashboard-ready summary:
 *   - top 3 setups by expectancy
 *   - top 3 symbols by net PnL
 *   - best regime by win rate
 *   - setups with edge decay warning
 *   - worst setup (consider disabling)
 */
router.get("/leaderboard/summary", (_req, res) => {
  const summary = getLeaderboardSummary();
  res.json(summary);
});

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function parseMinTrades(raw: unknown, fallback: number): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export default router;
