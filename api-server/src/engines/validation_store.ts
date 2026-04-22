/**
 * validation_store.ts — Persistent Validation Report Storage (Phase 51)
 *
 * Stores validation results from:
 *   - Walk-forward tests
 *   - Stress tests
 *   - Monte Carlo simulations
 *   - Paper validation runs
 */

import { persistWrite, persistRead, persistAppend } from "../lib/persistent_store.js";
import { logger } from "../lib/logger.js";

export interface ValidationReport {
  id: string;
  strategyId: string;
  type: "walk_forward" | "stress_test" | "monte_carlo" | "paper_validation";
  result: "PASS" | "FAIL" | "MARGINAL";
  metrics: Record<string, number>;
  details: Record<string, unknown>;
  createdAt: string;
}

export function saveValidationReport(report: ValidationReport): void {
  try {
    persistAppend("validation_reports", report);
    logger.info(
      { id: report.id, type: report.type, result: report.result },
      "Validation report saved"
    );
  } catch (error) {
    logger.error({ error, reportId: report.id }, "Failed to save validation report");
    throw error;
  }
}

export function getValidationReports(strategyId?: string): ValidationReport[] {
  try {
    const all = persistRead<ValidationReport[]>("validation_reports", []);
    if (!strategyId) return all;
    return all.filter((r) => r.strategyId === strategyId);
  } catch (error) {
    logger.warn({ error, strategyId }, "Failed to read validation reports");
    return [];
  }
}

export function getLatestValidation(
  strategyId: string,
  type: string
): ValidationReport | null {
  try {
    const reports = getValidationReports(strategyId).filter((r) => r.type === type as any);
    return reports.length > 0 ? reports[reports.length - 1]! : null;
  } catch (error) {
    logger.warn({ error, strategyId, type }, "Failed to get latest validation");
    return null;
  }
}

export function clearValidationReports(): void {
  try {
    persistWrite("validation_reports", []);
    logger.info("Cleared validation reports");
  } catch (error) {
    logger.error({ error }, "Failed to clear validation reports");
  }
}

export function getValidationStatistics(): {
  total: number;
  byType: Record<string, number>;
  byResult: Record<string, number>;
} {
  const reports = persistRead<ValidationReport[]>("validation_reports", []);
  const byType: Record<string, number> = {};
  const byResult: Record<string, number> = {};

  for (const report of reports) {
    byType[report.type] = (byType[report.type] ?? 0) + 1;
    byResult[report.result] = (byResult[report.result] ?? 0) + 1;
  }

  return { total: reports.length, byType, byResult };
}
