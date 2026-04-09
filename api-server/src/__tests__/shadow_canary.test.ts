/**
 * shadow_canary.test.ts — Phase 30: Shadow Mode & Canary Autonomy Tests
 *
 * Tests:
 *   - Shadow session lifecycle (create, add orders, record outcomes, complete)
 *   - Hypothetical order tracking and PnL calculation
 *   - Market outcome comparison and accuracy scoring
 *   - Canary deployment lifecycle (create, activate, demote, graduate, revoke)
 *   - Auto-demotion rule checking and triggering
 *   - Performance metrics tracking and updates
 *   - Query operations (get, list by strategy, get active)
 *   - Data clearing for testing
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock external dependencies
vi.mock("../lib/logger", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

const importShadow = () => import("../lib/shadow_canary/shadow_mode_manager");
const importCanary = () => import("../lib/shadow_canary/canary_controller");

// ────────────────────────────────────────────────────────────────────────────
// SHADOW SESSION TESTS
// ────────────────────────────────────────────────────────────────────────────

describe("ShadowModeManager — Session Lifecycle", () => {
  beforeEach(async () => {
    const mod = await importShadow();
    mod._clearSessions();
  });

  it("should create a shadow session with shadow mode by default", async () => {
    const mod = await importShadow();
    const result = mod.createShadowSession({
      strategy_id: "strat_001",
      symbol: "AAPL",
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.session_id).toMatch(/^shd_/);
    expect(result.data?.status).toBe("active");
    expect(result.data?.mode).toBe("shadow");
    expect(result.data?.strategy_id).toBe("strat_001");
    expect(result.data?.symbol).toBe("AAPL");
  });

  it("should create a shadow session with canary mode", async () => {
    const mod = await importShadow();
    const result = mod.createShadowSession({
      strategy_id: "strat_002",
      symbol: "TSLA",
      mode: "canary",
    });

    expect(result.success).toBe(true);
    expect(result.data?.mode).toBe("canary");
  });

  it("should add hypothetical order to active session", async () => {
    const mod = await importShadow();
    const sessionResult = mod.createShadowSession({
      strategy_id: "strat_003",
      symbol: "MSFT",
    });

    const sessionId = sessionResult.data!.session_id;
    const orderResult = mod.addHypotheticalOrder(sessionId, {
      side: "buy",
      quantity: 100,
      price: 150.0,
      timestamp: new Date().toISOString(),
      market_price_at_signal: 150.0,
      market_price_after_1m: 151.0,
      market_price_after_5m: 152.0,
      would_have_profit: null,
    });

    expect(orderResult.success).toBe(true);
    expect(orderResult.data?.order_id).toMatch(/^ord_/);
    expect(orderResult.data?.side).toBe("buy");
    expect(orderResult.data?.quantity).toBe(100);
  });

  it("should reject order addition to non-existent session", async () => {
    const mod = await importShadow();
    const result = mod.addHypotheticalOrder("shd_nonexistent", {
      side: "buy",
      quantity: 100,
      price: 150.0,
      timestamp: new Date().toISOString(),
      market_price_at_signal: 150.0,
      market_price_after_1m: null,
      market_price_after_5m: null,
      would_have_profit: null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("session_not_found");
  });

  it("should track multiple orders in a session", async () => {
    const mod = await importShadow();
    const sessionResult = mod.createShadowSession({
      strategy_id: "strat_004",
      symbol: "GOOGL",
    });

    const sessionId = sessionResult.data!.session_id;

    mod.addHypotheticalOrder(sessionId, {
      side: "buy",
      quantity: 50,
      price: 100.0,
      timestamp: new Date().toISOString(),
      market_price_at_signal: 100.0,
      market_price_after_1m: 101.0,
      market_price_after_5m: 102.0,
      would_have_profit: null,
    });

    mod.addHypotheticalOrder(sessionId, {
      side: "sell",
      quantity: 30,
      price: 110.0,
      timestamp: new Date().toISOString(),
      market_price_at_signal: 110.0,
      market_price_after_1m: 109.0,
      market_price_after_5m: 108.0,
      would_have_profit: null,
    });

    const session = mod.getShadowSession(sessionId);
    expect(session?.hypothetical_orders.length).toBe(2);
  });
});

describe("ShadowModeManager — Market Outcomes", () => {
  beforeEach(async () => {
    const mod = await importShadow();
    mod._clearSessions();
  });

  it("should record market outcomes to a session", async () => {
    const mod = await importShadow();
    const sessionResult = mod.createShadowSession({
      strategy_id: "strat_005",
      symbol: "AMZN",
    });

    const sessionId = sessionResult.data!.session_id;
    const now = new Date().toISOString();

    const result1 = mod.recordMarketOutcome(sessionId, {
      timestamp: now,
      price: 150.0,
      volume: 1000000,
    });

    const result2 = mod.recordMarketOutcome(sessionId, {
      timestamp: new Date(Date.now() + 60000).toISOString(),
      price: 151.5,
      volume: 900000,
    });

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    const session = mod.getShadowSession(sessionId);
    expect(session?.actual_market_outcomes.length).toBe(2);
  });

  it("should reject outcome recording to non-active session", async () => {
    const mod = await importShadow();
    const sessionResult = mod.createShadowSession({
      strategy_id: "strat_006",
      symbol: "META",
    });

    const sessionId = sessionResult.data!.session_id;
    mod.completeShadowSession(sessionId, "completed");

    const result = mod.recordMarketOutcome(sessionId, {
      timestamp: new Date().toISOString(),
      price: 200.0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("session_not_active");
  });
});

describe("ShadowModeManager — Session Completion & Comparison", () => {
  beforeEach(async () => {
    const mod = await importShadow();
    mod._clearSessions();
  });

  it("should complete a shadow session", async () => {
    const mod = await importShadow();
    const sessionResult = mod.createShadowSession({
      strategy_id: "strat_007",
      symbol: "NFLX",
    });

    const sessionId = sessionResult.data!.session_id;
    const result = mod.completeShadowSession(sessionId, "completed");

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe("completed");
    expect(result.data?.completed_at).toBeDefined();
  });

  it("should abort a shadow session", async () => {
    const mod = await importShadow();
    const sessionResult = mod.createShadowSession({
      strategy_id: "strat_008",
      symbol: "NVDA",
    });

    const sessionId = sessionResult.data!.session_id;
    const result = mod.completeShadowSession(sessionId, "aborted");

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe("aborted");
  });

  it("should calculate comparison results with orders and outcomes", async () => {
    const mod = await importShadow();
    const sessionResult = mod.createShadowSession({
      strategy_id: "strat_009",
      symbol: "PYPL",
    });

    const sessionId = sessionResult.data!.session_id;
    const now = new Date().toISOString();

    mod.addHypotheticalOrder(sessionId, {
      side: "buy",
      quantity: 100,
      price: 100.0,
      timestamp: now,
      market_price_at_signal: 100.0,
      market_price_after_1m: 101.0,
      market_price_after_5m: 102.0,
      would_have_profit: null,
    });

    mod.recordMarketOutcome(sessionId, {
      timestamp: now,
      price: 100.0,
    });

    mod.recordMarketOutcome(sessionId, {
      timestamp: new Date(Date.now() + 300000).toISOString(),
      price: 103.0,
    });

    const completeResult = mod.completeShadowSession(sessionId, "completed");
    const session = completeResult.data;

    expect(session?.comparison_results).toBeDefined();
    expect(session?.comparison_results?.accuracy_score).toBeGreaterThan(0);
    expect(session?.comparison_results?.timing_quality).toBeDefined();
  });

  it("should calculate positive PnL for profitable buy order", async () => {
    const mod = await importShadow();
    const sessionResult = mod.createShadowSession({
      strategy_id: "strat_010",
      symbol: "INTC",
    });

    const sessionId = sessionResult.data!.session_id;
    const now = new Date().toISOString();

    mod.addHypotheticalOrder(sessionId, {
      side: "buy",
      quantity: 100,
      price: 100.0,
      timestamp: now,
      market_price_at_signal: 100.0,
      market_price_after_1m: 101.0,
      market_price_after_5m: 105.0,
      would_have_profit: null,
    });

    const session = mod.getShadowSession(sessionId);
    expect(session?.pnl_if_executed).toBeGreaterThan(0);
  });
});

describe("ShadowModeManager — Queries", () => {
  beforeEach(async () => {
    const mod = await importShadow();
    mod._clearSessions();
  });

  it("should get all sessions for a strategy", async () => {
    const mod = await importShadow();

    mod.createShadowSession({ strategy_id: "strat_multi_1", symbol: "AAPL" });
    mod.createShadowSession({ strategy_id: "strat_multi_1", symbol: "MSFT" });
    mod.createShadowSession({ strategy_id: "strat_multi_2", symbol: "GOOGL" });

    const strat1Sessions = mod.getShadowSessionsByStrategy("strat_multi_1");
    expect(strat1Sessions.length).toBe(2);

    const strat2Sessions = mod.getShadowSessionsByStrategy("strat_multi_2");
    expect(strat2Sessions.length).toBe(1);
  });

  it("should get active shadow sessions", async () => {
    const mod = await importShadow();

    const s1 = mod.createShadowSession({ strategy_id: "strat_active_1", symbol: "AAPL" });
    const s2 = mod.createShadowSession({ strategy_id: "strat_active_2", symbol: "MSFT" });

    mod.completeShadowSession(s2.data!.session_id, "completed");

    const activeSessions = mod.getActiveShadowSessions();
    expect(activeSessions.length).toBe(1);
    expect(activeSessions[0].session_id).toBe(s1.data!.session_id);
  });

  it("should get all shadow sessions", async () => {
    const mod = await importShadow();

    mod.createShadowSession({ strategy_id: "strat_all_1", symbol: "AAPL" });
    mod.createShadowSession({ strategy_id: "strat_all_2", symbol: "MSFT" });
    mod.createShadowSession({ strategy_id: "strat_all_3", symbol: "GOOGL" });

    const allSessions = mod.getAllShadowSessions();
    expect(allSessions.length).toBe(3);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CANARY CONTROLLER TESTS
// ────────────────────────────────────────────────────────────────────────────

describe("CanaryController — Deployment Lifecycle", () => {
  beforeEach(async () => {
    const mod = await importCanary();
    mod._clearDeployments();
  });

  it("should create a canary deployment in pending status", async () => {
    const mod = await importCanary();
    const result = mod.createCanaryDeployment({
      strategy_id: "can_strat_001",
      symbols_allowed: ["AAPL", "MSFT"],
      max_position_size: 10000,
      max_daily_trades: 5,
      trust_tier_required: "gold",
      regime_allowed: ["bullish", "neutral"],
      auto_demotion_rules: [],
    });

    expect(result.success).toBe(true);
    expect(result.data?.deployment_id).toMatch(/^can_/);
    expect(result.data?.status).toBe("pending");
    expect(result.data?.trades_executed).toBe(0);
  });

  it("should activate a pending canary deployment", async () => {
    const mod = await importCanary();
    const createResult = mod.createCanaryDeployment({
      strategy_id: "can_strat_002",
      symbols_allowed: ["TSLA"],
      max_position_size: 5000,
      max_daily_trades: 3,
      trust_tier_required: "silver",
      regime_allowed: [],
      auto_demotion_rules: [],
    });

    const deploymentId = createResult.data!.deployment_id;
    const activateResult = mod.activateCanary(deploymentId);

    expect(activateResult.success).toBe(true);
    expect(activateResult.data?.status).toBe("active");
    expect(activateResult.data?.activated_at).toBeDefined();
  });

  it("should reject activation of non-pending deployment", async () => {
    const mod = await importCanary();
    const createResult = mod.createCanaryDeployment({
      strategy_id: "can_strat_003",
      symbols_allowed: ["NVDA"],
      max_position_size: 7500,
      max_daily_trades: 4,
      trust_tier_required: "bronze",
      regime_allowed: [],
      auto_demotion_rules: [],
    });

    const deploymentId = createResult.data!.deployment_id;
    mod.activateCanary(deploymentId);

    const result = mod.activateCanary(deploymentId);
    expect(result.success).toBe(false);
    expect(result.error).toBe("deployment_not_pending");
  });

  it("should demote an active canary deployment", async () => {
    const mod = await importCanary();
    const createResult = mod.createCanaryDeployment({
      strategy_id: "can_strat_004",
      symbols_allowed: ["GOOGL"],
      max_position_size: 12000,
      max_daily_trades: 6,
      trust_tier_required: "platinum",
      regime_allowed: [],
      auto_demotion_rules: [],
    });

    const deploymentId = createResult.data!.deployment_id;
    mod.activateCanary(deploymentId);

    const demoteResult = mod.demoteCanary(deploymentId, "excessive_drawdown");

    expect(demoteResult.success).toBe(true);
    expect(demoteResult.data?.status).toBe("demoted");
    expect(demoteResult.data?.demotion_reasons).toContain("excessive_drawdown");
  });

  it("should graduate an active canary to production", async () => {
    const mod = await importCanary();
    const createResult = mod.createCanaryDeployment({
      strategy_id: "can_strat_005",
      symbols_allowed: ["META"],
      max_position_size: 9000,
      max_daily_trades: 5,
      trust_tier_required: "gold",
      regime_allowed: [],
      auto_demotion_rules: [],
    });

    const deploymentId = createResult.data!.deployment_id;
    mod.activateCanary(deploymentId);

    const graduateResult = mod.graduateCanary(deploymentId);

    expect(graduateResult.success).toBe(true);
    expect(graduateResult.data?.status).toBe("graduated");
  });

  it("should revoke a canary deployment", async () => {
    const mod = await importCanary();
    const createResult = mod.createCanaryDeployment({
      strategy_id: "can_strat_006",
      symbols_allowed: ["AMZN"],
      max_position_size: 15000,
      max_daily_trades: 8,
      trust_tier_required: "platinum",
      regime_allowed: [],
      auto_demotion_rules: [],
    });

    const deploymentId = createResult.data!.deployment_id;
    mod.activateCanary(deploymentId);

    const revokeResult = mod.revokeCanary(deploymentId, "regulatory_concern");

    expect(revokeResult.success).toBe(true);
    expect(revokeResult.data?.status).toBe("revoked");
    expect(revokeResult.data?.demotion_reasons).toContain("REVOKED: regulatory_concern");
  });
});

describe("CanaryController — Auto-Demotion Rules", () => {
  beforeEach(async () => {
    const mod = await importCanary();
    mod._clearDeployments();
  });

  it("should check demotion rules against performance metrics", async () => {
    const mod = await importCanary();
    const createResult = mod.createCanaryDeployment({
      strategy_id: "can_strat_rules_1",
      symbols_allowed: ["AAPL"],
      max_position_size: 5000,
      max_daily_trades: 3,
      trust_tier_required: "gold",
      regime_allowed: [],
      auto_demotion_rules: [
        {
          metric: "drawdown",
          threshold: 0.1,
          comparison: "gt",
          action: "demote",
        },
      ],
    });

    const deploymentId = createResult.data!.deployment_id;
    mod.activateCanary(deploymentId);

    // Update metrics to trigger rule
    mod.updatePerformanceMetrics(deploymentId, {
      drawdown: 0.15,
    });

    const checkResult = mod.checkDemotionRules(deploymentId);

    expect(checkResult.success).toBe(true);
    expect(checkResult.data?.triggered_rules.length).toBeGreaterThan(0);
    expect(checkResult.data?.should_demote).toBe(true);
  });

  it("should trigger revoke rule on pnl threshold", async () => {
    const mod = await importCanary();
    const createResult = mod.createCanaryDeployment({
      strategy_id: "can_strat_rules_2",
      symbols_allowed: ["MSFT"],
      max_position_size: 8000,
      max_daily_trades: 4,
      trust_tier_required: "silver",
      regime_allowed: [],
      auto_demotion_rules: [
        {
          metric: "pnl",
          threshold: -5000,
          comparison: "lt",
          action: "revoke",
        },
      ],
    });

    const deploymentId = createResult.data!.deployment_id;
    mod.activateCanary(deploymentId);

    mod.updatePerformanceMetrics(deploymentId, {
      total_pnl: -6000,
    });

    const checkResult = mod.checkDemotionRules(deploymentId);

    expect(checkResult.success).toBe(true);
    expect(checkResult.data?.should_revoke).toBe(true);
  });

  it("should not trigger rules when metrics are within thresholds", async () => {
    const mod = await importCanary();
    const createResult = mod.createCanaryDeployment({
      strategy_id: "can_strat_rules_3",
      symbols_allowed: ["GOOGL"],
      max_position_size: 10000,
      max_daily_trades: 5,
      trust_tier_required: "gold",
      regime_allowed: [],
      auto_demotion_rules: [
        {
          metric: "drawdown",
          threshold: 0.1,
          comparison: "gt",
          action: "demote",
        },
      ],
    });

    const deploymentId = createResult.data!.deployment_id;
    mod.activateCanary(deploymentId);

    mod.updatePerformanceMetrics(deploymentId, {
      drawdown: 0.05,
    });

    const checkResult = mod.checkDemotionRules(deploymentId);

    expect(checkResult.success).toBe(true);
    expect(checkResult.data?.triggered_rules.length).toBe(0);
    expect(checkResult.data?.should_demote).toBe(false);
  });
});

describe("CanaryController — Metrics & Queries", () => {
  beforeEach(async () => {
    const mod = await importCanary();
    mod._clearDeployments();
  });

  it("should update performance metrics", async () => {
    const mod = await importCanary();
    const createResult = mod.createCanaryDeployment({
      strategy_id: "can_strat_metrics_1",
      symbols_allowed: ["TSLA"],
      max_position_size: 6000,
      max_daily_trades: 3,
      trust_tier_required: "bronze",
      regime_allowed: [],
      auto_demotion_rules: [],
    });

    const deploymentId = createResult.data!.deployment_id;

    const updateResult = mod.updatePerformanceMetrics(deploymentId, {
      total_trades: 10,
      total_pnl: 2500,
      win_rate: 0.7,
      drawdown: 0.03,
      sharpe_ratio: 1.5,
    });

    expect(updateResult.success).toBe(true);
    expect(updateResult.data?.performance_metrics.total_trades).toBe(10);
    expect(updateResult.data?.performance_metrics.total_pnl).toBe(2500);
    expect(updateResult.data?.performance_metrics.win_rate).toBe(0.7);
  });

  it("should get all deployments for a strategy", async () => {
    const mod = await importCanary();

    mod.createCanaryDeployment({
      strategy_id: "can_strat_query_1",
      symbols_allowed: ["AAPL"],
      max_position_size: 5000,
      max_daily_trades: 3,
      trust_tier_required: "gold",
      regime_allowed: [],
      auto_demotion_rules: [],
    });

    mod.createCanaryDeployment({
      strategy_id: "can_strat_query_1",
      symbols_allowed: ["MSFT"],
      max_position_size: 5000,
      max_daily_trades: 3,
      trust_tier_required: "silver",
      regime_allowed: [],
      auto_demotion_rules: [],
    });

    mod.createCanaryDeployment({
      strategy_id: "can_strat_query_2",
      symbols_allowed: ["GOOGL"],
      max_position_size: 7000,
      max_daily_trades: 4,
      trust_tier_required: "gold",
      regime_allowed: [],
      auto_demotion_rules: [],
    });

    const strat1Deployments = mod.getDeploymentsByStrategy("can_strat_query_1");
    expect(strat1Deployments.length).toBe(2);

    const strat2Deployments = mod.getDeploymentsByStrategy("can_strat_query_2");
    expect(strat2Deployments.length).toBe(1);
  });

  it("should get all active canary deployments", async () => {
    const mod = await importCanary();

    const d1 = mod.createCanaryDeployment({
      strategy_id: "can_strat_active_1",
      symbols_allowed: ["NVDA"],
      max_position_size: 8000,
      max_daily_trades: 4,
      trust_tier_required: "platinum",
      regime_allowed: [],
      auto_demotion_rules: [],
    });

    const d2 = mod.createCanaryDeployment({
      strategy_id: "can_strat_active_2",
      symbols_allowed: ["META"],
      max_position_size: 6000,
      max_daily_trades: 3,
      trust_tier_required: "gold",
      regime_allowed: [],
      auto_demotion_rules: [],
    });

    mod.activateCanary(d1.data!.deployment_id);
    mod.activateCanary(d2.data!.deployment_id);

    mod.graduateCanary(d2.data!.deployment_id);

    const activeDeployments = mod.getActiveDeployments();
    expect(activeDeployments.length).toBe(1);
    expect(activeDeployments[0].deployment_id).toBe(d1.data!.deployment_id);
  });

  it("should get all deployments", async () => {
    const mod = await importCanary();

    mod.createCanaryDeployment({
      strategy_id: "can_strat_all_1",
      symbols_allowed: ["AAPL"],
      max_position_size: 5000,
      max_daily_trades: 3,
      trust_tier_required: "gold",
      regime_allowed: [],
      auto_demotion_rules: [],
    });

    mod.createCanaryDeployment({
      strategy_id: "can_strat_all_2",
      symbols_allowed: ["MSFT"],
      max_position_size: 6000,
      max_daily_trades: 4,
      trust_tier_required: "silver",
      regime_allowed: [],
      auto_demotion_rules: [],
    });

    mod.createCanaryDeployment({
      strategy_id: "can_strat_all_3",
      symbols_allowed: ["GOOGL"],
      max_position_size: 7000,
      max_daily_trades: 5,
      trust_tier_required: "bronze",
      regime_allowed: [],
      auto_demotion_rules: [],
    });

    const allDeployments = mod.getAllDeployments();
    expect(allDeployments.length).toBe(3);
  });
});

describe("CanaryController — State Management", () => {
  beforeEach(async () => {
    const mod = await importCanary();
    mod._clearDeployments();
  });

  it("should clear all deployments for testing", async () => {
    const mod = await importCanary();

    mod.createCanaryDeployment({
      strategy_id: "can_strat_clear_1",
      symbols_allowed: ["AAPL"],
      max_position_size: 5000,
      max_daily_trades: 3,
      trust_tier_required: "gold",
      regime_allowed: [],
      auto_demotion_rules: [],
    });

    let allDeployments = mod.getAllDeployments();
    expect(allDeployments.length).toBe(1);

    mod._clearDeployments();

    allDeployments = mod.getAllDeployments();
    expect(allDeployments.length).toBe(0);
  });
});

describe("CanaryController — Config with Rules", () => {
  beforeEach(async () => {
    const mod = await importCanary();
    mod._clearDeployments();
  });

  it("should create deployment with multiple demotion rules", async () => {
    const mod = await importCanary();
    const result = mod.createCanaryDeployment({
      strategy_id: "can_strat_multirule",
      symbols_allowed: ["AAPL", "MSFT", "GOOGL"],
      max_position_size: 10000,
      max_daily_trades: 5,
      trust_tier_required: "platinum",
      regime_allowed: ["bullish", "neutral"],
      auto_demotion_rules: [
        {
          metric: "drawdown",
          threshold: 0.15,
          comparison: "gt",
          action: "demote",
        },
        {
          metric: "pnl",
          threshold: -10000,
          comparison: "lt",
          action: "revoke",
        },
        {
          metric: "daily_trades",
          threshold: 10,
          comparison: "gt",
          action: "demote",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.data?.config.auto_demotion_rules.length).toBe(3);
    expect(result.data?.config.auto_demotion_rules[0]).toHaveProperty("rule_id");
  });
});

describe("Integration — Shadow & Canary Together", () => {
  beforeEach(async () => {
    const shadowMod = await importShadow();
    const canaryMod = await importCanary();
    shadowMod._clearSessions();
    canaryMod._clearDeployments();
  });

  it("should support parallel shadow and canary operations", async () => {
    const shadowMod = await importShadow();
    const canaryMod = await importCanary();

    // Create shadow session
    const shadowResult = shadowMod.createShadowSession({
      strategy_id: "strat_integrated",
      symbol: "AAPL",
      mode: "shadow",
    });

    // Create canary deployment
    const canaryResult = canaryMod.createCanaryDeployment({
      strategy_id: "strat_integrated",
      symbols_allowed: ["AAPL"],
      max_position_size: 5000,
      max_daily_trades: 3,
      trust_tier_required: "gold",
      regime_allowed: [],
      auto_demotion_rules: [],
    });

    expect(shadowResult.success).toBe(true);
    expect(canaryResult.success).toBe(true);

    // Verify both are independent
    const shadowSessions = shadowMod.getShadowSessionsByStrategy("strat_integrated");
    const canaryDeployments = canaryMod.getDeploymentsByStrategy("strat_integrated");

    expect(shadowSessions.length).toBe(1);
    expect(canaryDeployments.length).toBe(1);
  });
});
