/**
 * Phase 5 — Channel-named child loggers.
 *
 * Three named channels for production triage:
 *   - execution      : order_executor + risk pipeline + audit log
 *   - proof          : paper_trades store + metrics + equity endpoints
 *   - reconciliation : reconciler + integrity checks + background jobs
 *
 * Each channel inherits the base pino logger config and adds a `channel`
 * field on every log line so log routing / filtering can split them.
 *
 * Usage:
 *   import { execLog, proofLog, reconLog } from "./log_channels";
 *   execLog.info({ symbol: "BTCUSD" }, "order_submitted");
 */
import { logger } from "./logger";

export const execLog = logger.child({ channel: "execution" });
export const proofLog = logger.child({ channel: "proof" });
export const reconLog = logger.child({ channel: "reconciliation" });
