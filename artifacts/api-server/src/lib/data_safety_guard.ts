/**
 * Data Safety Guard — prevents synthetic/fake data from contaminating live trading decisions.
 *
 * In paper/demo mode: synthetic fallbacks are allowed but logged with warnings.
 * In live mode: synthetic data is BLOCKED — functions throw instead of returning fake data.
 */
import { logger } from "./logger";

export type DataMode = "demo" | "paper" | "live" | "strict_live";

export function getDataMode(): DataMode {
  const envMode = process.env.GODSVIEW_SYSTEM_MODE ?? "paper";
  if (envMode === "live" || envMode === "strict_live") return envMode as DataMode;
  if (envMode === "demo") return "demo";
  return "paper";
}

export function isLiveMode(): boolean {
  const mode = getDataMode();
  return mode === "live" || mode === "strict_live";
}

export function allowSyntheticFallback(context: string): boolean {
  const mode = getDataMode();
  if (mode === "live" || mode === "strict_live") {
    logger.error({ context, mode }, "BLOCKED: Synthetic data fallback attempted in live mode");
    return false;
  }
  logger.warn({ context, mode }, "Synthetic data fallback activated (allowed in non-live mode)");
  return true;
}

export function guardSyntheticData<T>(
  context: string,
  syntheticFn: () => T,
  errorMessage?: string,
): T {
  if (!allowSyntheticFallback(context)) {
    throw new Error(
      errorMessage ?? `Synthetic data blocked in live mode: ${context}. Real market data required.`,
    );
  }
  logSyntheticUsage(context);
  return syntheticFn();
}

export interface DataSourceTag {
  source: "alpaca" | "tiingo" | "alphavantage" | "finnhub" | "synthetic" | "unknown";
  has_real_data: boolean;
  synthetic_reason?: string;
  timestamp: string;
}

export function createDataSourceTag(
  source: DataSourceTag["source"],
  hasRealData: boolean,
  reason?: string,
): DataSourceTag {
  return {
    source,
    has_real_data: hasRealData,
    synthetic_reason: reason,
    timestamp: new Date().toISOString(),
  };
}

/** Track synthetic data usage for observability */
const syntheticUsageLog: Array<{ context: string; timestamp: string; mode: DataMode }> = [];

export function logSyntheticUsage(context: string): void {
  const mode = getDataMode();
  syntheticUsageLog.push({ context, timestamp: new Date().toISOString(), mode });
  if (syntheticUsageLog.length > 1000) syntheticUsageLog.shift();
}

export function getSyntheticUsageStats(): {
  totalSyntheticFallbacks: number;
  recentFallbacks: typeof syntheticUsageLog;
} {
  return {
    totalSyntheticFallbacks: syntheticUsageLog.length,
    recentFallbacks: syntheticUsageLog.slice(-50),
  };
}
