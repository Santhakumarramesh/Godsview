/**
 * Lightweight Prometheus-compatible metrics collector.
 * No external dependency — produces text/plain exposition format.
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

/* ── Histogram (simple bucket-based) ────────── */

class Histogram {
  private buckets: number[];
  private counts: number[];
  private sum = 0;
  private count = 0;

  constructor(buckets: number[]) {
    this.buckets = buckets.sort((a, b) => a - b);
    this.counts = new Array(this.buckets.length + 1).fill(0);
  }

  observe(value: number): void {
    this.sum += value;
    this.count += 1;
    for (let i = 0; i < this.buckets.length; i++) {      if (value <= this.buckets[i]!) {
        this.counts[i]!++;
        return;
      }
    }
    this.counts[this.buckets.length]!++;
  }

  collect(name: string, help: string): string {
    const lines: string[] = [
      `# HELP ${name} ${help}`,
      `# TYPE ${name} histogram`,
    ];
    let cumulative = 0;
    for (let i = 0; i < this.buckets.length; i++) {
      cumulative += this.counts[i]!;
      lines.push(`${name}_bucket{le="${this.buckets[i]}"} ${cumulative}`);
    }
    cumulative += this.counts[this.buckets.length]!;
    lines.push(`${name}_bucket{le="+Inf"} ${cumulative}`);
    lines.push(`${name}_sum ${this.sum}`);
    lines.push(`${name}_count ${this.count}`);
    return lines.join("\n");
  }
}

/* ── Gauge ──────────────────────────────────── */
class Gauge {
  private value = 0;
  set(v: number): void { this.value = v; }
  inc(amount = 1): void { this.value += amount; }
  dec(amount = 1): void { this.value -= amount; }
  get(): number { return this.value; }

  collect(name: string, help: string): string {
    return [
      `# HELP ${name} ${help}`,
      `# TYPE ${name} gauge`,
      `${name} ${this.value}`,
    ].join("\n");
  }
}

/* ── Singleton Metrics Registry ─────────────── */

// HTTP
export const httpRequestsTotal = new Counter();
export const httpRequestDuration = new Histogram([
  0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
]);
export const httpRequestsInFlight = new Gauge();

// Trading pipeline
export const signalsProcessedTotal = new Counter();
export const siDecisionsTotal = new Counter();export const productionGateTotal = new Counter();
export const tradesExecutedTotal = new Counter();
export const claudeVetoTotal = new Counter();

// System gauges
export const activeSSEClients = new Gauge();
export const ensembleAccuracy = new Gauge();
export const dailyPnl = new Gauge();
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
    httpRequestsTotal.collect("godsview_http_requests_total", "Total HTTP requests"),
    httpRequestDuration.collect("godsview_http_request_duration_seconds", "HTTP request duration in seconds"),
    httpRequestsInFlight.collect("godsview_http_requests_in_flight", "HTTP requests currently being processed"),
    signalsProcessedTotal.collect("godsview_signals_processed_total", "Total signals processed through pipeline"),
    siDecisionsTotal.collect("godsview_si_decisions_total", "Total Super Intelligence decisions"),
    productionGateTotal.collect("godsview_production_gate_total", "Total production gate evaluations"),
    tradesExecutedTotal.collect("godsview_trades_executed_total", "Total trades executed"),
    claudeVetoTotal.collect("godsview_claude_veto_total", "Total Claude veto layer evaluations"),
    activeSSEClients.collect("godsview_active_sse_clients", "Number of active SSE stream clients"),
    ensembleAccuracy.collect("godsview_ensemble_accuracy", "Current ensemble model accuracy"),
    dailyPnl.collect("godsview_daily_pnl_usd", "Daily P&L in USD"),
    openPositions.collect("godsview_open_positions", "Number of open positions"),
    uptime.collect("godsview_uptime_seconds", "Server uptime in seconds"),

    // Phase 12: Execution truth
    ordersCreatedTotal.collect("godsview_orders_created_total", "Total orders created in execution truth layer"),
    ordersFilled.collect("godsview_orders_filled_total", "Total orders that reached filled status"),
    ordersRejected.collect("godsview_orders_rejected_total", "Total orders rejected"),
    fillsRecorded.collect("godsview_fills_recorded_total", "Total fills recorded from broker"),
    reconciliationsRun.collect("godsview_reconciliations_total", "Total EOD reconciliations run"),
    reconciliationDiscrepancies.collect("godsview_reconciliation_discrepancies", "Current reconciliation discrepancy count"),
    avgSlippageBps.collect("godsview_avg_slippage_bps", "Average slippage in basis points"),
    executionLatencyMs.collect("godsview_execution_latency_ms", "Order execution latency (submit to first fill)"),

    // Phase 13: Alignment
    alignmentChecksTotal.collect("godsview_alignment_checks_total", "Total alignment checks run"),
    alignmentScore.collect("godsview_alignment_score", "Latest composite alignment score (0-1)"),
    driftEventsTotal.collect("godsview_drift_events_total", "Total drift events detected"),
    unresolvedDriftEvents.collect("godsview_unresolved_drift_events", "Current unresolved drift events"),

    // Phase 14: ML operations
    modelRetrainsTotal.collect("godsview_model_retrains_total", "Total model retraining events"),
    modelEvaluationsTotal.collect("godsview_model_evaluations_total", "Total model evaluations run"),
    championAccuracy.collect("godsview_champion_accuracy", "Current champion model accuracy"),
    challengerAccuracy.collect("godsview_challenger_accuracy", "Current challenger model accuracy"),
    modelVersionCount.collect("godsview_model_version_count", "Total model versions registered"),
  ];

  return sections.join("\n\n") + "\n";
}