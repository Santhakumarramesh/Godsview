/**
 * routes/certification_gate.ts — Phase 36: Go-Live Certification Gate API Routes
 *
 * Critical pre-production certification endpoints for comprehensive go-live validation.
 *
 * Endpoints:
 *   POST   /certify                      — run full certification audit
 *   POST   /check/:category              — run single category check
 *   GET    /reports                      — list all certification reports
 *   GET    /reports/:id                  — get specific report
 *   GET    /reports/latest               — get most recent report
 *   GET    /blockers                     — get current critical blockers
 *   GET    /status                       — certification status (certified/not_certified/expired)
 *   GET    /summary                      — human-readable certification summary
 */

import { Router, Request, Response } from "express";
import {
  runFullCertification,
  runCategoryCheck,
  getReport,
  getLatestReport,
  getAllReports,
  type CertificationCategory,
} from "../lib/certification_gate";
import { logger as _logger } from "../lib/logger";

const logger = _logger.child({ module: "routes/certification_gate" });
const router = Router();

// ─── Request/Response Helpers ─────────────────────────────────────────────────

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp?: number;
}

// ─── POST /api/certification-gate/certify ────────────────────────────────────

/**
 * Run full certification audit across all 8 categories.
 * Returns comprehensive report with pass/fail status and blockers.
 */
router.post("/certify", (req: Request, res: Response) => {
  try {
    logger.info("Received full certification request");
    const report = runFullCertification();

    const response: ApiResponse = {
      success: true,
      data: report,
      timestamp: Date.now(),
    };

    res.json(response);
  } catch (error) {
    logger.error({ error }, "Error running full certification");
    res.status(500).json({
      success: false,
      error: "Failed to run certification",
      timestamp: Date.now(),
    });
  }
});

// ─── POST /api/certification-gate/check/:category ────────────────────────────

/**
 * Run certification check for a specific category.
 * Useful for re-validating individual subsystems.
 */
router.post("/check/:category", (req: Request, res: Response) => {
  try {
    const { category } = req.params;
    const validCategories = [
      "strategy_validation",
      "reconciliation_health",
      "data_truth",
      "latency_thresholds",
      "auth_security",
      "disaster_drill_completion",
      "test_coverage",
      "documentation_completeness",
    ];

    if (!validCategories.includes(category)) {
      return res.status(400).json({
        success: false,
        error: `Invalid category. Must be one of: ${validCategories.join(", ")}`,
        timestamp: Date.now(),
      });
    }

    logger.info({ category }, "Running category-specific check");
    const check = runCategoryCheck(category as CertificationCategory);

    const response: ApiResponse = {
      success: true,
      data: check,
      timestamp: Date.now(),
    };

    res.json(response);
  } catch (error) {
    logger.error({ error }, "Error running category check");
    res.status(500).json({
      success: false,
      error: "Failed to run category check",
      timestamp: Date.now(),
    });
  }
});

// ─── GET /api/certification-gate/reports ─────────────────────────────────────

/**
 * List all certification reports in reverse chronological order.
 * Includes full details for each report.
 */
router.get("/reports", (req: Request, res: Response) => {
  try {
    logger.debug("Fetching all certification reports");
    const reports = getAllReports();

    const response: ApiResponse = {
      success: true,
      data: {
        total: reports.length,
        reports,
      },
      timestamp: Date.now(),
    };

    res.json(response);
  } catch (error) {
    logger.error({ error }, "Error fetching reports");
    res.status(500).json({
      success: false,
      error: "Failed to fetch reports",
      timestamp: Date.now(),
    });
  }
});

// ─── GET /api/certification-gate/reports/:id ─────────────────────────────────

/**
 * Retrieve a specific certification report by ID.
 * Returns 404 if report not found.
 */
router.get("/reports/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    logger.debug({ report_id: id }, "Fetching specific report");

    const report = getReport(id);
    if (!report) {
      return res.status(404).json({
        success: false,
        error: "Report not found",
        timestamp: Date.now(),
      });
    }

    const response: ApiResponse = {
      success: true,
      data: report,
      timestamp: Date.now(),
    };

    res.json(response);
  } catch (error) {
    logger.error({ error }, "Error fetching report");
    res.status(500).json({
      success: false,
      error: "Failed to fetch report",
      timestamp: Date.now(),
    });
  }
});

// ─── GET /api/certification-gate/reports/latest ───────────────────────────────

/**
 * Get the most recent certification report.
 * Returns 404 if no reports have been generated yet.
 */
