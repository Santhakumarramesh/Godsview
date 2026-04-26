/**
 * In-process metrics + ring-buffer log store.
 *
 * Every call to the VC pipeline records a metrics event. Reads are O(1) for
 * counters and O(N) for the bounded log ring. Persisted state is intentionally
 * NOT used — these metrics reflect the lifetime of THIS process. Cross-process
 * aggregation belongs to Prometheus / CloudWatch, which is a separate concern.
 */

import { scrub } from "./scrub";

export type RejectionReason = string;

class SystemMetrics {
  private startedAt = Date.now();
  private signalsReceived = 0;
  private signalsAccepted = 0;
  private signalsRejected = 0;
  private rejectionReasons: Record<RejectionReason, number> = {};
  private latencies: number[] = []; // ring of last N webhook latencies in ms
  private latencyCap = 1000;
  private lastWebhookAt: number | null = null;
  private lastTradeAt: number | null = null;

  private logRing: Array<{ ts: number; level: string; event: string; data?: any }> = [];
  private logCap = 500;

  recordWebhook(latencyMs: number, accepted: boolean, reason?: string) {
    this.signalsReceived++;
    if (accepted) {
      this.signalsAccepted++;
      this.lastTradeAt = Date.now();
    } else {
      this.signalsRejected++;
      const r = (reason ?? "unknown").slice(0, 80);
      this.rejectionReasons[r] = (this.rejectionReasons[r] ?? 0) + 1;
    }
    this.latencies.push(latencyMs);
    if (this.latencies.length > this.latencyCap) this.latencies.shift();
    this.lastWebhookAt = Date.now();
  }

  log(level: "info" | "warn" | "error", event: string, data?: any) {
    // Scrub before storing so the ring never contains a raw secret. Even if
    // an operator dumps the ring, it is safe to share.
    this.logRing.push({ ts: Date.now(), level, event, data: data === undefined ? undefined : scrub(data) });
    if (this.logRing.length > this.logCap) this.logRing.shift();
  }

  recentLogs(limit = 100) {
    const n = Math.min(limit, this.logRing.length);
    return this.logRing.slice(this.logRing.length - n).reverse();
  }

  snapshot() {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p = (q: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0;
    return {
      uptimeMs: Date.now() - this.startedAt,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      counters: {
        signalsReceived: this.signalsReceived,
        signalsAccepted: this.signalsAccepted,
        signalsRejected: this.signalsRejected,
      },
      latencyMs: {
        count: this.latencies.length,
        avg: this.latencies.length ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length : 0,
        p50: p(0.5),
        p95: p(0.95),
        p99: p(0.99),
      },
      rejectionReasons: this.rejectionReasons,
      lastWebhookAt: this.lastWebhookAt ? new Date(this.lastWebhookAt).toISOString() : null,
      lastTradeAt: this.lastTradeAt ? new Date(this.lastTradeAt).toISOString() : null,
    };
  }
}

export const systemMetrics = new SystemMetrics();
