import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

// Configuration types
export interface AlertEngineConfig {
  maxActiveAlerts?: number;
  deduplicationWindowMs?: number;
  escalationDelayMs?: number;
}

// Alert rule and condition types
export interface AlertCondition {
  field: string;
  operator:
    | 'gt'
    | 'lt'
    | 'eq'
    | 'neq'
    | 'gte'
    | 'lte'
    | 'crosses_above'
    | 'crosses_below'
    | 'pct_change_gt'
    | 'pct_change_lt';
  value: number;
  timeframeMs?: number;
}

export interface AlertAction {
  type:
    | 'notify'
    | 'execute_trade'
    | 'halt_trading'
    | 'adjust_risk'
    | 'log';
  params: Record<string, unknown>;
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  category:
    | 'price'
    | 'volume'
    | 'drawdown'
    | 'regime'
    | 'execution'
    | 'system'
    | 'sentiment'
    | 'custom';
  conditions: AlertCondition[];
  actions: AlertAction[];
  cooldownMs: number;
  createdAt: string;
  lastTriggered?: string;
  triggerCount: number;
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  category: string;
  status: 'active' | 'acknowledged' | 'resolved' | 'escalated' | 'expired';
  message: string;
  details: Record<string, unknown>;
  triggeredAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  escalatedAt?: string;
  resolvedBy?: string;
}

export interface AlertSummary {
  total: number;
  active: number;
  acknowledged: number;
  resolved: number;
  escalated: number;
  byPriority: Record<string, number>;
  byCategory: Record<string, number>;
  recentAlerts: Alert[];
  topRules: Array<{
    ruleId: string;
    name: string;
    triggerCount: number;
  }>;
}

export interface AlertEngineState {
  lastValues: Record<string, number>;
}

// Main AlertEngine class
export class AlertEngine extends EventEmitter {
  private config: Required<AlertEngineConfig>;
  private rules: Map<string, AlertRule>;
  private alerts: Map<string, Alert>;
  private state: AlertEngineState;
  private deduplicationCache: Map<string, number>;

  constructor(config: AlertEngineConfig = {}) {
    super();
    this.config = {
      maxActiveAlerts: config.maxActiveAlerts ?? 500,
      deduplicationWindowMs: config.deduplicationWindowMs ?? 300000,
      escalationDelayMs: config.escalationDelayMs ?? 600000,
    };
    this.rules = new Map();
    this.alerts = new Map();
    this.state = { lastValues: {} };
    this.deduplicationCache = new Map();
    this.initializeDefaultRules();
  }

