import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  FailureRecoveryEngine,
  type SystemState,
  type PositionSnapshot,
  type PendingOrderSnapshot,
  type BrokerConnectionState,
} from "../lib/failure_recovery";

vi.mock("pino", () => ({
  default: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("pino-pretty", () => ({
  default: vi.fn(),
}));

vi.mock("../../lib/risk_engine", () => ({
  evaluateRisk: vi.fn(),
}));

vi.mock("../../lib/drawdown_breaker", () => ({
  checkDrawdown: vi.fn(),
}));

describe("FailureRecoveryEngine", () => {
  let engine: FailureRecoveryEngine;

  beforeEach(() => {
    engine = new FailureRecoveryEngine();
  });

  describe("System State Capture", () => {
    it("should capture system state with generated ID and timestamp", () => {
      const positions: PositionSnapshot[] = [
        {
          symbol: "AAPL",
          strategy_id: "strat_123",
          quantity: 100,
          avg_price: 150.5,
          side: "long",
          unrealized_pnl: 500,
        },
      ];

      const state = engine.captureSystemState({
        open_positions: positions,
        pending_orders: [],
        active_sessions: ["sess_1"],
        broker_connections: [
          {
            broker_id: "broker_1",
            name: "Interactive Brokers",
            connected: true,
            last_seen: new Date().toISOString(),
          },
        ],
        last_heartbeat: new Date().toISOString(),
        market_phase: "market_open",
      });

      expect(state.id).toMatch(/^state_/);
      expect(state.captured_at).toBeTruthy();
      expect(state.open_positions).toEqual(positions);
      expect(state.market_phase).toBe("market_open");
    });

    it("should retrieve the latest captured state", () => {
      const state1 = engine.captureSystemState({
        open_positions: [],
        pending_orders: [],
        active_sessions: [],
        broker_connections: [],
        last_heartbeat: new Date().toISOString(),
        market_phase: "pre_market",
      });

      // Wait a bit to ensure different timestamps
      const state2 = engine.captureSystemState({
        open_positions: [],
        pending_orders: [],
        active_sessions: [],
        broker_connections: [],
        last_heartbeat: new Date().toISOString(),
        market_phase: "market_open",
      });

      const latest = engine.getLatestState();
      expect(latest?.id).toBe(state2.id);
      expect(latest?.market_phase).toBe("market_open");
      expect(new Date(latest!.captured_at).getTime()).toBeGreaterThanOrEqual(
        new Date(state1.captured_at).getTime()
      );
    });

    it("should return undefined when no state has been captured", () => {
      const latest = engine.getLatestState();
      expect(latest).toBeUndefined();
    });
  });

  describe("Recovery Plan Creation", () => {
    let preState: SystemState;

    beforeEach(() => {
      preState = engine.captureSystemState({
        open_positions: [],
        pending_orders: [],
        active_sessions: [],
        broker_connections: [],
        last_heartbeat: new Date().toISOString(),
        market_phase: "market_open",
      });
    });

    it("should create recovery plan for system restart", () => {
      const plan = engine.createRecoveryPlan("system_restart", preState);

      expect(plan.id).toMatch(/^rp_/);
      expect(plan.trigger).toBe("system_restart");
      expect(plan.status).toBe("pending");
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.steps[0].name).toBe("capture_state");
      expect(plan.steps[plan.steps.length - 1].name).toBe("resume_operations");
    });

    it("should create recovery plan for broker outage", () => {
      const plan = engine.createRecoveryPlan("broker_outage", preState);

      expect(plan.trigger).toBe("broker_outage");
      const stepNames = plan.steps.map((s) => s.name);
      expect(stepNames).toContain("detect_outage");
      expect(stepNames).toContain("pause_strategies");
      expect(stepNames).toContain("switch_to_backup");
    });

    it("should create recovery plan for feed outage", () => {
      const plan = engine.createRecoveryPlan("feed_outage", preState);

      expect(plan.trigger).toBe("feed_outage");
      const stepNames = plan.steps.map((s) => s.name);
      expect(stepNames).toContain("detect_stale_feeds");
      expect(stepNames).toContain("switch_feed_source");
    });

    it("should create recovery plan for partial fill stuck", () => {
      const plan = engine.createRecoveryPlan("partial_fill_stuck", preState);

      expect(plan.trigger).toBe("partial_fill_stuck");
      const stepNames = plan.steps.map((s) => s.name);
      expect(stepNames).toContain("identify_stuck_orders");
      expect(stepNames).toContain("attempt_cancel");
    });

    it("should create recovery plan for network failure", () => {
      const plan = engine.createRecoveryPlan("network_failure", preState);

      expect(plan.trigger).toBe("network_failure");
      const stepNames = plan.steps.map((s) => s.name);
      expect(stepNames).toContain("detect_disconnection");
      expect(stepNames).toContain("enter_safe_mode");
    });

    it("should create recovery plan for process crash", () => {
      const plan = engine.createRecoveryPlan("process_crash", preState);

      expect(plan.trigger).toBe("process_crash");
      const stepNames = plan.steps.map((s) => s.name);
      expect(stepNames.length).toBeGreaterThan(0);
    });

    it("should create recovery plan for memory pressure", () => {
      const plan = engine.createRecoveryPlan("memory_pressure", preState);

      expect(plan.trigger).toBe("memory_pressure");
      const stepNames = plan.steps.map((s) => s.name);
      expect(stepNames).toContain("detect_memory_pressure");
    });

    it("should create recovery plan for manual trigger", () => {
      const plan = engine.createRecoveryPlan("manual", preState);

      expect(plan.trigger).toBe("manual");
      const stepNames = plan.steps.map((s) => s.name);
      expect(stepNames).toContain("operator_initiated");
    });
  });

  describe("Recovery Plan Step Execution", () => {
    let preState: SystemState;
    let planId: string;

    beforeEach(() => {
      preState = engine.captureSystemState({
        open_positions: [],
        pending_orders: [],
        active_sessions: [],
        broker_connections: [],
        last_heartbeat: new Date().toISOString(),
        market_phase: "market_open",
      });

      const plan = engine.createRecoveryPlan("system_restart", preState);
      planId = plan.id;
    });

    it("should execute recovery step successfully", () => {
      const result = engine.executeRecoveryStep(planId, "capture_state");

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      const plan = engine.getRecoveryPlan(planId);
      const step = plan?.steps.find((s) => s.name === "capture_state");
      expect(step?.status).toBe("completed");
      expect(step?.started_at).toBeTruthy();
      expect(step?.completed_at).toBeTruthy();
    });

    it("should fail when plan does not exist", () => {
      const result = engine.executeRecoveryStep("nonexistent", "capture_state");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Plan not found");
    });

    it("should fail when step does not exist", () => {
      const result = engine.executeRecoveryStep(planId, "nonexistent_step");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Step not found");
    });

    it("should change plan status to executing on first step", () => {
      let plan = engine.getRecoveryPlan(planId);
      expect(plan?.status).toBe("pending");

      engine.executeRecoveryStep(planId, "capture_state");

      plan = engine.getRecoveryPlan(planId);
      expect(plan?.status).toBe("executing");
    });
  });

  describe("Recovery Plan Completion", () => {
    let preState: SystemState;
    let postState: SystemState;
    let planId: string;

    beforeEach(() => {
      preState = engine.captureSystemState({
        open_positions: [],
        pending_orders: [],
        active_sessions: [],
        broker_connections: [],
        last_heartbeat: new Date().toISOString(),
        market_phase: "market_open",
      });

      postState = engine.captureSystemState({
        open_positions: [],
        pending_orders: [],
        active_sessions: [],
        broker_connections: [],
        last_heartbeat: new Date().toISOString(),
        market_phase: "market_open",
      });

      const plan = engine.createRecoveryPlan("system_restart", preState);
      planId = plan.id;
    });

    it("should complete recovery plan with post state", () => {
      const result = engine.completeRecoveryPlan(planId, postState);

      expect(result.success).toBe(true);

      const plan = engine.getRecoveryPlan(planId);
      expect(plan?.status).toBe("completed");
      expect(plan?.post_state).toEqual(postState);
      expect(plan?.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it("should fail when plan does not exist", () => {
      const result = engine.completeRecoveryPlan("nonexistent", postState);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Plan not found");
    });
  });

  describe("Recovery Plan Failure", () => {
    let preState: SystemState;
    let planId: string;

    beforeEach(() => {
      preState = engine.captureSystemState({
        open_positions: [],
        pending_orders: [],
        active_sessions: [],
        broker_connections: [],
        last_heartbeat: new Date().toISOString(),
        market_phase: "market_open",
      });

      const plan = engine.createRecoveryPlan("system_restart", preState);
      planId = plan.id;
    });

    it("should fail recovery plan with error message", () => {
      engine.executeRecoveryStep(planId, "capture_state");

      const result = engine.failRecoveryPlan(
        planId,
        "Broker connection failed"
      );

      expect(result.success).toBe(true);

      const plan = engine.getRecoveryPlan(planId);
      expect(plan?.status).toBe("failed");
    });

    it("should mark running step as failed", () => {
      engine.executeRecoveryStep(planId, "capture_state");

      engine.failRecoveryPlan(planId, "Step failed");

      const plan = engine.getRecoveryPlan(planId);
      const step = plan?.steps.find((s) => s.name === "capture_state");
      expect(step?.status).toBe("failed");
      expect(step?.error).toBe("Step failed");
    });
  });

  describe("Recovery Plan Retrieval", () => {
    let preState: SystemState;

    beforeEach(() => {
      preState = engine.captureSystemState({
        open_positions: [],
        pending_orders: [],
        active_sessions: [],
        broker_connections: [],
        last_heartbeat: new Date().toISOString(),
        market_phase: "market_open",
      });
    });

    it("should retrieve plan by ID", () => {
      const created = engine.createRecoveryPlan("system_restart", preState);
      const retrieved = engine.getRecoveryPlan(created.id);

      expect(retrieved).toEqual(created);
    });

    it("should return undefined for nonexistent plan", () => {
      const plan = engine.getRecoveryPlan("nonexistent");
      expect(plan).toBeUndefined();
    });

    it("should get all recovery plans", () => {
      engine.createRecoveryPlan("system_restart", preState);
      engine.createRecoveryPlan("broker_outage", preState);

      const plans = engine.getAllRecoveryPlans();

      expect(plans.length).toBe(2);
      expect(plans[0].created_at >= plans[1].created_at).toBe(true);
    });

    it("should apply limit when getting all plans", () => {
      engine.createRecoveryPlan("system_restart", preState);
      engine.createRecoveryPlan("broker_outage", preState);
      engine.createRecoveryPlan("feed_outage", preState);

      const plans = engine.getAllRecoveryPlans(2);

      expect(plans.length).toBe(2);
    });
  });

  describe("Active Recovery Plan", () => {
    let preState: SystemState;

    beforeEach(() => {
      preState = engine.captureSystemState({
        open_positions: [],
        pending_orders: [],
        active_sessions: [],
        broker_connections: [],
        last_heartbeat: new Date().toISOString(),
        market_phase: "market_open",
      });
    });

    it("should return active recovery plan", () => {
      const plan = engine.createRecoveryPlan("system_restart", preState);
      const active = engine.getActiveRecoveryPlan();

      expect(active?.id).toBe(plan.id);
    });

    it("should return undefined when no active plan", () => {
      const postState = engine.captureSystemState({
        open_positions: [],
        pending_orders: [],
        active_sessions: [],
        broker_connections: [],
        last_heartbeat: new Date().toISOString(),
        market_phase: "market_open",
      });

      const plan = engine.createRecoveryPlan("system_restart", preState);
      engine.completeRecoveryPlan(plan.id, postState);

      const active = engine.getActiveRecoveryPlan();

      expect(active).toBeUndefined();
    });
  });

  describe("Failure Drill Lifecycle", () => {
    it("should schedule a failure drill", () => {
      const criteria = [
        "All positions reconciled",
        "Orders verified",
      ];

      const drill = engine.scheduleDrill("system_restart", criteria);

      expect(drill.id).toMatch(/^drill_/);
      expect(drill.drill_type).toBe("system_restart");
      expect(drill.status).toBe("scheduled");
      expect(drill.scheduled_at).toBeTruthy();
      expect(drill.pass_criteria).toEqual(criteria);
      expect(drill.criteria_met).toBe(false);
      expect(drill.steps_completed).toBe(0);
      expect(drill.steps_total).toBeGreaterThan(0);
    });

    it("should start a scheduled drill", () => {
      const drill = engine.scheduleDrill("broker_outage", []);
      const result = engine.startDrill(drill.id);

      expect(result.success).toBe(true);

      const updated = engine.getDrill(drill.id);
      expect(updated?.status).toBe("running");
      expect(updated?.started_at).toBeTruthy();
    });

    it("should fail to start a drill that is not scheduled", () => {
      const drill = engine.scheduleDrill("feed_outage", []);
      engine.startDrill(drill.id);

      const result = engine.startDrill(drill.id);

      expect(result.success).toBe(false);
      expect(result.error).toContain("not in scheduled state");
    });

    it("should advance drill and track steps", () => {
      const drill = engine.scheduleDrill("network_failure", []);
      engine.startDrill(drill.id);

      engine.advanceDrill(drill.id, "Disconnection detected");
      engine.advanceDrill(drill.id, "Entered safe mode");

      const updated = engine.getDrill(drill.id);
      expect(updated?.steps_completed).toBe(2);
      expect(updated?.findings).toEqual([
        "Disconnection detected",
        "Entered safe mode",
      ]);
    });

    it("should fail to advance drill that is not running", () => {
      const drill = engine.scheduleDrill("partial_fill_stuck", []);

      const result = engine.advanceDrill(drill.id);

      expect(result.success).toBe(false);
      expect(result.error).toContain("not running");
    });

    it("should complete drill with pass criteria met", () => {
      const criteria = ["Positions verified", "Orders reconciled"];
      const drill = engine.scheduleDrill("system_restart", criteria);
      engine.startDrill(drill.id);

      const result = engine.completeDrill(drill.id, true);

      expect(result.success).toBe(true);

      const updated = engine.getDrill(drill.id);
      expect(updated?.status).toBe("passed");
      expect(updated?.completed_at).toBeTruthy();
      expect(updated?.criteria_met).toBe(true);
    });

    it("should complete drill with pass criteria not met", () => {
      const drill = engine.scheduleDrill("broker_outage", ["All systems OK"]);
      engine.startDrill(drill.id);

      const result = engine.completeDrill(drill.id, false);

      expect(result.success).toBe(true);

      const updated = engine.getDrill(drill.id);
      expect(updated?.status).toBe("failed");
      expect(updated?.criteria_met).toBe(false);
    });

    it("should abort running drill", () => {
      const drill = engine.scheduleDrill("feed_outage", []);
      engine.startDrill(drill.id);

      const result = engine.abortDrill(drill.id);

      expect(result.success).toBe(true);

      const updated = engine.getDrill(drill.id);
      expect(updated?.status).toBe("aborted");
      expect(updated?.completed_at).toBeTruthy();
    });

    it("should fail to abort completed drill", () => {
      const drill = engine.scheduleDrill("manual", []);
      engine.startDrill(drill.id);
      engine.completeDrill(drill.id, true);

      const result = engine.abortDrill(drill.id);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot abort");
    });
  });

  describe("Drill Retrieval", () => {
    it("should retrieve drill by ID", () => {
      const created = engine.scheduleDrill("system_restart", []);
      const retrieved = engine.getDrill(created.id);

      expect(retrieved).toEqual(created);
    });

    it("should return undefined for nonexistent drill", () => {
      const drill = engine.getDrill("nonexistent");
      expect(drill).toBeUndefined();
    });

    it("should get all drills", () => {
      engine.scheduleDrill("system_restart", []);
      engine.scheduleDrill("broker_outage", []);

      const drills = engine.getAllDrills();

      expect(drills.length).toBe(2);
      expect(drills[0].scheduled_at >= drills[1].scheduled_at).toBe(true);
    });

    it("should apply limit when getting all drills", () => {
      engine.scheduleDrill("system_restart", []);
      engine.scheduleDrill("broker_outage", []);
      engine.scheduleDrill("feed_outage", []);

      const drills = engine.getAllDrills(2);

      expect(drills.length).toBe(2);
    });

    it("should get only passed drills", () => {
      const drill1 = engine.scheduleDrill("system_restart", []);
      const drill2 = engine.scheduleDrill("broker_outage", []);
      const drill3 = engine.scheduleDrill("feed_outage", []);

      engine.startDrill(drill1.id);
      engine.completeDrill(drill1.id, true);

      engine.startDrill(drill2.id);
      engine.completeDrill(drill2.id, false);

      engine.startDrill(drill3.id);
      engine.completeDrill(drill3.id, true);

      const passed = engine.getPassedDrills();

      expect(passed.length).toBe(2);
      expect(passed.every((d) => d.status === "passed")).toBe(true);
    });
  });

  describe("Recovery Steps Order", () => {
    let preState: SystemState;

    beforeEach(() => {
      preState = engine.captureSystemState({
        open_positions: [],
        pending_orders: [],
        active_sessions: [],
        broker_connections: [],
        last_heartbeat: new Date().toISOString(),
        market_phase: "market_open",
      });
    });

    it("should maintain step order for system restart", () => {
      const plan = engine.createRecoveryPlan("system_restart", preState);

      const expectedOrder = [
        "capture_state",
        "halt_new_orders",
        "verify_broker_connection",
        "reconcile_positions",
        "reconcile_pending_orders",
        "restore_sessions",
        "resume_operations",
      ];

      plan.steps.forEach((step, index) => {
        expect(step.name).toBe(expectedOrder[index]);
        expect(step.order).toBe(index + 1);
      });
    });

    it("should maintain step order for broker outage", () => {
      const plan = engine.createRecoveryPlan("broker_outage", preState);

      const expectedOrder = [
        "detect_outage",
        "pause_strategies",
        "switch_to_backup",
        "verify_positions",
        "resume_when_connected",
      ];

      plan.steps.forEach((step, index) => {
        expect(step.name).toBe(expectedOrder[index]);
      });
    });
  });

  describe("Clear Recovery", () => {
    it("should clear all recovery data", () => {
      const preState = engine.captureSystemState({
        open_positions: [],
        pending_orders: [],
        active_sessions: [],
        broker_connections: [],
        last_heartbeat: new Date().toISOString(),
        market_phase: "market_open",
      });

      engine.createRecoveryPlan("system_restart", preState);
      engine.scheduleDrill("broker_outage", []);

      expect(engine.getAllRecoveryPlans().length).toBe(1);
      expect(engine.getAllDrills().length).toBe(1);

      engine._clearRecovery();

      expect(engine.getAllRecoveryPlans().length).toBe(0);
      expect(engine.getAllDrills().length).toBe(0);
      expect(engine.getLatestState()).toBeUndefined();
    });
  });
});
