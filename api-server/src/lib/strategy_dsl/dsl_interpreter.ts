import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type ConditionOperator =
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'eq'
  | 'neq'
  | 'crosses_above'
  | 'crosses_below';

export type LogicOperator = 'and' | 'or' | 'not';

export type TimeframeUnit =
  | '1m'
  | '5m'
  | '15m'
  | '1h'
  | '4h'
  | '1d'
  | '1w';

export type IndicatorType =
  | 'sma'
  | 'ema'
  | 'rsi'
  | 'macd'
  | 'bollinger'
  | 'atr'
  | 'vwap'
  | 'volume'
  | 'price';

export interface StrategyCondition {
  indicator: IndicatorType;
  params: Record<string, number>;
  operator: ConditionOperator;
  value: number | string;
  timeframe?: TimeframeUnit;
}

export interface ConditionGroup {
  logic: LogicOperator;
  conditions: (StrategyCondition | ConditionGroup)[];
}

export interface StrategyAction {
  type: 'buy' | 'sell' | 'close' | 'scale_in' | 'scale_out';
  symbol: string;
  quantity_pct: number;
  order_type: 'market' | 'limit' | 'stop' | 'stop_limit';
  limit_price?: number;
  stop_price?: number;
}

export interface RiskRule {
  type:
    | 'stop_loss'
    | 'take_profit'
    | 'trailing_stop'
    | 'max_position_size'
    | 'max_daily_loss'
    | 'max_drawdown';
  value: number;
  unit: 'percent' | 'dollars' | 'atr_multiple';
}

export interface StrategyFilter {
  type:
    | 'time_of_day'
    | 'day_of_week'
    | 'market_phase'
    | 'regime'
    | 'volume_min'
    | 'spread_max';
  params: Record<string, any>;
}

export interface StrategyParameter {
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface StrategyDSL {
  id: string;
  name: string;
  version: string;
  description: string;
  symbols: string[];
  timeframe: TimeframeUnit;
  entry_conditions: ConditionGroup;
  exit_conditions: ConditionGroup;
  actions: {
    entry: StrategyAction[];
    exit: StrategyAction[];
  };
  risk_rules: RiskRule[];
  filters: StrategyFilter[];
  parameters: Record<string, StrategyParameter>;
  metadata: {
    author: string;
    created_at: string;
    updated_at: string;
    tags: string[];
  };
}

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface ParsedStrategy {
  id: string;
  dsl: StrategyDSL;
  validated: boolean;
  validation: ValidationResult;
  compiled_at: string;
  hash: string;
}

// ============================================================================
// DSL INTERPRETER CLASS
// ============================================================================

class DslInterpreter {
  private strategies: Map<string, ParsedStrategy> = new Map();
  private templates: Map<string, StrategyDSL> = new Map();

  /**
   * Parse and validate a strategy DSL definition
   */
  parseStrategy(dsl: StrategyDSL): ParsedStrategy {
    // Assign ID if not present
    if (!dsl.id) {
      dsl.id = `dsl_${randomUUID()}`;
    }

    // Validate the strategy
    const validation = this.validateStrategy(dsl);

    // Compute hash
    const hash = this.computeHash(dsl);

    // Update metadata timestamps
    const now = new Date().toISOString();
    dsl.metadata.updated_at = now;
    if (!dsl.metadata.created_at) {
      dsl.metadata.created_at = now;
    }

    // Create parsed strategy
    const parsed: ParsedStrategy = {
      id: dsl.id,
      dsl,
      validated: validation.valid,
      validation,
      compiled_at: now,
      hash,
    };

    // Store in map
    this.strategies.set(dsl.id, parsed);

    return parsed;
  }

  /**
   * Validate a strategy DSL without storing
   */
  validateStrategy(dsl: StrategyDSL): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Check name not empty
    if (!dsl.name || dsl.name.trim() === '') {
      errors.push({
        field: 'name',
        message: 'Strategy name cannot be empty',
        severity: 'error',
      });
    }

    // Check symbols not empty
    if (!dsl.symbols || dsl.symbols.length === 0) {
      errors.push({
        field: 'symbols',
        message: 'At least one symbol must be specified',
        severity: 'error',
      });
    }

    // Check at least one entry condition
    if (
      !dsl.entry_conditions ||
      !this.hasConditions(dsl.entry_conditions)
    ) {
      errors.push({
        field: 'entry_conditions',
        message: 'At least one entry condition must be defined',
        severity: 'error',
      });
    }

    // Check at least one exit condition
    if (!dsl.exit_conditions || !this.hasConditions(dsl.exit_conditions)) {
      errors.push({
        field: 'exit_conditions',
        message: 'At least one exit condition must be defined',
        severity: 'error',
      });
    }

    // Check at least one entry action
    if (!dsl.actions.entry || dsl.actions.entry.length === 0) {
      errors.push({
        field: 'actions.entry',
        message: 'At least one entry action must be defined',
        severity: 'error',
      });
    }

    // Check at least one exit action
    if (!dsl.actions.exit || dsl.actions.exit.length === 0) {
      errors.push({
        field: 'actions.exit',
        message: 'At least one exit action must be defined',
        severity: 'error',
      });
    }