  // Initialize with 8 default rules
  private initializeDefaultRules(): void {
    const defaultRules: Array<Omit<AlertRule, 'id' | 'createdAt' | 'triggerCount'>> = [
      {
        name: 'Drawdown > 5%',
        description: 'Alert when portfolio drawdown exceeds 5%',
        enabled: true,
        priority: 'P1',
        category: 'drawdown',
        conditions: [
          {
            field: 'drawdown_pct',
            operator: 'gt',
            value: 5,
          },
        ],
        actions: [
          {
            type: 'notify',
            params: { severity: 'high' },
          },
        ],
        cooldownMs: 60000,
      },
      {
        name: 'Drawdown > 10%',
        description: 'Alert when portfolio drawdown exceeds 10% and halt trading',
        enabled: true,
        priority: 'P1',
        category: 'drawdown',
        conditions: [
          {
            field: 'drawdown_pct',
            operator: 'gt',
            value: 10,
          },
        ],
        actions: [
          {
            type: 'notify',
            params: { severity: 'critical' },
          },
          {
            type: 'halt_trading',
            params: {},
          },
        ],
        cooldownMs: 120000,
      },
      {
        name: 'Win Rate Drop Below 40%',
        description: 'Alert when win rate drops below 40% over 50 trades',
        enabled: true,
        priority: 'P2',
        category: 'execution',
        conditions: [
          {
            field: 'win_rate_pct',
            operator: 'lt',
            value: 40,
            timeframeMs: 300000,
          },
        ],
        actions: [
          {
            type: 'notify',
            params: { severity: 'medium' },
          },
          {
            type: 'adjust_risk',
            params: { reduction: 0.2 },
          },
        ],
        cooldownMs: 600000,
      },
      {
        name: 'Volume Spike > 3x Average',
        description: 'Alert when volume spikes exceed 3x average',
        enabled: true,
        priority: 'P3',
        category: 'volume',
        conditions: [
          {
            field: 'volume_ratio',
            operator: 'gt',
            value: 3,
          },
        ],
        actions: [
          {
            type: 'notify',
            params: { severity: 'low' },
          },
          {
            type: 'log',
            params: { message: 'Unusual volume detected' },
          },
        ],
        cooldownMs: 300000,
      },
      {
        name: 'Regime Change Detected',
        description: 'Alert when market regime change is detected',
        enabled: true,
        priority: 'P3',
        category: 'regime',
        conditions: [
          {
            field: 'regime_score',
            operator: 'crosses_above',
            value: 0.7,
          },
        ],
        actions: [
          {
            type: 'notify',
            params: { severity: 'medium' },
          },
          {
            type: 'log',
            params: { message: 'Regime change event' },
          },
        ],
        cooldownMs: 600000,
      },
      {
        name: 'Sentiment Extreme',
        description: 'Alert when sentiment score reaches extreme values (|score| > 0.8)',
        enabled: true,
        priority: 'P2',
        category: 'sentiment',
        conditions: [
          {
            field: 'sentiment_score_abs',
            operator: 'gt',
            value: 0.8,
          },
        ],
        actions: [
          {
            type: 'notify',
            params: { severity: 'high' },
          },
        ],
        cooldownMs: 300000,
      },
      {
        name: 'Fill Rate Below 90%',
        description: 'Alert when order fill rate drops below 90%',
        enabled: true,
        priority: 'P2',
        category: 'execution',
        conditions: [
          {
            field: 'fill_rate_pct',
            operator: 'lt',
            value: 90,
          },
        ],
        actions: [
          {
            type: 'notify',
            params: { severity: 'medium' },
          },
          {
            type: 'log',
            params: { message: 'Fill rate degradation' },
          },
        ],
        cooldownMs: 300000,
      },
      {
        name: 'System Latency > 500ms',
        description: 'Alert when system latency exceeds 500ms',
        enabled: true,
        priority: 'P3',
        category: 'system',
        conditions: [
          {
            field: 'latency_ms',
            operator: 'gt',
            value: 500,
          },
        ],
        actions: [
          {
            type: 'notify',
            params: { severity: 'medium' },
          },
          {
            type: 'log',
            params: { message: 'High system latency detected' },
          },
        ],
        cooldownMs: 60000,
      },
    ];

    for (const rule of defaultRules) {
      this.addRule(rule);
    }
  }

  /**
   * Add a new alert rule
   */
  addRule(rule: Omit<AlertRule, 'id' | 'createdAt' | 'triggerCount'>): AlertRule {
    const id = randomUUID();
    const fullRule: AlertRule = {
      ...rule,
      id,
      createdAt: new Date().toISOString(),
      triggerCount: 0,
    };
    this.rules.set(id, fullRule);
    return fullRule;
  }

  /**
   * Update an existing rule
   */
  updateRule(
    id: string,
    updates: Partial<AlertRule>
  ): AlertRule | undefined {
    const rule = this.rules.get(id);
    if (!rule) return undefined;

    const updated: AlertRule = {
      ...rule,
      ...updates,
      id: rule.id,
      createdAt: rule.createdAt,
    };
    this.rules.set(id, updated);
    return updated;
  }

  /**
   * Delete a rule
   */
  deleteRule(id: string): boolean {
    return this.rules.delete(id);
  }

