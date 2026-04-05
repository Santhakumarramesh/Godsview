import { describe, it, expect, beforeEach } from "vitest";
import {
  parsePrompt, compileRules, labCreateStrategy,
  getLabSnapshot, resetLab,
} from "../lib/godsview_lab.js";
import { resetRegistry } from "../lib/strategy_registry.js";

describe("GodsView Lab", () => {
  beforeEach(() => { resetLab(); resetRegistry(); });

  it("parses a prompt with RSI entry and exit", () => {
    const p = parsePrompt("Buy AAPL when RSI(14) < 30, sell when RSI > 70, stop at 2 ATR, risk 1.5%");
    expect(p.symbols).toContain("AAPL");
    expect(p.entryRules.length).toBeGreaterThanOrEqual(1);
    expect(p.exitRules.length).toBeGreaterThanOrEqual(1);
    expect(p.stopRule).toEqual({ type: "ATR", value: 2 });
    expect(p.riskPct).toBeCloseTo(0.015);
    expect(p.confidence).toBeGreaterThan(0.5);
  });

  it("parses SMA crossover prompt", () => {
    const p = parsePrompt("Buy when price crosses above 200 day SMA, sell when price below 50 SMA");
    expect(p.entryRules.length).toBeGreaterThanOrEqual(1);
    expect(p.exitRules.length).toBeGreaterThanOrEqual(1);
  });

  it("compiles parsed rules into expressions", () => {
    const p = parsePrompt("Buy TSLA when RSI < 30, sell when RSI > 70");
    const compiled = compileRules(p);
    expect(compiled.length).toBeGreaterThanOrEqual(1);
    expect(compiled[0].expression).toBeTruthy();
    expect(compiled[0].conditions.length).toBeGreaterThan(0);
  });

  it("full pipeline: parse → compile → register", () => {
    const result = labCreateStrategy("Buy NVDA when RSI(14) < 25 and price above 200 EMA, stop at 1.5 ATR, risk 2%", "sakthi");
    expect(result.parsed.symbols).toContain("NVDA");
    expect(result.compiled.length).toBeGreaterThan(0);
    expect(result.registered.state).toBe("draft");
    expect(result.registered.tags).toContain("lab");
    expect(result.registered.author).toBe("sakthi");
  });

  it("extracts timeframe from prompt", () => {
    const p = parsePrompt("Buy on 15 minute chart when RSI < 30");
    expect(p.timeframe).toBe("15m");
  });

  it("defaults risk to 2% when not specified", () => {
    const p = parsePrompt("Buy AAPL when RSI < 30");
    expect(p.riskPct).toBe(0.02);
  });

  it("tracks snapshot telemetry", () => {
    labCreateStrategy("Buy AAPL when RSI < 30");
    labCreateStrategy("Buy MSFT when price above 200 SMA");
    const snap = getLabSnapshot();
    expect(snap.totalPromptsParsed).toBe(2);
    expect(snap.totalStrategiesRegistered).toBe(2);
  });

  it("resets cleanly", () => {
    labCreateStrategy("Buy X when RSI < 30");
    resetLab();
    const snap = getLabSnapshot();
    expect(snap.totalPromptsParsed).toBe(0);
  });
});
