/**
 * shadow_canary/index.ts — Barrel Export
 */

export {
  createShadowSession,
  addHypotheticalOrder,
  recordMarketOutcome,
  completeShadowSession,
  getShadowSession,
  getShadowSessionsByStrategy,
  getActiveShadowSessions,
  getAllShadowSessions,
  _clearSessions,
  type ShadowSession,
  type ShadowSessionStatus,
  type ShadowMode,
  type OrderSide,
  type HypotheticalOrder,
  type ComparisonResult,
} from "./shadow_mode_manager";

export {
  createCanaryDeployment,
  activateCanary,
  checkDemotionRules,
  demoteCanary,
  graduateCanary,
  revokeCanary,
  getDeployment,
  getDeploymentsByStrategy,
  getActiveDeployments,
  getAllDeployments,
  updatePerformanceMetrics,
  _clearDeployments,
  type CanaryDeployment,
  type CanaryStatus,
  type CanaryConfig,
  type ComparisonOperator,
  type AutoDemotionAction,
  type AutoDemotionRule,
  type PerformanceMetrics,
} from "./canary_controller";
