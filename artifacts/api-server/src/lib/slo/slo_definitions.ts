/**
 * SLO Definitions (Phase 6)
 *
 * Codified Service Level Objectives for the GodsView API. These are the
 * production targets used by the SLO tracker to compute burn rates and by
 * the alert router to escalate when an objective is at risk.
 *
 * Each SLO has:
 *   - id: stable string identifier used in metrics labels and routes
 *   - title: human-readable summary
 *   - description: what this SLO measures
 *   - objective: the target (e.g. 99.5% of requests under 500ms)
 *   - window: rolling window the objective is measured against
 *   - severity: how bad it is when this SLO is breached
 *   - alertBurnRate: burn-rate multiplier that triggers an alert
 *
 * Burn rate (Google SRE workbook): the rate at which the error budget is
 * being consumed. A burn rate of 1 means the budget is being spent at the
 * same rate the SLO permits — at this pace it lasts exactly one window.
 * A burn rate of 14.4 over a 1h window consumes 100% of a 30-day 99.9% budget.
 *
 * SLOs are organised by tier:
 *   - critical:  trading path, execution, risk gates — page immediately
 *   - high:      dashboard read APIs, feature pages — page within an hour
 *   - normal:    ops endpoints, scheduler reads — file a ticket
 */

export type SLOTier = "critical" | "high" | "normal";
export type SLOKind = "latency" | "availability" | "freshness" | "throughput";

export interface SLODefinition {
  id: string;
  title: string;
  description: string;
  kind: SLOKind;
  tier: SLOTier;
  /** The target metric value (ms for latency, fraction 0-1 for availability/freshness) */
  target: number;
  /** Percentile that target applies to (latency only) */
  percentile?: 50 | 90 | 95 | 99;
  /** Objective fraction — % of measurements that must satisfy `target` */
  objective: number;
  /** Rolling window the objective is measured against */
  windowMs: number;
  /** Burn rate over the window that should fire a paging alert */
  alertBurnRate: number;
  /** HTTP route prefixes this SLO applies to (used for tagging requests) */
  routePrefixes?: string[];
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

export const SLO_DEFINITIONS: SLODefinition[] = [
  // ── Critical: trading & execution path ─────────────────────────────
  {
    id: "trading_signals_latency",
    title: "Trading signals API latency",
    description:
      "p95 of /api/signals* and /api/trades* requests must stay under 500ms — this is the surface the dashboard polls during live sessions.",
    kind: "latency",
    tier: "critical",
    target: 500,
    percentile: 95,
    objective: 0.99,
    windowMs: HOUR,
    alertBurnRate: 6,
    routePrefixes: ["/api/signals", "/api/trades"],
  },
  {
    id: "execution_path_availability",
    title: "Execution path availability",
    description:
      "/api/execution* and /api/alpaca* must answer 2xx 99.9% of the time over a rolling day. A breach here means orders may be silently dropped.",
    kind: "availability",
    tier: "critical",
    target: 0.999,
    objective: 0.999,
    windowMs: DAY,
    alertBurnRate: 14.4,
    routePrefixes: ["/api/execution", "/api/alpaca"],
  },
  {
    id: "scheduler_freshness",
    title: "Governance & calibration scheduler freshness",
    description:
      "Cycle freshness — the gap between the last completed scheduler cycle and now must stay within 2× the scheduler interval. Indicates the cron is alive.",
    kind: "freshness",
    tier: "critical",
    target: 2,
    objective: 0.995,
    windowMs: HOUR,
    alertBurnRate: 4,
    routePrefixes: ["/api/governance/scheduler", "/api/calibration/scheduler"],
  },

  // ── High: dashboard read surfaces ──────────────────────────────────
  {
    id: "dashboard_read_latency",
    title: "Dashboard read API latency",
    description:
      "p95 of all /api/* GET requests must stay under 1.5s. This covers the long tail of dashboard pages (portfolio, performance, observability).",
    kind: "latency",
    tier: "high",
    target: 1500,
    percentile: 95,
    objective: 0.95,
    windowMs: HOUR,
    alertBurnRate: 3,
  },
  {
    id: "general_availability",
    title: "API general availability",
    description:
      "All /api/* endpoints must answer 2xx-3xx-4xx (i.e. not 5xx) at least 99.5% of the time over a rolling day.",
    kind: "availability",
    tier: "high",
    target: 0.995,
    objective: 0.995,
    windowMs: DAY,
    alertBurnRate: 6,
  },

  // ── Normal: ops & low-traffic surfaces ─────────────────────────────
  {
    id: "ops_endpoint_latency",
    title: "Ops endpoint latency",
    description:
      "p99 of /api/ops* and /api/observability* requests must stay under 3s — these surface internal status and aren't on the hot path.",
    kind: "latency",
    tier: "normal",
    target: 3000,
    percentile: 99,
    objective: 0.95,
    windowMs: HOUR,
    alertBurnRate: 2,
    routePrefixes: ["/api/ops", "/api/observability"],
  },
];

export function findSLO(id: string): SLODefinition | undefined {
  return SLO_DEFINITIONS.find((s) => s.id === id);
}

/**
 * Match a request path to all SLOs that apply to it. The "general"
 * availability and dashboard latency SLOs (no `routePrefixes`) match
 * everything; specific SLOs match only their declared prefixes.
 */
export function findSLOsForPath(path: string): SLODefinition[] {
  return SLO_DEFINITIONS.filter((slo) => {
    if (!slo.routePrefixes || slo.routePrefixes.length === 0) {
      return path.startsWith("/api/");
    }
    return slo.routePrefixes.some((p) => path.startsWith(p));
  });
}
