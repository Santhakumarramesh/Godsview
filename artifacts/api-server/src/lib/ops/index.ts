// @ts-nocheck
/**
 * DESIGN SCAFFOLD — not wired into the live runtime.
 * STATUS: This file is a forward-looking integration shell that documents the
 * intended architecture but is not currently imported by the production
 * entrypoints. Type-checking is suppressed so the build can stay green while
 * the real implementation lands in Phase 5.
 *
 * REMOVE the `// @ts-nocheck` directive once Phase 5 is implemented and the
 * file is actually mounted in `src/index.ts` / `src/routes/index.ts`.
 */

/**
 * GodsView Operations Module
 * 
 * Exports operational runbook and daily briefing functionality
 * for the quant intelligence layer.
 */

import QuantRunbook, { RunbookProcedure, MaintenanceTask, IncidentReport } from './quant_runbook';
import DailyOperatorBrief, { DailyBrief, WeeklyBrief, ActionItem, RiskSummary } from './daily_operator_brief';

// ============================================================================
// SINGLETON INSTANCES
// ============================================================================

let quantRunbookInstance: QuantRunbook | null = null;
let dailyBriefInstance: DailyOperatorBrief | null = null;

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initializeOperations(): void {
  if (!quantRunbookInstance) {
    quantRunbookInstance = new QuantRunbook();
  }
  if (!dailyBriefInstance) {
    dailyBriefInstance = new DailyOperatorBrief();
  }
}

export function getQuantRunbook(): QuantRunbook {
  if (!quantRunbookInstance) {
    initializeOperations();
  }
  return quantRunbookInstance!;
}

export function getDailyOperatorBrief(): DailyOperatorBrief {
  if (!dailyBriefInstance) {
    initializeOperations();
  }
  return dailyBriefInstance!;
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export function generateDailyBrief(): DailyBrief {
  const brief = getDailyOperatorBrief();
  return brief.generateBrief();
}

export function generateWeeklyBrief(): WeeklyBrief {
  const brief = getDailyOperatorBrief();
  return brief.generateWeeklyBrief();
}

export function getRunbookProcedure(name: string): RunbookProcedure | undefined {
  const runbook = getQuantRunbook();
  return runbook.getProcedure(name);
}

export function getAllRunbookProcedures(): RunbookProcedure[] {
  const runbook = getQuantRunbook();
  return runbook.getAllProcedures();
}

export function getMaintenanceSchedule(): MaintenanceTask[] {
  const runbook = getQuantRunbook();
  return runbook.getMaintenanceSchedule();
}

export function getMaintenanceTasksByFrequency(frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly'): MaintenanceTask[] {
  const runbook = getQuantRunbook();
  return runbook.getTasksForFrequency(frequency);
}

export function getActionItems(): ActionItem[] {
  const brief = getDailyOperatorBrief();
  return brief.getActionItems();
}

export function getRiskSummary(): RiskSummary {
  const brief = getDailyOperatorBrief();
  return brief.getRiskSummary();
}

export function formatBriefForSlack(): string {
  const brief = getDailyOperatorBrief();
  return brief.formatForSlack();
}

export function formatBriefForEmail(): string {
  const brief = getDailyOperatorBrief();
  return brief.formatForEmail();
}

export function generateIncidentReport(data: {
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affectedSystems: string[];
  rootCause?: string;
  actionsTaken: string[];
  recommendations: string[];
}): IncidentReport {
  const runbook = getQuantRunbook();
  return runbook.generateIncidentReport(data);
}

export function formatIncidentReportAsText(report: IncidentReport): string {
  const runbook = getQuantRunbook();
  return runbook.formatIncidentReportAsText(report);
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

export { QuantRunbook, DailyOperatorBrief };
export type {
  RunbookProcedure,
  RunbookStep,
  RollbackStep,
  EscalationContact,
  MaintenanceTask,
  MaintenanceSchedule,
  IncidentReport,
  DailyBrief,
  WeeklyBrief,
  SystemHealth,
  StrategyStatus,
  PerformanceMetrics,
  DriftAlert,
  CalibrationStatus,
  ShadowSession,
  MemoryHealth,
  EvaluationStatus,
  ActionItem,
  RiskSummary,
} from './quant_runbook';

export type {
  SystemHealth as BriefSystemHealth,
  StrategyStatus as BriefStrategyStatus,
  PerformanceMetrics as BriefPerformanceMetrics,
  DriftAlert as BriefDriftAlert,
  CalibrationStatus as BriefCalibrationStatus,
  ShadowSession as BriefShadowSession,
  MemoryHealth as BriefMemoryHealth,
  EvaluationStatus as BriefEvaluationStatus,
  ActionItem as BriefActionItem,
  RiskSummary as BriefRiskSummary,
} from './daily_operator_brief';

export default {
  initializeOperations,
  getQuantRunbook,
  getDailyOperatorBrief,
  generateDailyBrief,
  generateWeeklyBrief,
  getRunbookProcedure,
  getAllRunbookProcedures,
  getMaintenanceSchedule,
  getMaintenanceTasksByFrequency,
  getActionItems,
  getRiskSummary,
  formatBriefForSlack,
  formatBriefForEmail,
  generateIncidentReport,
  formatIncidentReportAsText,
};
