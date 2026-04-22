/**
 * scanner_scheduler.ts — Autonomous Multi-Symbol Signal Scanner
 *
 * Runs a background schedule that:
 *   1. Reads the enabled watchlist
 *   2. For each symbol: fetches bars, runs setup detection + NoTrade filters
 *   3. Deduplicates alerts (same symbol/setup pair suppressed within cooldown window)
 *   4. Broadcasts high-quality setups as SSE "scanner_alert" events
 *   5. Records decisions in the trade journal
 *   6. Maintains a ring buffer of scan run history
 *
 * Architecture mirrors MacroContextService: singleton, start/stop, env-configurable interval.
 *
 * Env vars:
 *   SCANNER_INTERVAL_MS     — scan cycle in ms (default 120_000 = 2 min)
 *   SCANNER_ALERT_COOLDOWN_MS — per-symbol/setup cooldown (default 600_000 = 10 min)
 *   SCANNER_MAX_CONCURRENT  — symbols scanned in parallel (default 3)
 */

import {
  buildRecallFeatures,
  applyNoTradeFilters,
  computeATR,
  computeTPSL,
  computeFinalQuality,
  scoreRecall,
  getQualityThreshold,
  type SetupType,
} from "./strategy_engine";
import {
  DEFAULT_SETUPS,
  getSetupDefinition,
  evaluateC4Decision,
  classifyMarketRegime,
  isCategoryAllowedInRegime,
} from "@workspace/strategy-core";
import {
  getBars,
  placeOrder,
  getAccount,
  isAlpacaAuthFailureError,
  getAlpacaAuthFailureState,
} from "./alpaca";
import { publishAlert } from "./signal_stream";
import { listEnabledSymbols, touchScanned } from "./watchlist";
import { recordDecision } from "./trade_journal";
import { getCurrentMacroContext } from "./macro_context_service";
import {
  runSetupDetector,
  computeC4ContextScore,
  computeC4ConfirmationScore,
} from "./signal_pipeline";
import { getRiskEngineSnapshot, getCurrentTradingSession, isSessionAllowed, isKillSwitchActive } from "./risk_engine";
import { checkCircuitBreaker } from "./circuit_breaker";
import { checkAutoTradeGate, recordAutoTradeAttempt } from "./auto_trade_config";
import { computePositionSize } from "./position_sizer";
import { logger as _logger } from "./logger";
import { getStrategyAllocationForSignal } from "./strategy_allocator";

const logger = _logger.child({ module: "scanner" });

// ─── Config ───────────────────────────────────────────────────────────────────

const SCAN_INTERVAL_MS     = parseInt(process.env.SCANNER_INTERVAL_MS       ?? "120000",  10);
const ALERT_COOLDOWN_MS    = parseInt(process.env.SCANNER_ALERT_COOLDOWN_MS ?? "600000",  10);
const MAX_CONCURRENT       = parseInt(process.env.SCANNER_MAX_CONCURRENT    ?? "3",       10);
const HISTORY_MAX          = 100;
const QUALITY_FLOOR        = 0.55; // minimum quality score to emit an alert
const AUTH_WARN_COOLDOWN_MS = 30_000;
let _lastAuthWarnMs = 0;
let _lastAuthCycleSkipWarnMs = 0;

function logAuthDegraded(symbol: string, err: Error): void {
  const now = Date.now();
  if (now - _lastAuthWarnMs >= AUTH_WARN_COOLDOWN_MS) {
    _lastAuthWarnMs = now;
    logger.warn({ symbol, err: err.message }, "[scanner] Alpaca auth unavailable — scan degraded");
    return;
  }
  logger.debug({ symbol, err: err.message }, "[scanner] Alpaca auth unavailable — scan degraded");
}

