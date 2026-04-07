import { EventEmitter } from 'events';

// ============================================================================
// Type Definitions
// ============================================================================

type FailureMode =
  | 'broker_disconnect'
  | 'db_unavailable'
  | 'feed_stale'
  | 'high_latency'
  | 'memory_pressure'
  | 'clock_skew'
  | 'api_timeout'
  | 'partial_system'
  | 'unknown';

type FailsafeAction =
  | 'halt_new_orders'
  | 'cancel_pending'
  | 'flatten_all'
  | 'switch_paper'
  | 'reduce_size'
  | 'alert_operator'
  | 'log_only'
  | 'graceful_shutdown';

type FailsafeMode = 'normal' | 'degraded' | 'emergency' | 'lockdown';
type RecoveryLevel = 'lockdown' | 'emergency' | 'degraded' | 'normal';

interface FailsafeRule {
  id: string;
  trigger: FailureMode;
  condition: string;
  action: FailsafeAction;
  priority: number;
  cooldownMs: number;
  lastTriggered: number;
  triggerCount: number;
  enabled: boolean;
}

interface FailsafeState {
  mode: FailsafeMode;
  activeFailures: ActiveFailure[];
  actionsExecuted: ExecutedAction[];
  canTrade: boolean;
  canOpenNew: boolean;
  sizeMultiplier: number;
  lastEscalation: number;
}

interface ActiveFailure {
  mode: FailureMode;
  triggeredAt: number;
  escalationLevel: number;
  resolvedAt?: number;
  details: Record<string, unknown>;
}

interface ExecutedAction {
  action: FailsafeAction;
  triggeredBy: FailureMode;
  executedAt: number;
  ruleId: string;
  details: Record<string, unknown>;
}

interface RecoveryState {
  currentLevel: RecoveryLevel;
  startedAt: number;
  stabilityRequiredMs: number;
  lastFailureTime: number;
}

interface OperatorOverride {
  id: string;
  action: FailsafeAction | 'lockdown' | 'resume';
  reason: string;
  operatorId: string;
  executedAt: number;
  priority: number;
}

// ============================================================================
// FailsafeController Class
// ============================================================================

export class FailsafeController extends EventEmitter {
  private state: FailsafeState;
  private rules: Map<string, FailsafeRule>;
  private recoveryStates: Map<FailureMode, RecoveryState>;
  private operatorOverrides: OperatorOverride[];
  private isManualLockdown: boolean;
  private failureEventLog: Array<{ mode: FailureMode; timestamp: number }>;

  constructor() {
    super();

    this.state = {
      mode: 'normal',
      activeFailures: [],
      actionsExecuted: [],
      canTrade: true,
      canOpenNew: true,
      sizeMultiplier: 1.0,
      lastEscalation: 0,
    };

    this.rules = new Map();
    this.recoveryStates = new Map();
    this.operatorOverrides = [];
    this.isManualLockdown = false;
    this.failureEventLog = [];

    this.initializeRules();
    this.initializeHistoricalFailures();
  }

  // =========================================================================
  // Initialization
  // =========================================================================

