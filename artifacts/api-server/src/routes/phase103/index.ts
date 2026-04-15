/**
 * Phase 103 — REST surface
 * =========================
 * Single mount-point for every Phase 103 capability so the UI, MCP and
 * external operators can drive the new layer without spelunking through
 * the existing 200+ route catalogue.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  getOrderLifecycle,
  type OrderRequest,
  ReconciliationService,
  type BrokerSnapshot,
} from "../../lib/phase103/broker_reality/index.js";
import { getRecallStore } from "../../lib/phase103/recall_engine/index.js";
import { getAgentBus } from "../../lib/phase103/agents/index.js";
import { getQuantLab } from "../../lib/phase103/quant_lab_unified/index.js";
import { getFusionExplain } from "../../lib/phase103/fusion_explain/index.js";
import { getOrderFlowL2 } from "../../lib/phase103/orderflow_l2/index.js";
import { runE2E } from "../../lib/phase103/e2e_pipeline/index.js";
import {
  runSoak,
  validateAlpacaPaperRoundTrip,
} from "../../lib/phase103/production_gates/index.js";

const router: IRouter = Router();

// ── Broker reality ─────────────────────────────────────────────
router.post("/broker/orders", (req: Request, res: Response) => {
  const body = req.body as OrderRequest;
  if (!body || !body.client_order_id || !body.symbol) {
    return res.status(400).json({ error: "client_order_id+symbol required" });
  }
  const r = getOrderLifecycle().submit(body);
  return res.json(r);
});

router.get("/broker/orders", (_req: Request, res: Response) => {
  res.json(getOrderLifecycle().list());
});

router.get("/broker/orders/:cid", (req: Request, res: Response) => {
  const r = getOrderLifecycle().get(req.params.cid);
  if (!r) return res.status(404).json({ error: "not_found" });
  return res.json(r);
});

router.post("/broker/orders/:cid/cancel", (req: Request, res: Response) => {
  const r = getOrderLifecycle().cancel(
    req.params.cid,
    (req.body && (req.body as { reason?: string }).reason) || "user_cancel",
  );
  res.json(r);
});

router.get("/broker/slippage", (_req: Request, res: Response) => {
  res.json(getOrderLifecycle().slippageStats());
});

router.post("/broker/reconcile", (req: Request, res: Response) => {
  const snap = req.body as BrokerSnapshot;
  if (!snap || !Array.isArray(snap.positions)) {
    return res.status(400).json({ error: "positions required" });
  }
  const svc = new ReconciliationService(
    getOrderLifecycle(),
    () => [], // internal positions provider — wire to portfolio in app.ts override
    () => 0,
  );
  return res.json(svc.reconcile(snap));
});

// ── Recall engine ───────────────────────────────────────────────
router.post("/recall/setups", (req: Request, res: Response) => {
  const body = req.body as Parameters<ReturnType<typeof getRecallStore>["add"]>[0];
  res.json(getRecallStore().add(body));
});

router.post("/recall/similar", (req: Request, res: Response) => {
  const { features, k, threshold } = req.body as {
    features: Parameters<ReturnType<typeof getRecallStore>["findSimilar"]>[0];
    k?: number;
    threshold?: number;
  };
  res.json(getRecallStore().findSimilar(features, k ?? 10, threshold ?? 0.55));
});

router.post("/recall/summary", (req: Request, res: Response) => {
  const { features } = req.body as {
    features: Parameters<ReturnType<typeof getRecallStore>["summarize"]>[0];
  };
  res.json(getRecallStore().summarize(features));
});

router.get("/recall/size", (_req: Request, res: Response) => {
  res.json({ size: getRecallStore().size() });
});

// ── Agents ─────────────────────────────────────────────────────
router.get("/agents/trace/:decision_id", (req: Request, res: Response) => {
  res.json(getAgentBus().trace(req.params.decision_id));
});

router.get("/agents/recent", (req: Request, res: Response) => {
  const limit = Number(req.query.limit ?? 100);
  res.json(getAgentBus().recent(limit));
});

// P2-14: SSE stream of agent events, powering pages/e2e.tsx.
router.get("/agents/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const bus = getAgentBus();
  // Initial backfill so the UI isn't empty on first paint.
  try {
    const recent = bus.recent(Number(req.query.limit ?? 50));
    for (const evt of recent) {
      res.write(`event: agent\ndata: ${JSON.stringify(evt)}\n\n`);
    }
  } catch {
    /* non-fatal */
  }

  const onEvt = (evt: unknown) => {
    res.write(`event: agent\ndata: ${JSON.stringify(evt)}\n\n`);
  };
  // AgentBus.on returns an unsubscribe function; capture them all so req.close
  // cleans up cleanly. The union in agent_bus.ts is the source of truth.
  const AGENT_EVENT_TYPES = [
    "signal.new",
    "signal.validated",
    "signal.rejected",
    "risk.approved",
    "risk.reduced",
    "risk.blocked",
    "execution.requested",
    "execution.fill",
    "execution.failed",
    "learning.update",
    "governance.veto",
    "governance.audit",
  ] as const;
  const unsubscribers: Array<() => void> = [];
  for (const t of AGENT_EVENT_TYPES) {
    unsubscribers.push(bus.on(t as any, onEvt));
  }

  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    for (const u of unsubscribers) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
  });
});

