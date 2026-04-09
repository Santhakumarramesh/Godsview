/**
 * routes/capital_control.ts — Capital Allocation & Portfolio Guardrails API
 *
 * Endpoints:
 * - POST   /buckets                 — Create capital bucket
 * - GET    /buckets                 — List all buckets
 * - GET    /buckets/:id             — Get bucket details
 * - PUT    /buckets/:id             — Update bucket
 * - DELETE /buckets/:id             — Delete bucket
 * - POST   /allocate                — Request allocation from bucket
 * - GET    /allocations             — List allocation decisions
 * - GET    /budget                  — Get overall risk budget
 * - POST   /budget/update           — Update risk budget
 * - POST   /rebalance               — Rebalance buckets
 * - POST   /guardrails/check        — Run guardrail checks
 * - GET    /guardrails/config       — Get guardrail configuration
 * - PUT    /guardrails/config       — Update guardrail configuration
 * - GET    /explanations            — List allocation explanations
 * - GET    /summary                 — Capital control summary
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  createBucket,
  updateBucket,
  getBucket,
  listBuckets,
  deleteBucket,
  requestAllocation,
  getAvailableCapital,
  getRiskBudget,
  updateRiskBudget,
  rebalanceBuckets,
  getAllocationDecisions,
  resetDailyRisk,
  type CapitalBucket,
  type BucketType,
  runGuardrailChecks,
  explainAllocationDecision,
  getGuardrailConfig,
  updateGuardrailConfig,
  getGuardrailCheckHistory,
  getAllocationExplanationHistory,
  type PortfolioState,
} from "../lib/capital_control";

const router: IRouter = Router();

// ─── Capital Bucket Endpoints ──────────────────────────────────────────────────

router.post("/buckets", (req: Request, res: Response) => {
  const { name, type, allocated_capital, max_allocation_pct } = req.body;

  if (!name || !type || allocated_capital === undefined) {
    res.status(400).json({
      success: false,
      error: "name, type, and allocated_capital are required",
    });
    return;
  }

  const result = createBucket(
    name,
    type as BucketType,
    allocated_capital,
    max_allocation_pct ?? 25
  );

  if (result.success) {
    res.status(201).json(result);
  } else {
    res.status(400).json(result);
  }
});

router.get("/buckets", (_req: Request, res: Response) => {
  const buckets = listBuckets();
  res.json({ success: true, data: buckets });
});

router.get("/buckets/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const bucket = getBucket(id);

  if (bucket) {
    res.json({ success: true, data: bucket });
  } else {
    res.status(404).json({ success: false, error: "Bucket not found" });
  }
});

router.put("/buckets/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const result = updateBucket(id, req.body);

  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

router.delete("/buckets/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const result = deleteBucket(id);

  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

// ─── Allocation Endpoints ──────────────────────────────────────────────────────

router.post("/allocate", (req: Request, res: Response) => {
  const { strategy_id, requested_amount, bucket_id } = req.body;

  if (!strategy_id || requested_amount === undefined || !bucket_id) {
    res.status(400).json({
      success: false,
      error: "strategy_id, requested_amount, and bucket_id are required",
    });
    return;
  }

  const result = requestAllocation(strategy_id, requested_amount, bucket_id);

  if (result.success) {
    res.status(201).json(result);
  } else {
    res.status(400).json(result);
  }
});

router.get("/allocations", (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const decisions = getAllocationDecisions(limit);
  res.json({ success: true, data: decisions, count: decisions.length });
});

// ─── Risk Budget Endpoints ─────────────────────────────────────────────────────

router.get("/budget", (_req: Request, res: Response) => {
  const budget = getRiskBudget();
  res.json({ success: true, data: budget });
});

router.post("/budget/update", (req: Request, res: Response) => {
  const { total_capital, daily_car_cap } = req.body;

  if (total_capital === undefined && daily_car_cap === undefined) {
    res.status(400).json({
      success: false,
      error: "At least one of total_capital or daily_car_cap is required",
    });
    return;
  }

  const result = updateRiskBudget(total_capital, daily_car_cap);

  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

router.post("/budget/reset-daily-risk", (_req: Request, res: Response) => {
  resetDailyRisk();
  res.json({ success: true, message: "Daily capital at risk reset" });
});

// ─── Rebalancing Endpoints ────────────────────────────────────────────────────

router.post("/rebalance", (req: Request, res: Response) => {
  const { bucket_allocations } = req.body;

  if (!bucket_allocations || typeof bucket_allocations !== "object") {
    res.status(400).json({
      success: false,
      error: "bucket_allocations object is required",
    });
    return;
  }

  const result = rebalanceBuckets(bucket_allocations);

  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

// ─── Guardrail Endpoints ───────────────────────────────────────────────────────

router.post("/guardrails/check", (req: Request, res: Response) => {
  const { portfolio_state } = req.body;

  if (!portfolio_state) {
    res.status(400).json({
      success: false,
      error: "portfolio_state is required",
    });
    return;
  }

  const checks = runGuardrailChecks(portfolio_state as PortfolioState);
  const allPassed = checks.every((c) => c.passed);

  res.json({
    success: true,
    data: {
      all_passed: allPassed,
      checks,
    },
  });
});

router.get("/guardrails/config", (_req: Request, res: Response) => {
  const config = getGuardrailConfig();
  res.json({ success: true, data: config });
});

router.put("/guardrails/config", (req: Request, res: Response) => {
  const result = updateGuardrailConfig(req.body);

  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

router.get("/guardrails/checks", (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const checks = getGuardrailCheckHistory(limit);
  res.json({ success: true, data: checks, count: checks.length });
});

// ─── Explanation Endpoints ────────────────────────────────────────────────────

router.post("/explanations/generate", (req: Request, res: Response) => {
  const { strategy_id, original_size, adjusted_size, portfolio_state } = req.body;

  if (!strategy_id || original_size === undefined || adjusted_size === undefined || !portfolio_state) {
    res.status(400).json({
      success: false,
      error: "strategy_id, original_size, adjusted_size, and portfolio_state are required",
    });
    return;
  }

  const explanation = explainAllocationDecision(
    strategy_id,
    original_size,
    adjusted_size,
    portfolio_state as PortfolioState
  );

  res.status(201).json({ success: true, data: explanation });
});

router.get("/explanations", (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const explanations = getAllocationExplanationHistory(limit);
  res.json({ success: true, data: explanations, count: explanations.length });
});

// ─── Summary Endpoint ──────────────────────────────────────────────────────────

router.get("/summary", (_req: Request, res: Response) => {
  const budget = getRiskBudget();
  const allocationCount = getAllocationDecisions(1).length;
  const buckets = listBuckets();

  const totalAllocated = buckets.reduce((sum, b) => sum + b.allocated_capital, 0);
  const totalUsed = buckets.reduce((sum, b) => sum + b.used_capital, 0);
  const totalAvailable = buckets.reduce((sum, b) => sum + b.available_capital, 0);

  const summary = {
    success: true,
    data: {
      risk_budget: {
        total_capital: budget.total_capital,
        daily_capital_at_risk: budget.current_daily_risk,
        daily_cap: budget.daily_capital_at_risk_cap,
        utilization_pct: budget.utilization_pct,
      },
      buckets: {
        count: buckets.length,
        total_allocated: totalAllocated,
        total_used: totalUsed,
        total_available: totalAvailable,
        allocation_efficiency: budget.total_capital > 0 ? (totalAllocated / budget.total_capital) * 100 : 0,
      },
      allocations: {
        total_decisions: allocationCount,
      },
      last_updated: budget.last_updated,
    },
  };

  res.json(summary);
});

export default router;
