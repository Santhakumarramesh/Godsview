/**
 * compiler.ts — Phase 32 Natural Language Strategy Compiler
 *
 * Compiles natural language strategy prompts into DSL specification.
 * Uses pattern matching and keyword extraction for reliable parsing.
 *
 * Exports:
 *   - compile(prompt): Compile natural language to DSL
 *   - validateDSL(dsl): Validate DSL structure
 *   - generateExecutionPlan(dsl): Generate execution plan from DSL
 *   - getCompilationResult(resultId): Retrieve compilation result
 *   - getAllResults(): Get all compilation results
 *   - _clearResults(): Clear result store (testing)
 */

import { randomUUID } from "node:crypto";
import type {
  StrategyDSL,
  EntryCondition,
  ExitCondition,
  TimeFilter,
  VolatilityFilter,
  PositionSizing,
  DSLValidationResult,
} from "./dsl_types";

/**
 * Compilation stages
 */
export type CompilationStage =
  | "prompt_parse"
  | "semantic_normalization"
  | "dsl_generation"
  | "rule_validation"
  | "execution_plan_generation";

/**
 * Compilation error with context
 */
export interface CompilationError {
  stage: CompilationStage;
  code: string;
  message: string;
  suggestion?: string;
}

/**
 * Execution plan generated from DSL
 */
export interface ExecutionPlan {
  plan_id: string;
  strategy_id: string;
  entry_signals: Array<{
    indicator: string;
    action: string;
  }>;
  exit_triggers: Array<{
    type: string;
    condition: string;
  }>;
  risk_rules: Array<{
    rule: string;
    enforcement: string;
  }>;
  session_constraints: string[];
  position_limits: {
    min_size: number;
    max_size: number;
    max_pct: number;
  };
}

/**
 * Complete compilation result
 */
export interface CompilationResult {
  result_id: string;
  input_prompt: string;
  stages_completed: CompilationStage[];
  dsl: StrategyDSL | null;
  execution_plan: ExecutionPlan | null;
  errors: CompilationError[];
  warnings: Array<{
    stage: CompilationStage;
    message: string;
  }>;
  status: "success" | "partial" | "failed";
  compiled_at: number;
}

/**
 * Natural Language Strategy Compiler
 */
export class StrategyCompiler {
  private resultStore = new Map<string, CompilationResult>();

  /**
   * Compile natural language prompt into DSL
   */
  compile(prompt: string): CompilationResult {
    const result_id = `sc_${randomUUID()}`;
    const compiled_at = Date.now();
    const errors: CompilationError[] = [];
    const warnings: Array<{ stage: CompilationStage; message: string }> = [];
    const stages_completed: CompilationStage[] = [];

    let dsl: StrategyDSL | null = null;
    let execution_plan: ExecutionPlan | null = null;

    try {
      // Stage 1: Parse prompt
      stages_completed.push("prompt_parse");
      const parsed = this.parsePrompt(prompt);

      // Stage 2: Semantic normalization
      stages_completed.push("semantic_normalization");
      const normalized = this.normalizeSemantics(parsed);

      // Stage 3: DSL generation
      stages_completed.push("dsl_generation");
      dsl = this.generateDSL(normalized, prompt);

      // Stage 4: Validation
      stages_completed.push("rule_validation");
      const validation = this.validateDSL(dsl);
      if (!validation.valid) {
        for (const err of validation.errors) {
          errors.push({
            stage: "rule_validation",
            code: "VALIDATION_FAILED",
            message: err.message,
            suggestion: `Fix: ${err.field}`,
          });
        }
        for (const warn of validation.warnings) {
          warnings.push({
            stage: "rule_validation",
            message: warn.message,
          });
        }
      }

      // Stage 5: Execution plan generation
      if (dsl) {
        stages_completed.push("execution_plan_generation");
        execution_plan = this.generateExecutionPlan(dsl);
      }
    } catch (error: any) {
      errors.push({
        stage: stages_completed[stages_completed.length - 1] || "prompt_parse",
        code: "COMPILATION_ERROR",
        message: error.message || "Unknown compilation error",
        suggestion: "Check prompt format and required fields",
      });
    }

    const status =
      errors.length === 0 ? "success" : dsl ? "partial" : "failed";

    const compilationResult: CompilationResult = {
      result_id,
      input_prompt: prompt,
      stages_completed,
      dsl,
      execution_plan,
      errors,
      warnings,
      status,
      compiled_at,
    };

    this.resultStore.set(result_id, compilationResult);
    return compilationResult;
  }

