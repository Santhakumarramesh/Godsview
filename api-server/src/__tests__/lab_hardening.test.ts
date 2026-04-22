/**
 * lab_hardening.test.ts — Comprehensive tests for lab, walk-forward, and backtest hardening
 *
 * Tests input validation, persistence, config validation, and health checks
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  parsePrompt,
  validatePromptInput,
  validateCompiledStrategy,
  labHealthCheck,
  type ParsedStrategy,
  resetLab,
} from "../lib/godsview_lab.js";
import {
  validateWalkForwardParams,
  runWalkForward,
  getHistoricalWalkForward,
  resetWalkForwardStress,
} from "../lib/walk_forward_stress.js";
import {
  validateBacktestConfig,
  backtestHealthCheck,
  computeTradeChecksum,
  validateTradeSequenceIntegrity,
  enforceEquityCurveFloor,
  type TradeResult,
  type BacktestConfig,
} from "../lib/backtester.js";

// ─── GodsView Lab Tests ────────────────────────────────────────────────────────

describe("godsview_lab.ts — Input Validation", () => {
  beforeEach(() => resetLab());

  it("should reject empty string", () => {
    const result = validatePromptInput("");
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.error).toContain("empty");
  });

  it("should reject null/undefined", () => {
    const result = validatePromptInput(null as any);
    expect(result.valid).toBe(false);
  });

  it("should reject whitespace-only input", () => {
    const result = validatePromptInput("   \n\t  ");
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.error).toContain("empty");
  });

  it("should reject input exceeding 2000 characters", () => {
    const longInput = "a".repeat(2001);
    const result = validatePromptInput(longInput);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.error).toContain("2000");
  });

  it("should accept input at exactly 2000 characters", () => {
    const input = "Buy AAPL" + "a".repeat(1992);
    expect(input.length).toBe(2000);
    const result = validatePromptInput(input);
    expect(result.valid).toBe(true);
  });

  it("should reject injection pattern: import", () => {
    const result = validatePromptInput("Buy AAPL when import os");
    expect(result.valid).toBe(false);
  });

  it("should reject injection pattern: require", () => {
    const result = validatePromptInput("Buy when require('child_process')");
    expect(result.valid).toBe(false);
  });

  it("should reject injection pattern: eval", () => {
    const result = validatePromptInput("Sell when eval('alert(1)')");
    expect(result.valid).toBe(false);
  });

  it("should reject injection pattern: script tag", () => {
    const result = validatePromptInput("Buy <script>alert('xss')</script>");
    expect(result.valid).toBe(false);
  });

  it("should reject injection pattern: onclick", () => {
    const result = validatePromptInput("Buy when onclick=alert('xss')");
    expect(result.valid).toBe(false);
  });

  it("should accept valid prompt", () => {
    const result = validatePromptInput("Buy AAPL when RSI < 30 and price above 200-day SMA, sell when RSI > 70, stop at 2 ATR");
    expect(result.valid).toBe(true);
  });
});

describe("godsview_lab.ts — Strategy Compilation & Validation", () => {
  beforeEach(() => resetLab());

  it("should reject strategy with no entry rules", () => {
    const strategy: ParsedStrategy = {
      name: "Invalid",
      symbols: ["AAPL"],
      entryRules: [],
      exitRules: [{ action: "SELL", conditions: [{ indicator: "RSI", operator: ">", value: 70 }], logic: "AND" }],
      stopRule: { type: "ATR", value: 2 },
      riskPct: 0.02,
      timeframe: "1D",
      confidence: 0.5,
      rawPrompt: "test",
      parsedAt: new Date().toISOString(),
    };
    const result = validateCompiledStrategy(strategy);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "entryRules")).toBe(true);
  });

  it("should reject strategy with no exit rules", () => {
    const strategy: ParsedStrategy = {
      name: "Invalid",
      symbols: ["AAPL"],
      entryRules: [{ action: "BUY", conditions: [{ indicator: "RSI", operator: "<", value: 30 }], logic: "AND" }],
      exitRules: [],
      stopRule: { type: "ATR", value: 2 },
      riskPct: 0.02,
      timeframe: "1D",
      confidence: 0.5,
      rawPrompt: "test",
      parsedAt: new Date().toISOString(),
    };
    const result = validateCompiledStrategy(strategy);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "exitRules")).toBe(true);
  });

  it("should reject strategy with no stop loss", () => {
    const strategy: ParsedStrategy = {
      name: "Invalid",
      symbols: ["AAPL"],
      entryRules: [{ action: "BUY", conditions: [{ indicator: "RSI", operator: "<", value: 30 }], logic: "AND" }],
      exitRules: [{ action: "SELL", conditions: [{ indicator: "RSI", operator: ">", value: 70 }], logic: "AND" }],
      stopRule: null,
      riskPct: 0.02,
      timeframe: "1D",
      confidence: 0.5,
      rawPrompt: "test",
      parsedAt: new Date().toISOString(),
    };
    const result = validateCompiledStrategy(strategy);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "stopRule")).toBe(true);
  });

  it("should reject strategy with invalid risk percentage (0%)", () => {
    const strategy: ParsedStrategy = {
      name: "Invalid",
      symbols: ["AAPL"],
      entryRules: [{ action: "BUY", conditions: [{ indicator: "RSI", operator: "<", value: 30 }], logic: "AND" }],
      exitRules: [{ action: "SELL", conditions: [{ indicator: "RSI", operator: ">", value: 70 }], logic: "AND" }],
      stopRule: { type: "ATR", value: 2 },
      riskPct: 0,
      timeframe: "1D",
      confidence: 0.5,
      rawPrompt: "test",
      parsedAt: new Date().toISOString(),
    };
    const result = validateCompiledStrategy(strategy);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "riskPct")).toBe(true);
  });

  it("should reject strategy with invalid risk percentage (>50%)", () => {
    const strategy: ParsedStrategy = {
      name: "Invalid",
      symbols: ["AAPL"],
      entryRules: [{ action: "BUY", conditions: [{ indicator: "RSI", operator: "<", value: 30 }], logic: "AND" }],
      exitRules: [{ action: "SELL", conditions: [{ indicator: "RSI", operator: ">", value: 70 }], logic: "AND" }],
      stopRule: { type: "ATR", value: 2 },
      riskPct: 0.51,
      timeframe: "1D",
      confidence: 0.5,
      rawPrompt: "test",
      parsedAt: new Date().toISOString(),
    };
    const result = validateCompiledStrategy(strategy);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "riskPct")).toBe(true);
  });

  it("should accept valid strategy", () => {
    const strategy: ParsedStrategy = {
      name: "Valid",
      symbols: ["AAPL"],
      entryRules: [{ action: "BUY", conditions: [{ indicator: "RSI", operator: "<", value: 30 }], logic: "AND" }],
      exitRules: [{ action: "SELL", conditions: [{ indicator: "RSI", operator: ">", value: 70 }], logic: "AND" }],
      stopRule: { type: "ATR", value: 2 },
      riskPct: 0.02,
      timeframe: "1D",
      confidence: 0.5,
      rawPrompt: "test",
      parsedAt: new Date().toISOString(),
    };
    const result = validateCompiledStrategy(strategy);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("should parse valid prompt without validation errors", () => {
    const result = parsePrompt("Buy AAPL when RSI < 30 and price above 200-day SMA, sell when RSI > 70, stop at 2 ATR, risk 2%");
    expect(result).toBeDefined();
    expect(result.symbols).toContain("AAPL");
  });

  it("should throw error when parsing invalid prompt", () => {
    expect(() => parsePrompt("")).toThrow();
  });
});

describe("godsview_lab.ts — Lab Health Check", () => {
  beforeEach(() => resetLab());

  it("should report healthy lab when empty", () => {
    const health = labHealthCheck();
    expect(health.healthy).toBe(true);
    expect(health.totalPromptsParsed).toBe(0);
    expect(health.totalStrategiesCompiled).toBe(0);
    expect(health.recentParsedCapacity).toBe(0);
  });

  it("should track capacity after parsing", () => {
    parsePrompt("Buy AAPL when RSI < 30, sell when RSI > 70, stop at 2 ATR, risk 1%");
    const health = labHealthCheck();
    expect(health.totalPromptsParsed).toBeGreaterThan(0);
  });

  it("should report memory metrics", () => {
    const health = labHealthCheck();
    expect(health.maxRecentCapacity).toBe(30);
  });
});

// ─── Walk-Forward Tests ────────────────────────────────────────────────────────

describe("walk_forward_stress.ts — Parameter Validation", () => {
  it("should reject windows < 2", () => {
    const result = validateWalkForwardParams({ windows: 1 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "windows" || e.field === "minWindows")).toBe(true);
  });

  it("should accept windows >= 2", () => {
    const result = validateWalkForwardParams({ windows: 2 });
    expect(result.valid).toBe(true);
  });

  it("should reject trainRatio < 0.5", () => {
    const result = validateWalkForwardParams({ trainRatio: 0.4 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "trainRatio")).toBe(true);
  });

  it("should reject trainRatio > 0.9", () => {
    const result = validateWalkForwardParams({ trainRatio: 0.95 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "trainRatio")).toBe(true);
  });

  it("should accept trainRatio between 0.5 and 0.9", () => {
    const result = validateWalkForwardParams({ trainRatio: 0.7 });
    expect(result.valid).toBe(true);
  });

  it("should validate windows against minWindows", () => {
    const result = validateWalkForwardParams({ windows: 1, minWindows: 5 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "windows")).toBe(true);
  });
});

describe("walk_forward_stress.ts — Walk-Forward Execution & Persistence", () => {
  beforeEach(() => resetWalkForwardStress());

  it("should throw on invalid parameters", () => {
    expect(() => {
      runWalkForward({ strategyId: "test_strategy", windows: 1 });
    }).toThrow();
  });

  it("should run walk-forward with valid parameters", () => {
    const result = runWalkForward({ strategyId: "test_strategy", windows: 3 });
    expect(result).toBeDefined();
    expect(result.totalWindows).toBe(3);
    expect(result.passedWindows).toBeGreaterThanOrEqual(0);
  });

  it("should persist walk-forward result", () => {
    const strategyId = "test_persist_" + Date.now();
    const result = runWalkForward({ strategyId, windows: 2 });

    // Retrieve from persistent store
    const retrieved = getHistoricalWalkForward(strategyId);
    expect(retrieved).not.toBeNull();
    if (retrieved) {
      expect(retrieved.strategyId).toBe(strategyId);
      expect(retrieved.totalWindows).toBe(2);
    }
  });

  it("should return null for non-existent strategy", () => {
    const retrieved = getHistoricalWalkForward("nonexistent_" + Math.random());
    expect(retrieved).toBeNull();
  });

  it("should produce consistent verdicts", () => {
    const result = runWalkForward({ strategyId: "test_verdict", windows: 6 });
    expect(["PASS", "MARGINAL", "FAIL"]).toContain(result.verdict);
  });
});

// ─── Backtester Tests ──────────────────────────────────────────────────────────

describe("backtester.ts — Config Validation", () => {
  it("should reject zero lookback_days", () => {
    const config: BacktestConfig = {
      lookback_days: 0,
      initial_equity: 10000,
      mode: "baseline",
    };
    const result = validateBacktestConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "lookback_days")).toBe(true);
  });

  it("should reject negative lookback_days", () => {
    const config: BacktestConfig = {
      lookback_days: -10,
      initial_equity: 10000,
      mode: "baseline",
    };
    const result = validateBacktestConfig(config);
    expect(result.valid).toBe(false);
  });

  it("should reject lookback_days > 3650", () => {
    const config: BacktestConfig = {
      lookback_days: 3651,
      initial_equity: 10000,
      mode: "baseline",
    };
    const result = validateBacktestConfig(config);
    expect(result.valid).toBe(false);
  });

  it("should accept lookback_days between 1 and 3650", () => {
    const config: BacktestConfig = {
      lookback_days: 252,
      initial_equity: 10000,
      mode: "baseline",
    };
    const result = validateBacktestConfig(config);
    expect(result.valid).toBe(true);
  });

  it("should reject zero initial_equity", () => {
    const config: BacktestConfig = {
      lookback_days: 252,
      initial_equity: 0,
      mode: "baseline",
    };
    const result = validateBacktestConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "initial_equity")).toBe(true);
  });

  it("should reject negative initial_equity", () => {
    const config: BacktestConfig = {
      lookback_days: 252,
      initial_equity: -5000,
      mode: "baseline",
    };
    const result = validateBacktestConfig(config);
    expect(result.valid).toBe(false);
  });

  it("should reject initial_equity exceeding 1 billion", () => {
    const config: BacktestConfig = {
      lookback_days: 252,
      initial_equity: 1_000_000_001,
      mode: "baseline",
    };
    const result = validateBacktestConfig(config);
    expect(result.valid).toBe(false);
  });

  it("should reject invalid mode", () => {
    const config = {
      lookback_days: 252,
      initial_equity: 10000,
      mode: "invalid_mode",
    } as BacktestConfig;
    const result = validateBacktestConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "mode")).toBe(true);
  });

  it("should accept valid baseline config", () => {
    const config: BacktestConfig = {
      lookback_days: 252,
      initial_equity: 10000,
      mode: "baseline",
    };
    const result = validateBacktestConfig(config);
    expect(result.valid).toBe(true);
  });

  it("should accept valid super_intelligence config", () => {
    const config: BacktestConfig = {
      lookback_days: 252,
      initial_equity: 10000,
      mode: "super_intelligence",
      min_signals: 50,
    };
    const result = validateBacktestConfig(config);
    expect(result.valid).toBe(true);
  });

  it("should reject min_signals <= 0", () => {
    const config: BacktestConfig = {
      lookback_days: 252,
      initial_equity: 10000,
      mode: "baseline",
      min_signals: 0,
    };
    const result = validateBacktestConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "min_signals")).toBe(true);
  });
});

describe("backtester.ts — Health Check", () => {
  it("should report healthy status initially", () => {
    const health = backtestHealthCheck();
    expect(health.healthy).toBe(true);
    expect(health.activeBacktests).toBe(0);
    expect(health.estimatedMemoryMB).toBe(0);
  });

  it("should include warnings in result", () => {
    const health = backtestHealthCheck();
    expect(health.warnings).toBeDefined();
    expect(Array.isArray(health.warnings)).toBe(true);
  });
});

describe("backtester.ts — Equity Floor Protection", () => {
  it("should allow positive equity", () => {
    const result = enforceEquityCurveFloor(50000, 100000);
    expect(result).toBe(50000);
  });

  it("should floor negative equity at zero", () => {
    const result = enforceEquityCurveFloor(-10000, 100000);
    expect(result).toBe(0);
  });

  it("should allow zero equity", () => {
    const result = enforceEquityCurveFloor(0, 100000);
    expect(result).toBe(0);
  });
});

describe("backtester.ts — Trade Checksum & Integrity", () => {
  const createTrade = (id: number, pnl: number, outcome: "win" | "loss"): TradeResult => ({
    signal_id: id,
    setup_type: "test",
    regime: "bullish",
    direction: "long",
    entry_price: 100 + id,
    stop_loss: 95 + id,
    take_profit: 110 + id,
    outcome,
    pnl_pct: pnl,
    si_approved: true,
    si_win_prob: 0.65,
    si_edge_score: 1.5,
    si_kelly_pct: 0.02,
    baseline_quality: 0.6,
    enhanced_quality: 0.8,
  });

  it("should compute consistent checksum for same trades", () => {
    const trades = [createTrade(1, 1, "win"), createTrade(2, -0.5, "loss")];
    const checksum1 = computeTradeChecksum(trades);
    const checksum2 = computeTradeChecksum(trades);
    expect(checksum1).toBe(checksum2);
  });

  it("should produce different checksum for different trades", () => {
    const trades1 = [createTrade(1, 1, "win")];
    const trades2 = [createTrade(1, 2, "win")];
    const checksum1 = computeTradeChecksum(trades1);
    const checksum2 = computeTradeChecksum(trades2);
    expect(checksum1).not.toBe(checksum2);
  });

  it("should validate correct checksum", () => {
    const trades = [createTrade(1, 1, "win"), createTrade(2, -0.5, "loss")];
    const checksum = computeTradeChecksum(trades);
    const valid = validateTradeSequenceIntegrity(trades, checksum);
    expect(valid).toBe(true);
  });

  it("should reject incorrect checksum", () => {
    const trades = [createTrade(1, 1, "win")];
    const valid = validateTradeSequenceIntegrity(trades, "wrongchecksum");
    expect(valid).toBe(false);
  });

  it("should validate empty trade sequence", () => {
    const valid = validateTradeSequenceIntegrity([]);
    expect(valid).toBe(true);
  });

  it("should detect non-monotonic trade sequence", () => {
    const trades = [createTrade(2, 1, "win"), createTrade(1, -0.5, "loss")];
    const valid = validateTradeSequenceIntegrity(trades);
    expect(valid).toBe(false);
  });

  it("should validate monotonic trade sequence", () => {
    const trades = [createTrade(1, 1, "win"), createTrade(2, -0.5, "loss"), createTrade(3, 0.5, "win")];
    const valid = validateTradeSequenceIntegrity(trades);
    expect(valid).toBe(true);
  });
});