  private initializeRules(): void {
    const rules: FailsafeRule[] = [
      {
        id: 'broker_disc_immediate',
        trigger: 'broker_disconnect',
        condition: 'broker.connected === false',
        action: 'halt_new_orders',
        priority: 1,
        cooldownMs: 5000,
        lastTriggered: 0,
        triggerCount: 0,
        enabled: true,
      },
      {
        id: 'broker_disc_30s',
        trigger: 'broker_disconnect',
        condition: 'duration > 30000',
        action: 'cancel_pending',
        priority: 2,
        cooldownMs: 10000,
        lastTriggered: 0,
        triggerCount: 0,
        enabled: true,
      },
      {
        id: 'broker_disc_60s',
        trigger: 'broker_disconnect',
        condition: 'duration > 60000',
        action: 'flatten_all',
        priority: 3,
        cooldownMs: 30000,
        lastTriggered: 0,
        triggerCount: 0,
        enabled: true,
      },
      {
        id: 'db_unavailable',
        trigger: 'db_unavailable',
        condition: 'db.health.status !== "healthy"',
        action: 'switch_paper',
        priority: 2,
        cooldownMs: 10000,
        lastTriggered: 0,
        triggerCount: 0,
        enabled: true,
      },
      {
        id: 'feed_stale_15s',
        trigger: 'feed_stale',
        condition: 'staleDuration > 15000',
        action: 'halt_new_orders',
        priority: 1,
        cooldownMs: 5000,
        lastTriggered: 0,
        triggerCount: 0,
        enabled: true,
      },
      {
        id: 'high_latency_500ms',
        trigger: 'high_latency',
        condition: 'latency > 500',
        action: 'reduce_size',
        priority: 1,
        cooldownMs: 5000,
        lastTriggered: 0,
        triggerCount: 0,
        enabled: true,
      },
      {
        id: 'memory_critical',
        trigger: 'memory_pressure',
        condition: 'memoryUsagePercent > 90',
        action: 'graceful_shutdown',
        priority: 4,
        cooldownMs: 60000,
        lastTriggered: 0,
        triggerCount: 0,
        enabled: true,
      },
      {
        id: 'clock_skew_5s',
        trigger: 'clock_skew',
        condition: 'skewMs > 5000',
        action: 'halt_new_orders',
        priority: 2,
        cooldownMs: 15000,
        lastTriggered: 0,
        triggerCount: 0,
        enabled: true,
      },
      {
        id: 'api_timeout_consecutive',
        trigger: 'api_timeout',
        condition: 'consecutiveTimeouts >= 3',
        action: 'switch_paper',
        priority: 2,
        cooldownMs: 20000,
        lastTriggered: 0,
        triggerCount: 0,
        enabled: true,
      },
      {
        id: 'partial_system_degraded',
        trigger: 'partial_system',
        condition: 'criticalModuleDown === true',
        action: 'reduce_size',
        priority: 2,
        cooldownMs: 10000,
        lastTriggered: 0,
        triggerCount: 0,
        enabled: true,
      },
      {
        id: 'unknown_error_cautious',
        trigger: 'unknown',
        condition: 'error.stack !== ""',
        action: 'log_only',
        priority: 0,
        cooldownMs: 5000,
        lastTriggered: 0,
        triggerCount: 0,
        enabled: true,
      },
      {
        id: 'unknown_error_reduce',
        trigger: 'unknown',
        condition: 'error.severity === "high"',
        action: 'reduce_size',
        priority: 1,
        cooldownMs: 10000,
        lastTriggered: 0,
        triggerCount: 0,
        enabled: true,
      },
    ];

    rules.forEach(rule => {
      this.rules.set(rule.id, rule);
    });
  }

  private initializeHistoricalFailures(): void {
    const now = Date.now();
    const historicalFailures: Array<{ mode: FailureMode; timestamp: number }> = [
      { mode: 'high_latency', timestamp: now - 3600000 },
      { mode: 'feed_stale', timestamp: now - 1800000 },
      { mode: 'broker_disconnect', timestamp: now - 900000 },
      { mode: 'api_timeout', timestamp: now - 300000 },
      { mode: 'clock_skew', timestamp: now - 60000 },
    ];

    this.failureEventLog = historicalFailures;
  }

  // =========================================================================
  // Public API: Failure Detection & Escalation
  // =========================================================================

  public triggerFailureMode(
    mode: FailureMode,
    details: Record<string, unknown> = {}
  ): void {
    const now = Date.now();
    this.failureEventLog.push({ mode, timestamp: now });

    // Check if failure already exists
    let existingFailure = this.state.activeFailures.find(f => f.mode === mode);

    if (!existingFailure) {
      existingFailure = {
        mode,
        triggeredAt: now,
        escalationLevel: 1,
        details,
      };
      this.state.activeFailures.push(existingFailure);
      this.emit('failsafe:triggered', { mode, details, timestamp: now });
    } else {
      existingFailure.details = { ...existingFailure.details, ...details };
    }

    // Escalate based on duration
    this.escalateIfNeeded(existingFailure);

    // Execute applicable rules
    this.executeApplicableRules(mode, details);
  }