  /**
   * Parse prompt into components
   */
  private parsePrompt(prompt: string): Record<string, any> {
    const lower = prompt.toLowerCase();
    const result: Record<string, any> = {
      raw_prompt: prompt,
      indicators: [],
      entry_signals: [],
      exit_signals: [],
      position_size: null,
      timeframe: "1h",
      risk_level: "moderate",
    };

    // Extract timeframes (1m, 5m, 15m, 1h, 4h, daily)
    const timeframeMatch = prompt.match(
      /(\d+[mh]|daily|d|weekly|w)/i
    );
    if (timeframeMatch) {
      result.timeframe = this.normalizeTimeframe(timeframeMatch[1]);
    }

    // Extract entry signals
    if (
      /buy|long|go long|enter long|signal to buy/i.test(lower)
    ) {
      result.side = "long";
    } else if (/sell|short|go short|enter short/i.test(lower)) {
      result.side = "short";
    }

    // Extract RSI signals
    if (/rsi|relative strength/i.test(lower)) {
      result.indicators.push("rsi");
      if (/rsi\s*<\s*30|oversold|rsi.*30/i.test(lower)) {
        result.entry_signals.push({
          indicator: "rsi",
          condition: "rsi < 30",
        });
      } else if (/rsi\s*>\s*70|overbought|rsi.*70/i.test(lower)) {
        result.entry_signals.push({
          indicator: "rsi",
          condition: "rsi > 70",
        });
      }
    }

    // Extract moving average signals
    if (
      /ema|sma|moving average|ma|crosses|cross|crossover/i.test(
        lower
      )
    ) {
      result.indicators.push("moving_average");
      if (/crosses? above/i.test(lower)) {
        result.entry_signals.push({
          indicator: "ma",
          condition: "price crosses above MA",
        });
      } else if (/crosses? below/i.test(lower)) {
        result.entry_signals.push({
          indicator: "ma",
          condition: "price crosses below MA",
        });
      }
      if (/200.*ema|ema.*200|200.*sma/i.test(lower)) {
        result.ma_periods = "200";
      } else if (/50.*ema|ema.*50|50.*sma/i.test(lower)) {
        result.ma_periods = "50";
      } else if (/20.*ema|ema.*20|20.*sma/i.test(lower)) {
        result.ma_periods = "20";
      }
    }

    // Extract price-based signals
    if (/price\s+(above|below|>|<|above|crosses)/i.test(lower)) {
      result.indicators.push("price");
      const priceMatch = prompt.match(
        /price\s+(?:above|below|>|<|crosses)[^0-9]*(\d+(?:\.\d+)?)/i
      );
      if (priceMatch) {
        result.entry_signals.push({
          indicator: "price",
          value: parseFloat(priceMatch[1]),
        });
      }
    }

    // Extract MACD signals
    if (/macd|moving average convergence/i.test(lower)) {
      result.indicators.push("macd");
      if (/macd.*crosses? above|macd.*bullish/i.test(lower)) {
        result.entry_signals.push({
          indicator: "macd",
          condition: "MACD crosses above signal line",
        });
      }
    }

    // Extract Bollinger Band signals
    if (/bollinger|bb|bands/i.test(lower)) {
      result.indicators.push("bollinger_bands");
      if (/touches? lower|lower band|bb.*lower/i.test(lower)) {
        result.entry_signals.push({
          indicator: "bb",
          condition: "touches lower band",
        });
      }
    }

    // Extract stop loss
    const stopMatch = prompt.match(
      /stop[\s-]?loss[^0-9]*(\d+(?:\.\d+)?)\s*%?/i
    );
    if (stopMatch) {
      result.stop_loss = parseFloat(stopMatch[1]);
    }

    // Extract take profit
    const tpMatch = prompt.match(
      /take[\s-]?profit[^0-9]*(\d+(?:\.\d+)?)\s*%?|tp[^0-9]*(\d+(?:\.\d+)?)\s*%?/i
    );
    if (tpMatch) {
      result.take_profit = parseFloat(tpMatch[1] || tpMatch[2]);
    }

    // Extract position size
    const posMatch = prompt.match(
      /(?:position\s+size|risk)[^0-9]*(\d+(?:\.\d+)?)\s*%?|(\d+(?:\.\d+)?)\s*%\s+(?:of|per|each)/i
    );
    if (posMatch) {
      result.position_size = parseFloat(posMatch[1] || posMatch[2]);
    }

    // Extract trailing stop
    if (/trailing[\s-]?stop|trail/i.test(lower)) {
      const trailMatch = prompt.match(
        /trailing[\s-]?stop[^0-9]*(\d+(?:\.\d+)?)\s*%?/i
      );
      if (trailMatch) {
        result.trailing_stop = parseFloat(trailMatch[1]);
      } else {
        result.trailing_stop = 5; // default
      }
    }

    return result;
  }

