import { describe, it, expect } from "vitest";
import {
  getLastLiquidation,
  isLiquidationInProgress,
} from "../lib/emergency_liquidator";

describe("Emergency Liquidator", () => {
  it("should not be in progress initially", () => {
    expect(isLiquidationInProgress()).toBe(false);
  });

  it("should have no last liquidation initially", () => {
    expect(getLastLiquidation()).toBeNull();
  });
});
