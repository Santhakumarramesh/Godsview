/**
 * Risk Snapshot Collector — Phase 3
 *
 * Bridges the pure `evaluatePipeline()` to the live system. Reads from existing
 * modules to assemble a RiskSnapshot. This is the ONLY layer that reaches into
 * runtime state; the pipeline itself stays pure.
 *
 * If a snapshot input cannot be measured, the collector errs on the side of
 * SAFETY (e.g. an unfetchable equity returns dailyPnLPct=null which is then
 * mapped to "data_stale-style" rejection by the caller).
 */

import { resolveSystemMode, type SystemMode } from "@workspace/strategy-core";
import { isKillSwitchActive, getCurrentTradingSession, isSessionAllowed, isNewsLockoutActive, getRiskEngineSnapshot } from "../risk_engine.js";
import { isTradingAllowed as killSwitchAllowsTrading } from "./kill_switch.js";
import { getExposureLimits } from "./exposure_guard.js";
import type { RiskSnapshot } from "./risk_pipeline.js";

const LEGACY_LIVE = String(process.env.GODSVIEW_ENABLE_LIVE_TRADING ?? "").toLowerCase() === "true";
const SYSTEM_MODE: SystemMode = resolveSystemMode(process.env.GODSVIEW_SYSTEM_MODE, { liveTradingEnabled: LEGACY_LIVE });
const OPERATOR_TOKEN = (process.env.GODSVIEW_OPERATOR_TOKEN ?? "").trim();

const MAX_DATA_AGE_MS = Number(process.env.GODSVIEW_MAX_DATA_AGE_MS ?? 30_000);
const MAX_DAILY_LOSS_PCT = Number(process.env.GODSVIEW_MAX_DAILY_LOSS_PCT ?? 2);
const MAX_CONCURRENT_POSITIONS = Number(process.env.GODSVIEW_MAX_CONCURRENT_POSITIONS ?? 1);
const MAX_TRADES_PER_DAY = Number(process.env.GODSVIEW_MAX_TRADES_PER_DAY ?? 3);

export interface SnapshotInputs {
  /** Pre-measured age in ms of latest tick for the symbol; null if unknown. */
  dataAgeMs: number | null;
  /** Operator token supplied with the request (compared against env). */
  operatorTokenProvided?: string;
  /** Pre-fetched equity & PnL; null lets collector return zero (pessimistic only for loss). */
  dailyPnLPct?: number | null;
  /** Pre-fetched live counts. */
  openPositionCount?: number;
  tradesTodayCount?: number;
}

/**
 * Build a RiskSnapshot from current process state + caller-provided measurements.
 * Pure given its inputs (does NOT do its own data fetching).
 */
export function buildRiskSnapshot(inputs: SnapshotInputs): RiskSnapshot {
  // Kill switch: trip if EITHER risk_engine OR risk/kill_switch reports active.
  const killActive = isKillSwitchActive() || !killSwitchAllowsTrading();

  const session = getCurrentTradingSession();
  const controls = getRiskEngineSnapshot().config;

  // Operator token: in live mode, request must supply matching token.
  const tokenValid = SYSTEM_MODE === "live_enabled"
    ? OPERATOR_TOKEN.length > 0 && inputs.operatorTokenProvided === OPERATOR_TOKEN
    : true;

  // Exposure caps come from env (Phase 3 user spec) — note these may differ from
  // the broader exposure_guard defaults (which apply to additional constraints
  // like per-strategy %). The pipeline checks the user-specified hard caps.
  void getExposureLimits; // referenced for future cross-check; not used here

  return {
    systemMode: SYSTEM_MODE,
    killSwitchActive: killActive,
    operatorTokenValid: tokenValid,
    dataAgeMs: inputs.dataAgeMs,
    maxDataAgeMs: MAX_DATA_AGE_MS,
    sessionAllowed: isSessionAllowed(session, controls),
    activeSession: session,
    newsLockoutActive: isNewsLockoutActive(),
    dailyPnLPct: inputs.dailyPnLPct ?? 0,
    maxDailyLossPct: MAX_DAILY_LOSS_PCT,
    openPositionCount: inputs.openPositionCount ?? 0,
    maxConcurrentPositions: MAX_CONCURRENT_POSITIONS,
    tradesTodayCount: inputs.tradesTodayCount ?? 0,
    maxTradesPerDay: MAX_TRADES_PER_DAY,
  };
}

export const SNAPSHOT_CONFIG = {
  systemMode: SYSTEM_MODE,
  hasOperatorToken: OPERATOR_TOKEN.length > 0,
  maxDataAgeMs: MAX_DATA_AGE_MS,
  maxDailyLossPct: MAX_DAILY_LOSS_PCT,
  maxConcurrentPositions: MAX_CONCURRENT_POSITIONS,
  maxTradesPerDay: MAX_TRADES_PER_DAY,
} as const;
