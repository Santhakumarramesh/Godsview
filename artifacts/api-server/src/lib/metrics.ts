/**
 * Production Prometheus metrics collector.
 * No external dependency — produces text/plain exposition format.
 * Supports counters, histograms, gauges with labels.
 */

/* ── Counter ────────────────────────────────── */

class Counter {
  private counts = new Map<string, number>();

  inc(labels: Record<string, string> = {}, amount = 1): void {
    const key = this.labelsKey(labels);
    this.counts.set(key, (this.counts.get(key) ?? 0) + amount);
  }

  collect(name: string, help: string): string {
    const lines: string[] = [
      `# HELP ${name} ${help}`,
      `# TYPE ${name} counter`,
    ];
    for (const [key, val] of this.counts) {
      lines.push(`${name}${key} ${val}`);
    }
    return lines.join("\n");
  }

  private labelsKey(labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return "";
    const inner = entries.map(([k, v]) => `${k}="${v}"`).join(",");
    return `{${inner}}`;
  }
}

/* ── Histogram (bucket-based with labels) ──────── */

class Histogram {
  private buckets: number[];
  private data = new Map<string, { counts: number[]; sum: number; count: number }>();

  constructor(buckets: number[]) {
    this.buckets = buckets.sort((a, b) => a - b);
  }

  observe(value: number, labels: Record<string, string> = {}): void {
    const key = this.labelsKey(labels);
    if (!this.data.has(key)) {
      this.data.set(key, { counts: new Array(this.buckets.length + 1).fill(0), sum: 0, count: 0 });
    }
    const stats = this.data.get(key)!;
    stats.sum += value;
    stats.count += 1;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]!) {
        stats.counts[i]!++;
        return;
      }
    }
    stats.counts[this.buckets.length]!++;
  }

  collect(name: string, help: string): string {
    const lines: string[] = [
      `# HELP ${name} ${help}`,
      `# TYPE ${name} histogram`,
    ];

    if (this.data.size === 0) {
      // No observations yet
      return lines.join("\n");
    }

    for (const [labelKey, stats] of this.data) {
      let cumulative = 0;
      for (let i = 0; i < this.buckets.length; i++) {
        cumulative += stats.counts[i]!;
        const bucketLabel = labelKey ? `{le="${this.buckets[i]}"${labelKey.substring(1)}}` : `{le="${this.buckets[i]}"}`;
        lines.push(`${name}_bucket${bucketLabel} ${cumulative}`);
      }
      cumulative += stats.counts[this.buckets.length]!;
      const infLabel = labelKey ? `{le="+Inf"${labelKey.substring(1)}}` : `{le="+Inf"}`;
      lines.push(`${name}_bucket${infLabel} ${cumulative}`);
      lines.push(`${name}_sum${labelKey} ${stats.sum}`);
      lines.push(`${name}_count${labelKey} ${stats.count}`);
    }
    return lines.join("\n");
  }

  private labelsKey(labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return "";
    const inner = entries.map(([k, v]) => `${k}="${v}"`).join(",");
    return `{${inner}}`;
  }
}

/* ── Gauge (with labels support) ────────────── */
class Gauge {
  private data = new Map<string, number>();

  set(v: number, labels: Record<string, string> = {}): void {
    const key = this.labelsKey(labels);
    this.data.set(key, v);
  }

  inc(amount = 1, labels: Record<string, string> = {}): void {
    const key = this.labelsKey(labels);
    this.data.set(key, (this.data.get(key) ?? 0) + amount);
  }

  dec(amount = 1, labels: Record<string, string> = {}): void {
    const key = this.labelsKey(labels);
    this.data.set(key, (this.data.get(key) ?? 0) - amount);
  }

  get(labels?: Record<string, string>): number {
    const key = labels ? this.labelsKey(labels) : "";
    return this.data.get(key) ?? 0;
  }

  collect(name: string, help: string): string {
    const lines: string[] = [
      `# HELP ${name} ${help}`,
      `# TYPE ${name} gauge`,
    ];

    if (this.data.size === 0) {
      return lines.join("\n");
    }

    for (const [key, val] of this.data) {
      lines.push(`${name}${key} ${val}`);
    }
    return lines.join("\n");
  }

