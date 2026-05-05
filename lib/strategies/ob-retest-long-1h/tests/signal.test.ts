import { describe, expect, it } from "vitest";
import { buildLongSignal } from "../src/signal";
import type { Bar, OrderBlock1H } from "../src/types";

const b = (c: number, ts: string): Bar => ({
  Timestamp: ts, Open: c, High: c, Low: c, Close: c, Volume: 1,
});

describe("buildLongSignal (slim output)", () => {
  it("emits only kind/timestamp/entry/stop/target/invalidation", () => {
    const bars: Bar[] = [b(108.8, "2026-01-01T46:00:00.000Z")];
    const ob: OrderBlock1H = {
      obIndex: 0, bosIndex: 0, obLow: 106.5, obHigh: 108.0, displacementATR: 3,
    };
    const sig = buildLongSignal(bars, ob, 0, 1.0, {
      stopBufferATR: 0.25, takeProfitR: 2, maxRetestBars: 24,
    });
    expect(sig.kind).toBe("long");
    expect(sig.timestamp).toBe("2026-01-01T46:00:00.000Z");
    expect(sig.entry).toBeCloseTo(108.8, 10);
    expect(sig.stop).toBeCloseTo(106.25, 10);
    expect(sig.target).toBeCloseTo(113.9, 10);
    expect(sig.invalidation.obLow).toBe(106.5);
    expect(sig.invalidation.expireAt).toBe("2026-01-01T46:00:00.000Z"); // single-bar fixture: expireIdx clamps to bars.length-1
    // No extra fields:
    const allowed = new Set(["kind","timestamp","entry","stop","target","invalidation"]);
    for (const k of Object.keys(sig)) {
      expect(allowed.has(k)).toBe(true);
    }
    const inv = sig.invalidation as Record<string, unknown>;
    const allowedInv = new Set(["obLow","expireAt"]);
    for (const k of Object.keys(inv)) expect(allowedInv.has(k)).toBe(true);
  });
});
