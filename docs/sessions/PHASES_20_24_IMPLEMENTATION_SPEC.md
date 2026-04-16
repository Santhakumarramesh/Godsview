# GodsView — Phases 20–24 Implementation Specification

> From "impressive repo" to "real market-ready system."
> Every file, endpoint, DB table, and UI piece needed to get there.

---

## How to read this document

Each phase specifies exact implementation artifacts that plug directly into the existing GodsView architecture:

- **DB schemas** follow the Drizzle ORM pattern in `lib/db/src/schema/`
- **Migrations** follow the sequential `0006_`, `0007_` naming in `lib/db/migrations/`
- **Route files** follow Express Router pattern in `api-server/src/routes/` or `artifacts/api-server/src/routes/`
- **Lib modules** follow the domain-scoped pattern in `api-server/src/lib/`
- **Dashboard pages** follow `.tsx` pattern in `godsview-dashboard/src/pages/`
- **Tests** follow `__tests__/` pattern in `artifacts/api-server/src/__tests__/`

Existing infrastructure this builds on:

| Layer | Key Files |
|-------|-----------|
| Certification Engine | `artifacts/api-server/src/lib/certification_engine.ts` |
| Promotion Engine | `api-server/src/lib/governance/promotion_engine.ts` |
| Drift Detector | `api-server/src/lib/autonomous/drift_detector.ts` |
| Execution Schema | `lib/db/src/schema/execution.ts` |
| Alignment Schema | `lib/db/src/schema/alignment.ts` |
| Certification Schema | `lib/db/src/schema/certification.ts` |
| ML Operations Schema | `lib/db/src/schema/ml_operations.ts` |

---

## Phase 20 — One Strategy Certification Run

**Purpose:** Prove the certification machinery works on a real, narrow strategy. This is the single most important phase because it turns architecture into evidence.

**Why it matters:** Everything before Phase 20 is infrastructure. Phase 20 is the first time the platform proves it can do what it claims.

### DB Migration: `lib/db/migrations/0006_certification_run.sql`

```sql
-- Certification run sessions — tracks end-to-end certification attempts
CREATE TABLE certification_runs (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,           -- e.g. "cert_run_20260407_SPY_sweep"
  strategy_id TEXT NOT NULL,
  strategy_name TEXT NOT NULL,
  target_tier TEXT NOT NULL,             -- paper_approved | live_assisted
  status TEXT NOT NULL DEFAULT 'initiated',
  -- initiated | backtest_running | walkforward_running | stress_running |
  -- shadow_running | paper_running | collecting_evidence | review | certified | rejected | failed

  -- Config
  config_json JSONB NOT NULL,            -- symbols, timeframe, capital, date ranges
  operator_id TEXT,

  -- Backtest results
  backtest_started_at TIMESTAMPTZ,
  backtest_completed_at TIMESTAMPTZ,
  backtest_result_json JSONB,            -- full backtest output
  backtest_sharpe NUMERIC(8,4),
  backtest_win_rate NUMERIC(6,4),
  backtest_trade_count INTEGER,
  backtest_max_dd NUMERIC(8,4),
  backtest_profit_factor NUMERIC(8,4),

  -- Walk-forward results
  wf_started_at TIMESTAMPTZ,
  wf_completed_at TIMESTAMPTZ,
  wf_result_json JSONB,
  wf_pass_rate NUMERIC(6,4),
  wf_oos_sharpe NUMERIC(8,4),

  -- Stress test results
  stress_started_at TIMESTAMPTZ,
  stress_completed_at TIMESTAMPTZ,
  stress_result_json JSONB,
  stress_survival_rate NUMERIC(6,4),
  stress_worst_dd NUMERIC(8,4),

  -- Shadow / paper trading results
  shadow_started_at TIMESTAMPTZ,
  shadow_completed_at TIMESTAMPTZ,
  shadow_trade_count INTEGER DEFAULT 0,
  shadow_win_rate NUMERIC(6,4),
  shadow_pnl NUMERIC(14,4),
  shadow_result_json JSONB,

  -- Alignment & execution quality
  alignment_score NUMERIC(6,4),
  avg_slippage_bps NUMERIC(8,2),
  execution_fill_rate NUMERIC(6,4),
  execution_avg_latency_ms INTEGER,

  -- Drift status at certification time
  drift_score NUMERIC(6,4),
  drift_status TEXT,                     -- stable | minor_drift | significant_drift

  -- Evidence packet
  evidence_packet_json JSONB,            -- complete certification evidence
  gate_results_json JSONB,               -- per-gate pass/fail with scores

  -- Governance
  governance_verdict TEXT,               -- promote | hold | reject
  governance_reason TEXT,
  approved_by TEXT,
  rejection_reason TEXT,

  -- Incident log during run
  incidents_json JSONB DEFAULT '[]'::JSONB,

  -- Timestamps
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cert_runs_strategy ON certification_runs(strategy_id);
CREATE INDEX idx_cert_runs_status ON certification_runs(status);

-- Certification run steps — individual gate execution log
CREATE TABLE certification_run_steps (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES certification_runs(run_id),
  step_name TEXT NOT NULL,               -- backtest | walkforward | stress_test | shadow | paper | alignment | slippage | execution_quality
  step_order INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | running | passed | failed | skipped
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  result_json JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cert_steps_run ON certification_run_steps(run_id);
```

### DB Schema: `lib/db/src/schema/certification_run.ts`

New file. Follows exact Drizzle pattern from `certification.ts`:

```typescript
// Tables: certificationRunsTable, certificationRunStepsTable
// Insert schemas: insertCertificationRunSchema, insertCertificationRunStepSchema
// Types: CertificationRun, CertificationRunStep
```

### Lib Module: `api-server/src/lib/certification_runner.ts`

Core orchestrator that drives a full certification run.

