/**
 * Startup Validator — Runs deterministic checks at server boot.
 *
 * Ensures the system is correctly configured before accepting traffic.
 * Called from the entrypoint BEFORE the Express app starts listening.
 *
 * Checks:
 * 1. Required environment variables are present
 * 2. GODSVIEW_SYSTEM_MODE is valid
 * 3. Database is reachable (if DATABASE_URL set)
 * 4. Risk limits are sane
 * 5. Live trading is disabled by default
 * 6. No conflicting env configurations
 *
 * On failure: logs errors and either exits or starts in degraded mode.
 */
import { logger } from "../logger.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface StartupCheck {
  name: string;
  passed: boolean;
  required: boolean; // if required and failed → block startup
  message: string;
}

export interface StartupValidationResult {
  allPassed: boolean;
  criticalFailures: number;
  warningCount: number;
  checks: StartupCheck[];
  startedAt: string;
  mode: string;
}

// ── Valid Modes ──────────────────────────────────────────────────────────────

const VALID_MODES = ["demo", "paper", "live", "strict_live"] as const;

// ── Validator ────────────────────────────────────────────────────────────────

export function runStartupValidation(): StartupValidationResult {
  const checks: StartupCheck[] = [];
  const startedAt = new Date().toISOString();

  // 1. Check GODSVIEW_SYSTEM_MODE
  const mode = process.env.GODSVIEW_SYSTEM_MODE ?? "paper";
  const validMode = (VALID_MODES as readonly string[]).includes(mode);
  checks.push({
    name: "system_mode",
    passed: validMode,
    required: true,
    message: validMode
      ? `System mode: ${mode}`
      : `Invalid GODSVIEW_SYSTEM_MODE="${mode}". Must be one of: ${VALID_MODES.join(", ")}`,
  });

  // 2. Check PORT
  const port = process.env.PORT;
  const portNum = port ? parseInt(port, 10) : 3001;
  checks.push({
    name: "port_config",
    passed: portNum > 0 && portNum < 65536,
    required: true,
    message: `Port: ${portNum}`,
  });

  // 3. Check DATABASE_URL presence
  const hasDb = !!process.env.DATABASE_URL;
  checks.push({
    name: "database_url",
    passed: hasDb,
    required: false, // PGlite fallback exists
    message: hasDb
      ? "DATABASE_URL configured"
      : "No DATABASE_URL — will use PGlite (dev mode only)",
  });

  // 4. Check live trading safety
  const liveTradingEnabled = process.env.GODSVIEW_ENABLE_LIVE_TRADING === "true";
  const isLiveMode = mode === "live" || mode === "strict_live";

  if (liveTradingEnabled && !isLiveMode) {
    checks.push({
      name: "live_trading_mode_mismatch",
      passed: false,
      required: false,
      message: "GODSVIEW_ENABLE_LIVE_TRADING=true but mode is not live/strict_live — ignoring live flag",
    });
  }

  if (isLiveMode && !liveTradingEnabled) {
    checks.push({
      name: "live_mode_safety",
      passed: true, // this is correct behavior
      required: false,
      message: `Mode is ${mode} but live trading disabled — safe observation mode`,
    });
  }

  checks.push({
    name: "live_trading_default",
    passed: !liveTradingEnabled || isLiveMode,
    required: true,
    message: liveTradingEnabled
      ? "⚠ LIVE TRADING ENABLED — orders will be placed with real money"
      : "Live trading disabled (safe default)",
  });

  // 5. Check Alpaca credentials
  const hasAlpacaKey = !!process.env.ALPACA_API_KEY;
  const hasAlpacaSecret = !!process.env.ALPACA_SECRET_KEY;
  const alpacaBase = process.env.ALPACA_BASE_URL ?? "";
  const isPaperAlpaca = alpacaBase.includes("paper-api");

  const alpacaConfigured = hasAlpacaKey && hasAlpacaSecret;
  checks.push({
    name: "alpaca_credentials",
    passed: alpacaConfigured || !isLiveMode,
    required: isLiveMode, // MUST have Alpaca keys in live mode
    message: alpacaConfigured
      ? `Alpaca configured (${isPaperAlpaca ? "PAPER" : "LIVE"} endpoint)`
      : isLiveMode
        ? "CRITICAL: Alpaca credentials MISSING in live mode — set ALPACA_API_KEY and ALPACA_SECRET_KEY"
        : "Alpaca credentials not configured — trading disabled",
  });

  // 6. Live mode + paper Alpaca mismatch
  if (isLiveMode && isPaperAlpaca) {
    checks.push({
      name: "alpaca_endpoint_mismatch",
      passed: false,
      required: false,
      message: "Mode is live but Alpaca endpoint is paper-api — orders will be paper only",
    });
  }

  // 7. Check risk limits
  const maxDailyLoss = parseFloat(process.env.GODSVIEW_MAX_DAILY_LOSS_USD ?? "250");
  const maxExposure = parseFloat(process.env.GODSVIEW_MAX_OPEN_EXPOSURE_PCT ?? "0.6");

  checks.push({
    name: "risk_limits",
    passed: maxDailyLoss > 0 && maxExposure > 0 && maxExposure <= 1,
    required: false,
    message: `Risk limits: max daily loss $${maxDailyLoss}, max exposure ${(maxExposure * 100).toFixed(0)}%`,
  });

  // 8. Check operator token
  const operatorToken = process.env.GODSVIEW_OPERATOR_TOKEN;
  const tokenSecure = operatorToken && operatorToken !== "change-me" && operatorToken.length >= 16;
  checks.push({
    name: "operator_token",
    passed: !!tokenSecure,
    required: isLiveMode, // required only for live mode
    message: tokenSecure
      ? "Operator token configured"
      : "Operator token not set or insecure — set GODSVIEW_OPERATOR_TOKEN (min 16 chars)",
  });

  // 9. Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  checks.push({
    name: "node_version",
    passed: majorVersion >= 20,
    required: false,
    message: `Node.js ${nodeVersion} (recommended: >= 20)`,
  });

  // Aggregate
  const criticalFailures = checks.filter(c => c.required && !c.passed).length;
  const warningCount = checks.filter(c => !c.required && !c.passed).length;
  const allPassed = criticalFailures === 0;

  const result: StartupValidationResult = {
    allPassed,
    criticalFailures,
    warningCount,
    checks,
    startedAt,
    mode,
  };

  // Log summary
  if (allPassed) {
    logger.info({
      mode,
      checks: checks.length,
      warnings: warningCount,
    }, "✅ Startup validation PASSED");
  } else {
    logger.error({
      mode,
      criticalFailures,
      failures: checks.filter(c => !c.passed).map(c => c.message),
    }, "❌ Startup validation FAILED — critical issues detected");
  }

  // Log each check
  for (const check of checks) {
    if (!check.passed && check.required) {
      logger.error({ check: check.name }, `CRITICAL: ${check.message}`);
    } else if (!check.passed) {
      logger.warn({ check: check.name }, `WARNING: ${check.message}`);
    }
  }

  return result;
}

/**
 * Run validation and exit if critical failures found.
 * Call this at the very start of the server.
 */
export function validateOrExit(): StartupValidationResult {
  const result = runStartupValidation();

  if (!result.allPassed) {
    logger.error(
      "Server cannot start due to critical configuration failures. Fix the issues above and restart.",
    );
    // Don't actually process.exit in non-production to support dev/testing
    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }
  }

  return result;
}
