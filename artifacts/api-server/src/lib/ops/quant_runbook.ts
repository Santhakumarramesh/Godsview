import { EventEmitter } from 'events';

/**
 * Operational Runbook for GodsView Quant Intelligence Layer
 * 
 * Defines standard operating procedures for managing strategies,
 * handling incidents, and maintaining system health.
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface RunbookStep {
  order: number;
  action: string;
  rationale: string;
  expectedOutcome: string;
  estimatedDurationSeconds: number;
  requiredPermissions?: string[];
  checkpoints?: string[];
}

export interface RollbackStep {
  order: number;
  action: string;
  rationale: string;
  expectedOutcome: string;
  estimatedDurationSeconds: number;
}

export interface RunbookProcedure {
  name: string;
  displayName: string;
  description: string;
  whenToUse: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  steps: RunbookStep[];
  rollbackSteps: RollbackStep[];
  escalationPath: string[];
  estimatedTotalTime: number;
  lastUpdated: Date;
  updatedBy: string;
  tags: string[];
}

export interface EscalationContact {
  role: string;
  name: string;
  phone: string;
  email: string;
  availability: string;
}

export interface MaintenanceTask {
  taskId: string;
  name: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  estimatedDurationMinutes: number;
  procedure: string;
  requiredPermissions?: string[];
  successCriteria: string[];
}

export interface MaintenanceSchedule {
  date: Date;
  dailyTasks: MaintenanceTask[];
  weeklyTasks: MaintenanceTask[];
  monthlyTasks: MaintenanceTask[];
  quarterlyTasks: MaintenanceTask[];
}

export interface IncidentReport {
  incidentId: string;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  affectedSystems: string[];
  rootCause?: string;
  actionsTaken: string[];
  recommendations: string[];
  timeline: { time: Date; event: string }[];
  involvedPersonnel: string[];
  postMortemScheduled: boolean;
}

// ============================================================================
// QUANT RUNBOOK CLASS
// ============================================================================

export class QuantRunbook extends EventEmitter {
  private procedures: Map<string, RunbookProcedure> = new Map();
  private escalationMatrix: Map<string, EscalationContact[]> = new Map();
  private maintenanceSchedule: MaintenanceTask[] = [];

  constructor() {
    super();
    this.initializeProcedures();
    this.initializeEscalationMatrix();
    this.initializeMaintenanceSchedule();
  }

  private initializeProcedures(): void {
    this.procedures.set('STRATEGY_ONBOARDING', {
      name: 'STRATEGY_ONBOARDING',
      displayName: 'Strategy Onboarding',
      description: 'Process for onboarding a new strategy idea into the quant pipeline',
      whenToUse: 'When a new trading strategy concept is submitted for evaluation',
      severity: 'medium',
      steps: [
        {
          order: 1,
          action: 'Receive and validate strategy submission',
          rationale: 'Ensure submission meets baseline requirements and format',
          expectedOutcome: 'Strategy ID assigned and logged in system',
          estimatedDurationSeconds: 300,
          requiredPermissions: ['strategy.submit'],
          checkpoints: ['Valid submission format', 'Basic risk filters pass'],
        },
        {
          order: 2,
          action: 'Analyst reviews strategy interpretations and logic',
          rationale: 'Catch conceptual errors and validate trading hypothesis',
          expectedOutcome: 'Interpretation review document with recommendations',
          estimatedDurationSeconds: 3600,
          requiredPermissions: ['strategy.review'],
          checkpoints: ['Logic is sound', 'No obvious arbitrage violations', 'Risk profile documented'],
        },
        {
          order: 3,
          action: 'Get formal approval from strategy committee',
          rationale: 'Ensure alignment with platform capabilities and risk policy',
          expectedOutcome: 'Strategy approved for backtesting',
          estimatedDurationSeconds: 1800,
          requiredPermissions: ['strategy.approve'],
          checkpoints: ['Committee consensus', 'Risk sign-off', 'Resource allocation approved'],
        },
        {
          order: 4,
          action: 'Execute backtest on historical data',
          rationale: 'Validate performance assumptions under realistic conditions',
          expectedOutcome: 'Backtest results with Sharpe ratio, max drawdown, and stability metrics',
          estimatedDurationSeconds: 7200,
          requiredPermissions: ['backtest.run'],
          checkpoints: ['Backtest completes without errors', 'Results are reasonable', 'Data quality verified'],
        },
        {
          order: 5,
          action: 'Analyst reviews backtest results and performance',
          rationale: 'Determine if strategy warrants live testing',
          expectedOutcome: 'Pass/fail decision with detailed analysis',
          estimatedDurationSeconds: 3600,
          requiredPermissions: ['backtest.review'],
          checkpoints: ['Metrics meet minimum thresholds', 'No suspicious patterns', 'Overfitting assessment done'],
        },
        {
          order: 6,
          action: 'Transition strategy to shadow mode (paper trading)',
          rationale: 'Test strategy execution logic in real-time market conditions',
          expectedOutcome: 'Strategy enters shadow session on live market feed',
          estimatedDurationSeconds: 600,
          requiredPermissions: ['strategy.shadow'],
          checkpoints: ['Shadow mode initialized', 'Market feed connected', 'Execution engine ready'],
        },
        {
          order: 7,
          action: 'Monitor shadow session for 14 calendar days',
          rationale: 'Ensure strategy behavior matches backtest predictions in live markets',
          expectedOutcome: 'Shadow session completes with calibration data collected',
          estimatedDurationSeconds: 1209600,
          requiredPermissions: ['strategy.monitor'],
          checkpoints: ['Daily monitoring reports', 'No unexpected execution issues', 'Calibration data quality good'],
        },
        {
          order: 8,
          action: 'Review shadow results and approve for live trading or retire',
          rationale: 'Final gating before strategy goes live',
          expectedOutcome: 'Strategy approved for assisted mode or retirement decision',
          estimatedDurationSeconds: 3600,
          requiredPermissions: ['strategy.promote'],
          checkpoints: ['Calibration factors validated', 'Risk metrics acceptable', 'Operator sign-off obtained'],
        },
      ],
      rollbackSteps: [
        {
          order: 1,
          action: 'Stop shadow session if running',
          rationale: 'Prevent further paper trading',
          expectedOutcome: 'Shadow session halted',
          estimatedDurationSeconds: 300,
        },
        {
          order: 2,
          action: 'Archive strategy to rejected status',
          rationale: 'Ensure strategy cannot be accidentally promoted',
          expectedOutcome: 'Strategy marked as rejected in system',
          estimatedDurationSeconds: 300,
        },
        {
          order: 3,
          action: 'Notify submitter with detailed feedback',
          rationale: 'Enable future improvements',
          expectedOutcome: 'Feedback email sent',
          estimatedDurationSeconds: 600,
        },
      ],
      escalationPath: ['Quant Lead', 'Strategy Committee Chair', 'CTO', 'Chief Risk Officer'],
      estimatedTotalTime: 1223400,
      lastUpdated: new Date('2025-12-15'),
      updatedBy: 'Strategy Operations',
      tags: ['strategy', 'onboarding', 'backtest', 'shadow'],
    });

    this.procedures.set('SHADOW_TO_LIVE', {
      name: 'SHADOW_TO_LIVE',
      displayName: 'Shadow to Live Promotion',
      description: 'Process for promoting a strategy from shadow trading to assisted/autonomous mode',
      whenToUse: 'When a strategy completes shadow session and is ready for real money trading',
      severity: 'high',
      steps: [
        {
          order: 1,
          action: 'Review strategy performance scorecard',
          rationale: 'Comprehensive performance evaluation across 8 key criteria',
          expectedOutcome: 'Scorecard with 8 metrics evaluated and scored',
          estimatedDurationSeconds: 3600,
          requiredPermissions: ['strategy.review'],
          checkpoints: ['All 8 criteria documented', 'Scores are defensible', 'Anomalies explained'],
        },
        {
          order: 2,
          action: 'Verify all 8 criteria meet acceptance thresholds',
          rationale: 'Ensure strategy is production-ready across all dimensions',
          expectedOutcome: 'Formal approval that criteria are met',
          estimatedDurationSeconds: 1800,
          requiredPermissions: ['strategy.approve'],
          checkpoints: ['Calibration score >= 0.85', 'Sharpe ratio >= 0.8', 'Max drawdown <= 15%', 'Win rate >= 45%', 'Slippage ratio <= 1.2', 'Consistency score >= 0.9', 'Risk controls functional', 'No eval regressions'],
        },
        {
          order: 3,
          action: 'Obtain formal operator approval for live trading',
          rationale: 'Human oversight gate before deploying real capital',
          expectedOutcome: 'Signed approval from authorized operator',
          estimatedDurationSeconds: 1200,
          requiredPermissions: ['strategy.promote'],
          checkpoints: ['Operator reviewed scorecard', 'Operator has asked questions', 'Approval is signed and timestamped'],
        },
        {
          order: 4,
          action: 'Set bounded authority limits and position sizing',
          rationale: 'Control initial risk exposure while strategy proves itself',
          expectedOutcome: 'Position limits configured in TradingEngine',
          estimatedDurationSeconds: 600,
          requiredPermissions: ['risk.configure'],
          checkpoints: ['Max position size set', 'Daily loss limit set', 'Account heat configured', 'Drawdown protection enabled'],
        },
        {
          order: 5,
          action: 'Enable assisted trading mode',
          rationale: 'Start real-money trading with human intervention available',
          expectedOutcome: 'Strategy transitions to ASSISTED mode in mode_manager',
          estimatedDurationSeconds: 300,
          requiredPermissions: ['mode.change'],
          checkpoints: ['Mode change succeeds', 'First order generated correctly', 'Operator receives alert'],
        },
        {
          order: 6,
          action: 'Monitor assisted mode for 14 calendar days',
          rationale: 'Verify strategy performs as expected in live trading conditions',
          expectedOutcome: 'Daily monitoring reports and drift assessments',
          estimatedDurationSeconds: 1209600,
          requiredPermissions: ['strategy.monitor'],
          checkpoints: ['Daily PnL within expected range', 'No order rejections', 'Operator receives daily brief', 'No drift detected'],
        },
        {
          order: 7,
          action: 'Review 14-day assisted mode performance',
          rationale: 'Final gate before fully autonomous operation',
          expectedOutcome: 'Pass/fail decision on autonomous expansion',
          estimatedDurationSeconds: 3600,
          requiredPermissions: ['strategy.review'],
          checkpoints: ['Performance in line with shadow', 'No unexpected behavior', 'All systems stable'],
        },
        {
          order: 8,
          action: 'If approved, expand position limits and enable full autonomy',
          rationale: 'Allow strategy to operate at planned capacity without human intervention',
          expectedOutcome: 'Strategy transitions to AUTONOMOUS mode with full position limits',
          estimatedDurationSeconds: 600,
          requiredPermissions: ['mode.change', 'risk.configure'],
          checkpoints: ['Mode change to AUTONOMOUS succeeds', 'Position limits increased', 'Operator notified'],
        },
      ],
      rollbackSteps: [
        {
          order: 1,
          action: 'Immediately drop strategy to SHADOW mode',
          rationale: 'Stop live trading if performance issues detected',
          expectedOutcome: 'Strategy halted from trading real money',
          estimatedDurationSeconds: 300,
        },
        {
          order: 2,
          action: 'Liquidate all open positions',
          rationale: 'Minimize further exposure to problematic strategy',
          expectedOutcome: 'All positions closed at market price',
          estimatedDurationSeconds: 600,
        },
        {
          order: 3,
          action: 'Generate incident report and begin post-mortem',
          rationale: 'Understand what went wrong',
          expectedOutcome: 'Incident report filed and post-mortem scheduled',
          estimatedDurationSeconds: 1200,
        },
      ],
      escalationPath: ['Strategy Lead', 'Operator on Duty', 'Risk Manager', 'CTO'],
      estimatedTotalTime: 1221300,
      lastUpdated: new Date('2025-12-15'),
      updatedBy: 'Strategy Operations',
      tags: ['strategy', 'promotion', 'shadow', 'live', 'autonomous'],
    });

    this.procedures.set('EMERGENCY_STOP', {
      name: 'EMERGENCY_STOP',
      displayName: 'Emergency Stop All Trading',
      description: 'Immediate halt of all autonomous and assisted trading',
      whenToUse: 'When system detects critical anomaly, operator suspects fraud/malfunction, or major market event',
      severity: 'critical',
      steps: [
        {
          order: 1,
          action: 'Call mode_manager.setMode(EMERGENCY_STOP)',
          rationale: 'Centralized control to halt all strategy execution',
          expectedOutcome: 'All strategies enter EMERGENCY_STOP mode',
          estimatedDurationSeconds: 30,
          requiredPermissions: ['mode.emergency'],
          checkpoints: ['Mode change succeeds', 'All strategies receive stop signal'],
        },
        {
          order: 2,
          action: 'Verify all open orders are cancelled',
          rationale: 'Ensure no orders execute after emergency stop',
          expectedOutcome: 'Exchange confirms all orders cancelled',
          estimatedDurationSeconds: 60,
          requiredPermissions: ['order.cancel'],
          checkpoints: ['Exchange API confirms cancellations', 'Open order list empty', 'No pending executions'],
        },
        {
          order: 3,
          action: 'Generate operator alert with incident context',
          rationale: 'Notify all relevant personnel immediately',
          expectedOutcome: 'Alerts sent to operator, risk manager, CTO, on-call engineer',
          estimatedDurationSeconds: 30,
          requiredPermissions: ['alert.send'],
          checkpoints: ['All escalation contacts notified', 'Incident timestamp recorded'],
        },
        {
          order: 4,
          action: 'Preserve system state for post-mortem',
          rationale: 'Capture logs and telemetry for root cause analysis',
          expectedOutcome: 'System state snapshot created and archived',
          estimatedDurationSeconds: 120,
          requiredPermissions: ['system.snapshot'],
          checkpoints: ['Logs captured', 'Telemetry exported', 'State archive complete'],
        },
        {
          order: 5,
          action: 'Initiate incident report and post-mortem scheduling',
          rationale: 'Formal documentation and learning process',
          expectedOutcome: 'Incident report created and post-mortem meeting scheduled',
          estimatedDurationSeconds: 300,
          requiredPermissions: ['incident.create'],
          checkpoints: ['Incident report filed', 'Post-mortem date/time set', 'Stakeholders invited'],
        },
      ],
      rollbackSteps: [
        {
          order: 1,
          action: 'Only after root cause confirmed and fix verified: mode_manager.setMode(ASSISTED)',
          rationale: 'Gradual return to trading with human oversight',
          expectedOutcome: 'Strategies enter ASSISTED mode',
          estimatedDurationSeconds: 60,
        },
        {
          order: 2,
          action: 'Monitor for 1 hour before returning to prior mode',
          rationale: 'Ensure system is stable after incident',
          expectedOutcome: 'Stability verification complete',
          estimatedDurationSeconds: 3600,
        },
      ],
      escalationPath: ['Operator on Duty', 'Chief Risk Officer', 'CTO', 'CEO'],
      estimatedTotalTime: 540,
      lastUpdated: new Date('2025-12-15'),
      updatedBy: 'Risk Operations',
      tags: ['emergency', 'critical', 'stop', 'incident'],
    });

    this.procedures.set('DRIFT_RESPONSE', {
      name: 'DRIFT_RESPONSE',
      displayName: 'Drift Detection and Response',
      description: 'Response procedure when strategy begins drifting from expected behavior',
      whenToUse: 'When drift detection system identifies component divergence >= 0.15',
      severity: 'high',
      steps: [
        {
          order: 1,
          action: 'Retrieve current drift score and affected component analysis',
          rationale: 'Understand which component is drifting and by how much',
          expectedOutcome: 'Drift report with component breakdown',
          estimatedDurationSeconds: 60,
          requiredPermissions: ['drift.analyze'],
          checkpoints: ['Drift score retrieved', 'Component identified', 'Magnitude quantified'],
        },
        {
          order: 2,
          action: 'Identify root cause: market regime change, data quality, eval regression, or logic error',
          rationale: 'Determine if drift is expected or indicates a problem',
          expectedOutcome: 'Root cause classification and analysis',
          estimatedDurationSeconds: 1800,
          requiredPermissions: ['drift.diagnose'],
          checkpoints: ['Root cause identified', 'Confidence level assessed'],
        },
        {
          order: 3,
          action: 'Auto-downgrade strategy mode one tier (AUTONOMOUS->ASSISTED->SHADOW)',
          rationale: 'Reduce risk exposure while investigating',
          expectedOutcome: 'Strategy mode downgraded',
          estimatedDurationSeconds: 300,
          requiredPermissions: ['mode.change'],
          checkpoints: ['Mode downgrade succeeds', 'Position limits reduced', 'Operator notified'],
        },
        {
          order: 4,
          action: 'Pause affected strategies from initiating new trades',
          rationale: 'Prevent new positions until drift is understood',
          expectedOutcome: 'Affected strategies blocked from new orders',
          estimatedDurationSeconds: 60,
          requiredPermissions: ['strategy.pause'],
          checkpoints: ['Strategies paused', 'Existing positions not liquidated', 'Operator can manually resume'],
        },
        {
          order: 5,
          action: 'Run diagnostic: replay last 24h with component isolated',
          rationale: 'Determine if behavior is reproducible',
          expectedOutcome: 'Diagnostic report showing component isolation test results',
          estimatedDurationSeconds: 3600,
          requiredPermissions: ['backtest.run'],
          checkpoints: ['Diagnostic completes', 'Results explain drift magnitude'],
        },
        {
          order: 6,
          action: 'If fixable: apply hot-fix and re-run diagnostic; if not: retire strategy',
          rationale: 'Either restore strategy or remove permanently',
          expectedOutcome: 'Strategy either fixed and re-tested or retired',
          estimatedDurationSeconds: 7200,
          requiredPermissions: ['strategy.update', 'strategy.retire'],
          checkpoints: ['Fix validated', 'Or retirement approved by operator'],
        },
      ],
      rollbackSteps: [
        {
          order: 1,
          action: 'If fix applied and validated, re-run full strategy evaluation',
          rationale: 'Ensure fix does not introduce new issues',
          expectedOutcome: 'Full evaluation results',
          estimatedDurationSeconds: 3600,
        },
        {
          order: 2,
          action: 'Restore strategy mode if fix is confirmed good',
          rationale: 'Resume normal operation',
          expectedOutcome: 'Strategy mode restored',
          estimatedDurationSeconds: 300,
        },
      ],
      escalationPath: ['Strategy Lead', 'Quant Engineer', 'CTO', 'Chief Risk Officer'],
      estimatedTotalTime: 16020,
      lastUpdated: new Date('2025-12-15'),
      updatedBy: 'Quant Operations',
      tags: ['drift', 'monitoring', 'diagnostic', 'response'],
    });

    this.procedures.set('CALIBRATION_FAILURE', {
      name: 'CALIBRATION_FAILURE',
      displayName: 'Calibration Failure Response',
      description: 'Response when backtest-to-live calibration metrics degrade',
      whenToUse: 'When live performance diverges from backtest predictions by > 20%',
      severity: 'high',
      steps: [
        {
          order: 1,
          action: 'Identify which metrics have degraded and by what magnitude',
          rationale: 'Understand scope of calibration issue',
          expectedOutcome: 'Detailed metric degradation report',
          estimatedDurationSeconds: 600,
          requiredPermissions: ['calibration.analyze'],
          checkpoints: ['Affected metrics identified', 'Degradation magnitude quantified'],
        },
        {
          order: 2,
          action: 'Pause all new strategy deployments until root cause is understood',
          rationale: 'Prevent deploying strategies with bad calibration factors',
          expectedOutcome: 'Deployment gate activated',
          estimatedDurationSeconds: 300,
          requiredPermissions: ['deployment.gate'],
          checkpoints: ['Gate engaged', 'New deployments blocked', 'Operators notified'],
        },
        {
          order: 3,
          action: 'Recalibrate adjustment factors using last 30 days of live data',
          rationale: 'Update calibration to match current market conditions',
          expectedOutcome: 'Recalibrated adjustment factors with confidence intervals',
          estimatedDurationSeconds: 5400,
          requiredPermissions: ['calibration.recalibrate'],
          checkpoints: ['Recalibration completes', 'New factors are reasonable'],
        },
        {
          order: 4,
          action: 'Re-run backtest on all affected strategies with new calibration',
          rationale: 'Validate that strategies still meet acceptance criteria',
          expectedOutcome: 'Updated backtest results for affected strategies',
          estimatedDurationSeconds: 7200,
          requiredPermissions: ['backtest.run'],
          checkpoints: ['All affected strategies re-tested', 'Results are reasonable'],
        },
        {
          order: 5,
          action: 'Update adjustment factors in TradingEngine for all strategies',
          rationale: 'Apply recalibrated factors to live trading',
          expectedOutcome: 'Adjustment factors updated in engine',
          estimatedDurationSeconds: 600,
          requiredPermissions: ['config.update'],
          checkpoints: ['Engine receives new factors', 'All strategies use new factors'],
        },
        {
          order: 6,
          action: 'Resume deployments and monitor for convergence',
          rationale: 'Resume normal operations with updated calibration',
          expectedOutcome: 'New deployments allowed, live/backtest gap improves',
          estimatedDurationSeconds: 300,
          requiredPermissions: ['deployment.gate'],
          checkpoints: ['Deployment gate lifted', 'Gap metric shows improvement'],
        },
      ],
      rollbackSteps: [
        {
          order: 1,
          action: 'If new factors still do not improve convergence, revert to previous factors',
          rationale: 'Return to known state',
          expectedOutcome: 'Previous factors restored',
          estimatedDurationSeconds: 300,
        },
        {
          order: 2,
          action: 'Escalate to quant team for deeper investigation',
          rationale: 'Issue may be systemic or data quality related',
          expectedOutcome: 'Escalation complete',
          estimatedDurationSeconds: 600,
        },
      ],
      escalationPath: ['Calibration Engineer', 'Quant Lead', 'CTO'],
      estimatedTotalTime: 14400,
      lastUpdated: new Date('2025-12-15'),
      updatedBy: 'Quant Operations',
      tags: ['calibration', 'backtest', 'live', 'performance'],
    });

    this.procedures.set('EVAL_REGRESSION', {
      name: 'EVAL_REGRESSION',
      displayName: 'Evaluation Regression Response',
      description: 'Response when strategy evaluation quality drops unexpectedly',
      whenToUse: 'When evaluation grade drops > 1 letter grade or regressions detected on golden suite',
      severity: 'medium',
      steps: [
        {
          order: 1,
          action: 'Identify which evaluator(s) have regressed',
          rationale: 'Pinpoint the source of quality degradation',
          expectedOutcome: 'List of regressed evaluators with severity',
          estimatedDurationSeconds: 300,
          requiredPermissions: ['eval.analyze'],
          checkpoints: ['Regression identified', 'Affected evaluators listed'],
        },
        {
          order: 2,
          action: 'Check golden suite test cases for new failures',
          rationale: 'Validate against known good test cases',
          expectedOutcome: 'Golden suite results showing pass/fail for each evaluator',
          estimatedDurationSeconds: 1200,
          requiredPermissions: ['eval.test'],
          checkpoints: ['Golden suite executes', 'Results show which tests failed'],
        },
        {
          order: 3,
          action: 'Root cause analysis: data quality, evaluator logic, or dependency change',
          rationale: 'Determine underlying cause of regression',
          expectedOutcome: 'Root cause identified and documented',
          estimatedDurationSeconds: 3600,
          requiredPermissions: ['eval.debug'],
          checkpoints: ['Root cause found', 'Confidence level assessed'],
        },
        {
          order: 4,
          action: 'Apply fix to affected evaluator(s)',
          rationale: 'Restore evaluation quality',
          expectedOutcome: 'Updated evaluator code deployed',
          estimatedDurationSeconds: 1800,
          requiredPermissions: ['eval.deploy'],
          checkpoints: ['Code reviewed', 'Fix deployed to staging'],
        },
        {
          order: 5,
          action: 'Re-run golden suite to verify regression is resolved',
          rationale: 'Confirm fix worked',
          expectedOutcome: 'Golden suite passes all tests',
          estimatedDurationSeconds: 1200,
          requiredPermissions: ['eval.test'],
          checkpoints: ['All tests pass', 'Regression confirmed resolved'],
        },
        {
          order: 6,
          action: 'Deploy fixed evaluator(s) to production',
          rationale: 'Make fix live for all strategy evaluations',
          expectedOutcome: 'Evaluator deployed to production',
          estimatedDurationSeconds: 600,
          requiredPermissions: ['eval.deploy'],
          checkpoints: ['Production deployment succeeds', 'Monitoring active'],
        },
      ],
      rollbackSteps: [
        {
          order: 1,
          action: 'If production deployment causes issues, immediately rollback to previous version',
          rationale: 'Minimize impact of bad fix',
          expectedOutcome: 'Previous evaluator version restored',
          estimatedDurationSeconds: 300,
        },
        {
          order: 2,
          action: 'Escalate to evaluator maintainer',
          rationale: 'Get expert help on the issue',
          expectedOutcome: 'Escalation complete',
          estimatedDurationSeconds: 600,
        },
      ],
      escalationPath: ['Eval Maintainer', 'Quant Lead', 'CTO'],
      estimatedTotalTime: 8700,
      lastUpdated: new Date('2025-12-15'),
      updatedBy: 'Evaluation Team',
      tags: ['evaluation', 'quality', 'regression', 'testing'],
    });

    this.procedures.set('MEMORY_MAINTENANCE', {
      name: 'MEMORY_MAINTENANCE',
      displayName: 'Memory System Maintenance',
      description: 'Regular maintenance of strategy memory and decision logs',
      whenToUse: 'Daily at 05:00 UTC (weekly and monthly tasks on schedule)',
      severity: 'low',
      steps: [
        {
          order: 1,
          action: 'Prune stale entries older than 90 days',
          rationale: 'Keep memory store performant and focused on recent data',
          expectedOutcome: 'Entries older than 90 days removed',
          estimatedDurationSeconds: 1800,
          requiredPermissions: ['memory.prune'],
          checkpoints: ['Pruning completes', 'Entry count decreases', 'No recent data affected'],
        },
        {
          order: 2,
          action: 'Version contradicted memories (keep old versions for audit)',
          rationale: 'Track when strategies learn and update beliefs',
          expectedOutcome: 'Contradicted memories versioned and indexed',
          estimatedDurationSeconds: 600,
          requiredPermissions: ['memory.version'],
          checkpoints: ['Versioning completes', 'Old versions archived'],
        },
        {
          order: 3,
          action: 'Verify retrieval quality score (should stay >= 0.88)',
          rationale: 'Ensure memory relevance is maintained',
          expectedOutcome: 'Retrieval quality score report',
          estimatedDurationSeconds: 600,
          requiredPermissions: ['memory.quality'],
          checkpoints: ['Quality score calculated', 'Score >= 0.88 threshold met'],
        },
        {
          order: 4,
          action: 'Compact memory store and rebuild indexes',
          rationale: 'Optimize storage and query performance',
          expectedOutcome: 'Memory store compacted and re-indexed',
          estimatedDurationSeconds: 3600,
          requiredPermissions: ['memory.compact'],
          checkpoints: ['Compaction completes', 'Indexes rebuilt', 'Query performance acceptable'],
        },
        {
          order: 5,
          action: 'Backup memory store to archive storage',
          rationale: 'Protect against data loss',
          expectedOutcome: 'Backup created and verified',
          estimatedDurationSeconds: 1200,
          requiredPermissions: ['memory.backup'],
          checkpoints: ['Backup completes', 'Backup integrity verified'],
        },
        {
          order: 6,
          action: 'Generate maintenance report and log metrics',
          rationale: 'Track memory system health over time',
          expectedOutcome: 'Maintenance report added to log',
          estimatedDurationSeconds: 300,
          requiredPermissions: ['memory.report'],
          checkpoints: ['Report generated', 'Metrics logged'],
        },
      ],
      rollbackSteps: [
        {
          order: 1,
          action: 'If compaction causes issues, restore from pre-compaction backup',
          rationale: 'Recover from failed maintenance',
          expectedOutcome: 'Previous memory state restored',
          estimatedDurationSeconds: 3600,
        },
      ],
      escalationPath: ['Memory System Owner', 'DevOps', 'CTO'],
      estimatedTotalTime: 8100,
      lastUpdated: new Date('2025-12-15'),
      updatedBy: 'Platform Operations',
      tags: ['maintenance', 'memory', 'database', 'performance'],
    });

    this.procedures.set('GOVERNANCE_REVIEW', {
      name: 'GOVERNANCE_REVIEW',
      displayName: 'Weekly Governance Review',
      description: 'Weekly review of all strategies, promotions, and risk posture',
      whenToUse: 'Every Monday at 09:00 UTC',
      severity: 'medium',
      steps: [
        {
          order: 1,
          action: 'Review all strategies by tier: count, performance, status',
          rationale: 'Comprehensive view of strategy portfolio',
          expectedOutcome: 'Tier breakdown: Autonomous count/status, Assisted count/status, Shadow count/status',
          estimatedDurationSeconds: 1800,
          requiredPermissions: ['strategy.review'],
          checkpoints: ['All strategies accounted for', 'Status accurate', 'Performance data current'],
        },
        {
          order: 2,
          action: 'Check all pending promotions against gating criteria',
          rationale: 'Ensure only ready strategies are promoted',
          expectedOutcome: 'List of pending promotions with pass/fail on each criterion',
          estimatedDurationSeconds: 1800,
          requiredPermissions: ['strategy.review'],
          checkpoints: ['All pending promotions reviewed', 'Criteria assessment complete'],
        },
        {
          order: 3,
          action: 'Review any demotions that occurred in past week',
          rationale: 'Understand what caused any strategies to be downgraded',
          expectedOutcome: 'Demotion summary with reasons',
          estimatedDurationSeconds: 900,
          requiredPermissions: ['strategy.review'],
          checkpoints: ['All demotions accounted for', 'Reasons documented'],
        },
        {
          order: 4,
          action: 'Assess current risk posture and exposure limits',
          rationale: 'Ensure portfolio risk is within policy',
          expectedOutcome: 'Risk summary with utilization metrics',
          estimatedDurationSeconds: 1200,
          requiredPermissions: ['risk.view'],
          checkpoints: ['All risk metrics calculated', 'Exposure within limits'],
        },
        {
          order: 5,
          action: 'Generate operator governance report',
          rationale: 'Formal record of governance decisions',
          expectedOutcome: 'Governance report PDF with all decisions documented',
          estimatedDurationSeconds: 1200,
          requiredPermissions: ['report.generate'],
          checkpoints: ['Report generated', 'All data included', 'Report is signed/dated'],
        },
        {
          order: 6,
          action: 'Archive governance decisions to compliance record',
          rationale: 'Maintain audit trail',
          expectedOutcome: 'Report archived and indexed',
          estimatedDurationSeconds: 300,
          requiredPermissions: ['report.archive'],
          checkpoints: ['Archive succeeds', 'Document is retrievable'],
        },
        {
          order: 7,
          action: 'Send report to operator and compliance team',
          rationale: 'Inform stakeholders',
          expectedOutcome: 'Report delivered',
          estimatedDurationSeconds: 300,
          requiredPermissions: ['report.send'],
          checkpoints: ['Emails sent', 'Receipts confirmed'],
        },
      ],
      rollbackSteps: [
        {
          order: 1,
          action: 'If significant issues found, convene emergency governance review',
          rationale: 'Address urgent issues immediately',
          expectedOutcome: 'Emergency meeting scheduled',
          estimatedDurationSeconds: 600,
        },
      ],
      escalationPath: ['Governance Chair', 'Strategy Committee', 'CTO', 'CEO'],
      estimatedTotalTime: 7300,
      lastUpdated: new Date('2025-12-15'),
      updatedBy: 'Governance Operations',
      tags: ['governance', 'review', 'strategy', 'risk', 'weekly'],
    });
  }

  private initializeEscalationMatrix(): void {
    this.escalationMatrix.set('low', [
      {
        role: 'Strategy Lead',
        name: 'Strategy Team Lead',
        phone: '+1-415-555-0101',
        email: 'strategy-lead@godsview.com',
        availability: '24/5 (M-F 8am-6pm PT)',
      },
    ]);

    this.escalationMatrix.set('medium', [
      {
        role: 'Strategy Lead',
        name: 'Strategy Team Lead',
        phone: '+1-415-555-0101',
        email: 'strategy-lead@godsview.com',
        availability: '24/5 (M-F 8am-6pm PT)',
      },
      {
        role: 'Quant Lead',
        name: 'Head of Quantitative Research',
        phone: '+1-415-555-0102',
        email: 'quant-lead@godsview.com',
        availability: '24/5 (M-F 8am-6pm PT)',
      },
    ]);

    this.escalationMatrix.set('high', [
      {
        role: 'Operator on Duty',
        name: 'Duty Operator',
        phone: '+1-415-555-0100',
        email: 'ops-duty@godsview.com',
        availability: '24/7',
      },
      {
        role: 'Risk Manager',
        name: 'Chief Risk Officer',
        phone: '+1-415-555-0103',
        email: 'cro@godsview.com',
        availability: '24/5 (M-F 8am-8pm PT), 24/7 for critical',
      },
      {
        role: 'CTO',
        name: 'Chief Technology Officer',
        phone: '+1-415-555-0104',
        email: 'cto@godsview.com',
        availability: '24/5 (M-F 8am-6pm PT), 24/7 for critical',
      },
    ]);

    this.escalationMatrix.set('critical', [
      {
        role: 'Operator on Duty',
        name: 'Duty Operator',
        phone: '+1-415-555-0100',
        email: 'ops-duty@godsview.com',
        availability: '24/7',
      },
      {
        role: 'Chief Risk Officer',
        name: 'CRO',
        phone: '+1-415-555-0103',
        email: 'cro@godsview.com',
        availability: '24/7',
      },
      {
        role: 'CTO',
        name: 'Chief Technology Officer',
        phone: '+1-415-555-0104',
        email: 'cto@godsview.com',
        availability: '24/7',
      },
      {
        role: 'CEO',
        name: 'Chief Executive Officer',
        phone: '+1-415-555-0105',
        email: 'ceo@godsview.com',
        availability: '24/7 for critical',
      },
    ]);
  }

  private initializeMaintenanceSchedule(): void {
    this.maintenanceSchedule = [
      {
        taskId: 'daily_memory_prune',
        name: 'Daily Memory Pruning',
        frequency: 'daily',
        estimatedDurationMinutes: 30,
        procedure: 'MEMORY_MAINTENANCE',
        requiredPermissions: ['memory.prune'],
        successCriteria: ['Stale entries removed', 'Retrieval quality >= 0.88'],
      },
      {
        taskId: 'daily_operator_brief',
        name: 'Daily Operator Brief',
        frequency: 'daily',
        estimatedDurationMinutes: 15,
        procedure: 'GOVERNANCE_REVIEW',
        requiredPermissions: ['report.view'],
        successCriteria: ['Brief generated', 'Delivered to operator'],
      },
      {
        taskId: 'weekly_governance',
        name: 'Weekly Governance Review',
        frequency: 'weekly',
        estimatedDurationMinutes: 120,
        procedure: 'GOVERNANCE_REVIEW',
        requiredPermissions: ['strategy.review', 'risk.view'],
        successCriteria: ['All strategies reviewed', 'Risk posture verified', 'Report archived'],
      },
      {
        taskId: 'weekly_calibration_audit',
        name: 'Weekly Calibration Audit',
        frequency: 'weekly',
        estimatedDurationMinutes: 90,
        procedure: 'CALIBRATION_FAILURE',
        requiredPermissions: ['calibration.analyze'],
        successCriteria: ['Calibration metrics checked', 'Convergence verified'],
      },
      {
        taskId: 'monthly_eval_audit',
        name: 'Monthly Evaluation Audit',
        frequency: 'monthly',
        estimatedDurationMinutes: 120,
        procedure: 'EVAL_REGRESSION',
        requiredPermissions: ['eval.test'],
        successCriteria: ['Golden suite runs', 'All tests pass'],
      },
      {
        taskId: 'quarterly_memory_archive',
        name: 'Quarterly Memory Archive',
        frequency: 'quarterly',
        estimatedDurationMinutes: 180,
        procedure: 'MEMORY_MAINTENANCE',
        requiredPermissions: ['memory.backup', 'memory.archive'],
        successCriteria: ['Archive created', 'Integrity verified', 'Restore tested'],
      },
    ];
  }

  public getProcedure(name: string): RunbookProcedure | undefined {
    return this.procedures.get(name);
  }

  public getAllProcedures(): RunbookProcedure[] {
    return Array.from(this.procedures.values());
  }

  public getEscalationMatrix(): Map<string, EscalationContact[]> {
    return this.escalationMatrix;
  }

  public getEscalationContacts(severity: 'low' | 'medium' | 'high' | 'critical'): EscalationContact[] {
    return this.escalationMatrix.get(severity) || [];
  }

  public getMaintenanceSchedule(): MaintenanceTask[] {
    return this.maintenanceSchedule;
  }

  public getTasksForFrequency(frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly'): MaintenanceTask[] {
    return this.maintenanceSchedule.filter((task) => task.frequency === frequency);
  }

  public generateIncidentReport(data: {
    title: string;
    description: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    affectedSystems: string[];
    rootCause?: string;
    actionsTaken: string[];
    recommendations: string[];
  }): IncidentReport {
    const incidentId = `INC-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;

    return {
      incidentId,
      timestamp: new Date(),
      severity: data.severity,
      title: data.title,
      description: data.description,
      affectedSystems: data.affectedSystems,
      rootCause: data.rootCause,
      actionsTaken: data.actionsTaken,
      recommendations: data.recommendations,
      timeline: [
        {
          time: new Date(),
          event: 'Incident report generated',
        },
      ],
      involvedPersonnel: [],
      postMortemScheduled: data.severity === 'critical' || data.severity === 'high',
    };
  }

  public formatIncidentReportAsText(report: IncidentReport): string {
    const lines: string[] = [
      '==============================================================================',
      'INCIDENT REPORT',
      '==============================================================================',
      '',
      `Incident ID: ${report.incidentId}`,
      `Timestamp: ${report.timestamp.toISOString()}`,
      `Severity: ${report.severity.toUpperCase()}`,
      `Title: ${report.title}`,
      '',
      'DESCRIPTION',
      '---',
      report.description,
      '',
      'AFFECTED SYSTEMS',
      '---',
      report.affectedSystems.map((s) => `  - ${s}`).join('\n'),
      '',
    ];

    if (report.rootCause) {
      lines.push('ROOT CAUSE');
      lines.push('---');
      lines.push(report.rootCause);
      lines.push('');
    }

    lines.push('ACTIONS TAKEN');
    lines.push('---');
    report.actionsTaken.forEach((action, i) => {
      lines.push(`  ${i + 1}. ${action}`);
    });
    lines.push('');

    lines.push('RECOMMENDATIONS');
    lines.push('---');
    report.recommendations.forEach((rec, i) => {
      lines.push(`  ${i + 1}. ${rec}`);
    });
    lines.push('');

    lines.push('TIMELINE');
    lines.push('---');
    report.timeline.forEach((entry) => {
      lines.push(`  ${entry.time.toISOString()}: ${entry.event}`);
    });
    lines.push('');

    if (report.postMortemScheduled) {
      lines.push('POST-MORTEM: Scheduled for critical/high severity incident');
      lines.push('');
    }

    lines.push('==============================================================================');

    return lines.join('\n');
  }
}

export default QuantRunbook;