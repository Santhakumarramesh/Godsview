/**
 * SLO Definitions (Phase 6) — Codified Service Level Objectives
 */

export type SLOTier = "critical" | "high" | "normal";
export type SLOKind = "latency" | "availability" | "freshness" | "throughput";

export interface SLODefinition {
  id: string; title: string; description: string;
  kind: SLOKind; tier: SLOTier;
  target: number; percentile?: 50 | 90 | 95 | 99;
  objective: number; windowMs: number;
  alertBurnRate: number; routePrefixes?: string[];
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

export const SLO_DEFINITIONS: SLODefinition[] = [
  {
    id: "trading_signals_latency", title: "Trading signals API latency",
    description: "p95 of /api/signals* and /api/trades* requests must stay under 500ms",
    kind: "latency", tier: "critical", target: 500, percentile: 95,
    objective: 0.99, windowMs: HOUR, alertBurnRate: 6,
    routePrefixes: ["/api/signals", "/api/trades"],
  },
  {
    id: "execution_path_availability", title: "Execution path availability",
    description: "/api/execution* and /api/alpaca* must answer 2xx 99.9% of the time",
    kind: "availability", tier: "critical", target: 0.999,
    objective: 0.999, windowMs: DAY, alertBurnRate: 14.4,
    routePrefixes: ["/api/execution", "/api/alpaca"],
  },  {
    id: "scheduler_freshness", title: "Governance & calibration scheduler freshness",
    description: "Cycle freshness must stay within 2x the scheduler interval",
    kind: "freshness", tier: "critical", target: 2,
    objective: 0.995, windowMs: HOUR, alertBurnRate: 4,
    routePrefixes: ["/api/governance/scheduler", "/api/calibration/scheduler"],
  },
  {
    id: "dashboard_read_latency", title: "Dashboard read API latency",
    description: "p95 of all /api/* GET requests must stay under 1.5s",
    kind: "latency", tier: "high", target: 1500, percentile: 95,
    objective: 0.95, windowMs: HOUR, alertBurnRate: 3,
  },
  {
    id: "general_availability", title: "API general availability",
    description: "All /api/* endpoints must answer non-5xx at least 99.5% of the time",
    kind: "availability", tier: "high", target: 0.995,
    objective: 0.995, windowMs: DAY, alertBurnRate: 6,
  },
  {
    id: "ops_endpoint_latency", title: "Ops endpoint latency",
    description: "p99 of /api/ops* and /api/observability* requests must stay under 3s",
    kind: "latency", tier: "normal", target: 3000, percentile: 99,
    objective: 0.95, windowMs: HOUR, alertBurnRate: 2,
    routePrefixes: ["/api/ops", "/api/observability"],
  },
];

export function findSLO(id: string): SLODefinition | undefined {
  return SLO_DEFINITIONS.find((s) => s.id === id);
}

export function findSLOsForPath(path: string): SLODefinition[] {
  return SLO_DEFINITIONS.filter((slo) => {
    if (!slo.routePrefixes || slo.routePrefixes.length === 0)
      return path.startsWith("/api/");
    return slo.routePrefixes.some((p) => path.startsWith(p));
  });
}