function logAuthCycleSkipped(remainingMs: number, status: number | null): void {
  const now = Date.now();
  const payload = { remainingMs, status };
  if (now - _lastAuthCycleSkipWarnMs >= AUTH_WARN_COOLDOWN_MS) {
    _lastAuthCycleSkipWarnMs = now;
    logger.warn(payload, "[scanner] Alpaca auth cooldown active — skipping symbol fetches for this cycle");
    return;
  }
  logger.debug(payload, "[scanner] Alpaca auth cooldown active — skipping symbol fetches for this cycle");
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScannerAlert {
  id:          string;
  symbol:      string;
  setupType:   SetupType;
  direction:   "long" | "short";
  quality:     number;
  regime:      string;
  entryPrice:  number;
  stopLoss:    number;
  takeProfit:  number;
  atr:         number;
  macroBias:   { bias: string; conviction: string; direction: string; score: number };
  sentiment:   { retailBias: string; institutionalEdge: string; sentimentScore: number };
  detectedAt:  string;
  scanRunId:   string;
}

export interface ScanRun {
  id:              string;
  startedAt:       string;
  completedAt:     string | null;
  status:          "running" | "completed" | "error";
  symbolsScanned:  number;
  signalsFound:    number;
  alertsEmitted:   number;
  blocked:         number;
  durationMs:      number | null;
  error:           string | null;
}

// ─── Cooldown registry ────────────────────────────────────────────────────────

/** symbol::setup → epoch ms when it was last alerted */
const _cooldowns = new Map<string, number>();

function isCooledDown(symbol: string, setup: SetupType): boolean {
  const key = `${symbol}::${setup}`;
  const last = _cooldowns.get(key);
  if (!last) return true;
  return Date.now() - last >= ALERT_COOLDOWN_MS;
}

function markAlerted(symbol: string, setup: SetupType): void {
  _cooldowns.set(`${symbol}::${setup}`, Date.now());
}

function getCooldownMs(): number { return ALERT_COOLDOWN_MS; }
function getScanIntervalMs(): number { return SCAN_INTERVAL_MS; }

// ─── History ring buffer ──────────────────────────────────────────────────────

const _history: ScanRun[] = [];
let _currentRun: ScanRun | null = null;

function _recordRunStart(): ScanRun {
  const run: ScanRun = {
    id:             `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    startedAt:      new Date().toISOString(),
    completedAt:    null,
    status:         "running",
    symbolsScanned: 0,
    signalsFound:   0,
    alertsEmitted:  0,
    blocked:        0,
    durationMs:     null,
    error:          null,
  };
  _currentRun = run;
  _history.unshift(run);
  if (_history.length > HISTORY_MAX) _history.pop();
  return run;
}

function _finaliseRun(run: ScanRun, error?: string): void {
  run.completedAt = new Date().toISOString();
  run.status      = error ? "error" : "completed";
  run.durationMs  = Date.now() - new Date(run.startedAt).getTime();
  if (error) run.error = error;
  _currentRun = null;
}

// ─── Symbol scanner ───────────────────────────────────────────────────────────

async function scanSymbol(
  symbol: string,
  assetClass: "crypto" | "forex" | "equity" | "commodity",
  run: ScanRun,
): Promise<void> {
  try {
    const [bars1m, bars5m] = await Promise.all([
      getBars(symbol, "1Min", 200),
      getBars(symbol, "5Min", 100),
    ]);

    if (bars1m.length < 20) {
      logger.debug({ symbol }, "[scanner] Insufficient bars — skipping");
      return;
    }

    const recall     = buildRecallFeatures(bars1m, bars5m);
    const atr        = computeATR(bars1m);
    const lastBar    = bars1m[bars1m.length - 1];
    const entryPrice = Number(lastBar.Close);
    const regime     = recall.regime;
    const controls   = getRiskEngineSnapshot().config;
    const activeSession = getCurrentTradingSession();
    const sessionAllowed = isSessionAllowed(activeSession, controls);

    const regimeEngine = classifyMarketRegime({
      baseRegime:             regime,
      atrPct:                 recall.atr_pct,
      trendSlope5m:           recall.trend_slope_5m,
      directionalPersistence: recall.directional_persistence,
      newsLockoutActive:      controls.newsLockoutActive,
    });

    const macroCtx = getCurrentMacroContext();

    for (const setup of DEFAULT_SETUPS as SetupType[]) {
      // Pre-filter: only emit if cooled down
      if (!isCooledDown(symbol, setup)) continue;

      // No-trade filters
      const noTrade = applyNoTradeFilters(bars1m, recall, setup, {
        replayMode:        false,
        sessionAllowed,
        newsLockoutActive: controls.newsLockoutActive,
        macroBias:         macroCtx.macroBias as any,
        sentiment:         macroCtx.sentiment as any,
      });

      if (noTrade.blocked) {
        run.blocked++;
        try {
          recordDecision({
            symbol, setupType: setup,
            direction:   recall.trend_slope_5m >= 0 ? "long" : "short",
            decision:    "blocked",
            blockReason: noTrade.reason,
            macroBias:   macroCtx.macroBias as any,
            sentiment:   macroCtx.sentiment as any,
            signalPrice: entryPrice,
            regime,
          });
        } catch { /* best-effort */ }
        continue;
      }

      // Run setup detector
      const result = runSetupDetector(setup, bars1m, bars5m, recall);
      if (!result.detected) continue;

      const setupDef = getSetupDefinition(setup);
      if (!isCategoryAllowedInRegime(setupDef.c4Category, regimeEngine.regimeClass)) continue;

      const recallScore         = scoreRecall(recall, setup, result.direction);
      const c4ContextScore      = computeC4ContextScore(recallScore, recall);
      const c4ConfirmationScore = computeC4ConfirmationScore(setupDef, result, recall);

      const c4 = evaluateC4Decision({
        setup: setupDef,
        scores: {
          structure:    result.structure,
          orderflow:    result.orderFlow,
          context:      c4ContextScore,
          confirmation: c4ConfirmationScore,
        },
        gates: {
          sessionAllowed,
          newsClear:     !controls.newsLockoutActive,
          degradedData:  false,
          inSkZone:      recall.sk.in_zone,
        },
      });

      if (c4.blocked) continue;

      const direction = result.direction as "long" | "short";
      const finalQuality = computeFinalQuality(result.structure, result.orderFlow, recallScore, {
        recall,
        direction,
        setup_type: setup,
      });
      const threshold = getQualityThreshold(regime, setup);
      if (c4.decision === "REJECT" || finalQuality < threshold) continue;
      if (finalQuality < QUALITY_FLOOR) continue;

      run.signalsFound++;

      // Compute TPSL
      const { stopLoss, takeProfit } = computeTPSL(entryPrice, direction, atr, regime);

      const alert: ScannerAlert = {
        id:         `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        symbol,
        setupType:  setup,
        direction,
        quality:    finalQuality,
        regime,
        entryPrice,
        stopLoss,
        takeProfit,
        atr,
        macroBias: {
          bias:       macroCtx.macroBias?.bias       ?? "neutral",
          conviction: macroCtx.macroBias?.conviction ?? "low",
          direction:  macroCtx.macroBias?.direction  ?? "flat",
          score:      macroCtx.macroBias?.score      ?? 0.5,
        },
        sentiment: {
          retailBias:        macroCtx.sentiment?.retailBias        ?? "balanced",
          institutionalEdge: macroCtx.sentiment?.institutionalEdge ?? "none",
          sentimentScore:    macroCtx.sentiment?.sentimentScore    ?? 0.5,
        },
        detectedAt: new Date().toISOString(),
        scanRunId:  run.id,
      };

      // SSE broadcast
      publishAlert({ type: "scanner_alert", data: alert });
      markAlerted(symbol, setup);
      run.alertsEmitted++;

      // Journal
      try {
        recordDecision({
          symbol, setupType: setup, direction,
          decision:    "passed",
          macroBias:   macroCtx.macroBias as any,
          sentiment:   macroCtx.sentiment as any,
          signalPrice: entryPrice,
          regime,
          quality: {
            structure:  result.structure,
            orderFlow:  result.orderFlow,
            recall:     recallScore,
            ml:         0,
            final:      finalQuality,
          },
        });
      } catch { /* best-effort */ }

      logger.info({ symbol, setup, direction, quality: finalQuality }, "[scanner] Alert emitted");

      // ── Auto-execute (best-effort, non-blocking) ──────────────────────────
      const gateReject = checkAutoTradeGate({ symbol, quality: finalQuality, setupType: setup });
      if (gateReject === null) {
        // Fire-and-forget — do not await so scanner cycle isn't blocked
        (async () => {
          const executedAt = new Date().toISOString();
          let orderId: string | null = null;
          let accepted = false;
          let rejectReason: string | null = null;

          try {
            const acct = await getAccount() as any;
            const equity = Number(acct?.equity ?? acct?.portfolio_value ?? 0);
            if (equity <= 0) throw new Error("zero_equity");

            const sizing = computePositionSize({
              entryPrice,
              stopLossPrice: alert.stopLoss,
              accountEquity: equity,
              method:        "fixed_fractional",
            });

            const allocation = getStrategyAllocationForSignal({
              setup_type: setup,
              regime,
              symbol,
            });

            const qty = Math.max(0, Math.floor(sizing.qty * allocation.multiplier));
            if (qty <= 0) {
              throw new Error(`strategy_allocation_zero_qty (${allocation.match_level})`);
            }

            const order = await placeOrder({
              symbol,
              qty,
              side:              direction === "long" ? "buy" : "sell",
              type:              "market",
              time_in_force:     "gtc",
              take_profit_price: alert.takeProfit,
              stop_loss_price:   alert.stopLoss,
            });

            orderId  = order.id;
            accepted = true;
            logger.info(
              {
                symbol,
                direction,
                orderId,
                qty,
                allocationMultiplier: allocation.multiplier,
                allocationStrategy: allocation.strategy_id,
              },
              "[auto_trade] Order placed",
            );

            publishAlert({
              type: "auto_trade_executed",
              symbol,
              direction,
              orderId,
              quality: finalQuality,
              qty,
              allocation_multiplier: allocation.multiplier,
              allocation_strategy: allocation.strategy_id,
            });
          } catch (err: any) {
            rejectReason = err?.message ?? String(err);
            logger.warn({ symbol, err: rejectReason }, "[auto_trade] Execution failed");
          }

          recordAutoTradeAttempt({
            symbol, setupType: setup, direction, quality: finalQuality,
            entryPrice, orderId, accepted, rejectReason, executedAt,
          });
        })().catch(() => { /* swallow async error */ });
      } else {
        logger.debug({ symbol, setup, reason: gateReject }, "[auto_trade] Skipped");
      }
    }

    touchScanned(symbol, run.signalsFound > 0);
  } catch (err) {
    if (isAlpacaAuthFailureError(err)) {
      const normalizedErr = err instanceof Error ? err : new Error(String(err));
      logAuthDegraded(symbol, normalizedErr);
      touchScanned(symbol, false);
      return;
    }
    touchScanned(symbol, false);
    logger.warn({ symbol, err }, "[scanner] Symbol scan failed");
  } finally {
    run.symbolsScanned++;
  }
}