  private labelsKey(labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return "";
    const inner = entries.map(([k, v]) => `${k}="${v}"`).join(",");
    return `{${inner}}`;
  }
}

/* ── Singleton Metrics Registry ─────────────── */

// ═════════════════════════════════════════════════════════════════════════════
// HTTP METRICS
// ═════════════════════════════════════════════════════════════════════════════
export const httpRequestsTotal = new Counter();
export const httpRequestDuration = new Histogram([
  0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
]);
export const httpRequestsInFlight = new Gauge();

// ═════════════════════════════════════════════════════════════════════════════
// TRADING PIPELINE & SIGNALS
// ═════════════════════════════════════════════════════════════════════════════
export const signalsProcessedTotal = new Counter();
export const signalsByType = new Counter();
export const signalsByDirection = new Counter();
export const siDecisionsTotal = new Counter();
export const productionGateTotal = new Counter();
export const tradesExecutedTotal = new Counter();
export const tradesByOutcome = new Counter();  // win/loss
export const claudeVetoTotal = new Counter();

// ═════════════════════════════════════════════════════════════════════════════
// BUSINESS METRICS (NEW)
// ═════════════════════════════════════════════════════════════════════════════
// Position & Portfolio
export const activePositions = new Gauge();
export const dailyPnl = new Gauge();
export const portfolioHeat = new Gauge();
export const trustTier = new Gauge();
export const regime = new Gauge();  // by regime type
export const confidenceScore = new Histogram([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]);

// Brain & Cycle Metrics
export const brainCycleDuration = new Histogram([
  0.1, 0.5, 1, 2, 5, 10, 30, 60, 120,
]);  // seconds
export const brainCycleCount = new Gauge();

// Market Data & Infrastructure
export const orderbookLatency = new Histogram([1, 5, 10, 25, 50, 100, 250, 500, 1000]);  // ms
export const dataSourceFreshness = new Gauge();  // seconds, by source
export const webhookReceivedTotal = new Counter();

// Service Health (Gauges: 1=up, 0=down)
export const serviceHealth = new Gauge();  // by service name
export const serviceLatency = new Histogram([10, 50, 100, 250, 500, 1000, 2500]);  // ms

// System Gauges
export const activeSSEClients = new Gauge();
export const ensembleAccuracy = new Gauge();
export const openPositions = new Gauge();
export const uptime = new Gauge();

// Phase 12: Execution truth metrics
export const ordersCreatedTotal = new Counter();
export const ordersFilled = new Counter();
export const ordersRejected = new Counter();
export const fillsRecorded = new Counter();
export const reconciliationsRun = new Counter();
export const reconciliationDiscrepancies = new Gauge();  // gauge: current discrepancy count
export const avgSlippageBps = new Gauge();
export const executionLatencyMs = new Histogram([10, 50, 100, 250, 500, 1000, 2500, 5000]);

// Phase 13: Alignment metrics
export const alignmentChecksTotal = new Counter();
export const alignmentScore = new Gauge();       // latest composite alignment score
export const driftEventsTotal = new Counter();
export const unresolvedDriftEvents = new Gauge();

// Phase 14: ML operations metrics
export const modelRetrainsTotal = new Counter();
export const modelEvaluationsTotal = new Counter();
export const championAccuracy = new Gauge();
export const challengerAccuracy = new Gauge();
export const modelVersionCount = new Gauge();

