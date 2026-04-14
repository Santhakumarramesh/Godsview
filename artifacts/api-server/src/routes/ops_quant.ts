/**
 * Operations API Routes for GodsView Quant Intelligence Layer
 * 
 * Express router providing endpoints for:
 * - Daily and weekly operator briefs
 * - Operational runbook procedures
 * - Maintenance scheduling
 * - Action items and risk summaries
 * - Incident reporting
 */

import { Router, Request, Response, NextFunction } from 'express';
import {
  generateDailyBrief,
  generateWeeklyBrief,
  getAllRunbookProcedures,
  getRunbookProcedure,
  getMaintenanceSchedule,
  getMaintenanceTasksByFrequency,
  getActionItems,
  getRiskSummary,
  formatBriefForSlack,
  formatBriefForEmail,
  generateIncidentReport,
  formatIncidentReportAsText,
} from '../lib/ops';

const router = Router();

// ============================================================================
// TYPE DEFINITIONS FOR RESPONSES
// ============================================================================

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

interface ApiError {
  success: false;
  error: string;
  timestamp: string;
  statusCode: number;
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  console.error('[ops_quant] Error:', err);

  if (err instanceof Error) {
    res.status(500).json({
      success: false,
      error: err.message,
      timestamp: new Date().toISOString(),
      statusCode: 500,
    } as ApiError);
  } else {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: new Date().toISOString(),
      statusCode: 500,
    } as ApiError);
  }
}

// ============================================================================
// DAILY OPERATOR BRIEF ENDPOINTS
// ============================================================================

/**
 * GET /api/ops/brief
 * Generate and return today's operator brief
 */