router.get("/reports/latest", (req: Request, res: Response) => {
  try {
    logger.debug("Fetching latest certification report");
    const report = getLatestReport();

    if (!report) {
      return res.status(404).json({
        success: false,
        error: "No certification reports found",
        timestamp: Date.now(),
      });
    }

    const response: ApiResponse = {
      success: true,
      data: report,
      timestamp: Date.now(),
    };

    res.json(response);
  } catch (error) {
    logger.error({ error }, "Error fetching latest report");
    res.status(500).json({
      success: false,
      error: "Failed to fetch latest report",
      timestamp: Date.now(),
    });
  }
});

// ─── GET /api/certification-gate/blockers ────────────────────────────────────

/**
 * Get current critical blockers from the latest certification.
 * Returns empty array if no blockers or if no reports exist.
 */
router.get("/blockers", (req: Request, res: Response) => {
  try {
    logger.debug("Fetching current blockers");
    const latestReport = getLatestReport();

    const blockers = latestReport ? latestReport.critical_blockers : [];

    const response: ApiResponse = {
      success: true,
      data: {
        blocker_count: blockers.length,
        blockers,
        is_blocked: blockers.length > 0,
      },
      timestamp: Date.now(),
    };

    res.json(response);
  } catch (error) {
    logger.error({ error }, "Error fetching blockers");
    res.status(500).json({
      success: false,
      error: "Failed to fetch blockers",
      timestamp: Date.now(),
    });
  }
});

// ─── GET /api/certification-gate/status ──────────────────────────────────────

/**
 * Get current certification status.
 * Returns: certified, not_certified, or no_reports_yet
 */
router.get("/status", (req: Request, res: Response) => {
  try {
    logger.debug("Fetching certification status");
    const latestReport = getLatestReport();

    if (!latestReport) {
      return res.json({
        success: true,
        data: {
          status: "no_reports_yet",
          certified: false,
          report_id: null,
          generated_at: null,
        },
        timestamp: Date.now(),
      });
    }

    const certified = latestReport.status === "pass" || latestReport.status === "pass_with_restrictions";

    const response: ApiResponse = {
      success: true,
      data: {
        status: certified ? "certified" : "not_certified",
        report_status: latestReport.status,
        certified,
        report_id: latestReport.report_id,
        overall_score: latestReport.overall_score,
        critical_blockers: latestReport.critical_blockers.length,
        restrictions: latestReport.restrictions.length,
        generated_at: latestReport.generated_at,
      },
      timestamp: Date.now(),
    };

    res.json(response);
  } catch (error) {
    logger.error({ error }, "Error fetching certification status");
    res.status(500).json({
      success: false,
      error: "Failed to fetch certification status",
      timestamp: Date.now(),
    });
  }
});

// ─── GET /api/certification-gate/summary ─────────────────────────────────────

/**
 * Human-readable certification summary with pass/fail per category.
 * Good for dashboards and monitoring alerts.
 */
router.get("/summary", (req: Request, res: Response) => {
  try {
    logger.debug("Fetching certification summary");
    const latestReport = getLatestReport();

    if (!latestReport) {
      return res.status(404).json({
        success: false,
        error: "No certification reports found",
        timestamp: Date.now(),
      });
    }

    // Group checks by category and summarize
    const categoryStatus = new Map<string, { passed: number; failed: number; warnings: number }>();

    for (const check of latestReport.checks) {
      const category = check.category;
      if (!categoryStatus.has(category)) {
        categoryStatus.set(category, { passed: 0, failed: 0, warnings: 0 });
      }

      const status = categoryStatus.get(category)!;
      if (check.status === "pass") status.passed++;
      else if (check.status === "fail") status.failed++;
      else if (check.status === "warning") status.warnings++;
    }

    const summary: Record<string, any> = {};
    for (const [category, counts] of categoryStatus.entries()) {
      const total = counts.passed + counts.failed + counts.warnings;
      const categoryPassed = counts.failed === 0;
      summary[category] = {
        passed: categoryPassed,
        checks_passed: counts.passed,
        checks_failed: counts.failed,
        checks_warnings: counts.warnings,
        details: latestReport.checks
          .filter((c) => c.category === category)
          .map((c) => ({
            name: c.name,
            status: c.status,
            score: c.score,
          })),
      };
    }

    const response: ApiResponse = {
      success: true,
      data: {
        report_id: latestReport.report_id,
        overall_status: latestReport.status,
        overall_score: latestReport.overall_score,
        summary,
        total_checks: latestReport.checks.length,
        passed: latestReport.passed_count,
        failed: latestReport.failed_count,
        warnings: latestReport.warning_count,
        critical_blockers: latestReport.critical_blockers,
        restrictions: latestReport.restrictions,
        generated_at: latestReport.generated_at,
      },
      timestamp: Date.now(),
    };

    res.json(response);
  } catch (error) {
    logger.error({ error }, "Error generating certification summary");
    res.status(500).json({
      success: false,
      error: "Failed to generate certification summary",
      timestamp: Date.now(),
    });
  }
});

export default router;
