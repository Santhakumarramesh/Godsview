/**
 * auto_trade_config.ts — Autonomous Scanner Execution Config
 *
 * Controls whether the ScannerScheduler should automatically execute
 * high-quality signals through the Alpaca execution pipeline.
 *
 * Safety rails built-in:
 *   - Disabled by default (requires explicit opt-in via API or env)
 *   - Minimum quality floor enforced (default 0.70 — higher than scanner floor)
 *   - Per-session execution count cap
 *   - Cooldown between auto-executions
 *   - Circuit breaker / kill switch gate always checked at execute time
 *
 * State is in-memory — resets on server restart. Persistence of the
 * "enabled" flag is intentionally omitted so the system always starts
 * in a safe (disabled) state.
 */

import { logger as _logger } from "./logger";
import { publishAlert } from "./signal_stream";

const logger = _logger.child({ module: "auto_trade" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type AutoTradeSizingMethod = "fixed_fractional" | "half_kelly";

export interface AutoTradeConfig {
  /** Whether auto-execution from scanner signals is enabled */
  enabled:              boolean;
  /** Minimum quality score (0-1) a signal must meet to be auto-executed */
  qualityFloor:         number;
  /** Maximum auto-executions per session (resets on server restart) */
  maxExecutionsPerSession: number;
  /** Cooldown in seconds between executions of the same symbol */
  cooldownPerSymbolSec: number;
  /** Cooldown in seconds between any two auto-executions */
  globalCooldownSec:    number;
  /** Position sizing method for auto-executed trades */
  sizingMethod:         AutoTradeSizingMethod;
  /** Only execute if setup type is in this allowlist (empty = all setups allowed) */
  allowedSetups:        string[];
  /** Operator token required for live execution (mirrors GODSVIEW_OPERATOR_TOKEN) */
  requireOperatorToken: boolean;
}

export interface AutoTradeStatus {
  config:              AutoTradeConfig;
  executionsThisSession: number;
  lastExecutedAt:      string | null;
  lastSymbol:          string | null;
  /** ISO timestamps of last execution per symbol */
  symbolCooldowns:     Record<string, string>;
  /** Whether execution is currently gated by global cooldown */
  globalCooldownActive: boolean;
  globalCooldownRemainingMs: number;
}

export interface AutoTradeExecutionRecord {
  id:          string;
  symbol:      string;
  setupType:   string;
  direction:   "long" | "short";
  quality:     number;
  entryPrice:  number;
  orderId:     string | null;
  accepted:    boolean;
  rejectReason: string | null;
  executedAt:  string;
}

// ─── State ────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: AutoTradeConfig = {
  enabled:                 parseBoolEnv("AUTO_TRADE_ENABLED", false),
  qualityFloor:            parseFloatEnv("AUTO_TRADE_QUALITY_FLOOR", 0.70),
  maxExecutionsPerSession: parseIntEnv("AUTO_TRADE_MAX_PER_SESSION", 5),
  cooldownPerSymbolSec:    parseIntEnv("AUTO_TRADE_SYMBOL_COOLDOWN_SEC", 300),
  globalCooldownSec:       parseIntEnv("AUTO_TRADE_GLOBAL_COOLDOWN_SEC", 60),
  sizingMethod:            "fixed_fractional",
  allowedSetups:           [],
  requireOperatorToken:    true,
};

let _config: AutoTradeConfig = { ...DEFAULT_CONFIG };
let _executionsThisSession   = 0;
let _lastExecutedAt: string | null = null;
let _lastSymbol: string | null     = null;
const _symbolCooldowns = new Map<string, string>(); // symbol → ISO timestamp
const _executionLog: AutoTradeExecutionRecord[] = [];
const MAX_LOG_ENTRIES = 200;

// ─── Env helpers ──────────────────────────────────────────────────────────────

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
}

function parseFloatEnv(name: string, fallback: number): number {
  const v = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(v) ? v : fallback;
}

