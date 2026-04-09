import { randomUUID } from "crypto";

export type MarketPhase =
  | "pre_market"
  | "market_open"
  | "market_close"
  | "after_hours"
  | "weekend";

export type PositionSide = "long" | "short";

export type OrderStatus = "pending" | "partial";

export interface PositionSnapshot {
  symbol: string;
  strategy_id: string;
  quantity: number;
  avg_price: number;
  side: PositionSide;
  unrealized_pnl: number;
}

export interface PendingOrderSnapshot {
  order_id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  filled_quantity: number;
  status: OrderStatus;
  submitted_at: string;
}

export interface BrokerConnectionState {
  broker_id: string;
  name: string;
  connected: boolean;
  last_seen: string;
}

export interface SystemState {
  id: string;
  captured_at: string;
  open_positions: PositionSnapshot[];
  pending_orders: PendingOrderSnapshot[];
  active_sessions: string[];
  broker_connections: BrokerConnectionState[];
  last_heartbeat: string;
  market_phase: MarketPhase;
}

export interface RecoveryStep {
  name: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  started_at?: string;
  completed_at?: string;
  error?: string;
  order: number;
}

export type RecoveryTrigger =
  | "system_restart"
  | "broker_outage"
  | "feed_outage"
  | "partial_fill_stuck"
  | "network_failure"
  | "process_crash"
  | "memory_pressure"
  | "manual";

export interface RecoveryPlan {
  id: string;
  trigger: RecoveryTrigger;
  created_at: string;
  status: "pending" | "executing" | "completed" | "failed";
  steps: RecoveryStep[];
  pre_state: SystemState;
  post_state?: SystemState;
  duration_ms?: number;
}

export interface FailureDrill {
  id: string;
  drill_type: RecoveryTrigger;
  status: "scheduled" | "running" | "passed" | "failed" | "aborted";
  scheduled_at: string;
  started_at?: string;
  completed_at?: string;
  steps_completed: number;
  steps_total: number;
  findings: string[];
  pass_criteria: string[];
  criteria_met: boolean;
}

const DEFAULT_RECOVERY_STEPS: Record<RecoveryTrigger, RecoveryStep[]> = {
  system_restart: [
    {
      name: "capture_state",
      description: "Capture current system state",
      status: "pending",
      order: 1,
    },
    {
      name: "halt_new_orders",
      description: "Halt new order placement",
      status: "pending",
      order: 2,
    },
    {
      name: "verify_broker_connection",
      description: "Verify broker connection is active",
      status: "pending",
      order: 3,
    },
    {
      name: "reconcile_positions",
      description: "Reconcile positions with broker",
      status: "pending",
      order: 4,
    },
    {
      name: "reconcile_pending_orders",
      description: "Reconcile pending orders",
      status: "pending",
      order: 5,
    },
    {
      name: "restore_sessions",
      description: "Restore trading sessions",
      status: "pending",
      order: 6,
    },
    {
      name: "resume_operations",
      description: "Resume normal operations",
      status: "pending",
      order: 7,
    },
  ],
  broker_outage: [
    {
      name: "detect_outage",
      description: "Detect broker outage",
      status: "pending",
      order: 1,
    },
    {
      name: "pause_strategies",
      description: "Pause active strategies",
      status: "pending",
      order: 2,
    },
    {
      name: "switch_to_backup",
      description: "Switch to backup broker",
      status: "pending",
      order: 3,
    },
    {
      name: "verify_positions",
      description: "Verify positions on backup",
      status: "pending",
      order: 4,
    },
    {
      name: "resume_when_connected",
      description: "Resume when broker reconnected",
      status: "pending",
      order: 5,
    },
  ],
  feed_outage: [
    {
      name: "detect_stale_feeds",
      description: "Detect stale market feeds",
      status: "pending",
      order: 1,
    },
    {
      name: "pause_dependent_strategies",
      description: "Pause strategies dependent on feed",
      status: "pending",
      order: 2,
    },
    {
      name: "switch_feed_source",
      description: "Switch to backup feed source",
      status: "pending",
      order: 3,
    },
    {
      name: "validate_data_quality",
      description: "Validate incoming data quality",
      status: "pending",
      order: 4,
    },
    {
      name: "resume_strategies",
      description: "Resume strategies with new feed",
      status: "pending",
      order: 5,
    },
  ],
  partial_fill_stuck: [
    {
      name: "identify_stuck_orders",
      description: "Identify stuck partial fill orders",
      status: "pending",
      order: 1,
    },
    {
      name: "attempt_cancel",
      description: "Attempt to cancel stuck orders",
      status: "pending",
      order: 2,
    },
    {
      name: "reconcile_fills",
      description: "Reconcile filled quantities",
      status: "pending",
      order: 3,
    },
    {
      name: "adjust_positions",
      description: "Adjust positions to match fills",
      status: "pending",
      order: 4,
    },
    {
      name: "log_resolution",
      description: "Log resolution details",
      status: "pending",
      order: 5,
    },
  ],
  network_failure: [
    {
      name: "detect_disconnection",
      description: "Detect network disconnection",
      status: "pending",
      order: 1,
    },
    {
      name: "enter_safe_mode",
      description: "Enter safe mode",
      status: "pending",
      order: 2,
    },
    {
      name: "reconnect",
      description: "Attempt to reconnect",
      status: "pending",
      order: 3,
    },
    {
      name: "verify_state",
      description: "Verify system state after reconnect",
      status: "pending",
      order: 4,
    },
    {
      name: "resume_normal",
      description: "Resume normal operations",
      status: "pending",
      order: 5,
    },
  ],
  process_crash: [
    {
      name: "capture_state",
      description: "Capture system state before crash",
      status: "pending",
      order: 1,
    },
    {
      name: "halt_new_orders",
      description: "Halt new order placement",
      status: "pending",
      order: 2,
    },
    {
      name: "verify_broker_connection",
      description: "Verify broker connection",
      status: "pending",
      order: 3,
    },
    {
      name: "reconcile_positions",
      description: "Reconcile positions",
      status: "pending",
      order: 4,
    },
    {
      name: "restore_sessions",
      description: "Restore trading sessions",
      status: "pending",
      order: 5,
    },
  ],
  memory_pressure: [
    {
      name: "detect_memory_pressure",
      description: "Detect memory pressure",
      status: "pending",
      order: 1,
    },
    {
      name: "pause_non_critical",
      description: "Pause non-critical operations",
      status: "pending",
      order: 2,
    },
    {
      name: "clear_cache",
      description: "Clear non-essential caches",
      status: "pending",
      order: 3,
    },
    {
      name: "monitor_recovery",
      description: "Monitor memory recovery",
      status: "pending",
      order: 4,
    },
  ],
  manual: [
    {
      name: "operator_initiated",
      description: "Operator initiated recovery",
      status: "pending",
      order: 1,
    },
    {
      name: "custom_steps",
      description: "Execute custom recovery steps",
      status: "pending",
      order: 2,
    },
  ],
};

