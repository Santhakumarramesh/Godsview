/**
 * Phase 103 — comprehensive test suite
 * Verifies every new module compiles, behaves, and integrates end-to-end.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  OrderLifecycle,
  ReconciliationService,
  BrokerWsIngestor,
} from "../../lib/phase103/broker_reality/index.js";
import {
  RecallStore,
  embedFeatures,
  cosineSim,
} from "../../lib/phase103/recall_engine/index.js";
import {
  AgentBus,
  bootstrapAgentSystem,
} from "../../lib/phase103/agents/index.js";
import { QuantLabUnified } from "../../lib/phase103/quant_lab_unified/index.js";
import { FusionExplain } from "../../lib/phase103/fusion_explain/index.js";
import { OrderFlowL2Engine } from "../../lib/phase103/orderflow_l2/index.js";
import { runE2E } from "../../lib/phase103/e2e_pipeline/index.js";
import {
  runSoak,
  validateAlpacaPaperRoundTrip,
} from "../../lib/phase103/production_gates/index.js";
import { getOrderLifecycle } from "../../lib/phase103/broker_reality/order_lifecycle.js";

describe("Phase 103 — Broker Execution Reality Layer", () => {
  let lc: OrderLifecycle;
  beforeEach(() => {
    lc = new OrderLifecycle();
  });

  it("walks Order → Pending → Accepted → PartialFill → Filled", () => {
    const r = lc.submit({
      client_order_id: "T1",
      symbol: "AAPL",
      side: "buy",
      qty: 10,
      type: "market",
      tif: "day",
      reference_price: 100,
    });
    expect(r.state).toBe("pending");
    lc.accept("T1", "broker-1");
    expect(lc.get("T1")!.state).toBe("accepted");
    lc.applyFill("T1", { fill_id: "f1", qty: 4, price: 100.5, timestamp: Date.now() });
    expect(lc.get("T1")!.state).toBe("partial");
    lc.applyFill("T1", { fill_id: "f2", qty: 6, price: 100.7, timestamp: Date.now() });
    const final = lc.get("T1")!;
    expect(final.state).toBe("filled");
    expect(final.filled_qty).toBe(10);
    expect(final.realized_slippage_bps).toBeGreaterThan(0);
  });

  it("rejects illegal transitions", () => {
    lc.submit({
      client_order_id: "T2",
      symbol: "X",
      side: "buy",
      qty: 1,
      type: "market",
      tif: "day",
    });
    lc.cancel("T2");
    expect(() => lc.applyFill("T2", { fill_id: "f", qty: 1, price: 1, timestamp: 0 })).toThrow();
  });

  it("ingests broker WS messages", () => {
    const ing = new BrokerWsIngestor(lc);
    lc.submit({ client_order_id: "T3", symbol: "AAPL", side: "buy", qty: 5, type: "market", tif: "day", reference_price: 100 });
    expect(
      ing.ingest({ event: "accepted", order: { id: "broker-3", client_order_id: "T3", status: "accepted" } }).applied,
    ).toBe(true);
    expect(
      ing.ingest({
        event: "fill",
        order: { id: "broker-3", client_order_id: "T3", status: "filled" },
        qty: 5,
        price: 101,
      }).applied,
    ).toBe(true);
    expect(lc.get("T3")!.state).toBe("filled");
  });

  it("reconciles position drift and emits critical alerts", () => {
    const svc = new ReconciliationService(
      lc,
      () => [{ symbol: "AAPL", qty: 100, avg_price: 150 }],
      () => 250,
    );
    const report = svc.reconcile({
      timestamp: Date.now(),
      positions: [{ symbol: "AAPL", qty: 80, avg_price: 150 }],
      orders: [],
    });
    expect(report.total_drifts).toBeGreaterThan(0);
    expect(report.critical_count).toBeGreaterThan(0);
  });
});

describe("Phase 103 — Recall Engine", () => {
  it("produces normalized embeddings + cosine similarity", () => {
    const a = embedFeatures({ symbol: "AAPL", trend: "bullish", setup_type: "ob_retest" });
    const b = embedFeatures({ symbol: "AAPL", trend: "bullish", setup_type: "ob_retest" });
    const c = embedFeatures({ symbol: "TSLA", trend: "bearish", setup_type: "sweep" });
    expect(cosineSim(a, b)).toBeCloseTo(1, 5);
    expect(cosineSim(a, c)).toBeLessThan(0.6);
  });

  it("retrieves similar setups and summarizes outcomes", () => {
    const store = new RecallStore();
    for (let i = 0; i < 10; i++) {
      store.add({
        features: { symbol: "AAPL", trend: "bullish", setup_type: "ob_retest", rr: 2 },
        outcome: i < 7 ? "win" : "loss",
        pnl: i < 7 ? 100 : -50,
        rr_realized: i < 7 ? 2 : -1,
      });
    }
    const sim = store.findSimilar({ symbol: "AAPL", trend: "bullish", setup_type: "ob_retest", rr: 2 });
    expect(sim.length).toBeGreaterThan(0);
    const sum = store.summarize({ symbol: "AAPL", trend: "bullish", setup_type: "ob_retest", rr: 2 });
    expect(sum.win_rate).toBeGreaterThan(0.5);
    expect(store.recallConfidenceMultiplier({ symbol: "AAPL", trend: "bullish", setup_type: "ob_retest" })).toBeGreaterThan(1);
  });
});

describe("Phase 103 — Multi-Agent System", () => {
  it("flows signal → validation → risk → governance → execution → learning", async () => {
    const bus = new AgentBus();
    let learned: string | undefined;
    const sys = bootstrapAgentSystem({
      bus,
      submitOrder: async () => ({ accepted: true, broker_order_id: "B1" }),
      learn: (r) => {
        learned = r.final_state;
      },
    });
    await sys.signal.ingest({
      decision_id: "D1",
      symbol: "NVDA",
      side: "buy",
      qty: 5,
      reference_price: 800,
      setup_type: "breakout",
      confidence: 0.8,
      rr: 2.5,
    });
    await new Promise((r) => setImmediate(r));
    expect(learned).toBe("executed");
    const trace = bus.trace("D1");
    expect(trace.length).toBeGreaterThan(0);
    expect(trace.some((t) => t.type === "execution.fill")).toBe(true);
  });

  it("blocks low-confidence signals at the risk agent", async () => {
    const bus = new AgentBus();
    let final: string | undefined;
    const sys = bootstrapAgentSystem({
      bus,
      learn: (r) => {
        final = r.final_state;
      },
    });
    await sys.signal.ingest({
      decision_id: "D-low",
      symbol: "AAPL",
      side: "buy",
      qty: 5,
      reference_price: 100,
      confidence: 0.1,
    });
    await new Promise((r) => setImmediate(r));
    expect(final).toBe("blocked");
  });
});

describe("Phase 103 — Quant Lab Unified", () => {
  it("ranks strategies and gates promotion", () => {
    const lab = new QuantLabUnified();
    lab.registerStrategy({ id: "s1", name: "Trend follower", dsl: "..." });
    lab.recordBacktest({
      strategy_id: "s1",
      run_id: "r1",
      started_at: 0,
      finished_at: 1,
      metrics: {
        trades: 150,
        win_rate: 0.6,
        profit_factor: 1.5,
        sharpe: 1.2,
        max_drawdown: 0.18,
        expectancy: 0.5,
        total_pnl: 1000,
      },
    });
    const rank = lab.rankStrategies();
    expect(rank[0]!.strategy_id).toBe("s1");
    const promo = lab.evaluatePromotion("s1");
    expect(promo.eligible).toBe(true);
    expect(lab.promote("s1").to).toBe("paper");
  });

  it("rejects promotion when rules unmet", () => {
    const lab = new QuantLabUnified();
    lab.registerStrategy({ id: "s2", name: "Bad", dsl: "..." });
    lab.recordBacktest({
      strategy_id: "s2",
      run_id: "r2",
      started_at: 0,
      finished_at: 1,
      metrics: {
        trades: 10,
        win_rate: 0.4,
        profit_factor: 1.0,
        sharpe: 0.1,
        max_drawdown: 0.5,
        expectancy: -0.1,
        total_pnl: -100,
      },
    });
    const eval2 = lab.evaluatePromotion("s2");
    expect(eval2.eligible).toBe(false);
    expect(eval2.failed_rules.length).toBeGreaterThan(0);
  });
});

describe("Phase 103 — Fusion + Explainability", () => {
  it("produces structured explainability for an approved trade", () => {
    const fx = new FusionExplain();
    const r = fx.fuse({
      decision_id: "X1",
      symbol: "AAPL",
      side: "buy",
      contributions: [
        { source: "structure", weight: 0.7, confidence: 0.8 },
        { source: "flow", weight: 0.6, confidence: 0.7 },
        { source: "macro", weight: -0.1, confidence: 0.2 },
      ],
      regime: "trending",
      recall: { matches: 12, win_rate: 0.65 },
    });
    expect(r.outcome).toBe("approved");
    expect(r.contributions_used.length).toBe(2);
    expect(r.contributions_rejected.length).toBe(1);
    expect(r.confidence.final).toBeGreaterThan(0);
  });

  it("vetoes when governance vetoes, regardless of confidence", () => {
    const fx = new FusionExplain();
    const r = fx.fuse({
      decision_id: "X2",
      symbol: "AAPL",
      side: "buy",
      contributions: [{ source: "structure", weight: 1, confidence: 1 }],
      governance_veto: "kill_switch_active",
    });
    expect(r.outcome).toBe("vetoed");
    expect(r.size_multiplier).toBe(0);
  });
});

describe("Phase 103 — Order Flow L2 Engine", () => {
  it("computes imbalance, walls, and continuation", () => {
    const eng = new OrderFlowL2Engine();
    eng.ingestBook({
      symbol: "AAPL",
      ts: Date.now(),
      bids: [
        { price: 100, size: 1000 },
        { price: 99, size: 200 },
        { price: 98, size: 200 },
        { price: 97, size: 200 },
      ],
      asks: [
        { price: 101, size: 100 },
        { price: 102, size: 100 },
        { price: 103, size: 100 },
        { price: 104, size: 100 },
      ],
    });
    eng.ingestTrade({ symbol: "AAPL", ts: Date.now(), price: 100.5, size: 50, aggressor: "buy" });
    const s = eng.computeState("AAPL")!;
    expect(s.imbalance).toBeGreaterThan(0);
    expect(s.walls.some((w) => w.side === "bid")).toBe(true);
    expect(s.continuation_probability).toBeGreaterThanOrEqual(0);
    expect(s.continuation_probability).toBeLessThanOrEqual(1);
  });
});

describe("Phase 103 — End-to-End pipeline", () => {
  it("runs an approved decision all the way to an order plan", async () => {
    const r = await runE2E({
      raw_signal: {
        decision_id: "E1",
        symbol: "MSFT",
        side: "buy",
        qty: 5,
        reference_price: 400,
        setup_type: "breakout",
        confidence: 0.8,
        rr: 2,
      },
      contributions: [
        { source: "structure", weight: 0.7, confidence: 0.7 },
        { source: "flow", weight: 0.5, confidence: 0.6 },
      ],
      regime: "trending",
      dry_run: true,
    });
    expect(["approved", "reduced"]).toContain(r.status);
    expect(r.explain.confidence.final).toBeGreaterThan(0);
  });

  it("vetoes when governance flags", async () => {
    const r = await runE2E({
      raw_signal: {
        decision_id: "E2",
        symbol: "AAPL",
        side: "buy",
        qty: 1,
        reference_price: 100,
        confidence: 0.9,
      },
      contributions: [{ source: "structure", weight: 1, confidence: 1 }],
      governance_veto: "kill_switch_active",
      dry_run: true,
    });
    expect(r.status).toBe("vetoed");
  });
});

describe("Phase 103 — Production Gates", () => {
  it("runs a tiny soak that reports passed", async () => {
    const r = await runSoak({
      duration_ms: 500,
      rate_per_sec: 20,
      max_error_pct: 0.05,
      dry_run: true,
    });
    expect(r.total_decisions).toBeGreaterThan(0);
    expect(r.errors).toBe(0);
    expect(r.passed).toBe(true);
    expect(r.latency_ms_p95).toBeGreaterThanOrEqual(0);
  });

  it("validates the simulated paper round-trip", async () => {
    // Use a fresh lifecycle id to avoid cross-test interference
    const lc = getOrderLifecycle();
    lc.reset();
    const r = await validateAlpacaPaperRoundTrip({
      symbol: "AAPL",
      qty: 10,
      reference_price: 100,
    });
    expect(r.passed).toBe(true);
    expect(r.realized.qty).toBe(10);
    expect(r.realized.slippage_bps).toBeGreaterThan(0);
  });
});
