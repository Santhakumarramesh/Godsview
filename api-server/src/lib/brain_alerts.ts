/**
 * brain_alerts.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 8C: Brain Alert / Notification System
 *
 * Fires notifications when important brain events happen:
 *   - ELITE strategy fires a signal
 *   - Brain switches to DEFENSIVE mode
 *   - Position hits TP or SL
 *   - Contagion alert (HIGH/CRITICAL)
 *   - 5+ consecutive losses
 *   - Model accuracy drops below threshold (SI drift)
 *   - Brain stops running (crash/error)
 *
 * Delivery channels:
 *   1. In-app SSE event stream (always)
 *   2. Webhook (if BRAIN_WEBHOOK_URL is set)
 *   3. In-memory alert log (always, last 500 alerts)
 *
 * Rate limiting: same alert type + symbol won't fire more than once per 5min.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "./logger.js";
import { brainEventBus } from "./brain_event_bus.js";

// ── Alert Types ───────────────────────────────────────────────────────────────

export type AlertLevel = "INFO" | "WARNING" | "CRITICAL";

export type AlertCode =
  | "ELITE_SIGNAL"          // ELITE-tier strategy fired
  | "DEFENSIVE_MODE"        // Brain entered defensive mode
  | "POSITION_TP_HIT"       // Take profit hit
  | "POSITION_SL_HIT"       // Stop loss hit
  | "CONTAGION_HIGH"        // Cross-symbol correlation spike
  | "CONSECUTIVE_LOSSES"    // 5+ consecutive losses
  | "SI_DRIFT"              // SI model accuracy dropped
  | "BRAIN_STOPPED"         // Autonomous brain stopped unexpectedly
  | "STRATEGY_SUSPENDED"    // Strategy tier dropped to SUSPENDED
  | "NEW_ELITE_STRATEGY"    // Strategy promoted to ELITE tier
  | "EXECUTION_ERROR"       // Order execution failed
  | "BACKTEST_COMPLETE"     // Backtest finished
  | "RETRAIN_COMPLETE"      // ML retrain finished
  | "RISK_LIMIT_HIT"        // Account risk limit triggered
  | "CUSTOM";               // User-defined

export interface BrainAlert {
  id: string;
  code: AlertCode;
  level: AlertLevel;
  symbol?: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  deliveredVia: string[];
  createdAt: number;
  readAt?: number;
}

// ── Webhook payload ───────────────────────────────────────────────────────────

interface WebhookPayload {
  source: "godsview_brain";
  alertId: string;
  code: AlertCode;
  level: AlertLevel;
  symbol?: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

// ── Alert Manager ─────────────────────────────────────────────────────────────

class BrainAlertManager {
  private alerts: BrainAlert[] = [];
  private readonly MAX_ALERTS = 500;
  private readonly RATE_LIMIT_MS = 5 * 60_000; // 5 minutes between same alert type

  // Track last alert time per code+symbol to rate-limit
  private lastAlertAt = new Map<string, number>();

  private webhookUrl = (process.env.BRAIN_WEBHOOK_URL ?? "").trim();
  private webhookSecret = (process.env.BRAIN_WEBHOOK_SECRET ?? "").trim();

  // SSE subscribers registered from the route handler
  private sseSubscribers: Set<(alert: BrainAlert) => void> = new Set();

  // ── Fire alert ───────────────────────────────────────────────────────────────

  /**
   * Fire a new brain alert. Applies rate limiting, delivers to all channels.
   */
  fire(
    code: AlertCode,
    level: AlertLevel,
    title: string,
    message: string,
    options?: { symbol?: string; data?: Record<string, unknown>; skipRateLimit?: boolean }
  ): BrainAlert {
    const { symbol, data, skipRateLimit = false } = options ?? {};

    // Rate limit check
    const rateKey = `${code}::${symbol ?? "SYSTEM"}`;
    const lastFired = this.lastAlertAt.get(rateKey) ?? 0;
    if (!skipRateLimit && Date.now() - lastFired < this.RATE_LIMIT_MS) {
      // Swallow — too soon
      return this._makeAlert(code, level, title, message, symbol, data, []);
    }
    this.lastAlertAt.set(rateKey, Date.now());

    const deliveredVia: string[] = ["in_app"];
    const alert = this._makeAlert(code, level, title, message, symbol, data, deliveredVia);

    // Persist to in-memory log
    this.alerts.push(alert);
    if (this.alerts.length > this.MAX_ALERTS) {
      this.alerts.shift();
    }

    // Deliver to SSE subscribers
    for (const subscriber of this.sseSubscribers) {
      try { subscriber(alert); } catch { /* ignore */ }
    }

    // Deliver via brain event bus (for UI)
    brainEventBus.agentReport({
      agentId: "brain",
      symbol: symbol ?? "SYSTEM",
      status: "done",
      confidence: level === "CRITICAL" ? 1 : level === "WARNING" ? 0.7 : 0.5,
      score: level === "CRITICAL" ? 0.1 : level === "WARNING" ? 0.4 : 0.8,
      verdict: `[${level}] ${title}`,
      data: { alertId: alert.id, code, ...data },
      flags: level !== "INFO" ? [{ level: level === "CRITICAL" ? "critical" as any : "warning", code, message }] : [],
      timestamp: Date.now(),
      latencyMs: 0,
    });

    // Webhook delivery (async, non-blocking)
    if (this.webhookUrl) {
      this._deliverWebhook(alert).then((delivered) => {
        if (delivered) {
          alert.deliveredVia.push("webhook");
        }
      }).catch(() => { /* logged inside */ });
    }

    logger.info({ code, level, symbol, title }, `[BrainAlerts] ${level} alert fired`);
    return alert;
  }

  // ── Pre-built alert helpers ───────────────────────────────────────────────────

  eliteSignal(symbol: string, strategyId: string, score: number, direction: string): void {
    this.fire("ELITE_SIGNAL", "INFO",
      `ELITE Signal: ${symbol}`,
      `${symbol} ${direction.toUpperCase()} confirmed by ELITE strategy ${strategyId} (score: ${score.toFixed(3)})`,
      { symbol, data: { strategyId, score, direction } }
    );
  }

  defensiveMode(consecutiveLosses: number): void {
    this.fire("DEFENSIVE_MODE", "WARNING",
      "Brain → DEFENSIVE Mode",
      `${consecutiveLosses} consecutive losses triggered defensive mode. Kelly fractions halved, signals tightened.`,
      { skipRateLimit: true }
    );
  }

  tpHit(symbol: string, pnlR: number): void {
    this.fire("POSITION_TP_HIT", "INFO",
      `TP Hit: ${symbol}`,
      `${symbol} take profit reached. PnL: +${pnlR.toFixed(2)}R`,
      { symbol, data: { pnlR } }
    );
  }

  slHit(symbol: string, pnlR: number): void {
    this.fire("POSITION_SL_HIT", "WARNING",
      `SL Hit: ${symbol}`,
      `${symbol} stop loss triggered. Loss: ${pnlR.toFixed(2)}R`,
      { symbol, data: { pnlR } }
    );
  }

  contagionHigh(symbols: string[], avgCorr: number): void {
    this.fire("CONTAGION_HIGH", "CRITICAL",
      "Contagion Alert",
      `${symbols.length} symbols spiking in correlation (avg ${(avgCorr * 100).toFixed(0)}%). Reduce exposure.`,
      { data: { symbols, avgCorr } }
    );
  }

  consecutiveLosses(count: number, symbol?: string): void {
    this.fire("CONSECUTIVE_LOSSES", "WARNING",
      `${count} Consecutive Losses`,
      `Brain recorded ${count} losses in a row${symbol ? ` on ${symbol}` : ""}. Review strategy performance.`,
      { symbol, data: { count } }
    );
  }

  siDrift(symbol: string, accuracy: number, brier: number): void {
    this.fire("SI_DRIFT", "WARNING",
      `SI Model Drift: ${symbol}`,
      `${symbol} prediction accuracy dropped to ${(accuracy * 100).toFixed(1)}% (Brier: ${brier.toFixed(3)}). Retraining recommended.`,
      { symbol, data: { accuracy, brier } }
    );
  }

  strategySuspended(symbol: string, strategyId: string): void {
    this.fire("STRATEGY_SUSPENDED", "WARNING",
      `Strategy Suspended: ${symbol}`,
      `${strategyId} on ${symbol} suspended due to poor performance. No new entries.`,
      { symbol, data: { strategyId } }
    );
  }

  newEliteStrategy(symbol: string, strategyId: string, winRate: number, sharpe: number): void {
    this.fire("NEW_ELITE_STRATEGY", "INFO",
      `New ELITE Strategy: ${symbol}`,
      `${strategyId} on ${symbol} promoted to ELITE. WR: ${(winRate * 100).toFixed(0)}%, Sharpe: ${sharpe.toFixed(2)}`,
      { symbol, data: { strategyId, winRate, sharpe } }
    );
  }

  executionError(symbol: string, error: string): void {
    this.fire("EXECUTION_ERROR", "CRITICAL",
      `Execution Error: ${symbol}`,
      `Order execution failed for ${symbol}: ${error}`,
      { symbol, data: { error }, skipRateLimit: true }
    );
  }

  custom(level: AlertLevel, title: string, message: string, data?: Record<string, unknown>): void {
    this.fire("CUSTOM", level, title, message, { data });
  }

  // ── SSE subscription ──────────────────────────────────────────────────────

  subscribe(callback: (alert: BrainAlert) => void): () => void {
    this.sseSubscribers.add(callback);
    return () => this.sseSubscribers.delete(callback);
  }

  // ── Read/status ───────────────────────────────────────────────────────────

  getAlerts(limit = 100, level?: AlertLevel, code?: AlertCode): BrainAlert[] {
    let filtered = this.alerts;
    if (level) filtered = filtered.filter((a) => a.level === level);
    if (code) filtered = filtered.filter((a) => a.code === code);
    return filtered.slice(-limit).reverse();
  }

  getUnread(): BrainAlert[] {
    return this.alerts.filter((a) => !a.readAt).reverse();
  }

  markRead(alertIds: string[]): void {
    const now = Date.now();
    for (const alert of this.alerts) {
      if (alertIds.includes(alert.id)) alert.readAt = now;
    }
  }

  markAllRead(): void {
    const now = Date.now();
    for (const alert of this.alerts) {
      if (!alert.readAt) alert.readAt = now;
    }
  }

  getStats() {
    const unread = this.alerts.filter((a) => !a.readAt).length;
    const byLevel: Record<string, number> = { INFO: 0, WARNING: 0, CRITICAL: 0 };
    for (const a of this.alerts) byLevel[a.level] = (byLevel[a.level] ?? 0) + 1;
    return {
      total: this.alerts.length,
      unread,
      byLevel,
      webhookConfigured: !!this.webhookUrl,
      sseSubscribers: this.sseSubscribers.size,
    };
  }

  // ── Webhook delivery ──────────────────────────────────────────────────────

  private async _deliverWebhook(alert: BrainAlert): Promise<boolean> {
    if (!this.webhookUrl) return false;
    try {
      const payload: WebhookPayload = {
        source: "godsview_brain",
        alertId: alert.id,
        code: alert.code,
        level: alert.level,
        symbol: alert.symbol,
        title: alert.title,
        message: alert.message,
        data: alert.data,
        timestamp: new Date(alert.createdAt).toISOString(),
      };

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "GodsView-Brain/8.0",
      };

      if (this.webhookSecret) {
        // HMAC signature for webhook verification
        const body = JSON.stringify(payload);
        const { createHmac } = await import("crypto");
        const sig = createHmac("sha256", this.webhookSecret).update(body).digest("hex");
        headers["X-GodsView-Signature"] = `sha256=${sig}`;
      }

      const resp = await fetch(this.webhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });

      if (!resp.ok) {
        logger.warn({ status: resp.status, alertId: alert.id }, "[BrainAlerts] Webhook delivery failed");
        return false;
      }
      return true;
    } catch (err: any) {
      logger.warn({ err: err?.message, alertId: alert.id }, "[BrainAlerts] Webhook error");
      return false;
    }
  }

  private _makeAlert(
    code: AlertCode,
    level: AlertLevel,
    title: string,
    message: string,
    symbol?: string,
    data?: Record<string, unknown>,
    deliveredVia: string[] = [],
  ): BrainAlert {
    return {
      id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      code,
      level,
      symbol,
      title,
      message,
      data,
      deliveredVia,
      createdAt: Date.now(),
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const brainAlerts = new BrainAlertManager();
