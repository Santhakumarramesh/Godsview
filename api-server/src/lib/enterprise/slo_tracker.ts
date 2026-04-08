/**
 * SLO Tracker — Service Level Objective tracking
 *
 * Records and summarizes SLO metrics.
 */

export interface SloEvent {
  id: string;
  slo_name: string;
  target: number;
  actual: number;
  met: boolean;
  timestamp: Date;
}

export interface SloSummary {
  total: number;
  met: number;
  breached: number;
  compliance_pct: number;
  by_slo: Record<string, SloMetrics>;
}

export interface SloMetrics {
  total: number;
  met: number;
  breached: number;
  compliance_pct: number;
}

// In-memory store
let sloEvents: SloEvent[] = [];

/**
 * Generate SLO event ID with slo_ prefix
 */
function generateSloEventId(): string {
  return `slo_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Record a new SLO event
 */
export function recordSloEvent(
  slo_name: string,
  target: number,
  actual: number,
  met: boolean
): SloEvent {
  const event: SloEvent = {
    id: generateSloEventId(),
    slo_name,
    target,
    actual,
    met,
    timestamp: new Date(),
  };

  sloEvents.push(event);
  return event;
}

/**
 * Get all SLO events
 */
export function getSloEvents(): SloEvent[] {
  return [...sloEvents];
}

/**
 * Get SLO summary with compliance metrics
 */
export function getSloSummary(): SloSummary {
  const total = sloEvents.length;
  const met = sloEvents.filter((e) => e.met).length;
  const breached = total - met;
  const compliance_pct = total === 0 ? 100 : (met / total) * 100;

  // Group by SLO name
  const byName = new Map<string, SloMetrics>();

  for (const event of sloEvents) {
    if (!byName.has(event.slo_name)) {
      byName.set(event.slo_name, {
        total: 0,
        met: 0,
        breached: 0,
        compliance_pct: 0,
      });
    }

    const metrics = byName.get(event.slo_name)!;
    metrics.total += 1;
    if (event.met) {
      metrics.met += 1;
    } else {
      metrics.breached += 1;
    }
    metrics.compliance_pct =
      metrics.total === 0 ? 100 : (metrics.met / metrics.total) * 100;
  }

  const by_slo: Record<string, SloMetrics> = {};
  for (const [name, metrics] of byName) {
    by_slo[name] = metrics;
  }

  return {
    total,
    met,
    breached,
    compliance_pct,
    by_slo,
  };
}

/**
 * Clear all SLO events (for testing)
 */
export function _clearAll() {
  sloEvents = [];
}
