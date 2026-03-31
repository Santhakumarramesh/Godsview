import { describe, it, expect, beforeEach } from "vitest";
import {
  checkNewsLockout,
  ingestMacroEvent,
  clearMacroEvents,
  getMacroContext,
  type MacroEvent,
} from "../lib/macro_engine";

function makeEvent(overrides: Partial<MacroEvent> = {}): MacroEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: "economic_calendar",
    title: "Test Event",
    impact: "high",
    sentiment: -0.5,
    related_symbols: ["BTCUSD", "ETHUSD", "EURUSD"],
    source: "test",
    timestamp: new Date(Date.now() + 5 * 60_000).toISOString(), // 5 min in future
    ...overrides,
  };
}

describe("Macro Engine", () => {
  beforeEach(() => {
    clearMacroEvents();
  });

  it("returns not locked when no events exist", () => {
    const result = checkNewsLockout("BTCUSD");
    expect(result.locked).toBe(false);
  });

  it("locks out after high-impact event is ingested", () => {
    ingestMacroEvent(makeEvent({
      title: "FOMC Rate Decision",
      impact: "high",
      related_symbols: ["BTCUSD", "EURUSD"],
    }));

    const result = checkNewsLockout("BTCUSD");
    expect(result.locked).toBe(true);
    expect(result.reason).toBeTruthy();
  });

  it("does not lock on low-impact events", () => {
    ingestMacroEvent(makeEvent({
      title: "Minor Trade Balance",
      impact: "low",
      related_symbols: ["EURUSD"],
    }));

    const result = checkNewsLockout("EURUSD");
    expect(result.locked).toBe(false);
  });

  it("does not lock for unrelated symbols", () => {
    ingestMacroEvent(makeEvent({
      title: "JPY Event",
      impact: "high",
      related_symbols: ["USDJPY"],
    }));

    const result = checkNewsLockout("BTCUSD");
    expect(result.locked).toBe(false);
  });

  it("returns macro context with events", () => {
    ingestMacroEvent(makeEvent({ title: "NFP Report" }));
    const ctx = getMacroContext();
    expect(ctx.events.length).toBeGreaterThan(0);
    expect(ctx).toHaveProperty("overall_sentiment");
    expect(ctx).toHaveProperty("risk_level");
    expect(ctx).toHaveProperty("generated_at");
  });
});