    // Check risk rules has at least stop_loss
    const hasStopLoss = dsl.risk_rules.some(
      (rule) => rule.type === 'stop_loss'
    );
    if (!hasStopLoss) {
      warnings.push({
        field: 'risk_rules',
        message: 'No stop_loss risk rule defined',
        severity: 'warning',
      });
    }

    // Validate parameter ranges
    if (dsl.parameters) {
      Object.entries(dsl.parameters).forEach(([paramName, param]) => {
        if (param.min >= param.max) {
          errors.push({
            field: `parameters.${paramName}`,
            message: 'Parameter min must be less than max',
            severity: 'error',
          });
        }

        if (param.step <= 0) {
          errors.push({
            field: `parameters.${paramName}`,
            message: 'Parameter step must be greater than 0',
            severity: 'error',
          });
        }

        if (param.default < param.min || param.default > param.max) {
          errors.push({
            field: `parameters.${paramName}`,
            message: 'Parameter default must be within min and max range',
            severity: 'error',
          });
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get a strategy by ID
   */
  getStrategy(id: string): ParsedStrategy | null {
    return this.strategies.get(id) || null;
  }

  /**
   * Get all strategies sorted by compiled_at descending
   */
  getAllStrategies(limit?: number): ParsedStrategy[] {
    const strategies = Array.from(this.strategies.values()).sort(
      (a, b) =>
        new Date(b.compiled_at).getTime() - new Date(a.compiled_at).getTime()
    );

    if (limit && limit > 0) {
      return strategies.slice(0, limit);
    }

    return strategies;
  }

  /**
   * Update a strategy by ID
   */
  updateStrategy(
    id: string,
    updates: Partial<StrategyDSL>
  ): ParsedStrategy | null {
    const existing = this.strategies.get(id);
    if (!existing) {
      return null;
    }

    // Merge updates
    const updated = { ...existing.dsl, ...updates };

    // Re-validate
    const validation = this.validateStrategy(updated);

    // Re-hash
    const hash = this.computeHash(updated);

    // Update metadata
    updated.metadata.updated_at = new Date().toISOString();

    // Create new parsed strategy
    const parsed: ParsedStrategy = {
      id,
      dsl: updated,
      validated: validation.valid,
      validation,
      compiled_at: new Date().toISOString(),
      hash,
    };

    // Update map
    this.strategies.set(id, parsed);

    return parsed;
  }

  /**
   * Delete a strategy by ID
   */
  deleteStrategy(id: string): boolean {
    return this.strategies.delete(id);
  }

  /**
   * Clone a strategy with a new name
   */
  cloneStrategy(id: string, new_name: string): ParsedStrategy | null {
    const existing = this.strategies.get(id);
    if (!existing) {
      return null;
    }

    // Deep clone the DSL
    const cloned: StrategyDSL = JSON.parse(JSON.stringify(existing.dsl));

    // Update identification
    cloned.id = `dsl_${randomUUID()}`;
    cloned.name = new_name;
    cloned.version = '1.0.0';
    cloned.metadata.created_at = new Date().toISOString();
    cloned.metadata.updated_at = new Date().toISOString();

    // Parse and store as new strategy
    return this.parseStrategy(cloned);
  }

  /**
   * Register a template
   */
  registerTemplate(name: string, dsl: StrategyDSL): void {
    // Assign template ID if not present
    if (!dsl.id) {
      dsl.id = `tmpl_${randomUUID()}`;
    }
    this.templates.set(name, dsl);
  }

  /**
   * Get a template by name
   */
  getTemplate(name: string): StrategyDSL | null {
    return this.templates.get(name) || null;
  }

  /**
   * Get all templates
   */
  getAllTemplates(): Array<{ name: string; dsl: StrategyDSL }> {
    const result: Array<{ name: string; dsl: StrategyDSL }> = [];
    this.templates.forEach((dsl, name) => {
      result.push({ name, dsl });
    });
    return result;
  }

  /**
   * Instantiate a template with overrides
   */
  instantiateTemplate(
    template_name: string,
    overrides: Partial<StrategyDSL>
  ): ParsedStrategy | null {
    const template = this.getTemplate(template_name);
    if (!template) {
      return null;
    }

    // Deep clone template
    const instance: StrategyDSL = JSON.parse(JSON.stringify(template));

    // Apply overrides
    Object.assign(instance, overrides);

    // Reset ID to create new strategy
    instance.id = `dsl_${randomUUID()}`;

    // Parse and store
    return this.parseStrategy(instance);
  }

  /**
   * Evaluate a single condition against market data
   */
  evaluateCondition(
    condition: StrategyCondition,
    market_data: Record<string, number>
  ): boolean {
    const value = market_data[condition.indicator];

    if (value === undefined) {
      return false;
    }

    const target = condition.value as number;

    switch (condition.operator) {
      case 'gt':
        return value > target;
      case 'lt':
        return value < target;
      case 'gte':
        return value >= target;
      case 'lte':
        return value <= target;
      case 'eq':
        return value === target;
      case 'neq':
        return value !== target;
      case 'crosses_above':
        // Simplified: check if current > target and previous <= target
        // In real implementation, would need historical data
        return value > target;
      case 'crosses_below':
        // Simplified: check if current < target and previous >= target
        return value < target;
      default:
        return false;
    }
  }

  /**
   * Recursively evaluate a condition group against market data
   */
  evaluateConditionGroup(
    group: ConditionGroup,
    market_data: Record<string, number>
  ): boolean {
    const results = group.conditions.map((cond) => {
      if ('logic' in cond) {
        // It's a ConditionGroup
        return this.evaluateConditionGroup(cond, market_data);
      } else {
        // It's a StrategyCondition
        return this.evaluateCondition(cond, market_data);
      }
    });

    if (group.logic === 'and') {
      return results.every((r) => r);
    } else if (group.logic === 'or') {
      return results.some((r) => r);
    } else if (group.logic === 'not') {
      return !results[0];
    }

    return false;
  }

  /**
   * Extract all unique indicators used in a strategy
   */
  extractIndicators(dsl: StrategyDSL): string[] {
    const indicators = new Set<string>();

    const collectIndicators = (group: ConditionGroup) => {
      group.conditions.forEach((cond) => {
        if ('logic' in cond) {
          collectIndicators(cond);
        } else {
          indicators.add(cond.indicator);
        }
      });
    };

    collectIndicators(dsl.entry_conditions);
    collectIndicators(dsl.exit_conditions);

    return Array.from(indicators).sort();
  }

  /**
   * Extract all symbols referenced in a strategy
   */
  extractSymbols(dsl: StrategyDSL): string[] {
    const symbols = new Set<string>();

    // From strategy symbols
    dsl.symbols.forEach((s) => symbols.add(s));

    // From actions
    dsl.actions.entry.forEach((a) => symbols.add(a.symbol));
    dsl.actions.exit.forEach((a) => symbols.add(a.symbol));

    return Array.from(symbols).sort();
  }

  /**
   * Clear all stored strategies and templates
   */
  _clearDsl(): void {
    this.strategies.clear();
    this.templates.clear();
  }

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

  /**
   * Check if a condition group has any conditions
   */
  private hasConditions(group: ConditionGroup): boolean {
    if (!group || !group.conditions || group.conditions.length === 0) {
      return false;
    }

    for (const cond of group.conditions) {
      if ('logic' in cond) {
        // It's a nested group
        if (this.hasConditions(cond)) {
          return true;
        }
      } else {
        // It's a condition
        return true;
      }
    }

    return false;
  }

  /**
   * Compute SHA256 hash of a strategy
   */
  private computeHash(dsl: StrategyDSL): string {
    const json = JSON.stringify(dsl);
    return createHash('sha256').update(json).digest('hex');
  }
}

// ============================================================================
// SINGLETON INSTANCE AND DELEGATED EXPORTS
// ============================================================================

export const dslInterpreter = new DslInterpreter();

// Delegated functions that operate on the singleton
export const parseStrategy = (dsl: StrategyDSL): ParsedStrategy =>
  dslInterpreter.parseStrategy(dsl);

export const validateStrategy = (dsl: StrategyDSL): ValidationResult =>
  dslInterpreter.validateStrategy(dsl);

export const getStrategy = (id: string): ParsedStrategy | null =>
  dslInterpreter.getStrategy(id);

export const getAllStrategies = (limit?: number): ParsedStrategy[] =>
  dslInterpreter.getAllStrategies(limit);

export const updateStrategy = (
  id: string,
  updates: Partial<StrategyDSL>
): ParsedStrategy | null => dslInterpreter.updateStrategy(id, updates);

export const deleteStrategy = (id: string): boolean =>
  dslInterpreter.deleteStrategy(id);

export const cloneStrategy = (id: string, new_name: string): ParsedStrategy | null =>
  dslInterpreter.cloneStrategy(id, new_name);

export const registerTemplate = (name: string, dsl: StrategyDSL): void =>
  dslInterpreter.registerTemplate(name, dsl);

export const getTemplate = (name: string): StrategyDSL | null =>
  dslInterpreter.getTemplate(name);

export const getAllTemplates = (): Array<{ name: string; dsl: StrategyDSL }> =>
  dslInterpreter.getAllTemplates();

export const instantiateTemplate = (
  template_name: string,
  overrides: Partial<StrategyDSL>
): ParsedStrategy | null =>
  dslInterpreter.instantiateTemplate(template_name, overrides);

export const evaluateCondition = (
  condition: StrategyCondition,
  market_data: Record<string, number>
): boolean => dslInterpreter.evaluateCondition(condition, market_data);

export const evaluateConditionGroup = (
  group: ConditionGroup,
  market_data: Record<string, number>
): boolean => dslInterpreter.evaluateConditionGroup(group, market_data);

export const extractIndicators = (dsl: StrategyDSL): string[] =>
  dslInterpreter.extractIndicators(dsl);

export const extractSymbols = (dsl: StrategyDSL): string[] =>
  dslInterpreter.extractSymbols(dsl);

export const _clearDsl = (): void => dslInterpreter._clearDsl();