```typescript
export interface CertificationRunConfig {
  strategyId: string;
  strategyName: string;
  targetTier: TargetTier;
  symbols: string[];                    // e.g. ["SPY"]
  timeframe: string;                    // e.g. "5m"
  backtestDateRange: { start: string; end: string };
  walkforwardFolds: number;             // default 5
  stressScenarios: string[];            // e.g. ["covid_crash", "2022_bear", "flash_crash"]
  shadowDurationMinutes: number;        // minimum shadow observation time
  paperTradeMinCount: number;           // minimum paper trades before evidence collection
  capitalAllocation: number;            // paper capital for the run
  operatorId?: string;
}

export interface CertificationRunResult {
  runId: string;
  strategyId: string;
  status: 'certified' | 'rejected' | 'failed';
  gateResults: GateResult[];
  evidencePacket: EvidencePacket;
  governanceVerdict: string;
  completedAt: string;
}

export class CertificationRunner {
  // Creates run record, initializes steps
  async initiate(config: CertificationRunConfig): Promise<string>;

  // Runs each step sequentially, updates status after each
  async executeStep(runId: string, stepName: string): Promise<StepResult>;

  // Orchestrates full run: backtest → walkforward → stress → shadow → evidence → review
  async runFull(runId: string): Promise<CertificationRunResult>;

  // Collects all evidence into a formal packet
  async collectEvidence(runId: string): Promise<EvidencePacket>;

  // Records incident during run (e.g. data gap, execution anomaly)
  async recordIncident(runId: string, incident: RunIncident): void;

  // Gets current run status with step-by-step progress
  async getRunStatus(runId: string): Promise<CertificationRunStatus>;

  // Aborts a running certification
  async abort(runId: string, reason: string): Promise<void>;
}
```

### Routes: `artifacts/api-server/src/routes/certification_run.ts`

