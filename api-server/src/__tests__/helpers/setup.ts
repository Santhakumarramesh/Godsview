/**
 * Test setup — mocks external dependencies that aren't available in test environment.
 */

import { vi } from "vitest";

// Mock pino logger
vi.mock("pino", () => {
  const noop = () => {};
  const mockLogger = {
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    debug: noop,
    trace: noop,
    child: () => mockLogger,
  };
  return { default: () => mockLogger };
});

// Mock pino-pretty (imported by pino in dev)
vi.mock("pino-pretty", () => ({ default: () => {} }));

// Mock risk engine (not available in test env)
vi.mock("../lib/risk_engine", () => ({
  isKillSwitchActive: () => false,
  setKillSwitchActive: () => ({}),
  getRiskEngineSnapshot: () => ({}),
}));

// Mock drawdown breaker
vi.mock("../lib/drawdown_breaker", () => ({
  getBreakerSnapshot: () => ({ sizeMultiplier: 1.0, state: "normal", consecutiveLosses: 0 }),
  isCooldownActive: () => false,
  getPositionSizeMultiplier: () => 1.0,
  resetBreaker: () => ({}),
}));

// Mock emergency liquidator
vi.mock("../lib/emergency_liquidator", () => ({
  emergencyLiquidateAll: async () => ({ positions_closed: 0, orders_cancelled: 0, details: [] }),
  getLastLiquidation: () => null,
  isLiquidationInProgress: () => false,
}));