// ── Quant lab unified ──────────────────────────────────────────
router.post("/lab/strategy", (req: Request, res: Response) => {
  res.json(getQuantLab().registerStrategy(req.body));
});
router.get("/lab/strategy", (_req: Request, res: Response) => {
  res.json(getQuantLab().listStrategies());
});
router.post("/lab/backtest", (req: Request, res: Response) => {
  res.json(getQuantLab().recordBacktest(req.body));
});
router.get("/lab/rank", (_req: Request, res: Response) => {
  res.json(getQuantLab().rankStrategies());
});
router.post("/lab/promote/:strategy_id", (req: Request, res: Response) => {
  res.json(getQuantLab().promote(req.params.strategy_id));
});

// ── Fusion + Explain ───────────────────────────────────────────
router.post("/explain/fuse", (req: Request, res: Response) => {
  res.json(getFusionExplain().fuse(req.body));
});
router.get("/explain/decision/:id", (req: Request, res: Response) => {
  const r = getFusionExplain().get(req.params.id);
  if (!r) return res.status(404).json({ error: "not_found" });
  return res.json(r);
});
router.get("/explain/recent", (req: Request, res: Response) => {
  res.json(getFusionExplain().list(Number(req.query.limit ?? 100)));
});

// ── Order flow L2 ──────────────────────────────────────────────
router.post("/orderflow/book", (req: Request, res: Response) => {
  getOrderFlowL2().ingestBook(req.body);
  res.json({ ok: true });
});
router.post("/orderflow/trade", (req: Request, res: Response) => {
  getOrderFlowL2().ingestTrade(req.body);
  res.json({ ok: true });
});
router.get("/orderflow/state/:symbol", (req: Request, res: Response) => {
  const s = getOrderFlowL2().computeState(req.params.symbol);
  if (!s) return res.status(404).json({ error: "no_book" });
  return res.json(s);
});

// ── E2E pipeline ───────────────────────────────────────────────
router.post("/e2e/run", async (req: Request, res: Response) => {
  try {
    const r = await runE2E(req.body);
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "e2e_error" });
  }
});

// ── Production gates ───────────────────────────────────────────
router.post("/gates/soak", async (req: Request, res: Response) => {
  const cfg = req.body as Parameters<typeof runSoak>[0];
  // Hard-cap any operator-driven soak to 5m to protect API server liveness.
  const safe = { ...cfg, duration_ms: Math.min(cfg.duration_ms ?? 1000, 300_000) };
  res.json(await runSoak(safe));
});

router.post("/gates/paper-validate", async (req: Request, res: Response) => {
  res.json(
    await validateAlpacaPaperRoundTrip(
      req.body as Parameters<typeof validateAlpacaPaperRoundTrip>[0],
    ),
  );
});

router.get("/health", (_req: Request, res: Response) => {
  res.json({
    phase: 103,
    status: "ready",
    components: {
      broker_reality: true,
      recall_engine: true,
      agents: true,
      quant_lab: true,
      fusion_explain: true,
      orderflow_l2: true,
      e2e_pipeline: true,
      production_gates: true,
    },
    ts: Date.now(),
  });
});

export default router;