export class FailureRecoveryEngine {
  private states: Map<string, SystemState> = new Map();
  private stateOrder: string[] = [];
  private plans: Map<string, RecoveryPlan> = new Map();
  private drills: Map<string, FailureDrill> = new Map();

  captureSystemState(
    state: Omit<SystemState, "id" | "captured_at">
  ): SystemState {
    const captured: SystemState = {
      id: `state_${randomUUID()}`,
      captured_at: new Date().toISOString(),
      ...state,
    };

    this.states.set(captured.id, captured);
    this.stateOrder.push(captured.id);
    return captured;
  }

  getLatestState(): SystemState | undefined {
    if (this.stateOrder.length === 0) return undefined;
    const lastId = this.stateOrder[this.stateOrder.length - 1];
    return this.states.get(lastId);
  }

  createRecoveryPlan(
    trigger: RecoveryTrigger,
    pre_state: SystemState
  ): RecoveryPlan {
    const stepsTemplate = DEFAULT_RECOVERY_STEPS[trigger] || [];

    const plan: RecoveryPlan = {
      id: `rp_${randomUUID()}`,
      trigger,
      created_at: new Date().toISOString(),
      status: "pending",
      steps: stepsTemplate.map((step) => ({ ...step })),
      pre_state,
    };

    this.plans.set(plan.id, plan);
    return plan;
  }

  executeRecoveryStep(
    plan_id: string,
    step_name: string
  ): { success: boolean; error?: string } {
    const plan = this.plans.get(plan_id);
    if (!plan) {
      return { success: false, error: "Plan not found" };
    }

    const step = plan.steps.find((s) => s.name === step_name);
    if (!step) {
      return { success: false, error: "Step not found" };
    }

    step.status = "running";
    step.started_at = new Date().toISOString();

    step.status = "completed";
    step.completed_at = new Date().toISOString();

    if (plan.status === "pending") {
      plan.status = "executing";
    }

    return { success: true };
  }

  completeRecoveryPlan(
    plan_id: string,
    post_state: SystemState
  ): { success: boolean; error?: string } {
    const plan = this.plans.get(plan_id);
    if (!plan) {
      return { success: false, error: "Plan not found" };
    }

    plan.status = "completed";
    plan.post_state = post_state;
    const startTime = new Date(plan.created_at).getTime();
    const endTime = new Date().getTime();
    plan.duration_ms = endTime - startTime;

    return { success: true };
  }