  /**
   * Enable a rule
   */
  enableRule(id: string): void {
    const rule = this.rules.get(id);
    if (rule) {
      rule.enabled = true;
    }
  }

  /**
   * Disable a rule
   */
  disableRule(id: string): void {
    const rule = this.rules.get(id);
    if (rule) {
      rule.enabled = false;
    }
  }

  /**
   * Get all rules
   */
  getRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Evaluate all rules against data snapshot
   */
  evaluate(data: Record<string, number>): Alert[] {
    const triggeredAlerts: Alert[] = [];
    const now = Date.now();

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      // Check if rule is in cooldown
      if (
        rule.lastTriggered &&
        now - new Date(rule.lastTriggered).getTime() < rule.cooldownMs
      ) {
        continue;
      }

      // Evaluate all conditions
      const allConditionsMet = rule.conditions.every((condition) =>
        this.evaluateCondition(condition, data)
      );

      if (allConditionsMet) {
        // Check deduplication cache
        const dedupeKey = `${rule.id}`;
        const lastDedupeTime = this.deduplicationCache.get(dedupeKey) || 0;
        if (now - lastDedupeTime < this.config.deduplicationWindowMs) {
          continue;
        }

        // Create alert
        const alert: Alert = {
          id: randomUUID(),
          ruleId: rule.id,
          ruleName: rule.name,
          priority: rule.priority,
          category: rule.category,
          status: 'active',
          message: `${rule.name}: ${rule.description}`,
          details: {
            data,
            conditions: rule.conditions,
          },
          triggeredAt: new Date().toISOString(),
        };

        // Update rule tracking
        rule.lastTriggered = alert.triggeredAt;
        rule.triggerCount++;

        // Add to cache and alerts
        this.deduplicationCache.set(dedupeKey, now);
        this.alerts.set(alert.id, alert);

        // Emit event
        this.emit('alert:triggered', alert);

        triggeredAlerts.push(alert);

        // Check for escalation
        this.checkEscalation(alert, rule);
      }
    }

    // Prune old alerts if needed
    if (this.alerts.size > this.config.maxActiveAlerts) {
      this.pruneAlerts();
    }

