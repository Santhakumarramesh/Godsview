import { describe, it, expect, beforeEach } from "vitest";
import {
  recordTradeResult, checkBreaker, recordOrder, checkRateLimit,
  activateKillSwitch, deactivateKillSwitch, isTradingAllowed,
  getCircuitBreakerSnapshot, updateConfig, resetCircuitBreaker,
} from "../lib/circuit_breaker.js";

describe("Circuit Breaker + Rate Limiter", () => {
  beforeEach(() => { resetCircuitBreaker(); });

  it("trips on consecutive losses", () => {
    for (let i = 0; i < 5; i++) recordTradeResult(-0.5);
    const status = checkBreaker();
    expect(status.state).toBe("OPEN");
    expect(status.consecutiveLosses).toBe(5);
    expect(isTradingAllowed()).toBe(false);
  });

  it("trips on daily loss threshold", () => {
    recordTradeResult(-1.5);
    recordTradeResult(-1.6);
    const status = checkBreaker();
    expect(status.state).toBe("OPEN");
    expect(isTradingAllowed()).toBe(false);
  });

  it("resets consecutive losses on win", () => {
    recordTradeResult(-0.5);
    recordTradeResult(-0.5);
    recordTradeResult(1.0);
    expect(checkBreaker().consecutiveLosses).toBe(0);
  });

  it("kill switch blocks all trading", () => {
    activateKillSwitch("Emergency", "admin");
    expect(isTradingAllowed()).toBe(false);
    deactivateKillSwitch();
    expect(isTradingAllowed()).toBe(true);
  });

  it("rate limiter blocks after max per minute", () => {
    updateConfig({ maxConsecutiveLosses: 999 }); // avoid breaker trip
    for (let i = 0; i < 10; i++) recordOrder();
    const status = checkRateLimit();
    expect(status.blocked).toBe(true);
    expect(status.ordersThisMinute).toBe(10);
  });

  it("config can be updated", () => {
    const cfg = updateConfig({ maxConsecutiveLosses: 3, cooldownMinutes: 15 });
    expect(cfg.maxConsecutiveLosses).toBe(3);
    expect(cfg.cooldownMinutes).toBe(15);
    // Now trip at 3
    for (let i = 0; i < 3; i++) recordTradeResult(-0.5);
    expect(checkBreaker().state).toBe("OPEN");
  });

  it("snapshot returns full state", () => {
    recordTradeResult(-0.5);
    const snap = getCircuitBreakerSnapshot();
    expect(snap.breaker).toBeDefined();
    expect(snap.rateLimiter).toBeDefined();
    expect(snap.killSwitch).toBeDefined();
    expect(snap.tradingAllowed).toBe(true);
  });

  it("resets cleanly", () => {
    for (let i = 0; i < 5; i++) recordTradeResult(-0.5);
    resetCircuitBreaker();
    expect(checkBreaker().state).toBe("CLOSED");
    expect(isTradingAllowed()).toBe(true);
  });
});