// ─── Concurrency helper ───────────────────────────────────────────────────────

async function runConcurrent<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}

// ─── ScannerScheduler singleton ───────────────────────────────────────────────

export class ScannerScheduler {
  private static _instance: ScannerScheduler | null = null;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _running = false;
  private _scanCount = 0;

  static getInstance(): ScannerScheduler {
    if (!ScannerScheduler._instance) {
      ScannerScheduler._instance = new ScannerScheduler();
    }
    return ScannerScheduler._instance;
  }

  isRunning(): boolean { return this._running; }
  getScanCount(): number { return this._scanCount; }
  getHistory(): ScanRun[] { return [..._history]; }
  getCurrentRun(): ScanRun | null { return _currentRun; }
  getCooldownMs(): number { return getCooldownMs(); }
  getIntervalMs(): number { return getScanIntervalMs(); }

  /** Start the periodic scanner. Safe to call multiple times — idempotent. */
  start(): void {
    if (this._running) return;
    this._running = true;
    logger.info(`[scanner] Starting with ${SCAN_INTERVAL_MS / 1000}s interval`);

    // Immediate first scan
    void this._runScan();
    this._timer = setInterval(() => void this._runScan(), SCAN_INTERVAL_MS);
  }

  /** Stop the scanner. */
  stop(): void {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this._running = false;
    logger.info("[scanner] Stopped");
  }