/** Collect all metrics as Prometheus text exposition */
export function collectMetrics(): string {
  uptime.set(process.uptime());

  const sections = [
    // ═══════ HTTP METRICS ═══════
    httpRequestsTotal.collect("godsview_http_requests_total", "Total HTTP requests"),
    httpRequestDuration.collect("godsview_http_request_duration_seconds", "HTTP request duration in seconds"),
    httpRequestsInFlight.collect("godsview_http_requests_in_flight", "HTTP requests currently being processed"),

    // ═══════ TRADING PIPELINE ═══════
    signalsProcessedTotal.collect("godsview_signals_processed_total", "Total signals processed through pipeline"),
    signalsByType.collect("godsview_signals_total", "Total signals by type (long/short/neutral)"),
    signalsByDirection.collect("godsview_signals_by_direction_total", "Total signals by direction (buy/sell)"),
    siDecisionsTotal.collect("godsview_si_decisions_total", "Total Super Intelligence decisions"),
    productionGateTotal.collect("godsview_production_gate_total", "Total production gate evaluations"),
    tradesExecutedTotal.collect("godsview_trades_executed_total", "Total trades executed"),
    tradesByOutcome.collect("godsview_trades_total", "Total trades by outcome (win/loss)"),
    claudeVetoTotal.collect("godsview_claude_veto_total", "Total Claude veto layer evaluations"),

    // ═══════ BUSINESS METRICS ═══════
    activePositions.collect("godsview_active_positions", "Current number of active positions"),
    dailyPnl.collect("godsview_daily_pnl_usd", "Daily P&L in USD"),
    portfolioHeat.collect("godsview_portfolio_heat", "Portfolio heat metric (risk exposure)"),
    trustTier.collect("godsview_trust_tier", "Current trust tier level (1-5 or TIER_1-5)"),
    regime.collect("godsview_regime", "Current regime state (TREND_UP/DOWN/RANGE/MEAN_REV/SIDEWAYS)"),
    confidenceScore.collect("godsview_confidence_score", "Confidence score distribution (0-1)"),

    // ═══════ BRAIN & CYCLE ═══════
    brainCycleDuration.collect("godsview_brain_cycle_duration_seconds", "Brain cycle execution time in seconds"),
    brainCycleCount.collect("godsview_brain_cycle_count", "Total brain cycles completed"),

    // ═══════ MARKET DATA ═══════
    orderbookLatency.collect("godsview_orderbook_latency_ms", "Orderbook fetch latency in milliseconds"),
    dataSourceFreshness.collect("godsview_data_source_freshness_seconds", "Data source freshness in seconds"),
    webhookReceivedTotal.collect("godsview_webhook_received_total", "Total webhooks received"),

    // ═══════ SERVICE HEALTH ═══════
    serviceHealth.collect("godsview_service_health", "Service health status (1=up, 0=down) by service"),
    serviceLatency.collect("godsview_service_latency_ms", "Service latency in milliseconds by service"),

    // ═══════ LEGACY EXECUTION TRUTH ═══════
    ordersCreatedTotal.collect("godsview_orders_created_total", "Total orders created"),
    ordersFilled.collect("godsview_orders_filled_total", "Total orders filled"),
    ordersRejected.collect("godsview_orders_rejected_total", "Total orders rejected"),
    fillsRecorded.collect("godsview_fills_recorded_total", "Total fills recorded from broker"),
    reconciliationsRun.collect("godsview_reconciliations_total", "Total reconciliations run"),
    reconciliationDiscrepancies.collect("godsview_reconciliation_discrepancies", "Current reconciliation discrepancy count"),
    avgSlippageBps.collect("godsview_avg_slippage_bps", "Average slippage in basis points"),
    executionLatencyMs.collect("godsview_execution_latency_ms", "Order execution latency in milliseconds"),

    // ═══════ ALIGNMENT ═══════
    alignmentChecksTotal.collect("godsview_alignment_checks_total", "Total alignment checks run"),
    alignmentScore.collect("godsview_alignment_score", "Latest composite alignment score"),
    driftEventsTotal.collect("godsview_drift_events_total", "Total drift events detected"),
    unresolvedDriftEvents.collect("godsview_unresolved_drift_events", "Current unresolved drift events"),

    // ═══════ ML OPERATIONS ═══════
    modelRetrainsTotal.collect("godsview_model_retrains_total", "Total model retraining events"),
    modelEvaluationsTotal.collect("godsview_model_evaluations_total", "Total model evaluations run"),
    championAccuracy.collect("godsview_champion_accuracy", "Champion model accuracy"),
    challengerAccuracy.collect("godsview_challenger_accuracy", "Challenger model accuracy"),
    modelVersionCount.collect("godsview_model_version_count", "Total model versions"),

    // ═══════ SYSTEM ═══════
    activeSSEClients.collect("godsview_active_sse_clients", "Number of active SSE stream clients"),
    ensembleAccuracy.collect("godsview_ensemble_accuracy", "Current ensemble model accuracy"),
    openPositions.collect("godsview_open_positions", "Number of open positions"),
    uptime.collect("godsview_uptime_seconds", "Server uptime in seconds"),
  ];

  return sections.filter((s) => s.trim()).join("\n\n") + "\n";
}