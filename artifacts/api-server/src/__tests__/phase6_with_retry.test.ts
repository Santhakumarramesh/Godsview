import { describe, expect, it, vi } from "vitest";
import { withRetry } from "../lib/ops/with_retry";

describe("withRetry — happy path", () => {
  it("returns the resolved value on first attempt", async () => {
    const fn = vi.fn(async () => "ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("withRetry — retries on failure", () => {
  it("retries up to maxRetries (default 2 → 3 attempts total)", async () => {
    let n = 0;
    const fn = vi.fn(async () => { n += 1; if (n < 3) throw new Error("transient"); return "ok"; });
    const result = await withRetry(fn, { sleep: async () => {} });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws RetryFailure after maxRetries exhausted", async () => {
    const fn = vi.fn(async () => { throw new Error("permanent"); });
    await expect(withRetry(fn, { maxRetries: 2, sleep: async () => {} })).rejects.toThrow(/failed after 3 attempts/);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects shouldRetry classifier", async () => {
    const fn = vi.fn(async () => { throw Object.assign(new Error("fatal"), { fatal: true }); });
    await expect(
      withRetry(fn, {
        maxRetries: 5,
        shouldRetry: (err) => !(err as any).fatal,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/failed after 1 attempts/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uses exponential backoff between attempts", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const fn = vi.fn(async () => { n += 1; if (n < 3) throw new Error("retry"); return "ok"; });
    await withRetry(fn, { maxRetries: 2, backoffMs: 100, sleep: async (ms) => { sleeps.push(ms); } });
    expect(sleeps).toEqual([100, 200]);
  });
});

describe("withRetry — timeout", () => {
  it("aborts an attempt that exceeds timeoutMs", async () => {
    const slow = () => new Promise<string>((resolve) => setTimeout(() => resolve("done"), 200));
    await expect(withRetry(slow, { timeoutMs: 30, maxRetries: 0, sleep: async () => {} }))
      .rejects.toThrow(/timeout after 30ms/);
  });
  it("retries on timeout when maxRetries > 0", async () => {
    let calls = 0;
    const fn = () => new Promise<string>((resolve, reject) => {
      calls += 1;
      if (calls < 3) setTimeout(() => reject(new Error("never")), 1000);
      else resolve("ok");
    });
    const r = await withRetry(fn, { timeoutMs: 30, maxRetries: 2, backoffMs: 5, sleep: async () => {} });
    expect(r).toBe("ok");
    expect(calls).toBe(3);
  });
});