  private escalateIfNeeded(failure: ActiveFailure): void {
    const now = Date.now();
    const duration = now - failure.triggeredAt;

    let newLevel = failure.escalationLevel;

    if (duration > 300000) {
      newLevel = 4; // Level 4: 5min+
    } else if (duration > 120000) {
      newLevel = 3; // Level 3: 2-5min
    } else if (duration > 30000) {
      newLevel = 2; // Level 2: 30s-2min
    }

    if (newLevel > failure.escalationLevel) {
      failure.escalationLevel = newLevel;
      this.state.lastEscalation = now;
      this.applyEscalationActions(newLevel);
      this.emit('failsafe:escalated', {
        mode: failure.mode,
        newLevel,
        timestamp: now,
      });
    }
  }

  private applyEscalationActions(level: number): void {
    const now = Date.now();

    switch (level) {
      case 1:
        // Log + Dashboard alert (handled by event emitters)
        break;
      case 2:
        // Halt new orders + operator notification
        this.state.canOpenNew = false;
        this.emit('failsafe:level2', {
          action: 'halt_new_orders',
          timestamp: now
        });
        break;
      case 3:
        // Cancel pending + reduce exposure
        this.state.canOpenNew = false;
        this.state.sizeMultiplier = 0.5;
        this.emit('failsafe:level3', {
          action: 'cancel_pending + reduce_size',
          timestamp: now
        });
        break;
      case 4:
        // Emergency flatten + system lockdown
        this.state.mode = 'emergency';
        this.state.sizeMultiplier = 0;
        this.state.canOpenNew = false;
        this.state.canTrade = false;
        this.emit('failsafe:level4', {
          action: 'flatten_all + lockdown',
          timestamp: now
        });
        break;
    }
  }

  private executeApplicableRules(mode: FailureMode, details: Record<string, unknown>): void {
    const now = Date.now();

    this.rules.forEach(rule => {
      if (rule.trigger !== mode || !rule.enabled) return;

      const timeSinceLastTrigger = now - rule.lastTriggered;
      if (timeSinceLastTrigger < rule.cooldownMs) return;

      rule.lastTriggered = now;
      rule.triggerCount += 1;

      this.executeAction(rule.action, mode, rule.id, details);
    });
  }

  private executeAction(
    action: FailsafeAction,
    triggeredBy: FailureMode,
    ruleId: string,
    details: Record<string, unknown>
  ): void {
    const now = Date.now();
    const actionRecord: ExecutedAction = {
      action,
      triggeredBy,
      executedAt: now,
      ruleId,
      details,
    };

    this.state.actionsExecuted.push(actionRecord);

    switch (action) {
      case 'halt_new_orders':
        this.state.canOpenNew = false;
        break;
      case 'cancel_pending':
        // Emitted event will be handled by order manager
        this.emit('failsafe:cancelPending', { ruleId, timestamp: now });
        break;
      case 'flatten_all':
        this.state.mode = 'emergency';
        this.state.sizeMultiplier = 0;
        this.state.canTrade = false;
        this.emit('failsafe:flattenAll', { ruleId, timestamp: now });
        break;
      case 'switch_paper':
        this.state.mode = 'degraded';
        this.emit('failsafe:switchPaper', { ruleId, timestamp: now });
        break;
      case 'reduce_size':
        this.state.sizeMultiplier = Math.max(0.5, this.state.sizeMultiplier * 0.5);
        break;
      case 'alert_operator':
        this.emit('failsafe:alertOperator', { ruleId, timestamp: now, details });
        break;
      case 'log_only':
        // Logged via event emission
        break;
      case 'graceful_shutdown':
        this.state.mode = 'lockdown';
        this.state.canTrade = false;
        this.state.canOpenNew = false;
        this.emit('failsafe:gracefulShutdown', { ruleId, timestamp: now });
        break;
    }
  }

  // =========================================================================
  // Public API: Failure Resolution & Recovery
  // =========================================================================

  public resolveFailureMode(mode: FailureMode): void {
    const now = Date.now();
    const failure = this.state.activeFailures.find(f => f.mode === mode);

    if (!failure) return;

    failure.resolvedAt = now;
    this.state.activeFailures = this.state.activeFailures.filter(
      f => f !== failure
    );

    this.emit('failsafe:resolved', { mode, timestamp: now });

    // Initiate recovery if no other active failures
    if (this.state.activeFailures.length === 0) {
      this.initiateRecovery(mode);
    }
  }

