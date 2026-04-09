/**
 * capital_control/index.ts — Barrel export for capital allocation & guardrails
 */

export {
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
  _clearAll as clearAllCapitalAllocations,
  type CapitalBucket,
  type RiskBudget,
  type AllocationDecision,
  type BucketType,
} from "./capital_allocator";

export {
  checkConcentration,
  checkCorrelationCluster,
  checkRegimeExposure,
  checkDailyCAR,
  runGuardrailChecks,
  explainAllocationDecision,
  getGuardrailConfig,
  updateGuardrailConfig,
  getGuardrailCheckHistory,
  getAllocationExplanationHistory,
  _clearAll as clearAllGuardrails,
  type GuardrailCheck,
  type GuardrailConfig,
  type AllocationExplanation,
  type GuardrailCheckType,
  type Severity,
  type PortfolioState,
} from "./portfolio_guardrails";
