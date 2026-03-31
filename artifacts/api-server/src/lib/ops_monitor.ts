import { logger } from "./logger";

export interface ServiceHealth {
  name: string;
  status: "healthy" | "degraded" | "down";
  latency_ms: number | null;
  last_check: string;
  details: string;
}

export interface OpsSnapshot {
  timestamp: string;
  overall_status: "green" | "yellow" | "red";
  services: ServiceHealth[];
  data_freshness: {
    alpaca_bars_age_ms: number | null;
    orderbook_age_ms: number | null;
    si_last_decision_age_ms: number | null;
  };
  broker: {
    connected: boolean;
    mode: string;
    account_equity: number | null;
    buying_power: number | null;
  };
  system: {
    uptime_ms: number;
    memory_used_mb: number;
    memory_total_mb: number;
    cpu_usage_pct: number | null;
  };
  engine_status: Record<
    string,
    { loaded: boolean; last_run: string | null; error_count: number }
  >;
  alerts: Array<{
    level: "info" | "warn" | "critical";
    message: string;
    timestamp: string;
  }>;
}

interface FreshnessTracker {
  [key: string]: Date | null;
}

interface EngineTracker {
  [name: string]: {
    loaded: boolean;
    last_run: Date | null;
    error_count: number;
  };
}

const MAX_ALERTS = 100;
let lastSnapshot: OpsSnapshot | null = null;
let lastSnapshotTime = 0;
const SNAPSHOT_TTL_MS = 5000;

const freshnessTracker: FreshnessTracker = {
  alpaca_bars: null,
  orderbook: null,
  si_last_decision: null,
};

const engineTracker: EngineTracker = {};
const alertsQueue: OpsSnapshot["alerts"] = [];

export function updateDataFreshness(key: string, timestamp: Date): void {
  freshnessTracker[key] = timestamp;
}

export function registerEngine(name: string): void {
  if (!engineTracker[name]) {
    engineTracker[name] = {
      loaded: true,
      last_run: null,
      error_count: 0,
    };
    logger.info(`Registered engine: ${name}`);
  }
}

export function markEngineRun(name: string): void {
  if (!engineTracker[name]) {
    registerEngine(name);
  }
  engineTracker[name].last_run = new Date();
}

export function markEngineError(name: string): void {
  if (!engineTracker[name]) {
    registerEngine(name);
  }
  engineTracker[name].error_count++;
}

export function addOpsAlert(
  level: "info" | "warn" | "critical",
  message: string
): void {
  const alert = {
    level,
    message,
    timestamp: new Date().toISOString(),
  };
  alertsQueue.unshift(alert);
  if (alertsQueue.length > MAX_ALERTS) {
    alertsQueue.pop();
  }
  logger.info(`[OPS ALERT] ${level.toUpperCase()}: ${message}`);
}

export function getOpsAlerts(limit: number = 50): OpsSnapshot["alerts"] {
  return alertsQueue.slice(0, limit);
}

export function clearOpsAlerts(): void {
  alertsQueue.length = 0;
}

function checkServiceHealth(
  name: string,
  checkFn: () => boolean
): ServiceHealth {
  const now = new Date().toISOString();
  try {
    const isHealthy = checkFn();
    return {
      name,
      status: isHealthy ? "healthy" : "degraded",
      latency_ms: null,
      last_check: now,
      details: isHealthy ? "OK" : "Check failed",
    };
  } catch (err) {
    return {
      name,
      status: "down",
      latency_ms: null,
      last_check: now,
      details: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

function calculateDataFreshnessAge(key: string): number | null {
  const timestamp = freshnessTracker[key];
  if (!timestamp) return null;
  return Date.now() - timestamp.getTime();
}

function buildEngineStatus(): Record<
  string,
  { loaded: boolean; last_run: string | null; error_count: number }
> {
  const result: Record<
    string,
    { loaded: boolean; last_run: string | null; error_count: number }
  > = {};
  for (const [name, tracker] of Object.entries(engineTracker)) {
    result[name] = {
      loaded: tracker.loaded,
      last_run: tracker.last_run ? tracker.last_run.toISOString() : null,
      error_count: tracker.error_count,
    };
  }
  return result;
}

export function getOpsSnapshot(): OpsSnapshot {
  const now = Date.now();
  if (lastSnapshot && now - lastSnapshotTime < SNAPSHOT_TTL_MS) {
    return lastSnapshot;
  }

  const alpacaApiKey = process.env.ALPACA_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const tradingMode = process.env.TRADING_MODE || "paper";

  const services: ServiceHealth[] = [
    checkServiceHealth("api_server", () => true),
    checkServiceHealth("alpaca_stream", () => !!alpacaApiKey),
    checkServiceHealth("database", () => {
      try {
        require("@workspace/db");
        return true;
      } catch {
        return false;
      }
    }),
    checkServiceHealth("orderbook", () => !!alpacaApiKey),
    checkServiceHealth("claude_reasoning", () => !!anthropicKey),
  ];

  const overallStatus: "green" | "yellow" | "red" =
    services.every((s) => s.status === "healthy")
      ? "green"
      : services.some((s) => s.status === "down")
        ? "red"
        : "yellow";

  const memUsage = process.memoryUsage();

  const snapshot: OpsSnapshot = {
    timestamp: new Date().toISOString(),
    overall_status: overallStatus,
    services,
    data_freshness: {
      alpaca_bars_age_ms: calculateDataFreshnessAge("alpaca_bars"),
      orderbook_age_ms: calculateDataFreshnessAge("orderbook"),
      si_last_decision_age_ms: calculateDataFreshnessAge("si_last_decision"),
    },
    broker: {
      connected: !!alpacaApiKey,
      mode: tradingMode,
      account_equity: null,
      buying_power: null,
    },
    system: {
      uptime_ms: Math.floor(process.uptime() * 1000),
      memory_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
      memory_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
      cpu_usage_pct: null,
    },
    engine_status: buildEngineStatus(),
    alerts: [...alertsQueue],
  };

  lastSnapshot = snapshot;
  lastSnapshotTime = now;
  return snapshot;
}
