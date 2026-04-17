type MutableRiskConfig = {
  maxRiskPerTradePct: number;
  maxDailyLossUsd: number;
  maxDrawdownPct: number;
  maxPortfolioVarPct: number;
  maxPortfolioCorrelation: number;
  maxPairCorrelation: number;
  maxOpenExposurePct: number;
  maxConcurrentPositions: number;
  maxTradesPerSession: number;
  cooldownAfterLosses: number;
  cooldownMinutes: number;
  blockOnDegradedData: boolean;
  allowAsianSession: boolean;
  allowLondonSession: boolean;
  allowNySession: boolean;
  newsLockoutActive: boolean;
};

export type TradingSession = "Asian" | "London" | "NY";

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
  maxDrawdownPct: parseFloatEnv("GODSVIEW_MAX_DRAWDOWN_PCT", 0.15, 0, 1),
  maxPortfolioVarPct: parseFloatEnv("GODSVIEW_MAX_PORTFOLIO_VAR_PCT", 0.02, 0, 1),
  maxPortfolioCorrelation: parseFloatEnv("GODSVIEW_MAX_PORTFOLIO_CORRELATION", 0.7, 0, 1),
  maxPairCorrelation: parseFloatEnv("GODSVIEW_MAX_PAIR_CORRELATION", 0.9, 0, 1),
  maxOpenExposurePct: parseFloatEnv("GODSVIEW_MAX_OPEN_EXPOSURE_PCT", 0.6, 0, 5),
  maxConcurrentPositions: parseIntEnv("GODSVIEW_MAX_CONCURRENT_POSITIONS", 3, 1, 100),
  maxTradesPerSession: parseIntEnv("GODSVIEW_MAX_TRADES_PER_SESSION", 10, 1, 1000),
  cooldownAfterLosses: parseIntEnv("GODSVIEW_COOLDOWN_AFTER_LOSSES", 3, 1, 50),
  cooldownMinutes: parseIntEnv("GODSVIEW_COOLDOWN_MINUTES", 30, 1, 24 * 60),
  blockOnDegradedData: parseBooleanEnv("GODSVIEW_BLOCK_ON_DEGRADED_DATA", true),
  allowAsianSession: parseBooleanEnv("GODSVIEW_ALLOW_SESSION_ASIAN", true),
  allowLondonSession: parseBooleanEnv("GODSVIEW_ALLOW_SESSION_LONDON", true),
  allowNySession: parseBooleanEnv("GODSVIEW_ALLOW_SESSION_NY", true),
  newsLockoutActive: parseBooleanEnv("GODSVIEW_NEWS_LOCKOUT_ACTIVE", false),
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
  if (patch.maxDrawdownPct !== undefined) {
    const v = Number(patch.maxDrawdownPct);
    if (Number.isFinite(v)) next.maxDrawdownPct = Math.max(0, Math.min(v, 1));
  }
  if (patch.maxPortfolioVarPct !== undefined) {
    const v = Number(patch.maxPortfolioVarPct);
    if (Number.isFinite(v)) next.maxPortfolioVarPct = Math.max(0, Math.min(v, 1));
  }
  if (patch.maxPortfolioCorrelation !== undefined) {
    const v = Number(patch.maxPortfolioCorrelation);
    if (Number.isFinite(v)) next.maxPortfolioCorrelation = Math.max(0, Math.min(v, 1));
  }
  if (patch.maxPairCorrelation !== undefined) {
    const v = Number(patch.maxPairCorrelation);
    if (Number.isFinite(v)) next.maxPairCorrelation = Math.max(0, Math.min(v, 1));
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
  if (patch.allowAsianSession !== undefined) {
    next.allowAsianSession = Boolean(patch.allowAsianSession);
  }
  if (patch.allowLondonSession !== undefined) {
    next.allowLondonSession = Boolean(patch.allowLondonSession);
  }
  if (patch.allowNySession !== undefined) {
    next.allowNySession = Boolean(patch.allowNySession);
  }
  if (patch.newsLockoutActive !== undefined) {
    next.newsLockoutActive = Boolean(patch.newsLockoutActive);
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

export function getCurrentTradingSession(at: Date = new Date()): TradingSession {
  const hour = at.getUTCHours();
  if (hour >= 13 && hour < 22) return "NY";
  if (hour >= 7 && hour < 13) return "London";
  return "Asian";
}

export function isSessionAllowed(
  session: TradingSession,
  source: Pick<MutableRiskConfig, "allowAsianSession" | "allowLondonSession" | "allowNySession"> = config,
): boolean {
  if (session === "Asian") return source.allowAsianSession;
  if (session === "London") return source.allowLondonSession;
  return source.allowNySession;
}

export function isNewsLockoutActive(): boolean {
  return config.newsLockoutActive;
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
