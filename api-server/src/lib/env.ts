/**
 * Environment validation — thin wrapper over runtime_config.
 * Calling validateEnv() eagerly triggers runtime_config's
 * fail-fast parsing so the process exits before listen().
 */

import { runtimeConfig, getRuntimeConfigForLog } from "./runtime_config";
import { logger } from "./logger";

export function validateEnv(): void {
  // Accessing runtimeConfig forces the frozen config to be built.
  // If any required variable is missing or malformed, the module
  // throws synchronously and the process never reaches listen().
  const snapshot = getRuntimeConfigForLog();
  logger.info(snapshot, "Environment validated");
}

export { runtimeConfig };
