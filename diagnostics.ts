/**
 * Diagnostics - Strategy and system health diagnostics
 *
 * Identifies issues, root causes, and suggests quick fixes for
 * traders when strategies underperform or systems malfunction.
 */

import { randomUUID } from 'crypto';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface DiagnosticIssue {
  category:
    | 'performance'
    | 'risk'
    | 'data'
    | 'execution'
    | 'configuration'
    | 'market';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  evidence: string;
  suggestedAction: string;
}

export interface Fix {
  description: string;
  action: string;
  impact: string;
  effort: 'easy' | 'moderate' | 'complex';
  automated: boolean;
}

export interface DiagnosticReport {
  strategyId: string;
  health: 'healthy' | 'warning' | 'sick' | 'critical';
  issues: DiagnosticIssue[];
  quickFixes: Fix[];
  detailedAnalysis: string;
  timeline: { date: string; event: string; impact: string }[];
}

export interface TradeFailureDiagnosis {
  tradeId: string;
  failureReason: string;
  rootCauses: string[];
  preventionStrategies: string[];
  marketCondition: string;
}

export interface InactivityDiagnosis {
  reason: string;
  duration: string;
  affectedStrategies: string[];
  checkItems: { item: string; status: 'pass' | 'fail' | 'warning' }[];
  nextSteps: string[];
}

export interface SystemCheckReport {
  timestamp: string;
  overallHealth: 'healthy' | 'degraded' | 'down';
  components: {
    name: string;
    status: 'ok' | 'warning' | 'error';
    message: string;
  }[];
  issues: DiagnosticIssue[];
  recommendations: string[];
}

// ──────────────────────────────────────────────────────────────────────────
// Diagnostics
// ──────────────────────────────────────────────────────────────────────────

export class Diagnostics {
  /**
   * Comprehensive strategy diagnostics
   */
  diagnose(strategyId: string): DiagnosticReport {
    // Mock strategy data
    const mockStrategy = {
      id: strategyId,
      winRate: 0.45,
      sharpeRatio: 0.8,
      profitFactor: 1.2,
      maxDrawdown: 0.25,
      trades: 50,
      avgTrade: -50,
    };

    const issues = this.identifyIssues(mockStrategy);
    const fixes = this.suggestFixes(issues);
    const analysis = this.generateAnalysis(mockStrategy, issues);
    const timeline = this.generateTimeline(strategyId);

    // Determine health
    let health: 'healthy' | 'warning' | 'sick' | 'critical' = 'healthy';
    const criticalCount = issues.filter(i => i.severity === 'critical').length;