  private initiateRecovery(mode: FailureMode): void {
    const now = Date.now();
    this.recoveryStates.set(mode, {
      currentLevel: 'emergency',
      startedAt: now,
      stabilityRequiredMs: 60000,
      lastFailureTime: now,
    });

    this.emit('recovery:progress', {
      mode,
      currentLevel: 'emergency',
      timestamp: now,
    });
  }

  public attemptRecovery(mode: FailureMode): boolean {
    const recovery = this.recoveryStates.get(mode);
    if (!recovery) return false;

    const now = Date.now();
    const timeInRecovery = now - recovery.startedAt;

    if (timeInRecovery < recovery.stabilityRequiredMs) {
      return false;
    }

    // Progress through recovery levels
    const levelProgression: RecoveryLevel[] = ['lockdown', 'emergency', 'degraded', 'normal'];
    const currentIndex = levelProgression.indexOf(recovery.currentLevel);

    if (currentIndex < levelProgression.length - 1) {
      recovery.currentLevel = levelProgression[currentIndex + 1];
      recovery.startedAt = now;

      this.applyRecoveryLevel(recovery.currentLevel);

      this.emit('recovery:progress', {
        mode,
        currentLevel: recovery.currentLevel,
        timestamp: now,
      });

      return true;
    }

    // Fully recovered
    this.recoveryStates.delete(mode);
    this.transitionToMode('normal');
    return true;
  }

  private applyRecoveryLevel(level: RecoveryLevel): void {
    switch (level) {
      case 'lockdown':
        this.state.mode = 'lockdown';
        this.state.canTrade = false;
        this.state.canOpenNew = false;
        this.state.sizeMultiplier = 0;
        break;
      case 'emergency':
        this.state.mode = 'emergency';
        this.state.canTrade = false;
        this.state.canOpenNew = false;
        this.state.sizeMultiplier = 0.25;
        break;
      case 'degraded':
        this.state.mode = 'degraded';
        this.state.canTrade = true;
        this.state.canOpenNew = false;
        this.state.sizeMultiplier = 0.5;
        break;
      case 'normal':
        this.state.mode = 'normal';
        this.state.canTrade = true;
        this.state.canOpenNew = true;
        this.state.sizeMultiplier = 1.0;
        break;
    }
  }

  public getRecoveryProgress(): Record<FailureMode, RecoveryState | null> {
    const progress: Record<string, RecoveryState | null> = {};
    const modes: FailureMode[] = [
      'broker_disconnect',
      'db_unavailable',
      'feed_stale',
      'high_latency',
      'memory_pressure',
      'clock_skew',
      'api_timeout',
      'partial_system',
      'unknown',
    ];

    modes.forEach(mode => {
      progress[mode] = this.recoveryStates.get(mode) || null;
    });

    return progress;
  }

  // =========================================================================
  // Public API: Operator Control
  // =========================================================================

  public operatorOverride(
    action: FailsafeAction | 'lockdown' | 'resume',
    reason: string,
    operatorId: string = 'unknown'
  ): void {
    const now = Date.now();
    const override: OperatorOverride = {
      id: this.generateId(),
      action,
      reason,
      operatorId,
      executedAt: now,
      priority: 10,
    };

    this.operatorOverrides.push(override);

    if (action === 'lockdown') {
      this.lockdownTrading(reason, operatorId);
    } else if (action === 'resume') {
      this.resumeTrading(reason, operatorId);
    } else {
      this.executeAction(action, 'unknown', `override_${override.id}`, {
        overrideId: override.id,
      });
    }

    this.emit('operator:override', override);
  }

  public lockdownTrading(reason: string, operatorId: string = 'unknown'): void {
    const now = Date.now();
    this.isManualLockdown = true;
    this.state.mode = 'lockdown';
    this.state.canTrade = false;
    this.state.canOpenNew = false;
    this.state.sizeMultiplier = 0;

    this.emit('mode:changed', {
      from: this.state.mode,
      to: 'lockdown',
      reason: `Manual lockdown: ${reason}`,
      operatorId,
      timestamp: now,
    });
  }

  public resumeTrading(reason: string, operatorId: string = 'unknown'): void {
    const now = Date.now();
    const wasManagedLockdown = this.isManualLockdown;
    this.isManualLockdown = false;

    if (this.state.activeFailures.length === 0) {
      this.transitionToMode('normal');
    } else {
      this.transitionToMode('degraded');
    }

    this.emit('mode:changed', {
      from: 'lockdown',
      to: this.state.mode,
      reason: `Manual resume: ${reason}`,
      operatorId,
      timestamp: now,
      wasManualLockdown: wasManagedLockdown,
    });
  }

