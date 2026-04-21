/**
 * risk_v2/state.ts — Singleton broker-backed risk state.
 *
 * Phase 2: replaces the hardcoded PORTFOLIO/POSITIONS/LIMITS that lived
 * inside `routes/risk_v2.ts`. The route layer now talks to this module
 * instead of inlining fixtures.
 *
 * Behaviour:
 *   - In production with valid broker keys: positions are pulled from
 *     Alpaca and the engines are kept in sync.
 *   - In development/test: returns demo data (stamped via demo_mode).
 *   - In production without broker keys: callers receive 503 via
 *     `require503IfNoBroker`; this module never returns fake numbers.
 */
import { ExposureManager } from "./exposure_manager.js";
import { PortfolioRiskEngine } from "./portfolio_risk_engine.js";
import { MacroEventGuard } from "./macro_event_guard.js";
import { runtimeConfig } from "../runtime_config";
import { demoDataAllowed } from "../demo_mode";
import { logger } from "../logger";

let exposure: ExposureManager | null = null;
let risk: PortfolioRiskEngine | null = null;
let macro: MacroEventGuard | null = null;

/**
 * Lazily build the singletons. In production we construct empty engines
 * (no auto-mock-portfolio) and rely on Alpaca sync to populate them.
 * In dev we let the engine seed its demo portfolio so the UI renders.
 */
function buildEngines(): {
  exposure: ExposureManager;
  risk: PortfolioRiskEngine;
  macro: MacroEventGuard;
} {
  if (!exposure) exposure = new ExposureManager();
  if (!risk) risk = new PortfolioRiskEngine();
  if (!macro) macro = new MacroEventGuard();
  return { exposure, risk, macro };
}

/**
 * In production, drop any mock positions auto-installed by the engine
 * constructors so the first sync starts from a clean slate. In dev we
 * keep them as visible demo data.
 */
function clearMockPositionsIfProd(): void {
  if (runtimeConfig.nodeEnv !== "production") return;
  const engines = buildEngines();
  const expPositions = engines.exposure.getPositions();
  for (const symbol of Array.from(expPositions.keys())) {
    engines.exposure.removePosition(symbol);
  }
  const riskPositions = engines.risk.getPositions();
  for (const symbol of Array.from(riskPositions.keys())) {
    engines.risk.removePosition(symbol);
  }
  logger.info(
    { module: "risk_v2", action: "clearMockPositions" },
    "Cleared engine mock portfolio (production mode)",
  );
}

let initialized = false;

/** Get (and on first call, initialize) the engines. */
export function getRiskV2State(): {
  exposure: ExposureManager;
  risk: PortfolioRiskEngine;
  macro: MacroEventGuard;
} {
  const engines = buildEngines();
  if (!initialized) {
    initialized = true;
    clearMockPositionsIfProd();
  }
  return engines;
}

/** Whether the current state is demo (un-synced) or live broker data. */
export function isDemoState(): boolean {
  return demoDataAllowed();
}