router.get('/brief', (req: Request, res: Response, next: NextFunction) => {
  try {
    const brief = generateDailyBrief();
    res.json({
      success: true,
      data: brief,
      timestamp: new Date().toISOString(),
    } as ApiResponse<typeof brief>);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ops/brief/weekly
 * Generate and return this week's aggregated brief
 */
router.get('/brief/weekly', (req: Request, res: Response, next: NextFunction) => {
  try {
    const weeklyBrief = generateWeeklyBrief();
    res.json({
      success: true,
      data: weeklyBrief,
      timestamp: new Date().toISOString(),
    } as ApiResponse<typeof weeklyBrief>);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ops/brief/slack
 * Get daily brief formatted for Slack notification
 */
router.get('/brief/slack', (req: Request, res: Response, next: NextFunction) => {
  try {
    const slackMessage = formatBriefForSlack();
    res.json({
      success: true,
      data: {
        format: 'slack',
        message: slackMessage,
      },
      timestamp: new Date().toISOString(),
    } as ApiResponse<{ format: string; message: string }>);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ops/brief/email
 * Get daily brief formatted for email delivery
 */
router.get('/brief/email', (req: Request, res: Response, next: NextFunction) => {
  try {
    const emailMessage = formatBriefForEmail();
    res.json({
      success: true,
      data: {
        format: 'email',
        message: emailMessage,
      },
      timestamp: new Date().toISOString(),
    } as ApiResponse<{ format: string; message: string }>);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// OPERATIONAL RUNBOOK ENDPOINTS
// ============================================================================

/**
 * GET /api/ops/runbook
 * Get all available runbook procedures
 */
router.get('/runbook', (req: Request, res: Response, next: NextFunction) => {
  try {
    const procedures = getAllRunbookProcedures();
    res.json({
      success: true,
      data: {
        procedures,
        count: procedures.length,
      },
      timestamp: new Date().toISOString(),
    } as ApiResponse<{ procedures: typeof procedures; count: number }>);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ops/runbook/:procedure
 * Get a specific runbook procedure by name
 * 
 * Parameters:
 *   :procedure - Procedure name (e.g., STRATEGY_ONBOARDING, EMERGENCY_STOP)
 */
router.get('/runbook/:procedure', (req: Request, res: Response, next: NextFunction) => {
  try {
    const procedure = req.params.procedure as string;
    const proc = getRunbookProcedure(procedure);

    if (!proc) {
      res.status(404).json({
        success: false,
        error: `Procedure '${procedure}' not found`,
        timestamp: new Date().toISOString(),
        statusCode: 404,
      } as ApiError);
      return;
    }

    res.json({
      success: true,
      data: proc,
      timestamp: new Date().toISOString(),
    } as ApiResponse<typeof proc>);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// MAINTENANCE SCHEDULE ENDPOINTS
// ============================================================================

/**
 * GET /api/ops/maintenance
 * Get the complete maintenance schedule
 */
router.get('/maintenance', (req: Request, res: Response, next: NextFunction) => {
  try {
    const schedule = getMaintenanceSchedule();
    res.json({
      success: true,
      data: {
        schedule,
        count: schedule.length,
      },
      timestamp: new Date().toISOString(),
    } as ApiResponse<{ schedule: typeof schedule; count: number }>);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ops/maintenance/:frequency
 * Get maintenance tasks for a specific frequency
 * 
 * Parameters:
 *   :frequency - Task frequency (daily, weekly, monthly, quarterly)
 */
router.get('/maintenance/:frequency', (req: Request, res: Response, next: NextFunction) => {
  try {
    const frequency = req.params.frequency as string;
    const validFrequencies = ['daily', 'weekly', 'monthly', 'quarterly'];

    if (!validFrequencies.includes(frequency)) {
      res.status(400).json({
        success: false,
        error: `Invalid frequency '${frequency}'. Must be one of: ${validFrequencies.join(', ')}`,
        timestamp: new Date().toISOString(),
        statusCode: 400,
      } as ApiError);
      return;
    }

    const tasks = getMaintenanceTasksByFrequency(frequency as 'daily' | 'weekly' | 'monthly' | 'quarterly');
    res.json({
      success: true,
      data: {
        frequency,
        tasks,
        count: tasks.length,
      },
      timestamp: new Date().toISOString(),
    } as ApiResponse<{ frequency: string; tasks: typeof tasks; count: number }>);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// ACTION ITEMS AND RISK ENDPOINTS
// ============================================================================

/**
 * GET /api/ops/action-items
 * Get current action items prioritized by severity
 */
router.get('/action-items', (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = getActionItems();
    res.json({
      success: true,
      data: {
        items,
        count: items.length,
        critical: items.filter((i) => i.priority === 'critical').length,
        high: items.filter((i) => i.priority === 'high').length,
        medium: items.filter((i) => i.priority === 'medium').length,
        low: items.filter((i) => i.priority === 'low').length,
      },
      timestamp: new Date().toISOString(),
    } as ApiResponse<{
      items: typeof items;
      count: number;
      critical: number;
      high: number;
      medium: number;
      low: number;
    }>);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ops/risk
 * Get current risk summary and posture
 */
router.get('/risk', (req: Request, res: Response, next: NextFunction) => {
  try {
    const risk = getRiskSummary();
    res.json({
      success: true,
      data: risk,
      timestamp: new Date().toISOString(),
    } as ApiResponse<typeof risk>);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// INCIDENT REPORTING ENDPOINTS
// ============================================================================

/**
 * POST /api/ops/incident
 * Generate an incident report
 * 
 * Request Body:
 * {
 *   "title": "string",
 *   "description": "string",
 *   "severity": "low|medium|high|critical",
 *   "affectedSystems": ["string"],
 *   "rootCause": "string (optional)",
 *   "actionsTaken": ["string"],
 *   "recommendations": ["string"]
 * }
 */
router.post('/incident', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, description, severity, affectedSystems, rootCause, actionsTaken, recommendations } = req.body;

    // Validate required fields
    if (!title || !description || !severity || !affectedSystems || !actionsTaken || !recommendations) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: title, description, severity, affectedSystems, actionsTaken, recommendations',
        timestamp: new Date().toISOString(),
        statusCode: 400,
      } as ApiError);
      return;
    }

    // Validate severity
    const validSeverities = ['low', 'medium', 'high', 'critical'];
    if (!validSeverities.includes(severity)) {
      res.status(400).json({
        success: false,
        error: `Invalid severity '${severity}'. Must be one of: ${validSeverities.join(', ')}`,
        timestamp: new Date().toISOString(),
        statusCode: 400,
      } as ApiError);
      return;
    }

    // Generate incident report
    const report = generateIncidentReport({
      title,
      description,
      severity: severity as 'low' | 'medium' | 'high' | 'critical',
      affectedSystems,
      rootCause,
      actionsTaken,
      recommendations,
    });

    res.status(201).json({
      success: true,
      data: report,
      timestamp: new Date().toISOString(),
    } as ApiResponse<typeof report>);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ops/incident/format
 * Format an incident report as text for output
 * 
 * Request Body:
 * {
 *   "report": { incident report object }
 * }
 */
router.post('/incident/format', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { report } = req.body;

    if (!report) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: report',
        timestamp: new Date().toISOString(),
        statusCode: 400,
      } as ApiError);
      return;
    }

    const formatted = formatIncidentReportAsText(report);
    res.json({
      success: true,
      data: {
        formatted,
        incidentId: report.incidentId,
      },
      timestamp: new Date().toISOString(),
    } as ApiResponse<{ formatted: string; incidentId: string }>);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// HEALTH CHECK ENDPOINT
// ============================================================================

/**
 * GET /api/ops/health
 * Health check for the operations module
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status: 'operational',
      module: 'ops_quant',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  } as ApiResponse<{ status: string; module: string; version: string; timestamp: string }>);
});

// ============================================================================
// ERROR HANDLER MIDDLEWARE
// ============================================================================

router.use(errorHandler);

// ============================================================================
// EXPORTS
// ============================================================================

export default router;