  /**
   * Normalize semantic meanings
   */
  private normalizeSemantics(
    parsed: Record<string, any>
  ): Record<string, any> {
    const normalized = { ...parsed };

    // Normalize timeframe strings
    if (normalized.timeframe) {
      normalized.timeframe = this.normalizeTimeframe(
        normalized.timeframe
      );
    }

    // Infer entry direction if not explicit
    if (!normalized.side) {
      if (
        normalized.entry_signals.some((s: any) =>
          /oversold|lower|below|rsi.*30|bb.*lower/.test(
            JSON.stringify(s)
          )
        )
      ) {
        normalized.side = "long";
      } else if (
        normalized.entry_signals.some((s: any) =>
          /overbought|upper|above|rsi.*70/.test(
            JSON.stringify(s)
          )
        )
      ) {
        normalized.side = "short";
      }
    }

    // Default values
    if (!normalized.stop_loss) {
      normalized.stop_loss = 2; // 2% default
    }
    if (!normalized.position_size) {
      normalized.position_size = 1; // 1% default
    }

    return normalized;
  }

  /**
   * Generate DSL from parsed and normalized prompt
   */
  private generateDSL(
    normalized: Record<string, any>,
    originalPrompt: string
  ): StrategyDSL {
    const strategy_id = `strat_${randomUUID()}`;

    // Build entry conditions
    const entry_conditions: EntryCondition[] = [];

    for (const signal of normalized.entry_signals) {
      const id = `entry_${entry_conditions.length + 1}`;

      if (
        signal.indicator === "rsi" &&
        signal.condition === "rsi < 30"
      ) {
        entry_conditions.push({
          id,
          indicator: "rsi",
          comparator: "lt",
          value: 30,
          timeframe: normalized.timeframe || "1h",
          logic_operator: entry_conditions.length === 0 ? "and" : "or",
          description: "RSI oversold",
        });
      } else if (
        signal.indicator === "rsi" &&
        signal.condition === "rsi > 70"
      ) {
        entry_conditions.push({
          id,
          indicator: "rsi",
          comparator: "gt",
          value: 70,
          timeframe: normalized.timeframe || "1h",
          logic_operator: entry_conditions.length === 0 ? "and" : "or",
          description: "RSI overbought",
        });
      } else if (
        signal.indicator === "ma" &&
        signal.condition === "price crosses above MA"
      ) {
        const maPeriod = parseInt(normalized.ma_periods || "50");
        entry_conditions.push({
          id,
          indicator: "ema",
          comparator: "crosses_above",
          value: maPeriod,
          timeframe: normalized.timeframe || "1h",
          logic_operator: entry_conditions.length === 0 ? "and" : "or",
          description: `Price crosses above ${maPeriod} EMA`,
        });
      } else if (
        signal.indicator === "ma" &&
        signal.condition === "price crosses below MA"
      ) {
        const maPeriod = parseInt(normalized.ma_periods || "50");
        entry_conditions.push({
          id,
          indicator: "ema",
          comparator: "crosses_below",
          value: maPeriod,
          timeframe: normalized.timeframe || "1h",
          logic_operator: entry_conditions.length === 0 ? "and" : "or",
          description: `Price crosses below ${maPeriod} EMA`,
        });
      } else if (signal.indicator === "price" && signal.value) {
        entry_conditions.push({
          id,
          indicator: "price",
          comparator: normalized.side === "short" ? "lt" : "gt",
          value: signal.value,
          timeframe: normalized.timeframe || "1h",
          logic_operator: entry_conditions.length === 0 ? "and" : "or",
          description: `Price ${normalized.side === "short" ? "below" : "above"} ${signal.value}`,
        });
      } else if (
        signal.indicator === "macd" &&
        signal.condition === "MACD crosses above signal line"
      ) {
        entry_conditions.push({
          id,
          indicator: "macd",
          comparator: "crosses_above",
          value: 0,
          timeframe: normalized.timeframe || "1h",
          logic_operator: entry_conditions.length === 0 ? "and" : "or",
          description: "MACD crosses above signal line",
        });
      } else if (
        signal.indicator === "bb" &&
        signal.condition === "touches lower band"
      ) {
        entry_conditions.push({
          id,
          indicator: "bollinger_bands",
          comparator: "lt",
          value: 2,
          timeframe: normalized.timeframe || "1h",
          logic_operator: entry_conditions.length === 0 ? "and" : "or",
          description: "Price touches lower Bollinger Band",
        });
      }
    }

    // Fallback: if no entry conditions parsed, create a basic one
    if (entry_conditions.length === 0) {
      entry_conditions.push({
        id: "entry_1",
        indicator: "rsi",
        comparator: "lt",
        value: 30,
        timeframe: normalized.timeframe || "1h",
        logic_operator: "and",
        description: "Default: RSI oversold",
      });
    }

    // Build exit conditions
    const exit_conditions: ExitCondition[] = [];

    // Stop loss
    exit_conditions.push({
      id: "exit_sl",
      type: "stop_loss",
      value: normalized.stop_loss || 2,
      unit: "percent",
      description: `Stop loss at ${normalized.stop_loss || 2}%`,
    });

    // Take profit
    if (normalized.take_profit) {
      exit_conditions.push({
        id: "exit_tp",
        type: "take_profit",
        value: normalized.take_profit,
        unit: "percent",
        description: `Take profit at ${normalized.take_profit}%`,
      });
    }

    // Trailing stop
    if (normalized.trailing_stop) {
      exit_conditions.push({
        id: "exit_trail",
        type: "trailing_stop",
        value: normalized.trailing_stop,
        unit: "percent",
        trail_value: normalized.trailing_stop,
        description: `Trailing stop at ${normalized.trailing_stop}%`,
      });
    }

    // Build time filters
    const time_filters: TimeFilter[] = [
      {
        session: "regular",
        days_of_week: [1, 2, 3, 4, 5], // Mon-Fri
      },
    ];

    // Build position sizing
    const position_sizing: PositionSizing = {
      type: "percent_equity",
      value: normalized.position_size || 1,
      max_position_pct: Math.min(normalized.position_size || 1, 5),
      min_position: 100,
    };

    const dsl: StrategyDSL = {
      strategy_id,
      name: `Strategy_${strategy_id.slice(-8)}`,
      version: "1.0.0",
      entry_conditions,
      exit_conditions,
      stop_loss: normalized.stop_loss || 2,
      take_profit: normalized.take_profit,
      time_filters,
      position_sizing,
      metadata: {
        source_prompt: originalPrompt,
        created_at: Date.now(),
        risk_level: "moderate",
        tags: normalized.indicators || [],
      },
    };

    return dsl;
  }