Mounts at `/api/certification-run/`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/initiate` | Start a new certification run with config |
| `POST` | `/:runId/step/:stepName` | Execute a specific step |
| `POST` | `/:runId/run-full` | Execute all steps sequentially |
| `POST` | `/:runId/abort` | Abort a running certification |
| `POST` | `/:runId/incident` | Record an incident during the run |
| `GET` | `/:runId/status` | Get run status with step progress |
| `GET` | `/:runId/evidence` | Get collected evidence packet |
| `GET` | `/:runId/steps` | Get all step results |
| `GET` | `/active` | Get currently active certification runs |
| `GET` | `/history` | Get past certification runs with filters |

### Dashboard Page: `godsview-dashboard/src/pages/certification-run.tsx`

**Components:**

1. **CertificationRunWizard** — step-by-step config form
   - Strategy selector (from strategy registry)
   - Symbol picker, timeframe, date range
   - Target tier selector
   - Capital allocation input
   - Stress scenario checkboxes
   - Shadow/paper duration settings
   - "Initiate Run" button

2. **CertificationRunProgress** — real-time run tracker
   - Vertical step pipeline: backtest → walkforward → stress → shadow → paper → evidence → review
   - Each step shows: status icon, duration, key metrics, expandable details
   - Live progress bar for active step
   - Incident log sidebar

3. **EvidencePacketViewer** — formatted evidence review
   - Gate scorecard (7 gates, pass/fail, score bars)
   - Backtest equity curve chart
   - Walk-forward fold comparison chart
   - Shadow vs backtest alignment scatter
   - Slippage distribution histogram
   - Drift status badge
   - Governance verdict with reasoning
   - "Approve" / "Reject" buttons for operator

4. **CertificationRunHistory** — table of past runs
   - Columns: strategy, target tier, status, gates passed, date, duration
   - Click to expand evidence packet
   - Filter by strategy, tier, status

### Tests: `artifacts/api-server/src/__tests__/certification_runner.test.ts`

- Initiation creates run and steps correctly
- Each gate step passes/fails based on thresholds from `TIER_REQUIREMENTS`
- Full run orchestration updates status at each step
- Incident recording appends to run
- Abort stops execution and marks remaining steps skipped
- Evidence packet aggregates all step results
- Expired certification runs are detected
- Concurrent runs for same strategy are rejected

### Exit Criterion

One strategy has a `certified` row in `certification_runs` where `status = 'certified'`, all 7 gates passed, and the evidence packet is complete and reviewable in the UI.

---

## Phase 21 — Controlled Assisted Live

**Purpose:** Move one certified strategy from paper to human-approved live execution with hard safety boundaries.

**Why it matters:** This is the first time real money touches real markets through GodsView. Every safety gate exists to make this moment boring, not exciting.

### DB Migration: `lib/db/migrations/0007_assisted_live.sql`

```sql
-- Live trading sessions — bounded live execution windows
CREATE TABLE live_sessions (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  strategy_id TEXT NOT NULL,
  certification_run_id TEXT,             -- FK to certification_runs.run_id
  mode TEXT NOT NULL DEFAULT 'assisted', -- assisted | autonomous_candidate
  status TEXT NOT NULL DEFAULT 'pending_approval',
  -- pending_approval | approved | active | paused | completed | killed | expired

  -- Capital controls
  allocated_capital NUMERIC(14,4) NOT NULL,
  max_daily_loss NUMERIC(14,4) NOT NULL,
  max_position_size NUMERIC(14,4) NOT NULL,
  max_concurrent_positions INTEGER NOT NULL DEFAULT 1,
  max_daily_trades INTEGER NOT NULL DEFAULT 10,

  -- Symbol & session restrictions
  allowed_symbols TEXT[] NOT NULL,       -- e.g. {"SPY", "QQQ"}
  allowed_sessions TEXT[] NOT NULL,      -- e.g. {"regular_hours"}
  blocked_dates TEXT[],                  -- e.g. {"2026-04-15"} (FOMC days, etc.)

  -- Approval
  approved_by TEXT,
  approval_notes TEXT,
  approved_at TIMESTAMPTZ,
  preflight_result_json JSONB,           -- preflight check results at approval time

  -- Runtime state
  daily_pnl NUMERIC(14,4) DEFAULT 0,
  daily_trades_count INTEGER DEFAULT 0,
  current_exposure NUMERIC(14,4) DEFAULT 0,
  high_water_mark NUMERIC(14,4) DEFAULT 0,
  session_pnl NUMERIC(14,4) DEFAULT 0,

  -- Kill switch
  killed_at TIMESTAMPTZ,
  kill_reason TEXT,
  killed_by TEXT,                        -- operator ID or "system"

  -- Safety events
  safety_events_json JSONB DEFAULT '[]'::JSONB,
  breaker_triggered BOOLEAN DEFAULT FALSE,

  -- Timestamps
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,       -- hard session expiry
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_live_sessions_strategy ON live_sessions(strategy_id);
CREATE INDEX idx_live_sessions_status ON live_sessions(status);

-- Live execution approvals — every live order requires operator sign-off
CREATE TABLE live_execution_approvals (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  order_uuid TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity NUMERIC(12,4) NOT NULL,
  limit_price NUMERIC(14,6),
  stop_price NUMERIC(14,6) NOT NULL,
  target_price NUMERIC(14,6) NOT NULL,

  -- Signal context
  signal_json JSONB,                     -- the signal that generated this order
  reasoning TEXT,                        -- AI explanation of why this trade

  -- Approval
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending | approved | rejected | expired | auto_approved
  approved_by TEXT,
  approval_notes TEXT,
  approved_at TIMESTAMPTZ,
  rejected_reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL,       -- approval window (e.g. 60 seconds)

  -- Execution outcome (filled after execution)
  executed BOOLEAN DEFAULT FALSE,
  execution_result_json JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_approvals_session ON live_execution_approvals(session_id);
CREATE INDEX idx_approvals_status ON live_execution_approvals(status);

-- Live session daily summaries — EOD reconciliation per session
CREATE TABLE live_session_dailies (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  trading_date DATE NOT NULL,
  strategy_id TEXT NOT NULL,

  -- Performance
  trades_executed INTEGER DEFAULT 0,
  trades_approved INTEGER DEFAULT 0,
  trades_rejected INTEGER DEFAULT 0,
  gross_pnl NUMERIC(14,4) DEFAULT 0,
  net_pnl NUMERIC(14,4) DEFAULT 0,
  commissions NUMERIC(10,4) DEFAULT 0,
  total_slippage_bps NUMERIC(8,2),
  win_rate NUMERIC(6,4),

  -- Risk
  max_drawdown_intraday NUMERIC(8,4),
  max_exposure NUMERIC(14,4),
  breakers_triggered INTEGER DEFAULT 0,
  safety_events INTEGER DEFAULT 0,

  -- Comparison to paper
  paper_expected_pnl NUMERIC(14,4),
  live_vs_paper_divergence NUMERIC(8,4),

  -- Reconciliation
  reconciliation_status TEXT,            -- clean | discrepancy | pending
  reconciliation_json JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, trading_date)
);
```

### DB Schema: `lib/db/src/schema/live_sessions.ts`

New file. Three tables: `liveSessionsTable`, `liveExecutionApprovalsTable`, `liveSessionDailiesTable`.

### Lib Modules

**`api-server/src/lib/live/session_manager.ts`**

```typescript
export class LiveSessionManager {
  // Creates a session with safety bounds, requires certification proof
  async createSession(config: LiveSessionConfig): Promise<string>;

  // Operator approval with preflight checks
  async approveSession(sessionId: string, operatorId: string, notes?: string): Promise<PreflightResult>;

  // Starts the session (activates execution path)
  async startSession(sessionId: string): Promise<void>;

  // Pauses without killing (can resume)
  async pauseSession(sessionId: string, reason: string): Promise<void>;

  // Hard kill — stops all activity, cancels open orders
  async killSession(sessionId: string, killedBy: string, reason: string): Promise<void>;

  // Gets real-time session state
  async getSessionState(sessionId: string): Promise<LiveSessionState>;

  // EOD daily summary generation
  async generateDailySummary(sessionId: string, date: string): Promise<DailySummary>;
}
```

**`api-server/src/lib/live/execution_approver.ts`**

```typescript
export class ExecutionApprover {
  // Submits order for approval (creates approval record, notifies operator)
  async submitForApproval(sessionId: string, order: PendingOrder): Promise<string>;

  // Operator approves — order proceeds to execution
  async approve(approvalId: number, operatorId: string, notes?: string): Promise<void>;

  // Operator rejects — order is cancelled
  async reject(approvalId: number, operatorId: string, reason: string): Promise<void>;

  // Auto-expire stale approvals
  async expireStale(): Promise<number>;

  // Get pending approvals for operator dashboard
  async getPending(sessionId?: string): Promise<PendingApproval[]>;
}
```

**`api-server/src/lib/live/safety_monitor.ts`**

```typescript
export class LiveSafetyMonitor {
  // Runs continuously during live session
  // Checks: daily loss limit, exposure cap, trade count, session hours, blocked dates
  async checkSafety(sessionId: string): Promise<SafetyCheckResult>;

  // Called before every order submission
  async preTradeCheck(sessionId: string, order: PendingOrder): Promise<PreTradeResult>;

  // Called after every fill
  async postTradeUpdate(sessionId: string, fill: Fill): Promise<void>;

  // Triggers circuit breaker
  async triggerBreaker(sessionId: string, reason: string): Promise<void>;

  // Compares live fills to paper expectations
  async liveVsPaperCheck(sessionId: string): Promise<DivergenceResult>;
}
```

**`api-server/src/lib/live/preflight_gate.ts`**

```typescript
export interface PreflightResult {
  passed: boolean;
  checks: PreflightCheck[];
  blockers: string[];
}

export async function runLivePreflight(sessionId: string): Promise<PreflightResult>;
// Checks:
// 1. Valid certification exists and is not expired
// 2. Broker connection healthy
// 3. Account has sufficient buying power
// 4. Kill switch is not active
// 5. System mode is live_enabled
// 6. No unresolved critical drift events
// 7. Data feeds are healthy
// 8. No active breakers
// 9. Current time is within allowed session hours
// 10. Today is not a blocked date
```

### Routes: `artifacts/api-server/src/routes/live_session.ts`

Mounts at `/api/live/`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions` | Create new live session |
| `POST` | `/sessions/:sessionId/approve` | Operator approves session |
| `POST` | `/sessions/:sessionId/start` | Start approved session |
| `POST` | `/sessions/:sessionId/pause` | Pause session |
| `POST` | `/sessions/:sessionId/kill` | Emergency kill |
| `POST` | `/sessions/:sessionId/resume` | Resume paused session |
| `GET` | `/sessions/:sessionId` | Get session state |
| `GET` | `/sessions/:sessionId/safety` | Get safety status |
| `GET` | `/sessions/:sessionId/dailies` | Get daily summaries |
| `GET` | `/sessions/active` | Get all active sessions |
| `POST` | `/approvals/:approvalId/approve` | Approve a pending order |
| `POST` | `/approvals/:approvalId/reject` | Reject a pending order |
| `GET` | `/approvals/pending` | Get all pending order approvals |
| `GET` | `/preflight/:sessionId` | Run preflight without starting |

All mutation routes require `requireOperator` middleware.

### Dashboard Page: `godsview-dashboard/src/pages/live-control.tsx`

**Components:**

1. **LiveSessionCreator** — form to create a new live session
   - Strategy selector (only shows certified strategies)
   - Capital allocation with max cap
   - Symbol whitelist picker
   - Session hours selector
   - Daily loss limit input
   - Max position size input
   - Session expiry date picker
   - Blocked dates multi-picker
   - "Create Session" → goes to approval

2. **LiveSessionDashboard** — the main live control surface
   - Session status banner (big green/yellow/red indicator)
   - Real-time PnL chart (streaming)
   - Daily loss gauge (progress bar toward limit)
   - Exposure gauge (current vs max)
   - Trade counter (used / max daily)
   - **Kill switch button** — prominent, red, requires confirmation dialog
   - Pause / Resume controls

3. **OrderApprovalQueue** — operator approval interface
   - Cards for each pending order showing:
     - Symbol, side, quantity, prices
     - Signal reasoning (from AI)
     - Strategy context
     - Time remaining before auto-expire
   - "Approve" (green) / "Reject" (red) buttons
   - Batch approve checkbox (for experienced operators)

4. **LiveVsPaperComparison** — divergence tracker
   - Side-by-side PnL curves (live actual vs paper expected)
   - Slippage comparison chart
   - Win rate comparison bars
   - Divergence score with threshold indicator

5. **SafetyEventsLog** — chronological safety event feed
   - Breaker triggers, exposure warnings, drift alerts
   - Severity badges
   - Link to related order/fill

6. **EODReconciliationView** — daily session summary
   - Performance table
   - Reconciliation status
   - Live vs paper divergence
   - Next-day recommendation

### Tests: `artifacts/api-server/src/__tests__/live_session.test.ts`

- Session creation requires valid certification
- Session cannot start without operator approval
- Preflight blocks start when conditions unmet (12+ specific test cases)
- Daily loss limit triggers kill when exceeded
- Max exposure blocks new orders
- Kill switch cancels all open orders
- Paused session rejects new order submissions
- Expired sessions auto-complete
- Order approval timeout expires correctly
- Safety monitor detects all bound violations
- Live vs paper divergence calculation works
- EOD reconciliation detects position mismatches

### Exit Criterion

One live session completes a full trading day with real fills, no unresolved safety violations, and the daily reconciliation is `clean`.

---

## Phase 22 — Autonomous Candidate Mode

**Purpose:** Allow limited autonomy on a narrow, proven strategy under tight governance. The system executes without per-trade operator approval, but within strict bounds that auto-revoke autonomy on degradation.

**Why it matters:** This is where GodsView transitions from "tool that helps you trade" to "system that trades under your governance."

### DB Migration: `lib/db/migrations/0008_autonomous_mode.sql`

```sql
-- Autonomy grants — explicit, bounded, revocable autonomy
CREATE TABLE autonomy_grants (
  id SERIAL PRIMARY KEY,
  grant_id TEXT NOT NULL UNIQUE,
  strategy_id TEXT NOT NULL,
  session_id TEXT,                        -- FK to live_sessions.session_id

  -- Authority bounds
  authority_level TEXT NOT NULL,          -- observation | recommendation | bounded_execution | full_execution
  max_trade_size NUMERIC(14,4) NOT NULL,
  max_daily_exposure NUMERIC(14,4) NOT NULL,
  max_daily_loss NUMERIC(14,4) NOT NULL,
  max_concurrent_positions INTEGER NOT NULL DEFAULT 2,
  allowed_symbols TEXT[] NOT NULL,
  allowed_order_types TEXT[] NOT NULL,    -- e.g. {"limit", "bracket"}
  allowed_sessions TEXT[] NOT NULL,

  -- Revocation conditions (checked every tick)
  revoke_on_daily_loss_pct NUMERIC(6,4) NOT NULL,     -- e.g. 0.02 = 2%
  revoke_on_consecutive_losses INTEGER NOT NULL,       -- e.g. 5
  revoke_on_drift_score NUMERIC(6,4) NOT NULL,        -- e.g. 0.6
  revoke_on_slippage_bps NUMERIC(8,2) NOT NULL,       -- e.g. 100
  revoke_on_execution_quality_below NUMERIC(6,4),      -- e.g. 0.8
  cooldown_after_revoke_minutes INTEGER DEFAULT 60,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending | active | paused | revoked | expired | completed
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  revoked_by TEXT,                        -- system | operator_id

  -- Governance
  granted_by TEXT NOT NULL,               -- operator who approved
  certification_run_id TEXT,
  evidence_at_grant_json JSONB,           -- snapshot of evidence at grant time
  granted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_autonomy_grants_strategy ON autonomy_grants(strategy_id);
CREATE INDEX idx_autonomy_grants_status ON autonomy_grants(status);

-- Autonomy audit log — every autonomous action is logged
CREATE TABLE autonomy_audit_log (
  id SERIAL PRIMARY KEY,
  grant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  -- order_placed | order_filled | order_cancelled | position_closed |
  -- bound_checked | bound_warning | bound_violation |
  -- revocation_check | revocation_triggered | cooldown_started | cooldown_ended |
  -- drift_check | quality_check

  -- Context
  order_uuid TEXT,
  symbol TEXT,
  details_json JSONB,
  severity TEXT DEFAULT 'info',          -- info | warning | critical

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_autonomy_audit_grant ON autonomy_audit_log(grant_id);
CREATE INDEX idx_autonomy_audit_type ON autonomy_audit_log(event_type);

-- Autonomous performance snapshots — periodic scoring
CREATE TABLE autonomous_performance_snapshots (
  id SERIAL PRIMARY KEY,
  grant_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL,

  -- Performance
  trades_total INTEGER,
  win_rate NUMERIC(6,4),
  sharpe NUMERIC(8,4),
  pnl NUMERIC(14,4),
  max_drawdown NUMERIC(8,4),

  -- Execution quality
  avg_slippage_bps NUMERIC(8,2),
  fill_rate NUMERIC(6,4),
  avg_latency_ms INTEGER,

  -- Drift
  drift_score NUMERIC(6,4),
  drift_status TEXT,

  -- Autonomy health
  bounds_utilization NUMERIC(6,4),       -- how close to limits (0-1)
  revocation_risk TEXT,                  -- low | medium | high | imminent
  recommendation TEXT,                   -- continue | reduce_bounds | pause | revoke

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auto_perf_grant ON autonomous_performance_snapshots(grant_id);
```

### DB Schema: `lib/db/src/schema/autonomy.ts`

Three tables: `autonomyGrantsTable`, `autonomyAuditLogTable`, `autonomousPerformanceSnapshotsTable`.

### Lib Modules

**`api-server/src/lib/autonomous/autonomy_governor.ts`**

```typescript
export class AutonomyGovernor {
  // Grants bounded autonomy (requires operator + certification proof)
  async grantAutonomy(config: AutonomyGrantConfig): Promise<string>;

  // Checks all revocation conditions — called before every trade
  async checkRevocationConditions(grantId: string): Promise<RevocationCheckResult>;

  // Revokes autonomy (system or operator)
  async revokeAutonomy(grantId: string, revokedBy: string, reason: string): Promise<void>;

  // Auto-demotes: reduces authority level instead of full revoke
  async demoteAuthority(grantId: string, newLevel: AuthorityLevel, reason: string): Promise<void>;

  // Periodic health snapshot
  async capturePerformanceSnapshot(grantId: string): Promise<void>;

  // Gets current autonomy state
  async getAutonomyState(grantId: string): Promise<AutonomyState>;

  // Cooldown management
  async startCooldown(grantId: string, durationMinutes: number): Promise<void>;
  async isCoolingDown(grantId: string): Promise<boolean>;
}
```

**`api-server/src/lib/autonomous/autonomous_executor.ts`**

```typescript
export class AutonomousExecutor {
  // Executes a trade within autonomy bounds (no operator approval needed)
  async executeAutonomous(grantId: string, signal: TradingSignal): Promise<ExecutionResult>;

  // Pre-execution bound check
  async validateWithinBounds(grantId: string, order: PendingOrder): Promise<BoundCheckResult>;

  // Logs every action to audit trail
  async logAction(grantId: string, event: AuditEvent): Promise<void>;

  // Emergency: cancel all autonomous orders
  async cancelAllOrders(grantId: string, reason: string): Promise<void>;
}
```

### Routes: `artifacts/api-server/src/routes/autonomy.ts`

Mounts at `/api/autonomy/`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/grants` | Create autonomy grant |
| `POST` | `/grants/:grantId/activate` | Activate a pending grant |
| `POST` | `/grants/:grantId/revoke` | Revoke autonomy |
| `POST` | `/grants/:grantId/demote` | Reduce authority level |
| `POST` | `/grants/:grantId/pause` | Pause without revoking |
| `POST` | `/grants/:grantId/resume` | Resume paused grant |
| `GET` | `/grants/:grantId` | Get grant state |
| `GET` | `/grants/:grantId/audit` | Get audit log |
| `GET` | `/grants/:grantId/performance` | Get performance snapshots |
| `GET` | `/grants/active` | All active grants |
| `GET` | `/revocation-check/:grantId` | Dry-run revocation check |

All mutation routes require `requireOperator`.

### Dashboard Page: `godsview-dashboard/src/pages/autonomy.tsx`

**Components:**

1. **AutonomyGrantWizard** — create/configure autonomy
   - Strategy selector (only assisted-live proven strategies)
   - Authority level selector with descriptions
   - Bound configuration form (all limits)
   - Revocation condition thresholds
   - Expiry and cooldown settings
   - Requires explicit "I understand the risks" checkbox

2. **AutonomyDashboard** — live monitoring
   - Authority level indicator (colored badge)
   - Bounds utilization gauges (trade size, exposure, daily loss — each as % of limit)
   - Revocation risk thermometer (low → imminent)
   - Live trade feed (autonomous decisions with reasoning)
   - Drift score trend line
   - Performance sparklines (win rate, PnL, Sharpe rolling)

3. **AutonomyAuditTrail** — full audit log
   - Filterable by event type, severity
   - Every order, bound check, revocation check logged
   - Exportable for compliance

4. **RevocationControlPanel** — emergency controls
   - One-click revoke button (red, prominent)
   - Demote authority dropdown
   - Cooldown timer display
   - Revocation history

### Tests: `artifacts/api-server/src/__tests__/autonomy_governor.test.ts`

- Grant creation requires valid certification and assisted-live evidence
- Bound violations trigger automatic revocation
- Consecutive loss limit triggers revocation
- Drift score threshold triggers revocation
- Slippage threshold triggers revocation
- Cooldown period enforced after revocation
- Authority demotion reduces bounds correctly
- Audit log captures every event
- Performance snapshots calculate revocation risk correctly
- Expired grants auto-complete
- Concurrent grants for same strategy blocked

### Exit Criterion

One strategy completes at least 20 autonomous trades within bounds, with zero unplanned revocations and the audit trail is complete.

---

## Phase 23 — Portfolio Intelligence

**Purpose:** Move beyond single-strategy execution to multi-strategy capital management with correlated risk awareness.

**Why it matters:** This is where GodsView becomes a desk, not just a strategy runner. A single strategy doesn't make a trading operation. Portfolio intelligence does.

### DB Migration: `lib/db/migrations/0009_portfolio_intelligence.sql`

```sql
-- Portfolios — named collections of strategies with allocation rules
CREATE TABLE portfolios (
  id SERIAL PRIMARY KEY,
  portfolio_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | active | paused | retired

  -- Capital
  total_capital NUMERIC(14,4) NOT NULL,
  allocated_capital NUMERIC(14,4) DEFAULT 0,
  unallocated_capital NUMERIC(14,4),
  cash_reserve_pct NUMERIC(6,4) DEFAULT 0.10, -- keep 10% in cash

  -- Risk limits (portfolio-level)
  max_portfolio_drawdown NUMERIC(8,4) NOT NULL,
  max_daily_loss NUMERIC(14,4) NOT NULL,
  max_gross_exposure NUMERIC(14,4) NOT NULL,
  max_single_strategy_pct NUMERIC(6,4) DEFAULT 0.30,  -- no strategy > 30% of capital
  max_correlated_exposure_pct NUMERIC(6,4) DEFAULT 0.50,

  -- Regime awareness
  current_regime TEXT,                   -- trending | mean_reverting | volatile | crisis
  regime_updated_at TIMESTAMPTZ,

  owner_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Strategy allocations — how capital is distributed
CREATE TABLE strategy_allocations (
  id SERIAL PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,

  -- Allocation
  allocation_pct NUMERIC(6,4) NOT NULL,  -- target % of portfolio
  allocated_capital NUMERIC(14,4) NOT NULL,
  current_exposure NUMERIC(14,4) DEFAULT 0,
  current_pnl NUMERIC(14,4) DEFAULT 0,

  -- Strategy status within portfolio
  status TEXT NOT NULL DEFAULT 'active', -- active | paused | deactivated | pending_entry | pending_exit
  activation_regime TEXT[],              -- regimes where this strategy is active

  -- Risk contribution
  marginal_risk_contribution NUMERIC(8,4),
  correlation_to_portfolio NUMERIC(6,4),

  -- Performance
  rolling_sharpe_30d NUMERIC(8,4),
  rolling_win_rate_30d NUMERIC(6,4),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(portfolio_id, strategy_id)
);

-- Portfolio snapshots — periodic portfolio-level metrics
CREATE TABLE portfolio_snapshots (
  id SERIAL PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL,

  -- Performance
  total_pnl NUMERIC(14,4),
  daily_pnl NUMERIC(14,4),
  portfolio_sharpe NUMERIC(8,4),
  portfolio_sortino NUMERIC(8,4),
  portfolio_win_rate NUMERIC(6,4),

  -- Risk
  gross_exposure NUMERIC(14,4),
  net_exposure NUMERIC(14,4),
  current_drawdown NUMERIC(8,4),
  max_drawdown NUMERIC(8,4),
  var_95 NUMERIC(14,4),                  -- Value at Risk 95%
  cvar_95 NUMERIC(14,4),                 -- Conditional VaR

  -- Correlation matrix (stored as JSON for flexibility)
  correlation_matrix_json JSONB,
  concentration_hhi NUMERIC(8,4),        -- Herfindahl index

  -- Regime
  regime TEXT,
  regime_confidence NUMERIC(6,4),

  -- Strategy-level breakdown
  strategy_breakdown_json JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_portfolio_snapshots ON portfolio_snapshots(portfolio_id, snapshot_at);

-- Rebalance events — when and why portfolio allocation changed
CREATE TABLE rebalance_events (
  id SERIAL PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  event_type TEXT NOT NULL,              -- scheduled | regime_change | drift_trigger | manual | risk_breach
  status TEXT NOT NULL DEFAULT 'proposed',
  -- proposed | approved | executing | completed | rejected

  -- What changed
  changes_json JSONB NOT NULL,           -- [{strategy_id, old_pct, new_pct, reason}]
  trigger_reason TEXT NOT NULL,

  -- Approval
  approved_by TEXT,
  approved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### DB Schema: `lib/db/src/schema/portfolio.ts`

Four tables: `portfoliosTable`, `strategyAllocationsTable`, `portfolioSnapshotsTable`, `rebalanceEventsTable`.

### Lib Modules

**`api-server/src/lib/portfolio/portfolio_manager.ts`**

```typescript
export class PortfolioManager {
  async createPortfolio(config: PortfolioConfig): Promise<string>;
  async addStrategy(portfolioId: string, strategyId: string, allocationPct: number): Promise<void>;
  async removeStrategy(portfolioId: string, strategyId: string): Promise<void>;
  async rebalance(portfolioId: string, changes: AllocationChange[]): Promise<string>;
  async getPortfolioState(portfolioId: string): Promise<PortfolioState>;
  async captureSnapshot(portfolioId: string): Promise<void>;
}
```

**`api-server/src/lib/portfolio/correlation_engine.ts`**

```typescript
export class CorrelationEngine {
  // Computes rolling correlation matrix across strategies
  async computeCorrelationMatrix(strategyIds: string[], windowDays: number): Promise<CorrelationMatrix>;

  // Checks if adding a strategy increases correlated exposure beyond limit
  async checkConcentrationRisk(portfolioId: string, newStrategyId: string): Promise<ConcentrationResult>;

  // Identifies highly correlated strategy pairs
  async findCorrelatedPairs(portfolioId: string, threshold: number): Promise<CorrelatedPair[]>;
}
```

**`api-server/src/lib/portfolio/regime_allocator.ts`**

```typescript
export class RegimeAllocator {
  // Determines which strategies should be active given current regime
  async getRegimeAllocation(portfolioId: string, regime: string): Promise<RegimeAllocation>;

  // Proposes rebalance when regime changes
  async onRegimeChange(portfolioId: string, newRegime: string): Promise<RebalanceProposal>;

  // Deactivates strategies not suited to current regime
  async applyRegimeFilter(portfolioId: string): Promise<ActivationChange[]>;
}
```

**`api-server/src/lib/portfolio/portfolio_risk.ts`**

```typescript
export class PortfolioRiskEngine {
  // Portfolio-level safety checks
  async checkPortfolioSafety(portfolioId: string): Promise<PortfolioSafetyResult>;

  // Computes VaR and CVaR
  async computeRiskMetrics(portfolioId: string): Promise<PortfolioRiskMetrics>;

  // Checks if a proposed trade violates portfolio limits
  async preTradePortfolioCheck(portfolioId: string, order: PendingOrder): Promise<PreTradeResult>;

  // Marginal risk contribution of each strategy
  async computeMarginalRisk(portfolioId: string): Promise<MarginalRiskReport>;
}
```

### Routes: `artifacts/api-server/src/routes/portfolio_intelligence.ts`

Mounts at `/api/portfolio/intelligence/`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/portfolios` | Create portfolio |
| `PUT` | `/portfolios/:portfolioId` | Update portfolio config |
| `POST` | `/portfolios/:portfolioId/strategies` | Add strategy to portfolio |
| `DELETE` | `/portfolios/:portfolioId/strategies/:strategyId` | Remove strategy |
| `POST` | `/portfolios/:portfolioId/rebalance` | Propose rebalance |
| `POST` | `/rebalance/:eventId/approve` | Approve rebalance |
| `GET` | `/portfolios/:portfolioId` | Get portfolio state |
| `GET` | `/portfolios/:portfolioId/risk` | Get risk metrics |
| `GET` | `/portfolios/:portfolioId/correlation` | Get correlation matrix |
| `GET` | `/portfolios/:portfolioId/snapshots` | Historical snapshots |
| `GET` | `/portfolios/:portfolioId/regime` | Current regime + allocation |
| `GET` | `/portfolios` | List all portfolios |

### Dashboard Page: `godsview-dashboard/src/pages/portfolio-intelligence.tsx`

**Components:**

1. **PortfolioOverview** — capital allocation treemap
   - Visual allocation breakdown (treemap or sunburst chart)
   - Unallocated capital shown
   - Color-coded by strategy performance

2. **CorrelationHeatmap** — strategy correlation matrix
   - Interactive heatmap
   - Click a cell to see rolling correlation chart
   - Concentration risk indicator

3. **PortfolioRiskDashboard**
   - VaR/CVaR gauges
   - Drawdown chart
   - Exposure breakdown (gross/net)
   - Risk contribution bar chart per strategy

4. **RegimePanel**
   - Current regime badge with confidence
   - Regime history timeline
   - Strategy activation matrix (which strategies active per regime)
   - Proposed rebalance on regime change

5. **RebalanceWorkflow**
   - Proposed changes table (old % → new %, reason)
   - Approve / reject controls
   - Execution status tracker
   - Rebalance history

### Tests: `artifacts/api-server/src/__tests__/portfolio_intelligence.test.ts`

- Portfolio creation with capital limits
- Strategy allocation respects max single-strategy %
- Correlation matrix computation
- Concentration risk detection blocks overly correlated additions
- Regime change triggers rebalance proposal
- Portfolio-level daily loss breaker
- VaR computation with historical data
- Rebalance execution updates allocations atomically
- Snapshot captures all relevant metrics
- Removing strategy redistributes or parks capital

### Exit Criterion

A portfolio with 2+ strategies shows accurate correlation, risk metrics, and regime-aware allocation in the dashboard. Rebalance proposals flow through approval correctly.

---

## Phase 24 — Enterprise / Product Production

**Purpose:** Make GodsView production-ready not just for trading logic, but for real operational ownership by teams and organizations.

**Why it matters:** This is the difference between "a system one person runs" and "a platform an organization trusts." Without this, GodsView cannot be a company.

### DB Migration: `lib/db/migrations/0010_enterprise.sql`

```sql
-- Organizations
CREATE TABLE organizations (
  id SERIAL PRIMARY KEY,
  org_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'pro',      -- retail | pro | team | institutional
  status TEXT NOT NULL DEFAULT 'active',
  settings_json JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users and roles
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  org_id TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  -- viewer | trader | analyst | risk_manager | operator | admin | owner
  permissions_json JSONB DEFAULT '[]'::JSONB,
  status TEXT NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_org ON users(org_id);

-- Audit trail — every significant action across the platform
CREATE TABLE platform_audit_log (
  id SERIAL PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  -- session_created | session_approved | session_killed |
  -- order_approved | order_rejected | autonomy_granted | autonomy_revoked |
  -- strategy_promoted | strategy_demoted | portfolio_rebalanced |
  -- settings_changed | role_changed | user_invited | user_removed
  resource_type TEXT NOT NULL,           -- session | order | strategy | portfolio | user | settings
  resource_id TEXT,
  details_json JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_org ON platform_audit_log(org_id);
CREATE INDEX idx_audit_action ON platform_audit_log(action);
CREATE INDEX idx_audit_created ON platform_audit_log(created_at);

-- SLO tracking
CREATE TABLE slo_metrics (
  id SERIAL PRIMARY KEY,
  metric_name TEXT NOT NULL,
  -- api_latency_p99 | api_availability | data_freshness |
  -- execution_latency | dashboard_load_time | deploy_success_rate
  target_value NUMERIC(10,4) NOT NULL,
  actual_value NUMERIC(10,4) NOT NULL,
  window TEXT NOT NULL,                  -- 1h | 24h | 7d | 30d
  status TEXT NOT NULL,                  -- met | warning | breached
  measured_at TIMESTAMPTZ NOT NULL,
  details_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_slo_metric ON slo_metrics(metric_name, measured_at);

-- Incident records
CREATE TABLE incidents (
  id SERIAL PRIMARY KEY,
  incident_id TEXT NOT NULL UNIQUE,
  org_id TEXT,
  severity TEXT NOT NULL,                -- p1 | p2 | p3 | p4
  status TEXT NOT NULL DEFAULT 'open',   -- open | investigating | mitigated | resolved | postmortem
  title TEXT NOT NULL,
  description TEXT,
  affected_systems TEXT[],
  timeline_json JSONB DEFAULT '[]'::JSONB,
  root_cause TEXT,
  resolution TEXT,
  postmortem_url TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backup verification
CREATE TABLE backup_verifications (
  id SERIAL PRIMARY KEY,
  backup_type TEXT NOT NULL,             -- full | incremental | wal
  status TEXT NOT NULL,                  -- success | failure | partial
  backup_size_bytes BIGINT,
  duration_ms INTEGER,
  restore_tested BOOLEAN DEFAULT FALSE,
  restore_duration_ms INTEGER,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);
```

### DB Schema: `lib/db/src/schema/enterprise.ts`

Six tables: `organizationsTable`, `usersTable`, `platformAuditLogTable`, `sloMetricsTable`, `incidentsTable`, `backupVerificationsTable`.

### Lib Modules

**`api-server/src/lib/enterprise/rbac.ts`**

```typescript
export type Role = 'viewer' | 'trader' | 'analyst' | 'risk_manager' | 'operator' | 'admin' | 'owner';

export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  viewer:       ['read:dashboard', 'read:portfolio', 'read:strategies'],
  trader:       ['...viewer', 'execute:paper', 'create:orders'],
  analyst:      ['...viewer', 'run:backtest', 'run:research', 'export:data'],
  risk_manager: ['...analyst', 'approve:sessions', 'modify:limits', 'trigger:kill'],
  operator:     ['...risk_manager', 'approve:live', 'grant:autonomy', 'promote:strategies'],
  admin:        ['...operator', 'manage:users', 'manage:settings', 'manage:org'],
  owner:        ['*'],
};

export function requirePermission(permission: string): Express.Middleware;
export function requireRole(minRole: Role): Express.Middleware;
export function checkPermission(userId: string, permission: string): Promise<boolean>;
```

**`api-server/src/lib/enterprise/audit_logger.ts`**

```typescript
export class AuditLogger {
  async log(event: AuditEvent): Promise<void>;
  async query(filters: AuditFilters): Promise<AuditEntry[]>;
  async exportForCompliance(orgId: string, dateRange: DateRange): Promise<AuditExport>;
}
```

**`api-server/src/lib/enterprise/slo_tracker.ts`**

```typescript
export class SLOTracker {
  async recordMetric(name: string, value: number): Promise<void>;
  async getSLOStatus(): Promise<SLODashboard>;
  async checkBreach(): Promise<SLOBreach[]>;
}
```

**`api-server/src/lib/enterprise/incident_manager.ts`**

```typescript
export class IncidentManager {
  async openIncident(incident: NewIncident): Promise<string>;
  async updateTimeline(incidentId: string, entry: TimelineEntry): Promise<void>;
  async resolve(incidentId: string, resolution: Resolution): Promise<void>;
  async getActiveIncidents(): Promise<Incident[]>;
}
```

**`api-server/src/lib/enterprise/backup_manager.ts`**

```typescript
export class BackupManager {
  async triggerBackup(type: 'full' | 'incremental'): Promise<void>;
  async verifyBackup(backupId: string): Promise<VerificationResult>;
  async testRestore(backupId: string): Promise<RestoreTestResult>;
  async getBackupHistory(): Promise<BackupRecord[]>;
}
```

### Routes: `artifacts/api-server/src/routes/enterprise.ts`

Mounts at `/api/enterprise/`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/org` | Get organization info |
| `PUT` | `/org/settings` | Update org settings |
| `GET` | `/users` | List users |
| `POST` | `/users` | Invite user |
| `PUT` | `/users/:userId/role` | Change user role |
| `DELETE` | `/users/:userId` | Remove user |
| `GET` | `/audit` | Query audit log |
| `GET` | `/audit/export` | Export audit for compliance |
| `GET` | `/slo` | SLO dashboard |
| `GET` | `/slo/breaches` | Current SLO breaches |
| `GET` | `/incidents` | List incidents |
| `POST` | `/incidents` | Open incident |
| `PUT` | `/incidents/:id` | Update incident |
| `GET` | `/backups` | Backup history |
| `POST` | `/backups/verify` | Trigger backup verification |
| `GET` | `/health/deep` | Deep health check (all deps) |

### Dashboard Page: `godsview-dashboard/src/pages/enterprise.tsx`

**Components:**

1. **UserManagement** — invite, role assignment, removal
   - User list table with role badges
   - Invite form (email + role selector)
   - Role change dropdown with confirmation
   - Last login display

2. **AuditExplorer** — searchable audit log
   - Timeline view of all platform actions
   - Filter by user, action, resource, date range
   - Export to CSV/JSON button
   - Drill-down to related resource

3. **SLODashboard** — operational health scorecard
   - Cards per SLO metric: target vs actual, status badge
   - Trend charts (7d/30d)
   - Breach alerts
   - Error budget remaining

4. **IncidentCenter** — incident lifecycle management
   - Active incidents with severity badges
   - Timeline view per incident
   - Status transitions
   - Postmortem links

5. **BackupHealth** — backup & restore status
   - Last backup timestamp + status
   - Restore test results
   - Backup schedule display

6. **EnvironmentPanel** — environment separation view
   - Current environment badge (dev/staging/prod)
   - Config diff viewer
   - Environment variable status (masked)

### Tests: `artifacts/api-server/src/__tests__/enterprise.test.ts`

- RBAC enforces permissions correctly (viewer cannot approve live sessions, etc.)
- Role hierarchy works (operator has all risk_manager permissions)
- Audit log captures all mutation operations
- SLO tracker detects breaches
- Incident lifecycle state machine
- Backup verification records results
- User invitation and removal works
- Audit export includes all required fields
- Permission check performance (< 5ms per check)

### Exit Criterion

RBAC prevents unauthorized actions. Audit trail captures every mutation. SLO dashboard shows real operational metrics. One backup/restore drill completes successfully.

---

## Summary — Implementation Artifact Counts

| Phase | DB Tables | Lib Modules | Routes | Dashboard Components | Test Files |
|-------|-----------|-------------|--------|---------------------|------------|
| 20 — Certification Run | 2 | 1 | 1 (10 endpoints) | 4 | 1 |
| 21 — Assisted Live | 3 | 4 | 1 (14 endpoints) | 6 | 1 |
| 22 — Autonomous Mode | 3 | 2 | 1 (11 endpoints) | 4 | 1 |
| 23 — Portfolio Intelligence | 4 | 4 | 1 (12 endpoints) | 5 | 1 |
| 24 — Enterprise Production | 6 | 5 | 1 (17 endpoints) | 6 | 1 |
| **Total** | **18** | **16** | **5 (64 endpoints)** | **25** | **5** |

## Correct Execution Order

```
Phase 20 (Certify one strategy)
    ↓
Phase 21 (Assisted live with that strategy)
    ↓
Phase 22 (Autonomous candidate with that strategy)
    ↓
Phase 23 (Add second strategy, build portfolio layer)
    ↓
Phase 24 (Enterprise hardening across everything)
```

Each phase depends on the prior one's exit criterion being met. Do not skip ahead.

## Migration Sequence

```
0006_certification_run.sql
0007_assisted_live.sql
0008_autonomous_mode.sql
0009_portfolio_intelligence.sql
0010_enterprise.sql
```

These follow sequentially from the existing `0005_certification.sql`.

---

*Generated for GodsView — the AI-native market intelligence and decision operating system.*