    return triggeredAlerts;
  }

  /**
   * Evaluate a single condition against data
   */
  private evaluateCondition(
    condition: AlertCondition,
    data: Record<string, number>
  ): boolean {
    const value = data[condition.field];
    if (value === undefined) return false;

    switch (condition.operator) {
      case 'gt':
        return value > condition.value;
      case 'lt':
        return value < condition.value;
      case 'eq':
        return value === condition.value;
      case 'neq':
        return value !== condition.value;
      case 'gte':
        return value >= condition.value;
      case 'lte':
        return value <= condition.value;
      case 'crosses_above': {
        const prevValue = this.state.lastValues[condition.field];
        return prevValue !== undefined && prevValue <= condition.value && value > condition.value;
      }
      case 'crosses_below': {
        const prevValue = this.state.lastValues[condition.field];
        return prevValue !== undefined && prevValue >= condition.value && value < condition.value;
      }
      case 'pct_change_gt': {
        const prevValue = this.state.lastValues[condition.field];
        if (prevValue === undefined || prevValue === 0) return false;
        const pctChange = ((value - prevValue) / Math.abs(prevValue)) * 100;
        return pctChange > condition.value;
      }
      case 'pct_change_lt': {
        const prevValue = this.state.lastValues[condition.field];
        if (prevValue === undefined || prevValue === 0) return false;
        const pctChange = ((value - prevValue) / Math.abs(prevValue)) * 100;
        return pctChange < condition.value;
      }
      default:
        return false;
    }
  }

  /**
   * Check if alert should be escalated
   */
  private checkEscalation(alert: Alert, rule: AlertRule): void {
    if (rule.priority === 'P1') {
      setTimeout(() => {
        const currentAlert = this.alerts.get(alert.id);
        if (
          currentAlert &&
          currentAlert.status === 'active' &&
          !currentAlert.acknowledgedAt
        ) {
          currentAlert.status = 'escalated';
          currentAlert.escalatedAt = new Date().toISOString();
          this.emit('alert:escalated', currentAlert);
        }
      }, this.config.escalationDelayMs);
    }
  }

  /**
   * Acknowledge an alert
   */
  acknowledge(alertId: string, by?: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.status = 'acknowledged';
    alert.acknowledgedAt = new Date().toISOString();
    this.emit('alert:acknowledged', alert);
    return true;
  }

  /**
   * Resolve an alert
   */
  resolve(alertId: string, by?: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.status = 'resolved';
    alert.resolvedAt = new Date().toISOString();
    alert.resolvedBy = by;
    this.emit('alert:resolved', alert);
    return true;
  }

  /**
   * Get alerts with optional filters
   */
  getAlerts(filters?: {
    status?: string;
    priority?: string;
    category?: string;
    limit?: number;
  }): Alert[] {
    let alerts = Array.from(this.alerts.values());

    if (filters?.status) {
      alerts = alerts.filter((a) => a.status === filters.status);
    }
    if (filters?.priority) {
      alerts = alerts.filter((a) => a.priority === filters.priority);
    }
    if (filters?.category) {
      alerts = alerts.filter((a) => a.category === filters.category);
    }

    alerts.sort(
      (a, b) =>
        new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime()
    );

    if (filters?.limit) {
      alerts = alerts.slice(0, filters.limit);
    }

    return alerts;
  }

  /**
   * Get summary of all alerts
   */
  getSummary(): AlertSummary {
    const alerts = Array.from(this.alerts.values());
    const byPriority: Record<string, number> = {
      P1: 0,
      P2: 0,
      P3: 0,
      P4: 0,
    };
    const byCategory: Record<string, number> = {};

    let active = 0;
    let acknowledged = 0;
    let resolved = 0;
    let escalated = 0;

    for (const alert of alerts) {
      byPriority[alert.priority]++;
      byCategory[alert.category] = (byCategory[alert.category] ?? 0) + 1;

      switch (alert.status) {
        case 'active':
          active++;
          break;
        case 'acknowledged':
          acknowledged++;
          break;
        case 'resolved':
          resolved++;
          break;
        case 'escalated':
          escalated++;
          break;
      }
    }

    // Get top rules by trigger count
    const topRules = Array.from(this.rules.values())
      .filter((r) => r.triggerCount > 0)
      .sort((a, b) => b.triggerCount - a.triggerCount)
      .slice(0, 10)
      .map((r) => ({
        ruleId: r.id,
        name: r.name,
        triggerCount: r.triggerCount,
      }));

    return {
      total: alerts.length,
      active,
      acknowledged,
      resolved,
      escalated,
      byPriority,
      byCategory,
      recentAlerts: alerts.slice(0, 20),
      topRules,
    };
  }

  /**
   * Clear all resolved alerts
   */
  clearResolved(): number {
    let cleared = 0;
    for (const [id, alert] of this.alerts.entries()) {
      if (alert.status === 'resolved') {
        this.alerts.delete(id);
        cleared++;
      }
    }
    return cleared;
  }

  /**
   * Update state with new data values for crossing detection
   */
  updateState(data: Record<string, number>): void {
    this.state.lastValues = { ...data };
  }

  /**
   * Prune old alerts to maintain max active alerts limit
   */
  private pruneAlerts(): void {
    const sorted = Array.from(this.alerts.values()).sort(
      (a, b) =>
        new Date(a.triggeredAt).getTime() - new Date(b.triggeredAt).getTime()
    );

    while (
      this.alerts.size > this.config.maxActiveAlerts &&
      sorted.length > 0
    ) {
      const alert = sorted.shift();
      if (alert) {
        this.alerts.delete(alert.id);
      }
    }
  }
}