  // =========================================================================
  // Public API: State Inspection
  // =========================================================================

  public getState(): FailsafeState {
    return { ...this.state };
  }

  public getMode(): FailsafeMode {
    return this.state.mode;
  }

  public canTrade(): boolean {
    return this.state.canTrade;
  }

  public canOpenNewOrders(): boolean {
    return this.state.canOpenNew;
  }

  public getSizeMultiplier(): number {
    return this.state.sizeMultiplier;
  }

  public getActiveFailures(): ActiveFailure[] {
    return [...this.state.activeFailures];
  }

  public hasActiveFailure(mode: FailureMode): boolean {
    return this.state.activeFailures.some(f => f.mode === mode);
  }

  public getExecutedActions(limit: number = 50): ExecutedAction[] {
    return this.state.actionsExecuted.slice(-limit);
  }

  public getRules(): FailsafeRule[] {
    return Array.from(this.rules.values());
  }

  public getRule(id: string): FailsafeRule | undefined {
    return this.rules.get(id);
  }

  public getOperatorOverrides(limit: number = 20): OperatorOverride[] {
    return this.operatorOverrides.slice(-limit);
  }

  public getFailureEventLog(limit: number = 100): Array<{ mode: FailureMode; timestamp: number }> {
    return this.failureEventLog.slice(-limit);
  }

  // =========================================================================
  // Public API: Rule Management
  // =========================================================================

  public enableRule(id: string): boolean {
    const rule = this.rules.get(id);
    if (!rule) return false;
    rule.enabled = true;
    return true;
  }

  public disableRule(id: string): boolean {
    const rule = this.rules.get(id);
    if (!rule) return false;
    rule.enabled = false;
    return true;
  }

  public resetRuleTriggerCount(id: string): boolean {
    const rule = this.rules.get(id);
    if (!rule) return false;
    rule.triggerCount = 0;
    rule.lastTriggered = 0;
    return true;
  }

  public updateRuleCooldown(id: string, cooldownMs: number): boolean {
    const rule = this.rules.get(id);
    if (!rule) return false;
    rule.cooldownMs = cooldownMs;
    return true;
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private transitionToMode(newMode: FailsafeMode): void {
    const now = Date.now();
    const oldMode = this.state.mode;

    this.applyRecoveryLevel(newMode);
    this.state.lastEscalation = now;

    this.emit('mode:changed', {
      from: oldMode,
      to: newMode,
      timestamp: now,
    });
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // =========================================================================
  // Diagnostic & Health Methods
  // =========================================================================

  public getHealthStatus(): {
    mode: FailsafeMode;
    isHealthy: boolean;
    activeFailureCount: number;
    canTrade: boolean;
    sizeMultiplier: number;
    lastEscalationMs: number;
  } {
    const now = Date.now();
    return {
      mode: this.state.mode,
      isHealthy: this.state.mode === 'normal' && this.state.activeFailures.length === 0,
      activeFailureCount: this.state.activeFailures.length,
      canTrade: this.state.canTrade,
      sizeMultiplier: this.state.sizeMultiplier,
      lastEscalationMs: now - this.state.lastEscalation,
    };
  }

  public getSummary(): Record<string, unknown> {
    return {
      mode: this.state.mode,
      isHealthy: this.state.mode === 'normal' && this.state.activeFailures.length === 0,
      canTrade: this.state.canTrade,
      canOpenNew: this.state.canOpenNew,
      sizeMultiplier: this.state.sizeMultiplier,
      activeFailures: this.state.activeFailures.map(f => ({
        mode: f.mode,
        duration: Date.now() - f.triggeredAt,
        level: f.escalationLevel,
      })),
      recentActions: this.state.actionsExecuted.slice(-5).map(a => ({
        action: a.action,
        ruleId: a.ruleId,
        secondsAgo: (Date.now() - a.executedAt) / 1000,
      })),
      recoveryInProgress: this.recoveryStates.size > 0,
      totalRules: this.rules.size,
      enabledRules: Array.from(this.rules.values()).filter(r => r.enabled).length,
    };
  }
}
