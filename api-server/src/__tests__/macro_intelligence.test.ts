/**
 * macro_intelligence.test.ts — Phase 33: Macro Intelligence Tests
 *
 * Tests:
 *   - Event CRUD operations (add, remove, list)
 *   - Lockout/cooldown window computation
 *   - Macro risk scoring with event severity weighting
 *   - News distortion flagging and expiry
 *   - Multiple events stacking risk
 *   - Symbol-specific lockout checks
 *   - State cleanup and edge cases
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  addEvent,
  removeEvent,
  getUpcomingEvents,
  getActiveEvents,
  isInLockout,
  isInCooldown,
  getEventWindows,
  _clearEvents,
  type EconomicEvent,
} from "../lib/macro_intelligence/event_calendar.js";
import {
  computeMacroRisk,
  addNewsDistortion,
  getActiveDistortions,
  getMacroRiskScore,
  getAllRiskScores,
  _clearAll as _clearRiskScores,
} from "../lib/macro_intelligence/macro_risk_scorer.js";

// Mock pino logging
vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

vi.mock("pino-pretty", () => ({
  default: vi.fn(),
}));

// ─── Event Calendar Tests ──────────────────────────────────────────────────

describe("Event Calendar", () => {
  beforeEach(() => {
    _clearEvents();
    _clearRiskScores();
  });

  it("should add an economic event successfully", () => {
    const now = new Date();
    const scheduledAt = new Date(now.getTime() + 60 * 60_000).toISOString();

    const result = addEvent({
      name: "FOMC Meeting",
      category: "fed_decision",
      severity: "high",
      scheduled_at: scheduledAt,
      symbols_affected: ["BTCUSD", "ETHUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "upcoming",
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.event_id).toMatch(/^evt_/);
    expect(result.data?.name).toBe("FOMC Meeting");
  });

  it("should reject event with invalid timestamp", () => {
    const result = addEvent({
      name: "Invalid Event",
      category: "custom",
      severity: "low",
      scheduled_at: "not-a-timestamp",
      symbols_affected: ["BTCUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "upcoming",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("should remove an event by ID", () => {
    const now = new Date();
    const scheduledAt = new Date(now.getTime() + 60 * 60_000).toISOString();

    const addResult = addEvent({
      name: "Test Event",
      category: "cpi",
      severity: "medium",
      scheduled_at: scheduledAt,
      symbols_affected: ["BTCUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "upcoming",
    });

    expect(addResult.data?.event_id).toBeDefined();
    const eventId = addResult.data!.event_id;

    const removeResult = removeEvent(eventId);
    expect(removeResult.success).toBe(true);

    // Verify it's gone
    const upcoming = getUpcomingEvents(24);
    const found = upcoming.find((e) => e.event_id === eventId);
    expect(found).toBeUndefined();
  });

  it("should reject removal of non-existent event", () => {
    const result = removeEvent("evt_nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("should get upcoming events within time window", () => {
    const now = new Date();
    const inOneHour = new Date(now.getTime() + 60 * 60_000).toISOString();
    const inThreeDays = new Date(now.getTime() + 3 * 24 * 60 * 60_000).toISOString();

    addEvent({
      name: "CPI Release",
      category: "cpi",
      severity: "high",
      scheduled_at: inOneHour,
      symbols_affected: ["BTCUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "upcoming",
    });

    addEvent({
      name: "Fed Minutes",
      category: "fomc_minutes",
      severity: "medium",
      scheduled_at: inThreeDays,
      symbols_affected: ["ETHUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "upcoming",
    });

    // Get upcoming in next 2 hours (should include CPI only)
    const upcoming2h = getUpcomingEvents(2);
    expect(upcoming2h.length).toBeGreaterThanOrEqual(1);
    expect(upcoming2h.some((e) => e.name === "CPI Release")).toBe(true);

    // Get upcoming in next 7 days (should include both)
    const upcoming7d = getUpcomingEvents(7 * 24);
    expect(upcoming7d.length).toBeGreaterThanOrEqual(2);
  });

  it("should exclude canceled events from upcoming list", () => {
    const now = new Date();
    const inOneHour = new Date(now.getTime() + 60 * 60_000).toISOString();

    addEvent({
      name: "Canceled Event",
      category: "custom",
      severity: "low",
      scheduled_at: inOneHour,
      symbols_affected: ["BTCUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "canceled",
    });

    const upcoming = getUpcomingEvents(24);
    expect(upcoming.some((e) => e.name === "Canceled Event")).toBe(false);
  });

  it("should compute lockout window correctly", () => {
    const now = new Date();
    // Event in 10 minutes
    const scheduledAt = new Date(now.getTime() + 10 * 60_000);
    const eventTime = scheduledAt.toISOString();

    addEvent({
      name: "NFP Release",
      category: "nfp",
      severity: "critical",
      scheduled_at: eventTime,
      symbols_affected: ["BTCUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "upcoming",
    });

    const windows = getEventWindows("BTCUSD");
    expect(windows.length).toBeGreaterThan(0);
    const window = windows[0];

    // Verify lockout window times
    const lockoutStart = new Date(window.lockout_start);
    const lockoutEnd = new Date(window.lockout_end);
    expect(lockoutEnd.getTime()).toBeGreaterThan(lockoutStart.getTime());

    // Verify cooldown includes lockout period
    const cooldownEnd = new Date(window.cooldown_end);
    expect(cooldownEnd.getTime()).toBeGreaterThan(lockoutEnd.getTime());
  });

  it("should detect when symbol is in lockout", () => {
    const now = new Date();
    // Event 5 minutes in the future (within 15-minute lockout window before event)
    const scheduledAt = new Date(now.getTime() + 5 * 60_000).toISOString();

    addEvent({
      name: "Recent Event",
      category: "custom",
      severity: "low",
      scheduled_at: scheduledAt,
      symbols_affected: ["BTCUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "upcoming",
    });

    const inLockout = isInLockout("BTCUSD");
    expect(inLockout).toBe(true);
  });

  it("should detect when symbol is in cooldown", () => {
    const now = new Date();
    // Event 5 minutes in the past (within 30-minute cooldown window)
    const scheduledAt = new Date(now.getTime() - 5 * 60_000).toISOString();

    addEvent({
      name: "Recent Event",
      category: "custom",
      severity: "low",
      scheduled_at: scheduledAt,
      symbols_affected: ["BTCUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "active",
    });

    const inCooldown = isInCooldown("BTCUSD");
    expect(inCooldown).toBe(true);
  });

  it("should not lock unaffected symbols", () => {
    const now = new Date();
    const scheduledAt = new Date(now.getTime() - 5 * 60_000).toISOString();

    addEvent({
      name: "Event for BTC",
      category: "custom",
      severity: "low",
      scheduled_at: scheduledAt,
      symbols_affected: ["BTCUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "active",
    });

    const ethlocked = isInLockout("ETHUSD");
    expect(ethlocked).toBe(false);
  });

  it("should get active events", () => {
    const now = new Date();
    // Event in the past (within cooldown)
    const inPast = new Date(now.getTime() - 5 * 60_000).toISOString();
    // Event far in future
    const inFuture = new Date(now.getTime() + 24 * 60 * 60_000).toISOString();

    addEvent({
      name: "Active Event",
      category: "custom",
      severity: "low",
      scheduled_at: inPast,
      symbols_affected: ["BTCUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "active",
    });

    addEvent({
      name: "Future Event",
      category: "custom",
      severity: "low",
      scheduled_at: inFuture,
      symbols_affected: ["ETHUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "upcoming",
    });

    const active = getActiveEvents();
    expect(active.length).toBeGreaterThanOrEqual(1);
    expect(active.some((e) => e.name === "Active Event")).toBe(true);
  });

  it("should clear all events", () => {
    const now = new Date();
    const scheduled = new Date(now.getTime() + 60 * 60_000).toISOString();

    addEvent({
      name: "Event 1",
      category: "custom",
      severity: "low",
      scheduled_at: scheduled,
      symbols_affected: ["BTCUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "upcoming",
    });

    addEvent({
      name: "Event 2",
      category: "custom",
      severity: "low",
      scheduled_at: scheduled,
      symbols_affected: ["ETHUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "upcoming",
    });

    _clearEvents();

    const upcoming = getUpcomingEvents(24);
    expect(upcoming.length).toBe(0);
  });
});

// ─── Macro Risk Scoring Tests ──────────────────────────────────────────────

describe("Macro Risk Scoring", () => {
  beforeEach(() => {
    _clearEvents();
    _clearRiskScores();
  });

  it("should compute base risk score of 10 with no events", () => {
    const result = computeMacroRisk("BTCUSD", []);

    expect(result.success).toBe(true);
    expect(result.data?.risk_score).toBe(10);
    expect(result.data?.risk_level).toBe("low");
    expect(result.data?.lockout_active).toBe(false);
    expect(result.data?.cooldown_active).toBe(false);
    expect(result.data?.news_distortion_flag).toBe(false);
  });

  it("should weight low severity event correctly", () => {
    const now = new Date();
    const scheduled = new Date(now.getTime() - 5 * 60_000).toISOString();

    const event: EconomicEvent = {
      event_id: "evt_test1",
      name: "Low Severity Event",
      category: "custom",
      severity: "low",
      scheduled_at: scheduled,
      symbols_affected: ["BTCUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "active",
    };

    const result = computeMacroRisk("BTCUSD", [event]);

    expect(result.success).toBe(true);
    // base 10 + low severity (5) = 15
    expect(result.data?.risk_score).toBeGreaterThanOrEqual(15);
  });

  it("should weight medium severity event correctly", () => {
    const now = new Date();
    const scheduled = new Date(now.getTime() - 5 * 60_000).toISOString();

    const event: EconomicEvent = {
      event_id: "evt_test2",
      name: "Medium Severity Event",
      category: "cpi",
      severity: "medium",
      scheduled_at: scheduled,
      symbols_affected: ["BTCUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "active",
    };

    const result = computeMacroRisk("BTCUSD", [event]);

    expect(result.success).toBe(true);
    // base 10 + medium severity (15) = 25
    expect(result.data?.risk_score).toBeGreaterThanOrEqual(25);
  });

  it("should weight high severity event correctly", () => {
    const now = new Date();
    const scheduled = new Date(now.getTime() - 5 * 60_000).toISOString();

    const event: EconomicEvent = {
      event_id: "evt_test3",
      name: "High Severity Event",
      category: "fed_decision",
      severity: "high",
      scheduled_at: scheduled,
      symbols_affected: ["BTCUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "active",
    };

    const result = computeMacroRisk("BTCUSD", [event]);

    expect(result.success).toBe(true);
    // base 10 + high severity (30) = 40
    expect(result.data?.risk_score).toBeGreaterThanOrEqual(40);
  });

  it("should weight critical severity event correctly", () => {
    const now = new Date();
    const scheduled = new Date(now.getTime() - 5 * 60_000).toISOString();

    const event: EconomicEvent = {
      event_id: "evt_test4",
      name: "Critical Event",
      category: "nfp",
      severity: "critical",
      scheduled_at: scheduled,
      symbols_affected: ["BTCUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "active",
    };

    const result = computeMacroRisk("BTCUSD", [event]);

    expect(result.success).toBe(true);
    // base 10 + critical severity (50) = 60
    expect(result.data?.risk_score).toBeGreaterThanOrEqual(60);
  });

  it("should stack multiple events", () => {
    const now = new Date();
    const scheduled = new Date(now.getTime() - 5 * 60_000).toISOString();

    const event1: EconomicEvent = {
      event_id: "evt_stack1",
      name: "Event 1",
      category: "cpi",
      severity: "medium",
      scheduled_at: scheduled,
      symbols_affected: ["BTCUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "active",
    };

    const event2: EconomicEvent = {
      event_id: "evt_stack2",
      name: "Event 2",
      category: "nfp",
      severity: "high",
      scheduled_at: scheduled,
      symbols_affected: ["BTCUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "active",
    };

    const result = computeMacroRisk("BTCUSD", [event1, event2]);

    expect(result.success).toBe(true);
    // base 10 + medium (15) + high (30) = 55
    expect(result.data?.risk_score).toBeGreaterThanOrEqual(55);
    expect(result.data?.active_events.length).toBe(2);
  });

  it("should add lockout penalty", () => {
    const now = new Date();
    // Event 5 minutes in future - within 15-minute pre-lockout window
    // Lockout window: now - 15 min to +5 min (event time)
    // Current time is within that window
    const scheduled = new Date(now.getTime() + 5 * 60_000).toISOString();

    // Must add event to calendar for isInLockout to find it
    const addResult = addEvent({
      name: "Lockout Test",
      category: "custom",
      severity: "low",
      scheduled_at: scheduled,
      symbols_affected: ["BTCUSD"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "upcoming",
    });

    expect(addResult.data?.event_id).toBeDefined();
    const event = addResult.data!;

    const result = computeMacroRisk("BTCUSD", [event]);

    expect(result.success).toBe(true);
    // base 10 + low severity (5) + lockout penalty (20) = 35
    expect(result.data?.risk_score).toBeGreaterThanOrEqual(35);
    expect(result.data?.lockout_active).toBe(true);
    expect(result.data?.active_events).toContain(event.event_id);
  });

  it("should add news distortion weight", () => {
    // Add distortion first
    const distResult = addNewsDistortion("BTCUSD", "Bloomberg", "Unexpected rate decision", "high", 60);
    expect(distResult.success).toBe(true);

    // Compute risk with distortion present
    const riskResult = computeMacroRisk("BTCUSD", []);

    expect(riskResult.success).toBe(true);
    // base 10 + high distortion (40) = 50
    expect(riskResult.data?.risk_score).toBeGreaterThanOrEqual(50);
    expect(riskResult.data?.news_distortion_flag).toBe(true);
  });

  it("should cap risk score at 100", () => {
    const now = new Date();
    const scheduled = new Date(now.getTime() - 5 * 60_000).toISOString();

    const events: EconomicEvent[] = [
      {
        event_id: "evt_cap1",
        name: "Event 1",
        category: "custom",
        severity: "critical",
        scheduled_at: scheduled,
        symbols_affected: ["BTCUSD"],
        pre_event_lockout_minutes: 15,
        post_event_cooldown_minutes: 30,
        status: "active",
      },
      {
        event_id: "evt_cap2",
        name: "Event 2",
        category: "custom",
        severity: "critical",
        scheduled_at: scheduled,
        symbols_affected: ["BTCUSD"],
        pre_event_lockout_minutes: 15,
        post_event_cooldown_minutes: 30,
        status: "active",
      },
    ];

    // Add high-severity distortion
    addNewsDistortion("BTCUSD", "Source", "Headline", "high", 60);

    const result = computeMacroRisk("BTCUSD", events);

    expect(result.success).toBe(true);
    expect(result.data?.risk_score).toBeLessThanOrEqual(100);
  });

  it("should classify risk levels correctly", () => {
    const now = new Date();

    // Low risk
    let result = computeMacroRisk("BTCUSD1", []);
    expect(result.data?.risk_level).toBe("low");

    _clearRiskScores();

    // Elevated risk (25-49)
    // base 10 + low severity (5) + low distortion (10) = 25
    const event1: EconomicEvent = {
      event_id: "evt_el1",
      name: "Low Severity Event",
      category: "custom",
      severity: "low",
      scheduled_at: new Date(now.getTime() + 5 * 60_000).toISOString(),
      symbols_affected: ["BTCUSD2"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "upcoming",
    };
    addNewsDistortion("BTCUSD2", "Source", "Headline", "low", 60);
    result = computeMacroRisk("BTCUSD2", [event1]);
    expect(result.data?.risk_level).toMatch(/elevated|high/);

    _clearRiskScores();

    // High risk (50-74)
    // base 10 + high severity (30) + low distortion (10) = 50
    const event2: EconomicEvent = {
      event_id: "evt_high1",
      name: "High Severity Event",
      category: "custom",
      severity: "high",
      scheduled_at: new Date(now.getTime() + 5 * 60_000).toISOString(),
      symbols_affected: ["BTCUSD3"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "upcoming",
    };
    addNewsDistortion("BTCUSD3", "Source", "Headline", "low", 60);
    result = computeMacroRisk("BTCUSD3", [event2]);
    expect(result.data?.risk_level).toMatch(/high|extreme/);

    _clearRiskScores();

    // Extreme risk (75+)
    // base 10 + critical (50) + high distortion (40) + lockout (20) = 120 (capped at 100)
    const event3: EconomicEvent = {
      event_id: "evt_extreme",
      name: "Critical Event",
      category: "custom",
      severity: "critical",
      scheduled_at: new Date(now.getTime() + 5 * 60_000).toISOString(),
      symbols_affected: ["BTCUSD4"],
      pre_event_lockout_minutes: 15,
      post_event_cooldown_minutes: 30,
      status: "upcoming",
    };
    addNewsDistortion("BTCUSD4", "Source", "Headline", "high", 60);
    result = computeMacroRisk("BTCUSD4", [event3]);
    expect(result.data?.risk_level).toBe("extreme");
  });

  it("should add news distortion", () => {
    const result = addNewsDistortion(
      "BTCUSD",
      "Reuters",
      "Unexpected policy shift",
      "medium",
      120
    );

    expect(result.success).toBe(true);
    expect(result.data?.distortion_id).toMatch(/^nws_/);
    expect(result.data?.symbol).toBe("BTCUSD");
    expect(result.data?.severity).toBe("medium");
  });

  it("should retrieve active distortions", () => {
    addNewsDistortion("BTCUSD", "Source1", "Headline1", "low", 60);
    addNewsDistortion("ETHUSD", "Source2", "Headline2", "medium", 60);

    // All distortions
    const all = getActiveDistortions();
    expect(all.length).toBeGreaterThanOrEqual(2);

    // Filter by symbol
    const btcOnly = getActiveDistortions("BTCUSD");
    expect(btcOnly.length).toBeGreaterThanOrEqual(1);
    expect(btcOnly.every((d) => d.symbol === "BTCUSD")).toBe(true);
  });

  it("should expire old distortions", () => {
    // Add distortion that expires immediately
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    addNewsDistortion("BTCUSD", "Source", "Headline", "low", 0);
    vi.setSystemTime(now + 1000); // Advance 1 second

    // Call getActiveDistortions which triggers cleanup
    const active = getActiveDistortions("BTCUSD");
    expect(active.length).toBe(0);

    vi.useRealTimers();
  });

  it("should retrieve cached risk score", () => {
    const result = computeMacroRisk("BTCUSD", []);
    expect(result.data?.score_id).toBeDefined();

    const scoreId = result.data!.score_id;
    const retrieved = getMacroRiskScore(scoreId);

    expect(retrieved).not.toBeNull();
    expect(retrieved?.score_id).toBe(scoreId);
    expect(retrieved?.symbol).toBe("BTCUSD");
  });

  it("should return all risk scores", () => {
    computeMacroRisk("BTCUSD", []);
    computeMacroRisk("ETHUSD", []);

    const allScores = getAllRiskScores();
    expect(allScores.length).toBeGreaterThanOrEqual(2);
  });

  it("should clear all risk state", () => {
    addNewsDistortion("BTCUSD", "Source", "Headline", "low", 60);
    computeMacroRisk("BTCUSD", []);

    _clearRiskScores();

    expect(getAllRiskScores().length).toBe(0);
    expect(getActiveDistortions().length).toBe(0);
  });
});
