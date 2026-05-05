import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetCountersForTests,
  incFailedRequests,
  incOrderAttempt,
  incOrderExecution,
  incReconciliationRun,
  incTotalRequests,
  snapshotCounters,
} from "../lib/ops/counters";

describe("counters — reset + increment + snapshot", () => {
  beforeEach(() => _resetCountersForTests());

  it("snapshot starts at zero", () => {
    const s = snapshotCounters();
    expect(s.total_requests).toBe(0);
    expect(s.failed_requests).toBe(0);
    expect(s.order_attempts).toBe(0);
    expect(s.order_executions).toBe(0);
    expect(s.reconciliation_runs).toBe(0);
    expect(s.uptime_sec).toBeGreaterThanOrEqual(0);
  });

  it("increments are independent and additive", () => {
    incTotalRequests();
    incTotalRequests();
    incFailedRequests();
    incOrderAttempt();
    incOrderExecution();
    incOrderExecution();
    incReconciliationRun();
    const s = snapshotCounters();
    expect(s.total_requests).toBe(2);
    expect(s.failed_requests).toBe(1);
    expect(s.order_attempts).toBe(1);
    expect(s.order_executions).toBe(2);
    expect(s.reconciliation_runs).toBe(1);
  });

  it("snapshot has stable timestamp + monotonic uptime", () => {
    const s1 = snapshotCounters();
    const s2 = snapshotCounters();
    expect(s2.uptime_sec).toBeGreaterThanOrEqual(s1.uptime_sec);
    expect(typeof s1.started_at).toBe("string");
    expect(typeof s1.snapshot_at).toBe("string");
  });
});
