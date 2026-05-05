import { describe, expect, it } from "vitest";
import { atrTooLow, inNewsWindow } from "../src/filters";

describe("atrTooLow", () => {
  it("returns true when current ATR is < minRatio * average", () => {
    const series = [1, 1, 1, 1, 0.4];
    expect(atrTooLow(series, 4, 5, 0.5)).toBe(true);
  });
  it("returns false when current ATR is comfortably above the ratio", () => {
    const series = [1, 1, 1, 1, 1];
    expect(atrTooLow(series, 4, 5, 0.5)).toBe(false);
  });
  it("returns true when current ATR is NaN (do not trade unknown)", () => {
    const series = [1, 1, NaN];
    expect(atrTooLow(series, 2, 3, 0.5)).toBe(true);
  });
  it("returns false when there is no history (cannot measure)", () => {
    const series = [NaN, NaN, 1.0];
    expect(atrTooLow(series, 2, 1, 0.5)).toBe(false);
  });
});

describe("inNewsWindow", () => {
  const t0 = "2026-01-01T12:00:00.000Z";
  it("blocks within +/-30 minutes of a high-severity event", () => {
    const news = [{ ts: "2026-01-01T12:25:00.000Z", severity: "high" as const }];
    expect(inNewsWindow(t0, news, 30)).toBe(true);
  });
  it("does not block outside the window", () => {
    const news = [{ ts: "2026-01-01T13:00:00.000Z", severity: "high" as const }];
    expect(inNewsWindow(t0, news, 30)).toBe(false);
  });
  it("ignores non-high severity events", () => {
    const news = [
      { ts: "2026-01-01T12:00:00.000Z", severity: "medium" as const },
      { ts: "2026-01-01T12:00:00.000Z", severity: "low" as const },
    ];
    expect(inNewsWindow(t0, news, 30)).toBe(false);
  });
  it("returns false when news is undefined or empty", () => {
    expect(inNewsWindow(t0, undefined, 30)).toBe(false);
    expect(inNewsWindow(t0, [], 30)).toBe(false);
  });
});
