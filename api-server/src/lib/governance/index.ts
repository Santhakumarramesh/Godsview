/**
 * governance/index.ts — Governance System Orchestrator
 *
 * Central export point for the Phase 6 governance system.
 * Orchestrates promotion, demotion, degradation monitoring, and operator dashboard.
 */

export { PromotionEngine, type PromotionDecision, type DemotionDecision, type EvidencePacket, type GateResult, type StrategyMetrics } from "./promotion_engine";

export {
  DegradationMonitor,
  type DegradationReport,
  type DegradationSignal,
  type DriftResult,
  type DegradationTrend,
} from "./degradation_monitor";

export {
  StrategyFamily,
  type StrategyFamilyGroup,
  type FamilyComparison,
  type RetirementDecision,
  type FamilyAnalytics,
  type StrategyLineage,
} from "./strategy_family";

export {
  OperatorDashboard,
  type ReviewItem,
  type OperatorAlert,
  type SystemHealthOverview,
  type PortfolioOverview,
  type DailyOperatorReport,
} from "./operator_dashboard";

// ── Governance Orchestrator ────────────────────────────────────────────────

import { logger } from "../logger";
import { PromotionEngine } from "./promotion_engine";
import { DegradationMonitor } from "./degradation_monitor";
import { StrategyFamily } from "./strategy_family";
import { OperatorDashboard } from "./operator_dashboard";

export class GovernanceSystem {
  private promotionEngine: PromotionEngine;
  private degradationMonitor: DegradationMonitor;
  private strategyFamily: StrategyFamily;
  private operatorDashboard: OperatorDashboard;

  constructor() {
    this.promotionEngine = new PromotionEngine();
    this.degradationMonitor = new DegradationMonitor();
    this.strategyFamily = new StrategyFamily();
    this.operatorDashboard = new OperatorDashboard();

    logger.info({}, "Governance system initialized");
  }

  // ── Promotion Workflow ─────────────────────────────────────────────────

  evaluateStrategyForPromotion(strategyId: string, currentTier: string, metrics: any) {
    return this.promotionEngine.evaluatePromotion(strategyId, currentTier, metrics);
  }

  generatePromotionEvidence(strategyId: string, metrics: any) {
    return this.promotionEngine.generateEvidencePacket(strategyId, metrics);
  }

  approvePromotion(strategyId: string, targetTier: string, approver: string) {
    return this.promotionEngine.executePromotion(strategyId, targetTier, approver);
  }

  // ── Degradation Workflow ───────────────────────────────────────────────

  checkStrategyDegradation(strategyId: string, recentMetrics: any, historicalMetrics: any) {
    return this.degradationMonitor.checkDegradation(strategyId, recentMetrics, historicalMetrics);
  }

  monitorAllStrategies(strategies: any[]) {
    return this.degradationMonitor.monitorAll(strategies);
  }

  recordStrategyMetrics(strategyId: string, metrics: any) {
    this.degradationMonitor.recordMetrics(strategyId, metrics);
  }

  // ── Family Management ──────────────────────────────────────────────────

  organizeStrategyFamilies(strategies: any[]) {
    return this.strategyFamily.groupIntoFamilies(strategies);
  }

  compareFamilyMembers(familyId: string) {
    return this.strategyFamily.compareFamilyMembers(familyId);
  }

  evaluateStrategyRetirement(strategyId: string) {
    return this.strategyFamily.evaluateRetirement(strategyId);
  }

  // ── Operator Dashboard ─────────────────────────────────────────────────

  getPendingReviews() {
    return this.operatorDashboard.getPendingReviews();
  }

  getSystemHealth() {
    return this.operatorDashboard.getSystemHealth();
  }

  getPortfolioOverview() {
    return this.operatorDashboard.getPortfolioOverview();
  }

  getAlerts() {
    return this.operatorDashboard.getAlerts();
  }

  generateDailyReport() {
    return this.operatorDashboard.generateDailyReport();
  }

  recordOperatorDecision(reviewId: string, decision: string, notes: string) {
    this.operatorDashboard.recordDecision(reviewId, decision, notes);
  }

  pauseStrategy(strategyId: string, reason: string) {
    this.operatorDashboard.pauseStrategy(strategyId, reason);
  }

  resumeStrategy(strategyId: string) {
    this.operatorDashboard.resumeStrategy(strategyId);
  }

  overridePromotion(strategyId: string, targetTier: string, reason: string) {
    this.operatorDashboard.overridePromotion(strategyId, targetTier, reason);
  }

  forceRetire(strategyId: string, reason: string) {
    this.operatorDashboard.forceRetire(strategyId, reason);
  }

  // ── System Status ──────────────────────────────────────────────────────

  getGovernanceStatus() {
    return {
      timestamp: new Date().toISOString(),
      components: {
        promotionEngine: "active",
        degradationMonitor: "active",
        strategyFamily: "active",
        operatorDashboard: "active",
      },
      systemHealth: this.getSystemHealth(),
    };
  }
}

// ── Singleton Instance ─────────────────────────────────────────────────────

export let governanceSystem: GovernanceSystem | null = null;

export function initGovernanceSystem(): GovernanceSystem {
  governanceSystem = new GovernanceSystem();
  return governanceSystem;
}

export function getGovernanceSystem(): GovernanceSystem {
  if (!governanceSystem) {
    governanceSystem = new GovernanceSystem();
  }
  return governanceSystem;
}
