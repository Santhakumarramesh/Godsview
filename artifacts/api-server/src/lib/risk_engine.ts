type MutableRiskConfig = {
  maxRiskPerTradePct: number;
  maxDailyLossUsd: number;
  maxOpenExposurePct: number;
  maxConcurrentPositions: number;
  maxTradesPerSession: number;
  cooldownAfterLosses: number;
  cooldownMinutes: number;
  blockOnDegradedData: boolean;
};

type RuntimeRiskState = {
  killSwitchActive: boolean;
  updatedAt: string;
};

export type RiskEngineSnapshot = {
  runtime: RuntimeRiskState;
  config: MutableRiskConfig;
};

function parseFloatEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

const config: MutableRiskConfig = {
  maxRiskPerTradePct: parseFloatEnv("GODSVIEW_MAX_RISK_PER_TRADE_PCT", 0.01, 0, 1),
  maxDailyLossUsd: parseFloatEnv("GODSVIEW_MAX_DAILY_LOSS_USD", 250, 0, 5_000_000),
  maxOpenExposurePct: parseFloatEnv("GODSVIEW_MAX_OPEN_EXPOSURE_PCT", 0.6, 0, 5),
  maxConcurrentPositions: parseIntEnv("GODSVIEW_MAX_CONCURRENT_POSITIONS", 3, 1, 100),
  maxTradesPerSession: parseIntEnv("GODSVIEW_MAX_TRADES_PER_SESSION", 10, 1, 1000),
  cooldownAfterLosses: parseIntEnv("GODSVIEW_COOLDOWN_AFTER_LOSSES", 3, 1, 50),
  cooldownMinutes: parseIntEnv("GODSVIEW_COOLDOWN_MINUTES", 30, 1, 24 * 60),
  blockOnDegradedData: parseBooleanEnv("GODSVIEW_BLOCK_ON_DEGRADED_DATA", true),
};

const runtime: RuntimeRiskState = {
  killSwitchActive: parseBooleanEnv("GODSVIEW_KILL_SWITCH", false),
  updatedAt: new Date().toISOString(),
};

function sanitizePatch(patch: Partial<MutableRiskConfig>): Partial<MutableRiskConfig> {
  const next: Partial<MutableRiskConfig> = {};
  if (patch.maxRiskPerTradePct !== undefined) {
    const v = Number(patch.maxRiskPerTradePct);
    if (Number.isFinite(v)) next.maxRiskPerTradePct = Math.max(0, Math.min(v, 1));
  }
  if (patch.maxDailyLossUsd !== undefined) {
    const v = Number(patch.maxDailyLossUsd);
    if (Number.isFinite(v)) next.maxDailyLossUsd = Math.max(0, Math.min(v, 5_000_000));
  }
  if (patch.maxOpenExposurePct !== undefined) {
    const v = Number(patch.maxOpenExposurePct);
    if (Number.isFinite(v)) next.maxOpenExposurePct = Math.max(0, Math.min(v, 5));
  }
  if (patch.maxConcurrentPositions !== undefined) {
    const v = Math.trunc(Number(patch.maxConcurrentPositions));
    if (Number.isFinite(v)) next.maxConcurrentPositions = Math.max(1, Math.min(v, 100));
  }
  if (patch.maxTradesPerSession !== undefined) {
    const v = Math.trunc(Number(patch.maxTradesPerSession));
    if (Number.isFinite(v)) next.maxTradesPerSession = Math.max(1, Math.min(v, 1000));
  }
  if (patch.cooldownAfterLosses !== undefined) {
    const v = Math.trunc(Number(patch.cooldownAfterLosses));
    if (Number.isFinite(v)) next.cooldownAfterLosses = Math.max(1, Math.min(v, 50));
  }
  if (patch.cooldownMinutes !== undefined) {
    const v = Math.trunc(Number(patch.cooldownMinutes));
    if (Number.isFinite(v)) next.cooldownMinutes = Math.max(1, Math.min(v, 24 * 60));
  }
  if (patch.blockOnDegradedData !== undefined) {
    next.blockOnDegradedData = Boolean(patch.blockOnDegradedData);
  }
  return next;
}

export function getRiskEngineSnapshot(): RiskEngineSnapshot {
  return {
    runtime: { ...runtime },
    config: { ...config },
  };
}

export function setKillSwitchActive(active: boolean): RiskEngineSnapshot {
  runtime.killSwitchActive = Boolean(active);
  runtime.updatedAt = new Date().toISOString();
  return getRiskEngineSnapshot();
}

export function isKillSwitchActive(): boolean {
  return runtime.killSwitchActive;
}

export function updateRiskConfig(patch: Partial<MutableRiskConfig>): RiskEngineSnapshot {
  const next = sanitizePatch(patch);
  Object.assign(config, next);
  runtime.updatedAt = new Date().toISOString();
  return getRiskEngineSnapshot();
}

export function resetRiskEngineRuntime(): RiskEngineSnapshot {
  runtime.updatedAt = new Date().toISOString();
  return getRiskEngineSnapshot();
}
