/**
 * macro_context_service.ts — Singleton Cache + Background Refresh
 *
 * Manages a cached LiveMacroSnapshot that auto-refreshes every REFRESH_INTERVAL_MS.
 * On refresh, if macro conviction changes (low→high, high→low, direction flips),
 * an SSE event of type "macro_update" is broadcast to all connected dashboard clients.
 *
 * Usage:
 *   MacroContextService.getInstance().start();
 *   const ctx = MacroContextService.getInstance().getContext();
 *
 * The service starts in a degraded state (neutral snapshot) until the first successful
 * fetch. This ensures the API responds immediately even before Alpaca data arrives.
 */

import { logger } from "./logger";
import { fetchLiveMacroSnapshot, type LiveMacroSnapshot } from "./macro_feed";
import { computeMacroBias, neutralMacroBias, type MacroBiasResult } from "./macro_bias_engine";
import { computeSentiment, neutralSentiment, type SentimentResult } from "./sentiment_engine";
import { publishAlert } from "./signal_stream";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MacroContext {
  snapshot: LiveMacroSnapshot;
  macroBias: MacroBiasResult;
  sentiment: SentimentResult;
  lastRefreshedAt: string;
  nextRefreshAt: string;
  refreshCount: number;
  isLive: boolean;
}

export interface MacroConvictionChange {
  type: "macro_update";
  previous: { biasDir: string; biasConviction: string; crowdingLevel: string };
  current:  { biasDir: string; biasConviction: string; crowdingLevel: string };
  delta: {
    convictionChanged: boolean;
    directionChanged:  boolean;
    crowdingChanged:   boolean;
  };
  context: MacroContext;
  ts: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = parseInt(process.env.MACRO_REFRESH_INTERVAL_MS ?? "300000", 10); // 5 min
const MAX_CONSECUTIVE_ERRORS = 5;

// ─── Neutral bootstrap snapshot ───────────────────────────────────────────────

function buildNeutralSnapshot(): LiveMacroSnapshot {
  return {
    macroBiasInput: {
      dxySlope: 0, rateDifferentialBps: 0, cpiMomentum: 0,
      vixLevel: 20, macroRiskScore: 0.3,
      assetClass: "crypto", intendedDirection: "long",
    },
    sentimentInput: {
      retailLongRatio: 0.5, priceTrendSlope: 0, cvdNet: 0,
      openInterestChange: 0, fundingRate: 0,
      intendedDirection: "long", assetClass: "crypto",
    },
    fredSnapshot: null,
    fetchedAt: new Date().toISOString(),
    dataQuality: "stale",
    sources: { all: "neutral bootstrap — not yet fetched" },
  };
}

function buildContext(
  snapshot: LiveMacroSnapshot,
  macroBias: MacroBiasResult,
  sentiment: SentimentResult,
  refreshCount: number,
  intervalMs: number,
): MacroContext {
  const now = new Date();
  return {
    snapshot,
    macroBias,
    sentiment,
    lastRefreshedAt: now.toISOString(),
    nextRefreshAt: new Date(now.getTime() + intervalMs).toISOString(),
    refreshCount,
    isLive: snapshot.dataQuality !== "stale",
  };
}

// ─── Singleton service ────────────────────────────────────────────────────────

export class MacroContextService {
  private static _instance: MacroContextService | null = null;

  private _context: MacroContext;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _consecutiveErrors = 0;
  private _started = false;

  private constructor() {
    const neutralSnapshot = buildNeutralSnapshot();
    this._context = buildContext(
      neutralSnapshot,
      neutralMacroBias(),
      neutralSentiment(),
      0,
      REFRESH_INTERVAL_MS,
    );
  }

  static getInstance(): MacroContextService {
    if (!MacroContextService._instance) {
      MacroContextService._instance = new MacroContextService();
    }
    return MacroContextService._instance;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getContext(): MacroContext {
    return this._context;
  }

  isStarted(): boolean {
    return this._started;
  }

  /**
   * Start the background refresh loop.
   * Triggers an immediate first fetch, then repeats every REFRESH_INTERVAL_MS.
   * Safe to call multiple times — will not double-start.
   */
  start(): void {
    if (this._started) return;
    this._started = true;
    logger.info(`[macro_context] Starting with ${REFRESH_INTERVAL_MS / 1000}s refresh interval`);
    void this._refresh(); // immediate first fetch
    this._timer = setInterval(() => void this._refresh(), REFRESH_INTERVAL_MS);
  }

  /** Stop background refresh (used in tests / graceful shutdown). */
  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._started = false;
    logger.info("[macro_context] Stopped");
  }

