/**
 * capital_allocator.ts — Capital Bucket Management & Allocation Control
 *
 * Manages capital allocation across trading strategies using a bucketing system:
 * - Strategy buckets: Isolate capital for specific strategies
 * - Regime buckets: Allocate capital to market regimes (bull/bear/sideways)
 * - Symbol group buckets: Allocate capital to correlated symbol clusters
 * - Reserve buckets: Emergency capital reserves
 *
 * Core responsibilities:
 * 1. Create/update/delete capital buckets with type-specific constraints
 * 2. Process allocation requests from strategies with approval/denial logic
 * 3. Track capital utilization (allocated vs. used vs. available)
 * 4. Enforce maximum allocation percentages per bucket
 * 5. Rebalance buckets based on performance and market conditions
 * 6. Maintain allocation decision history for audit trails
 */

import { randomUUID } from "node:crypto";
import { logger as _logger } from "../logger";

const logger = _logger.child({ module: "capital_allocator" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type BucketType = "strategy" | "regime" | "symbol_group" | "reserve";

export interface CapitalBucket {
  bucket_id: string;
  name: string;
  type: BucketType;
  allocated_capital: number;      // Total amount allocated to this bucket
  used_capital: number;            // Amount currently in active trades
  available_capital: number;       // allocated - used
  max_allocation_pct: number;      // Max % of total capital this bucket can have
  strategies_assigned: string[];   // Strategy IDs assigned to this bucket
  created_at: string;
  updated_at: string;
}

export interface RiskBudget {
  budget_id: string;
  total_capital: number;
  buckets: CapitalBucket[];
  daily_capital_at_risk_cap: number;  // Max capital at risk per day
  current_daily_risk: number;         // Current capital at risk today
  utilization_pct: number;            // (sum of allocated_capital) / total_capital
  last_updated: string;
}

export interface AllocationDecision {
  decision_id: string;
  strategy_id: string;
  requested_amount: number;
  approved_amount: number;
  reason: string;
  bucket_id: string;
  timestamp: string;
  status: "approved" | "partial" | "denied";
}

// ─── State ────────────────────────────────────────────────────────────────────

const buckets = new Map<string, CapitalBucket>();
const allocationDecisions: AllocationDecision[] = [];
const MAX_DECISION_HISTORY = 1000;

let _riskBudget: RiskBudget = {
  budget_id: `budget-${randomUUID()}`,
  total_capital: 100_000,
  buckets: [],
  daily_capital_at_risk_cap: 5_000,
  current_daily_risk: 0,
  utilization_pct: 0,
  last_updated: new Date().toISOString(),
};

// ─── Helper Functions ─────────────────────────────────────────────────────────

function generateBucketId(): string {
  return `bucket-${randomUUID()}`;
}

function generateDecisionId(): string {
  return `decision-${randomUUID()}`;
}

function recalculateRiskBudget(): void {
  const allBuckets = Array.from(buckets.values());
  const totalAllocated = allBuckets.reduce((sum, b) => sum + b.allocated_capital, 0);
  const utilization = _riskBudget.total_capital > 0
    ? totalAllocated / _riskBudget.total_capital
    : 0;

  _riskBudget.buckets = allBuckets;
  _riskBudget.utilization_pct = Math.min(utilization, 1.0);
  _riskBudget.last_updated = new Date().toISOString();

  logger.debug(
    { totalAllocated, utilization_pct: _riskBudget.utilization_pct },
    "Risk budget recalculated"
  );
}

function validateBucketConstraints(bucket: Partial<CapitalBucket>, isCreation: boolean = false): string | null {
  // Only check name/type if creating or if they're explicitly provided for update
  if (isCreation) {
    if (!bucket.name || bucket.name.trim().length === 0) {
      return "Bucket name cannot be empty";
    }

    if (!bucket.type || !["strategy", "regime", "symbol_group", "reserve"].includes(bucket.type)) {
      return "Invalid bucket type";
    }
  } else {
    // For updates, only validate if the field is being changed
    if (bucket.name !== undefined && bucket.name.trim().length === 0) {
      return "Bucket name cannot be empty";
    }

    if (bucket.type !== undefined && !["strategy", "regime", "symbol_group", "reserve"].includes(bucket.type)) {
      return "Invalid bucket type";
    }
  }

  if (bucket.max_allocation_pct !== undefined) {
    if (bucket.max_allocation_pct < 0 || bucket.max_allocation_pct > 100) {
      return "max_allocation_pct must be between 0 and 100";
    }
  }

  if (bucket.allocated_capital !== undefined && bucket.allocated_capital < 0) {
    return "allocated_capital cannot be negative";
  }

  if (bucket.used_capital !== undefined && bucket.used_capital < 0) {
    return "used_capital cannot be negative";
  }

  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createBucket(
  name: string,
  type: BucketType,
  allocated_capital: number,
  max_allocation_pct: number = 25,
): { success: boolean; data?: CapitalBucket; error?: string } {
  const validationError = validateBucketConstraints({
    name,
    type,
    allocated_capital,
    max_allocation_pct,
  }, true);

  if (validationError) {
    logger.warn({ name, type, error: validationError }, "Bucket creation failed");
    return { success: false, error: validationError };
  }

  // Check total allocation constraint
  const totalAllocated = Array.from(buckets.values()).reduce(
    (sum, b) => sum + b.allocated_capital,
    0
  );
  const newTotal = totalAllocated + allocated_capital;
  const maxAllowedCapital = (_riskBudget.total_capital * max_allocation_pct) / 100;

  if (allocated_capital > maxAllowedCapital) {
    const error = `Cannot allocate more than ${max_allocation_pct}% of total capital (${maxAllowedCapital})`;
    logger.warn({ error }, "Bucket allocation exceeds limit");
    return { success: false, error };
  }

  if (newTotal > _riskBudget.total_capital) {
    const error = `Total allocation (${newTotal}) exceeds risk budget (${_riskBudget.total_capital})`;
    logger.warn({ error }, "Total allocation exceeds budget");
    return { success: false, error };
  }

  const bucket: CapitalBucket = {
    bucket_id: generateBucketId(),
    name,
    type,
    allocated_capital,
    used_capital: 0,
    available_capital: allocated_capital,
    max_allocation_pct,
    strategies_assigned: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  buckets.set(bucket.bucket_id, bucket);
  recalculateRiskBudget();

  logger.info(
    { bucket_id: bucket.bucket_id, name, type, allocated_capital },
    "Capital bucket created"
  );

  return { success: true, data: bucket };
}

export function updateBucket(
  bucket_id: string,
  updates: Partial<CapitalBucket>,
): { success: boolean; data?: CapitalBucket; error?: string } {
  const bucket = buckets.get(bucket_id);
  if (!bucket) {
    return { success: false, error: "Bucket not found" };
  }

  const validationError = validateBucketConstraints(updates);
  if (validationError) {
    logger.warn({ bucket_id, error: validationError }, "Bucket update failed");
    return { success: false, error: validationError };
  }

  // If changing allocated_capital, validate against total budget
  if (updates.allocated_capital !== undefined) {
    const otherBucketsTotal = Array.from(buckets.values())
      .filter((b) => b.bucket_id !== bucket_id)
      .reduce((sum, b) => sum + b.allocated_capital, 0);
    const maxPct = updates.max_allocation_pct ?? bucket.max_allocation_pct;
    const maxAllowed = (_riskBudget.total_capital * maxPct) / 100;

    if (updates.allocated_capital > maxAllowed) {
      const error = `Cannot allocate more than ${maxPct}% of total capital`;
      return { success: false, error };
    }

    if (otherBucketsTotal + updates.allocated_capital > _riskBudget.total_capital) {
      // Allow if still fits within total budget
      const totalNeeded = otherBucketsTotal + updates.allocated_capital;
      if (totalNeeded > _riskBudget.total_capital) {
        return { success: false, error: "Total allocation would exceed risk budget" };
      }
    }
  }

  // Apply updates
  if (updates.name !== undefined) bucket.name = updates.name;
  if (updates.allocated_capital !== undefined) {
    bucket.allocated_capital = updates.allocated_capital;
    bucket.available_capital = Math.max(0, updates.allocated_capital - bucket.used_capital);
  }
  if (updates.used_capital !== undefined) {
    bucket.used_capital = updates.used_capital;
    bucket.available_capital = Math.max(0, bucket.allocated_capital - updates.used_capital);
  }
  if (updates.max_allocation_pct !== undefined) {
    bucket.max_allocation_pct = updates.max_allocation_pct;
  }
  if (updates.strategies_assigned !== undefined) {
    bucket.strategies_assigned = updates.strategies_assigned;
  }

  bucket.updated_at = new Date().toISOString();
  buckets.set(bucket_id, bucket);
  recalculateRiskBudget();

  logger.info({ bucket_id, updates: Object.keys(updates) }, "Bucket updated");

  return { success: true, data: bucket };
}

export function getBucket(bucket_id: string): CapitalBucket | null {
  return buckets.get(bucket_id) ?? null;
}

export function listBuckets(): CapitalBucket[] {
  return Array.from(buckets.values());
}

export function deleteBucket(bucket_id: string): { success: boolean; error?: string } {
  const bucket = buckets.get(bucket_id);
  if (!bucket) {
    return { success: false, error: "Bucket not found" };
  }

  if (bucket.used_capital > 0) {
    return { success: false, error: "Cannot delete bucket with active capital usage" };
  }

  if (bucket.strategies_assigned.length > 0) {
    return { success: false, error: "Cannot delete bucket with assigned strategies" };
  }

  buckets.delete(bucket_id);
  recalculateRiskBudget();

  logger.info({ bucket_id }, "Bucket deleted");

  return { success: true };
}

export function requestAllocation(
  strategy_id: string,
  requested_amount: number,
  bucket_id: string,
): {
  success: boolean;
  data?: AllocationDecision;
  error?: string;
} {
  const bucket = buckets.get(bucket_id);
  if (!bucket) {
    return { success: false, error: "Bucket not found" };
  }

  if (requested_amount <= 0) {
    return { success: false, error: "Requested amount must be positive" };
  }

  // Step 1: Check bucket available capital
  const bucketAvailable = Math.min(
    bucket.available_capital,
    requested_amount
  );

  // Step 2: Check daily CAR cap
  const carCapRemaining = _riskBudget.daily_capital_at_risk_cap - _riskBudget.current_daily_risk;
  const capLimited = Math.min(bucketAvailable, carCapRemaining);

  // Determine approval amount and status
  let approved_amount = capLimited;
  let status: "approved" | "partial" | "denied" = "denied";
  let reason = "";

  if (approved_amount >= requested_amount) {
    status = "approved";
    reason = "Sufficient available capital in bucket";
  } else if (approved_amount > 0) {
    status = "partial";
    const reasons: string[] = [];
    if (bucketAvailable < requested_amount) {
      reasons.push(`Only ${bucketAvailable} available in bucket`);
    }
    if (carCapRemaining < bucketAvailable) {
      reasons.push(`Only ${carCapRemaining} remaining daily CAR`);
    }
    reason = reasons.length > 0 ? reasons.join("; ") : "Limited by constraints";
  } else {
    status = "denied";
    const reasons: string[] = [];
    if (bucket.available_capital === 0) {
      reasons.push("No available capital in bucket");
    } else {
      reasons.push("Daily CAR cap exceeded");
    }
    reason = reasons.join("; ");
  }

  const decision: AllocationDecision = {
    decision_id: generateDecisionId(),
    strategy_id,
    requested_amount,
    approved_amount,
    reason,
    bucket_id,
    timestamp: new Date().toISOString(),
    status,
  };

  allocationDecisions.push(decision);
  if (allocationDecisions.length > MAX_DECISION_HISTORY) {
    allocationDecisions.shift();
  }

  // Update bucket usage if approved
  if (approved_amount > 0) {
    const updatedBucket = buckets.get(bucket_id)!;
    updatedBucket.used_capital += approved_amount;
    updatedBucket.available_capital = Math.max(0, updatedBucket.allocated_capital - updatedBucket.used_capital);
    updatedBucket.updated_at = new Date().toISOString();
    buckets.set(bucket_id, updatedBucket);

    _riskBudget.current_daily_risk += approved_amount;
    recalculateRiskBudget();
  }

  logger.info(
    { decision_id: decision.decision_id, strategy_id, status, approved_amount },
    "Allocation decision made"
  );

  return { success: true, data: decision };
}

export function getAvailableCapital(bucket_id: string): number {
  const bucket = buckets.get(bucket_id);
  if (!bucket) return 0;

  return Math.max(
    0,
    Math.min(
      bucket.available_capital,
      _riskBudget.daily_capital_at_risk_cap - _riskBudget.current_daily_risk
    )
  );
}

export function getRiskBudget(): RiskBudget {
  return { ..._riskBudget };
}

export function updateRiskBudget(
  total_capital?: number,
  daily_car_cap?: number,
): { success: boolean; data?: RiskBudget; error?: string } {
  if (total_capital !== undefined) {
    if (total_capital <= 0) {
      return { success: false, error: "total_capital must be positive" };
    }

    const totalAllocated = Array.from(buckets.values()).reduce(
      (sum, b) => sum + b.allocated_capital,
      0
    );

    if (totalAllocated > total_capital) {
      return {
        success: false,
        error: `Total allocated capital (${totalAllocated}) exceeds new budget (${total_capital})`,
      };
    }

    _riskBudget.total_capital = total_capital;
  }

  if (daily_car_cap !== undefined) {
    if (daily_car_cap < 0) {
      return { success: false, error: "daily_car_cap cannot be negative" };
    }
    _riskBudget.daily_capital_at_risk_cap = daily_car_cap;
  }

  recalculateRiskBudget();
  logger.info({ total_capital, daily_car_cap }, "Risk budget updated");

  return { success: true, data: _riskBudget };
}

export function rebalanceBuckets(
  bucket_allocations: Record<string, number>
): { success: boolean; data?: RiskBudget; error?: string } {
  // Validate total doesn't exceed budget
  const totalRequested = Object.values(bucket_allocations).reduce((sum, amt) => sum + amt, 0);
  if (totalRequested > _riskBudget.total_capital) {
    return {
      success: false,
      error: `Total allocation (${totalRequested}) exceeds budget (${_riskBudget.total_capital})`,
    };
  }

  // Apply rebalancing
  for (const [bucket_id, new_allocation] of Object.entries(bucket_allocations)) {
    const bucket = buckets.get(bucket_id);
    if (!bucket) {
      return { success: false, error: `Bucket ${bucket_id} not found` };
    }

    if (new_allocation < 0) {
      return { success: false, error: "Allocation cannot be negative" };
    }

    bucket.allocated_capital = new_allocation;
    bucket.available_capital = Math.max(0, new_allocation - bucket.used_capital);
    bucket.updated_at = new Date().toISOString();
    buckets.set(bucket_id, bucket);
  }

  recalculateRiskBudget();
  logger.info({ rebalanced_buckets: Object.keys(bucket_allocations).length }, "Buckets rebalanced");

  return { success: true, data: _riskBudget };
}

export function getAllocationDecisions(limit: number = 100): AllocationDecision[] {
  return allocationDecisions.slice(-limit);
}

export function resetDailyRisk(): void {
  _riskBudget.current_daily_risk = 0;
  _riskBudget.last_updated = new Date().toISOString();
  logger.info("Daily capital at risk reset");
}

export function _clearAll(): void {
  buckets.clear();
  allocationDecisions.length = 0;
  _riskBudget = {
    budget_id: `budget-${randomUUID()}`,
    total_capital: 100_000,
    buckets: [],
    daily_capital_at_risk_cap: 5_000,
    current_daily_risk: 0,
    utilization_pct: 0,
    last_updated: new Date().toISOString(),
  };
  logger.debug("Capital allocator state cleared");
}
