/**
 * report_generator.ts — Human-Readable Analysis Reports
 *
 * Generates comprehensive reports suitable for:
 *   - Traders reviewing strategy quality
 *   - Risk managers assessing drawdowns
 *   - Researchers documenting findings
 *   - Compliance auditors verifying decisions
 *
 * Report types:
 *   - Strategy Report: full deep dive into strategy quality
 *   - Daily Report: what happened today and why
 *   - Performance Review: monthly/quarterly review
 *   - Executive Summary: one-page high-level overview
 */

import { logger } from "../logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReportSection {
  summary: string;
  grade?: string;
  recommendation?: string;
  metrics?: Record<string, any>;
  narrative?: string;
  charts?: any[];
  warnings?: string[];
}

export interface StrategyReport {
  title: string;
  generatedAt: string;
  strategyId: string;
  period: string;

  sections: {
    overview: ReportSection & { grade: string; recommendation: string };
    performance: ReportSection & { metrics: any };
    risk: ReportSection & { metrics: any };
    attribution: ReportSection & { metrics: any };
    fragility: ReportSection & { metrics: any };
    improvements: ReportSection;
    conclusion: ReportSection;
  };

  // Formatted for display
  plainText: string;
  htmlSummary: string;
  markdownSummary: string;
}

export interface DailyReport {
  date: string;
  generatedAt: string;

  sections: {
    summary: ReportSection;
    trades: ReportSection & { trades: any[] };
    performance: ReportSection & { metrics: any };
    market: ReportSection;
    risks: ReportSection & { alerts: any[] };
  };

  plainText: string;
  htmlSummary: string;
}

export interface PerformanceReview {
  period: string;
  generatedAt: string;

  sections: {
    overview: ReportSection;
    trends: ReportSection;
    bestPerformers: ReportSection;
    worstPerformers: ReportSection;
    recommendations: ReportSection;
  };

  plainText: string;
}

export interface ExecutiveSummary {
  generatedAt: string;

  sections: {
    status: string;
    keyMetrics: any;
    topRisks: string[];
    recommendations: string[];
  };

  plainText: string;
}

// ─── Report Generator ────────────────────────────────────────────────────────

export class ReportGenerator {
  /**