  /** Force an immediate out-of-cycle scan. */
  async forceScan(): Promise<ScanRun> {
    return this._runScan();
  }

  /** Reset cooldowns for a specific symbol (or all if omitted). */
  resetCooldowns(symbol?: string): void {
    if (symbol) {
      for (const key of _cooldowns.keys()) {
        if (key.startsWith(`${symbol}::`)) _cooldowns.delete(key);
      }
    } else {
      _cooldowns.clear();
    }
    logger.info({ symbol: symbol ?? "ALL" }, "[scanner] Cooldowns reset");
  }

  private async _runScan(): Promise<ScanRun> {
    const run = _recordRunStart();
    this._scanCount++;

    try {
      // Phase 20: check circuit breaker before scanning — skip if kill switch is active
      try { checkCircuitBreaker(); } catch { /* CB check is best-effort */ }
      if (isKillSwitchActive()) {
        logger.warn("[scanner] Kill switch / circuit breaker active — scan suppressed");
        _finaliseRun(run);
        return run;
      }

      const symbols = listEnabledSymbols();
      if (!symbols.length) {
        logger.debug("[scanner] Watchlist empty — nothing to scan");
        _finaliseRun(run);
        return run;
      }

      logger.info({ count: symbols.length, runId: run.id }, "[scanner] Scan cycle started");

      const authFailure = getAlpacaAuthFailureState();
      if (authFailure.active) {
        logAuthCycleSkipped(authFailure.remainingMs, authFailure.status);
        for (const entry of symbols) {
          touchScanned(entry.symbol, false);
        }
        run.symbolsScanned += symbols.length;
        _finaliseRun(run);
        logger.info({
          runId: run.id,
          symbolsScanned: run.symbolsScanned,
          signalsFound: run.signalsFound,
          alertsEmitted: run.alertsEmitted,
          durationMs: run.durationMs,
        }, "[scanner] Scan cycle completed (auth cooldown skip)");
        return run;
      }

      await runConcurrent(
        symbols,
        (entry) => scanSymbol(entry.symbol, entry.assetClass, run),
        MAX_CONCURRENT,
      );

      _finaliseRun(run);
      logger.info({
        runId:         run.id,
        symbolsScanned: run.symbolsScanned,
        signalsFound:   run.signalsFound,
        alertsEmitted:  run.alertsEmitted,
        durationMs:     run.durationMs,
      }, "[scanner] Scan cycle completed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      _finaliseRun(run, msg);
      logger.error({ err, runId: run.id }, "[scanner] Scan cycle failed");
    }

    return run;
  }
}

// ─── Convenience exports ──────────────────────────────────────────────────────

export function getScannerScheduler(): ScannerScheduler {
  return ScannerScheduler.getInstance();
}
