/**
 * ux/index.ts - UX System Orchestrator
 *
 * Central hub for all user experience and workflow management:
 * - Workflow orchestration (idea → ready)
 * - Strategy summarization (technical → plain English)
 * - Guided strategy builder (step-by-step)
 * - System diagnostics (health checks, issue detection)
 */

// ─────────────────────────────────────────────────────────────────────────
// WorkflowEngine
// ─────────────────────────────────────────────────────────────────────────
export {
  WorkflowEngine,
  getWorkflowEngine,
  type WorkflowInput,
  type WorkflowState,
  type WorkflowStep,
  type WorkflowResult,
  type NextStepGuidance,
  type QuickResult,
  type DeployResult,
} from './workflow_engine';

// ─────────────────────────────────────────────────────────────────────────
// StrategySummarizer
// ─────────────────────────────────────────────────────────────────────────
export {
  StrategySummarizer,
  getStrategySummarizer,
  type StrategySummary,
  type DetailedSummary,
  type ComparisonSummary,
  type FormattedMetrics,
} from './strategy_summarizer';

// ─────────────────────────────────────────────────────────────────────────
// GuidedBuilder
// ─────────────────────────────────────────────────────────────────────────
export {
  GuidedBuilder,
  getGuidedBuilder,
  type BuildSession,
  type BuildSection,
  type BuildQuestion,
  type BuildStep,
} from './guided_builder';

// ─────────────────────────────────────────────────────────────────────────
// Diagnostics
// ─────────────────────────────────────────────────────────────────────────
export {
  Diagnostics,
  getDiagnostics,
  type DiagnosticReport,
  type DiagnosticIssue,
  type TradeFailureDiagnosis,
  type InactivityDiagnosis,
  type SystemCheckReport,
  type Fix,
} from './diagnostics';

/**
 * Unified UX System - Single entry point
 */
export class UXSystem {
  private static instance: UXSystem;

  private constructor() {}

  static getInstance(): UXSystem {
    if (!UXSystem.instance) {
      UXSystem.instance = new UXSystem();
    }
    return UXSystem.instance;
  }

  /**
   * Get all UX services
   */
  getServices() {
    const { getWorkflowEngine } = require('./workflow_engine');
    const { getStrategySummarizer } = require('./strategy_summarizer');
    const { getGuidedBuilder } = require('./guided_builder');
    const { getDiagnostics } = require('./diagnostics');

    return {
      workflow: getWorkflowEngine(),
      summarizer: getStrategySummarizer(),
      builder: getGuidedBuilder(),
      diagnostics: getDiagnostics(),
    };
  }
}

export function getUXSystem(): UXSystem {
  return UXSystem.getInstance();
}