  /**
   * Validate DSL structure and rules
   */
  validateDSL(dsl: StrategyDSL): DSLValidationResult {
    const errors: Array<{ field: string; message: string }> = [];
    const warnings: Array<{ field: string; message: string }> = [];

    // Check required fields
    if (!dsl.strategy_id) {
      errors.push({
        field: "strategy_id",
        message: "strategy_id is required",
      });
    }
    if (!dsl.name || dsl.name.trim().length === 0) {
      errors.push({
        field: "name",
        message: "name is required",
      });
    }
    if (!dsl.version) {
      errors.push({
        field: "version",
        message: "version is required",
      });
    }

    // Check entry conditions
    if (!dsl.entry_conditions || dsl.entry_conditions.length === 0) {
      errors.push({
        field: "entry_conditions",
        message:
          "At least one entry condition is required",
      });
    }

    // Check exit conditions
    if (!dsl.exit_conditions || dsl.exit_conditions.length === 0) {
      errors.push({
        field: "exit_conditions",
        message: "At least one exit condition is required",
      });
    }

    // Check stop loss
    const hasStopLoss = dsl.exit_conditions?.some(
      (e) => e.type === "stop_loss"
    );
    if (!hasStopLoss) {
      errors.push({
        field: "exit_conditions",
        message: "Stop loss exit condition is required",
      });
    }

    // Check stop loss value reasonableness
    if (dsl.stop_loss < 0.5) {
      warnings.push({
        field: "stop_loss",
        message: "Stop loss < 0.5% may be too tight",
      });
    }
    if (dsl.stop_loss > 20) {
      warnings.push({
        field: "stop_loss",
        message: "Stop loss > 20% may be too loose",
      });
    }

    // Check position sizing
    if (!dsl.position_sizing) {
      errors.push({
        field: "position_sizing",
        message: "position_sizing is required",
      });
    } else {
      if (dsl.position_sizing.value < 0.1) {
        warnings.push({
          field: "position_sizing",
          message: "Position size < 0.1% is very small",
        });
      }
      if (dsl.position_sizing.value > 10) {
        warnings.push({
          field: "position_sizing",
          message: "Position size > 10% per trade is aggressive",
        });
      }
      if (dsl.position_sizing.max_position_pct > 50) {
        warnings.push({
          field: "position_sizing.max_position_pct",
          message:
            "Max position > 50% of account is high concentration risk",
        });
      }
    }

    // Check time filters
    if (!dsl.time_filters || dsl.time_filters.length === 0) {
      warnings.push({
        field: "time_filters",
        message:
          "No time filters specified; will trade all sessions",
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Generate execution plan from validated DSL
   */
  generateExecutionPlan(dsl: StrategyDSL): ExecutionPlan {
    const plan_id = `ep_${randomUUID()}`;

    const entry_signals = dsl.entry_conditions.map((c) => ({
      indicator: c.indicator,
      action: c.description || `${c.indicator} ${c.comparator} ${c.value}`,
    }));

    const exit_triggers = dsl.exit_conditions.map((c) => ({
      type: c.type,
      condition: c.description || `${c.type} at ${c.value} ${c.unit}`,
    }));

    const risk_rules: Array<{ rule: string; enforcement: string }> = [];
    if (dsl.stop_loss) {
      risk_rules.push({
        rule: `Hard stop loss at ${dsl.stop_loss}%`,
        enforcement: "Mandatory on all positions",
      });
    }
    if (dsl.take_profit) {
      risk_rules.push({
        rule: `Take profit target at ${dsl.take_profit}%`,
        enforcement: "Recommended exit",
      });
    }

    const session_constraints = dsl.time_filters
      .map((tf) => {
        if (tf.session === "all") {
          return null;
        }
        const days = tf.days_of_week
          .map(
            (d) =>
              ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
                d
              ]
          )
          .join(", ");
        return `Trade ${tf.session} session on ${days}`;
      })
      .filter((x): x is string => x !== null);

    return {
      plan_id,
      strategy_id: dsl.strategy_id,
      entry_signals,
      exit_triggers,
      risk_rules,
      session_constraints,
      position_limits: {
        min_size:
          dsl.position_sizing.min_position || 100,
        max_size: Infinity,
        max_pct:
          dsl.position_sizing.max_position_pct || 5,
      },
    };
  }

  /**
   * Get compilation result by ID
   */
  getCompilationResult(resultId: string): CompilationResult | null {
    return this.resultStore.get(resultId) || null;
  }

  /**
   * Get all compilation results
   */
  getAllResults(): CompilationResult[] {
    return Array.from(this.resultStore.values());
  }

  /**
   * Clear all results (testing)
   */
  _clearResults(): void {
    this.resultStore.clear();
  }

  /**
   * Normalize timeframe string to standard format
   */
  private normalizeTimeframe(tf: string): string {
    const lower = tf.toLowerCase();
    if (lower.match(/^1m|^1$/)) return "1m";
    if (lower.match(/^5m/)) return "5m";
    if (lower.match(/^15m/)) return "15m";
    if (lower.match(/^30m/)) return "30m";
    if (lower.match(/^1h|^h$/)) return "1h";
    if (lower.match(/^4h/)) return "4h";
    if (lower.match(/^d|^daily|^1d/)) return "daily";
    if (lower.match(/^w|^weekly/)) return "weekly";
    return "1h"; // default
  }
}

export const strategyCompiler = new StrategyCompiler();