function parseIntEnv(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : fallback;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getAutoTradeConfig(): AutoTradeConfig {
  return { ..._config };
}

export function updateAutoTradeConfig(patch: Partial<AutoTradeConfig>): AutoTradeConfig {
  const prev = _config.enabled;

  if (patch.enabled           !== undefined) _config.enabled                = patch.enabled;
  if (patch.qualityFloor      !== undefined) _config.qualityFloor           = Math.max(0, Math.min(1, patch.qualityFloor));
  if (patch.maxExecutionsPerSession !== undefined) _config.maxExecutionsPerSession = Math.max(1, patch.maxExecutionsPerSession);
  if (patch.cooldownPerSymbolSec    !== undefined) _config.cooldownPerSymbolSec    = Math.max(0, patch.cooldownPerSymbolSec);
  if (patch.globalCooldownSec       !== undefined) _config.globalCooldownSec       = Math.max(0, patch.globalCooldownSec);
  if (patch.sizingMethod      !== undefined) _config.sizingMethod           = patch.sizingMethod;
  if (patch.allowedSetups     !== undefined) _config.allowedSetups          = patch.allowedSetups;
  if (patch.requireOperatorToken !== undefined) _config.requireOperatorToken = patch.requireOperatorToken;

  const next = _config.enabled;
  if (prev !== next) {
    logger.info(`[auto_trade] ${next ? "ENABLED" : "DISABLED"}`);
    try {
      publishAlert({ type: "auto_trade_toggled", enabled: next });
    } catch { /* best-effort */ }
  }

  return getAutoTradeConfig();
}

export function getAutoTradeStatus(): AutoTradeStatus {
  const now         = Date.now();
  const lastMs      = _lastExecutedAt ? new Date(_lastExecutedAt).getTime() : 0;
  const globalGapMs = _config.globalCooldownSec * 1000;
  const elapsed     = now - lastMs;
  const remaining   = Math.max(0, globalGapMs - elapsed);

  return {
    config:                  getAutoTradeConfig(),
    executionsThisSession:   _executionsThisSession,
    lastExecutedAt:          _lastExecutedAt,
    lastSymbol:              _lastSymbol,
    symbolCooldowns:         Object.fromEntries(_symbolCooldowns),
    globalCooldownActive:    elapsed < globalGapMs && _lastExecutedAt !== null,
    globalCooldownRemainingMs: remaining,
  };
}

/**
 * Gate check: should this signal be auto-executed?
 * Returns `null` if the signal should proceed, or a rejection reason string.
 */
export function checkAutoTradeGate(opts: {
  symbol:    string;
  quality:   number;
  setupType: string;
}): string | null {
  if (!_config.enabled) return "auto_trade_disabled";

  if (_executionsThisSession >= _config.maxExecutionsPerSession) {
    return `session_cap_reached (${_executionsThisSession}/${_config.maxExecutionsPerSession})`;
  }

  if (opts.quality < _config.qualityFloor) {
    return `quality_below_floor (${opts.quality.toFixed(2)} < ${_config.qualityFloor.toFixed(2)})`;
  }

  if (_config.allowedSetups.length > 0 && !_config.allowedSetups.includes(opts.setupType)) {
    return `setup_not_in_allowlist (${opts.setupType})`;
  }

  // Global cooldown
  if (_lastExecutedAt !== null) {
    const elapsed = Date.now() - new Date(_lastExecutedAt).getTime();
    if (elapsed < _config.globalCooldownSec * 1000) {
      const remaining = Math.ceil((_config.globalCooldownSec * 1000 - elapsed) / 1000);
      return `global_cooldown_active (${remaining}s remaining)`;
    }
  }

  // Per-symbol cooldown
  const lastSymbolAt = _symbolCooldowns.get(opts.symbol);
  if (lastSymbolAt) {
    const elapsed = Date.now() - new Date(lastSymbolAt).getTime();
    if (elapsed < _config.cooldownPerSymbolSec * 1000) {
      const remaining = Math.ceil((_config.cooldownPerSymbolSec * 1000 - elapsed) / 1000);
      return `symbol_cooldown_active (${opts.symbol} ${remaining}s remaining)`;
    }
  }

  return null; // proceed
}

/**
 * Record a completed auto-trade attempt (accepted or rejected).
 * Updates internal cooldown/counter state.
 */
export function recordAutoTradeAttempt(rec: Omit<AutoTradeExecutionRecord, "id">): AutoTradeExecutionRecord {
  const id    = `at_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const entry = { ...rec, id };

  if (rec.accepted) {
    _executionsThisSession++;
    _lastExecutedAt = rec.executedAt;
    _lastSymbol     = rec.symbol;
    _symbolCooldowns.set(rec.symbol, rec.executedAt);
    logger.info(`[auto_trade] Executed #${_executionsThisSession}: ${rec.symbol} ${rec.direction} q=${rec.quality.toFixed(2)}`);
  }

  _executionLog.unshift(entry);
  if (_executionLog.length > MAX_LOG_ENTRIES) _executionLog.length = MAX_LOG_ENTRIES;

  return entry;
}

export function getAutoTradeLog(): AutoTradeExecutionRecord[] {
  return [..._executionLog];
}

/**
 * Reset session counters (called by test teardown or manual admin action).
 */
export function resetAutoTradeSession(): void {
  _executionsThisSession = 0;
  _lastExecutedAt        = null;
  _lastSymbol            = null;
  _symbolCooldowns.clear();
  logger.info("[auto_trade] Session counters reset");
}
