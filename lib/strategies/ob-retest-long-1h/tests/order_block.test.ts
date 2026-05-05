import { describe, expect, it } from "vitest";
import { displacementATR, findOrderBlockForBOS } from "../src/order_block";
import { buildBaseFixture } from "./fixtures/builders";

describe("findOrderBlockForBOS", () => {
  it("identifies the OB candle at index 40 (last down-close before BOS at 42)", () => {
    const { bars, expected } = buildBaseFixture();
    const ob = findOrderBlockForBOS(bars, expected.bosIndex, 32);
    expect(ob).not.toBeNull();
    expect(ob!.obIndex).toBe(expected.obIndex);
    expect(ob!.obLow).toBe(expected.obLow);
    expect(ob!.obHigh).toBe(expected.obHigh);
  });
  it("returns null when no down-close bar exists in the search window", () => {
    const { bars, expected } = buildBaseFixture();
    const mod = bars.map((b, i) =>
      i <= 41 ? { ...b, Open: b.Low, Close: b.High } : b,
    );
    const ob = findOrderBlockForBOS(mod, expected.bosIndex, 32);
    expect(ob).toBeNull();
  });
});

describe("displacementATR", () => {
  it("equals (range from OB to BOS) / atrAtBos", () => {
    const { bars } = buildBaseFixture();
    const disp = displacementATR(bars, 40, 42, 1.0);
    expect(disp).toBeCloseTo(5.5, 10);
  });
  it("returns 0 for non-positive ATR", () => {
    const { bars } = buildBaseFixture();
    expect(displacementATR(bars, 40, 42, 0)).toBe(0);
    expect(displacementATR(bars, 40, 42, -1)).toBe(0);
  });
});
