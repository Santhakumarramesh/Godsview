/**
 * routes/analytics.ts — Portfolio Performance & Circuit Breaker REST API
 *
 * Endpoints:
 *   GET  /api/analytics/equity              — full equity report (curve + metrics)
 *   GET  /api/analytics/metrics             — metrics only (lighter weight)
 *   GET  /api/analytics/equity/curve        — just the daily equity curve array
 *   GET  /api/analytics/breakdown/setup     — per-setup breakdown
 *   GET  /api/analytics/breakdown/symbol    — per-symbol breakdown
 *   GET  /api/analytics/breakdown/regime    — per-regime breakdown
 *
 *   GET  /api/analytics/circuit-breaker         — CB status + current readings
 *   POST /api/analytics/circuit-breaker/check   — force a CB evaluation pass
 *   POST /api/analytics/circuit-breaker/reset   — manually reset the CB
 *   POST /api/analytics/circuit-breaker/trip    — manual emergency halt
 *   GET  /api/analytics/circuit-breaker/history — trip history
 */

import { Router } from "express";
import { generateEquityReport } from "../lib/equity_engine";
import {
  getCircuitBreakerStatus,
  checkCircuitBreaker,
  resetCircuitBreaker,
  manualTrip,
  getTripHistory,
} from "../lib/circuit_breaker";

const router = Router();

// ─── Equity Report ────────────────────────────────────────────────────────────

/** GET /api/analytics/equity */
router.get("/analytics/equity", (req, res) => {
  const { symbol, from, to } = req.query as Record<string, string | undefined>;
  const report = generateEquityReport({ symbol, from, to });
  res.json({ report });
});

/** GET /api/analytics/metrics */
router.get("/analytics/metrics", (req, res) => {
  const { symbol, from, to } = req.query as Record<string, string | undefined>;
  const report = generateEquityReport({ symbol, from, to });
  res.json({ metrics: report.metrics, generatedAt: report.generatedAt });
});

/** GET /api/analytics/equity/curve */
router.get("/analytics/equity/curve", (req, res) => {
  const { symbol, from, to } = req.query as Record<string, string | undefined>;
  const report = generateEquityReport({ symbol, from, to });
  res.json({ curve: report.equityCurve, count: report.equityCurve.length, generatedAt: report.generatedAt });
});

// ─── Breakdowns ───────────────────────────────────────────────────────────────

/** GET /api/analytics/breakdown/setup */
router.get("/analytics/breakdown/setup", (req, res) => {
  const { symbol, from, to } = req.query as Record<string, string | undefined>;
  const report = generateEquityReport({ symbol, from, to });
  res.json({ bySetup: report.bySetup, generatedAt: report.generatedAt });
});

/** GET /api/analytics/breakdown/symbol */
router.get("/analytics/breakdown/symbol", (req, res) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  const report = generateEquityReport({ from, to });
  res.json({ bySymbol: report.bySymbol, generatedAt: report.generatedAt });
});

/** GET /api/analytics/breakdown/regime */
router.get("/analytics/breakdown/regime", (req, res) => {
  const { symbol, from, to } = req.query as Record<string, string | undefined>;
  const report = generateEquityReport({ symbol, from, to });
  res.json({ byRegime: report.byRegime, generatedAt: report.generatedAt });
});

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

/** GET /api/analytics/circuit-breaker */
router.get("/analytics/circuit-breaker", (_req, res) => {
  res.json({ status: getCircuitBreakerStatus() });
});

/** POST /api/analytics/circuit-breaker/check — force a CB evaluation pass */
router.post("/analytics/circuit-breaker/check", (_req, res) => {
  const status = checkCircuitBreaker();
  res.json({ status });
});

/** POST /api/analytics/circuit-breaker/reset */
router.post("/analytics/circuit-breaker/reset", (_req, res) => {
  const status = resetCircuitBreaker();
  res.json({ status, reset: true });
});

/** POST /api/analytics/circuit-breaker/trip */
router.post("/analytics/circuit-breaker/trip", (req, res) => {
  const reason = String(req.body?.reason ?? "Manual emergency halt");
  const status = manualTrip(reason);
  res.json({ status, tripped: true });
});

/** GET /api/analytics/circuit-breaker/history */
router.get("/analytics/circuit-breaker/history", (_req, res) => {
  const history = getTripHistory();
  res.json({ history, count: history.totalTrips });
});

// ─── Aliases for frontend compatibility ──────────────────────────────────────

/** GET /api/analytics/summary — alias for /api/analytics/metrics */
router.get("/analytics/summary", (req, res) => {
  const { symbol, from, to } = req.query as Record<string, string | undefined>;
  const report = generateEquityReport({ symbol, from, to });
  res.json({ summary: report.metrics, generatedAt: report.generatedAt });
});

/** GET /api/analytics/equity-curve — alias for /api/analytics/equity/curve */
router.get("/analytics/equity-curve", (req, res) => {
  const { symbol, from, to } = req.query as Record<string, string | undefined>;
  const report = generateEquityReport({ symbol, from, to });
  res.json({ curve: report.equityCurve, count: report.equityCurve.length, generatedAt: report.generatedAt });
});

/** GET /api/analytics/daily-pnl — derived from equity curve */
router.get("/analytics/daily-pnl", (req, res) => {
  const { symbol, from, to } = req.query as Record<string, string | undefined>;
  const report = generateEquityReport({ symbol, from, to });
  const dailyPnl = report.equityCurve.map((pt: { date: string; value: number }, i: number, arr: { date: string; value: number }[]) => ({
    date: pt.date,
    pnl: i === 0 ? 0 : pt.value - arr[i - 1].value,
    cumulative: pt.value,
  }));
  res.json({ dailyPnl, count: dailyPnl.length, generatedAt: report.generatedAt });
});

export default router;