  failRecoveryPlan(
    plan_id: string,
    error: string
  ): { success: boolean; error?: string } {
    const plan = this.plans.get(plan_id);
    if (!plan) {
      return { success: false, error: "Plan not found" };
    }

    plan.status = "failed";

    const runningStep = plan.steps.find((s) => s.status === "running");
    if (runningStep) {
      runningStep.status = "failed";
      runningStep.error = error;
      runningStep.completed_at = new Date().toISOString();
    } else {
      // If no running step, find the last completed step and fail it
      const completedSteps = plan.steps
        .filter((s) => s.status === "completed")
        .sort((a, b) => b.order - a.order);
      if (completedSteps.length > 0) {
        completedSteps[0].status = "failed";
        completedSteps[0].error = error;
      }
    }

    return { success: true };
  }

  getRecoveryPlan(id: string): RecoveryPlan | undefined {
    return this.plans.get(id);
  }

  getAllRecoveryPlans(limit?: number): RecoveryPlan[] {
    const plans = Array.from(this.plans.values());
    plans.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return limit ? plans.slice(0, limit) : plans;
  }

  getActiveRecoveryPlan(): RecoveryPlan | undefined {
    for (const plan of this.plans.values()) {
      if (plan.status === "executing" || plan.status === "pending") {
        return plan;
      }
    }
    return undefined;
  }

  scheduleDrill(
    drill_type: RecoveryTrigger,
    pass_criteria: string[]
  ): FailureDrill {
    const stepsTemplate = DEFAULT_RECOVERY_STEPS[drill_type] || [];

    const drill: FailureDrill = {
      id: `drill_${randomUUID()}`,
      drill_type,
      status: "scheduled",
      scheduled_at: new Date().toISOString(),
      steps_completed: 0,
      steps_total: stepsTemplate.length,
      findings: [],
      pass_criteria,
      criteria_met: false,
    };

    this.drills.set(drill.id, drill);
    return drill;
  }

  startDrill(drill_id: string): { success: boolean; error?: string } {
    const drill = this.drills.get(drill_id);
    if (!drill) {
      return { success: false, error: "Drill not found" };
    }

    if (drill.status !== "scheduled") {
      return { success: false, error: "Drill is not in scheduled state" };
    }

    drill.status = "running";
    drill.started_at = new Date().toISOString();

    return { success: true };
  }

  advanceDrill(
    drill_id: string,
    finding?: string
  ): { success: boolean; error?: string } {
    const drill = this.drills.get(drill_id);
    if (!drill) {
      return { success: false, error: "Drill not found" };
    }

    if (drill.status !== "running") {
      return { success: false, error: "Drill is not running" };
    }

    if (drill.steps_completed < drill.steps_total) {
      drill.steps_completed += 1;
    }

    if (finding) {
      drill.findings.push(finding);
    }

    return { success: true };
  }

  completeDrill(
    drill_id: string,
    criteria_met: boolean
  ): { success: boolean; error?: string } {
    const drill = this.drills.get(drill_id);
    if (!drill) {
      return { success: false, error: "Drill not found" };
    }

    drill.status = criteria_met ? "passed" : "failed";
    drill.completed_at = new Date().toISOString();
    drill.criteria_met = criteria_met;

    return { success: true };
  }

  abortDrill(drill_id: string): { success: boolean; error?: string } {
    const drill = this.drills.get(drill_id);
    if (!drill) {
      return { success: false, error: "Drill not found" };
    }

    if (drill.status === "passed" || drill.status === "failed" || drill.status === "aborted") {
      return {
        success: false,
        error: "Cannot abort a completed or already aborted drill",
      };
    }

    drill.status = "aborted";
    drill.completed_at = new Date().toISOString();

    return { success: true };
  }

  getDrill(id: string): FailureDrill | undefined {
    return this.drills.get(id);
  }

  getAllDrills(limit?: number): FailureDrill[] {
    const drills = Array.from(this.drills.values());
    drills.sort(
      (a, b) =>
        new Date(b.scheduled_at).getTime() -
        new Date(a.scheduled_at).getTime()
    );
    return limit ? drills.slice(0, limit) : drills;
  }

  getPassedDrills(): FailureDrill[] {
    return Array.from(this.drills.values()).filter(
      (drill) => drill.status === "passed"
    );
  }

  _clearRecovery(): void {
    this.states.clear();
    this.stateOrder.length = 0;
    this.plans.clear();
    this.drills.clear();
  }
}

export const recoveryEngine = new FailureRecoveryEngine();
