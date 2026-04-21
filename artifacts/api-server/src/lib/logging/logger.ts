/**
 * logging/logger.ts — compat shim.
 *
 * Phase 5 activates governance scaffolds (promotion_engine, calibration_tracker,
 * promotion_discipline, trust_surface, shadow_scorecard) that were originally
 * authored against an earlier logger layout at `../logging/logger`. The canonical
 * pino logger now lives at `../logger`; this file re-exports that singleton so
 * the legacy import paths keep resolving without duplicating the pino config.
 *
 * New code should import from `../logger` directly.
 */
import type { Logger as PinoLogger } from "pino";

export { logger } from "../logger";
export type Logger = PinoLogger;
