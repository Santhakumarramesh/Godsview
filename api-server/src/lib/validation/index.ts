/**
 * Phase 27 — Production Validation Backbone
 * Public API barrel export
 */

export {
  createValidationSession,
  startValidationSession,
  completeValidationSession,
  abortValidationSession,
  recordTrade,
  addValidationEvent,
  getSession,
  getSessionsByStrategy,
  getActiveSessions,
  getAllSessions,
  _clearSessions,
  type ValidationSession,
  type ValidationSessionConfig,
  type ValidationSessionType,
  type ValidationSessionStatus,
  type ValidationMetrics,
  type ValidationEvent,
  type TradeRecord,
} from "./validation_session_manager";

export {
  generateComparisonReport,
  getReport,
  getReportsByStrategy,
  getAllReports,
  _clearReports,
  type PerformanceSnapshot,
  type ComparisonReport,
  type DeviationResult,
} from "./comparison_engine";

export {
  computeReadinessScore,
  getReadinessScore,
  getLatestScoreByStrategy,
  getAllScores,
  _clearScores,
  PROMOTION_THRESHOLDS,
  type ReadinessScore,
  type ReadinessLevel,
  type PromotionBlocker,
  type BlockerSeverity,
  type ReadinessDimension,
} from "./readiness_scorer";