  /**
   * Force an immediate refresh outside the normal schedule.
   * Returns the new context.
   */
  async forceRefresh(
    intendedDirection: "long" | "short" = "long",
    assetClass: LiveMacroSnapshot["macroBiasInput"]["assetClass"] = "crypto",
  ): Promise<MacroContext> {
    await this._refresh(intendedDirection, assetClass);
    return this._context;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private async _refresh(
    intendedDirection: "long" | "short" = "long",
    assetClass: LiveMacroSnapshot["macroBiasInput"]["assetClass"] = "crypto",
  ): Promise<void> {
    try {
      const snapshot = await fetchLiveMacroSnapshot(intendedDirection, "BTC/USD", assetClass);

      const newBias      = computeMacroBias(snapshot.macroBiasInput);
      const newSentiment = computeSentiment(snapshot.sentimentInput);

      const prev = this._context;
      const newCount = prev.refreshCount + 1;

      const newContext = buildContext(snapshot, newBias, newSentiment, newCount, REFRESH_INTERVAL_MS);

      // Detect conviction change and broadcast SSE if significant
      const changed = this._detectChange(prev, newContext);
      this._context = newContext;
      this._consecutiveErrors = 0;

      if (changed && prev.isLive) {
        this._broadcastChange(prev, newContext);
      }

      logger.info(
        `[macro_context] Refresh #${newCount} complete — ` +
        `bias: ${newBias.bias} (${newBias.conviction}), ` +
        `crowding: ${newSentiment.crowdingLevel}, ` +
        `quality: ${snapshot.dataQuality}`
      );
    } catch (err) {
      this._consecutiveErrors++;
      logger.error(`[macro_context] Refresh error #${this._consecutiveErrors}: ${String(err)}`);

      if (this._consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        logger.warn("[macro_context] Too many errors — resetting to neutral snapshot");
        const neutralSnapshot = buildNeutralSnapshot();
        this._context = buildContext(
          neutralSnapshot,
          neutralMacroBias(),
          neutralSentiment(),
          this._context.refreshCount + 1,
          REFRESH_INTERVAL_MS,
        );
        this._consecutiveErrors = 0;
      }
    }
  }

  private _detectChange(prev: MacroContext, next: MacroContext): boolean {
    return (
      prev.macroBias.conviction  !== next.macroBias.conviction  ||
      prev.macroBias.direction   !== next.macroBias.direction   ||
      prev.sentiment.crowdingLevel !== next.sentiment.crowdingLevel
    );
  }

  private _broadcastChange(prev: MacroContext, next: MacroContext): void {
    const payload: MacroConvictionChange = {
      type: "macro_update",
      previous: {
        biasDir:       prev.macroBias.direction,
        biasConviction: prev.macroBias.conviction,
        crowdingLevel: prev.sentiment.crowdingLevel,
      },
      current: {
        biasDir:       next.macroBias.direction,
        biasConviction: next.macroBias.conviction,
        crowdingLevel: next.sentiment.crowdingLevel,
      },
      delta: {
        convictionChanged: prev.macroBias.conviction !== next.macroBias.conviction,
        directionChanged:  prev.macroBias.direction  !== next.macroBias.direction,
        crowdingChanged:   prev.sentiment.crowdingLevel !== next.sentiment.crowdingLevel,
      },
      context: next,
      ts: new Date().toISOString(),
    };

    try {
      publishAlert(payload);
      logger.info(`[macro_context] Broadcast macro_update: ${prev.macroBias.conviction}→${next.macroBias.conviction}, dir: ${prev.macroBias.direction}→${next.macroBias.direction}`);
    } catch (err) {
      logger.warn(`[macro_context] SSE broadcast failed: ${String(err)}`);
    }
  }
}

// ─── Convenience exports ───────────────────────────────────────────────────────

/** Returns the current macro context from the singleton. */
export function getCurrentMacroContext(): MacroContext {
  return MacroContextService.getInstance().getContext();
}

/** Force a refresh and return the updated context. */
export async function refreshMacroContext(
  intendedDirection?: "long" | "short",
  assetClass?: LiveMacroSnapshot["macroBiasInput"]["assetClass"],
): Promise<MacroContext> {
  return MacroContextService.getInstance().forceRefresh(intendedDirection, assetClass);
}
