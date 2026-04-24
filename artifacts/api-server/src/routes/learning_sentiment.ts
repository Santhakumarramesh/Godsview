import { Router, type Request, type Response } from "express";
import {
  recordOutcome,
  getRecentOutcomes,
  computeCalibration,
  detectDrift,
  runEvolutionCycle,
  getInsights,
  getInsightsByType,
  getCycles,
  getLearningSummary,
  getSentimentSnapshot,
  getMultiSymbolSentiment,
  getSentimentHistory,
  generateSentimentSignals,
  type TradeOutcome,
} from "../lib/learning_evolution";

const router = Router();

// ── Learning System Endpoints ────────────────────────────────────────────────

// POST /outcome — record a trade outcome for learning
router.post("/outcome", (req: Request, res: Response) => {
  try {
    const o = req.body as TradeOutcome;
    if (!o.tradeId || !o.symbol) { res.status(400).json({ error: "tradeId and symbol required" }); return; }
    const outcome = recordOutcome(o);
    res.json({ ok: true, outcome });
  } catch (err: any) { res.status(503).json({ error: err.message }); }
});

// GET /outcomes — recent trade outcomes
router.get("/outcomes", (req: Request, res: Response) => {
  try {
    const limit = parseInt((req.query.limit as string) || "50", 10);
    const outcomes = getRecentOutcomes(limit);
    res.json({ ok: true, count: outcomes.length, outcomes });
  } catch (err: any) { res.status(503).json({ error: err.message }); }
});

// GET /calibration — confidence calibration report
router.get("/calibration", (_req: Request, res: Response) => {
  try {
    const calibration = computeCalibration();
    res.json({ ok: true, buckets: calibration.length, calibration });
  } catch (err: any) { res.status(503).json({ error: err.message }); }
});

// GET /drift — strategy drift detection
router.get("/drift", (_req: Request, res: Response) => {
  try {
    const drifts = detectDrift();
    res.json({ ok: true, count: drifts.length, drifts });
  } catch (err: any) { res.status(503).json({ error: err.message }); }
});

// POST /evolve — trigger an evolution cycle manually
router.post("/evolve", (_req: Request, res: Response) => {
  try {
    const cycle = runEvolutionCycle();
    res.json({ ok: true, cycle });
  } catch (err: any) { res.status(503).json({ error: err.message }); }
});

// GET /insights — learning insights
router.get("/insights", (req: Request, res: Response) => {
  try {
    const type = req.query.type as string | undefined;
    const limit = parseInt((req.query.limit as string) || "50", 10);
    const insights = type ? getInsightsByType(type as any) : getInsights(limit);
    res.json({ ok: true, count: insights.length, insights });
  } catch (err: any) { res.status(503).json({ error: err.message }); }
});

// GET /cycles — evolution cycle history
router.get("/cycles", (req: Request, res: Response) => {
  try {
    const limit = parseInt((req.query.limit as string) || "20", 10);
    const cycles = getCycles(limit);
    res.json({ ok: true, count: cycles.length, cycles });
  } catch (err: any) { res.status(503).json({ error: err.message }); }
});

// GET /summary — learning system summary
router.get("/summary", (_req: Request, res: Response) => {
  try {
    const summary = getLearningSummary();
    res.json({ ok: true, summary });
  } catch (err: any) { res.status(503).json({ error: err.message }); }
});

// ── Sentiment Engine Endpoints ───────────────────────────────────────────────

// GET /sentiment/:symbol — sentiment snapshot for a symbol
router.get("/sentiment/:symbol", (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase();
    const snapshot = getSentimentSnapshot(symbol);
    res.json({ ok: true, snapshot });
  } catch (err: any) { res.status(503).json({ error: err.message }); }
});

// GET /sentiment-signals/:symbol — raw sentiment signals
router.get("/sentiment-signals/:symbol", (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase();
    const signals = generateSentimentSignals(symbol);
    res.json({ ok: true, symbol, count: signals.length, signals });
  } catch (err: any) { res.status(503).json({ error: err.message }); }
});

// GET /sentiment-history/:symbol — sentiment signal history
router.get("/sentiment-history/:symbol", (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase();
    const limit = parseInt((req.query.limit as string) || "30", 10);
    const history = getSentimentHistory(symbol, limit);
    res.json({ ok: true, symbol, count: history.length, history });
  } catch (err: any) { res.status(503).json({ error: err.message }); }
});

// GET /sentiment-multi — multi-symbol sentiment overview
router.get("/sentiment-multi", (req: Request, res: Response) => {
  try {
    const symbols = req.query.symbols ? (req.query.symbols as string).split(",").map((s) => s.trim().toUpperCase()) : undefined;
    const snapshots = getMultiSymbolSentiment(symbols);
    res.json({ ok: true, count: snapshots.length, snapshots });
  } catch (err: any) { res.status(503).json({ error: err.message }); }
});

// GET /health — health check
router.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "learning-evolution-sentiment", status: "operational", ts: new Date().toISOString() });
});

export default router;
