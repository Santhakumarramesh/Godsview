import { detectAbsorption } from "./absorption_engine";
import { computeImbalanceMetrics } from "./imbalance_engine";
import { buildLiquidityHeatmap } from "./liquidity_heatmap_engine";
import { computeMicrostructureScore } from "./microstructure_score";
import { ingestOrderbookSnapshot } from "./orderbook_ingestor";
import { normalizeOrderbookSnapshot } from "./orderbook_normalizer";
import { orderflowSnapshotStore } from "./orderflow_snapshot_store";
import { buildTradeTapeSummary } from "./trade_tape_engine";
import type {
  MicrostructureCurrentSnapshot,
  MicrostructureEventRecord,
  MicrostructureEventType,
} from "./microstructure_types";

export interface BuildMicrostructureOptions {
  depth?: number;
  top_levels?: number;
  tape_window_sec?: number;
  heatmap_bucket_pct?: number;
  heatmap_top_n?: number;
  force_fresh?: boolean;
}

function directionalFromSnapshot(snapshot: MicrostructureCurrentSnapshot): "long" | "short" | "neutral" {
  if (snapshot.score.direction === "long") return "long";
  if (snapshot.score.direction === "short") return "short";
  return "neutral";
}

function maybeEmitEvent(
  symbol: string,
  type: MicrostructureEventType,
  strength: number,
  detail: string,
  direction: "long" | "short" | "neutral",
  metadata: Record<string, unknown>,
): MicrostructureEventRecord {
  return orderflowSnapshotStore.createEvent({
    symbol,
    type,
    strength,
    detail,
    direction,
    metadata,
  });
}

function emitDerivedEvents(
  symbol: string,
  current: MicrostructureCurrentSnapshot,
  previous: MicrostructureCurrentSnapshot | null,
): MicrostructureEventRecord[] {
  const events: MicrostructureEventRecord[] = [];

  if (!previous || Math.sign(previous.imbalance.weighted_imbalance) !== Math.sign(current.imbalance.weighted_imbalance)) {
    if (Math.abs(current.imbalance.weighted_imbalance) >= 0.2) {
      events.push(maybeEmitEvent(
        symbol,
        "imbalance_shift",
        Math.abs(current.imbalance.weighted_imbalance),
        `Weighted imbalance shifted to ${current.imbalance.bias}`,
        directionalFromSnapshot(current),
        {
          weighted_imbalance: current.imbalance.weighted_imbalance,
          touch_imbalance: current.imbalance.touch_imbalance,
          depth_imbalance: current.imbalance.depth_imbalance,
        },
      ));
    }
  }

  if (current.absorption.state !== "none" && current.absorption.state !== previous?.absorption.state) {
    events.push(maybeEmitEvent(
      symbol,
      current.absorption.state,
      current.absorption.score,
      current.absorption.reason,
      directionalFromSnapshot(current),
      {
        persistence: current.absorption.persistence,
        mid_drift_bps: current.absorption.mid_drift_bps,
        spread_bps: current.absorption.spread_bps,
      },
    ));
  }

  const topVacuum = current.heatmap.zones.find((zone) => zone.type === "vacuum" && zone.intensity >= 0.6);
  if (topVacuum) {
    events.push(maybeEmitEvent(
      symbol,
      "liquidity_vacuum",
      topVacuum.intensity,
      `Liquidity vacuum near ${topVacuum.price_start.toFixed(2)}-${topVacuum.price_end.toFixed(2)}`,
      directionalFromSnapshot(current),
      {
        zone: topVacuum,
      },
    ));
  }

  if (current.tape.score >= 0.72 && current.tape.print_count >= 15) {
    events.push(maybeEmitEvent(
      symbol,
      "aggressive_tape",
      current.tape.score,
      `Aggressive tape burst detected (${current.tape.bias})`,
      directionalFromSnapshot(current),
      {
        normalized_delta: current.tape.normalized_delta,
        burst_score: current.tape.burst_score,
        print_count: current.tape.print_count,
      },
    ));
  }

  if (current.score.score >= 0.75 && (previous?.score.score ?? 0) < 0.65) {
    events.push(maybeEmitEvent(
      symbol,
      "score_spike",
      current.score.score,
      `Composite microstructure score spiked to ${current.score.score.toFixed(3)}`,
      directionalFromSnapshot(current),
      {
        previous_score: previous?.score.score ?? null,
        verdict: current.score.verdict,
      },
    ));
  }

  return events;
}

export async function buildMicrostructureSnapshot(
  symbol: string,
  options: BuildMicrostructureOptions = {},
): Promise<{ snapshot: MicrostructureCurrentSnapshot; events: MicrostructureEventRecord[] }> {
  const depth = Math.max(10, Math.min(120, Math.round(options.depth ?? 40)));
  const topLevels = Math.max(3, Math.min(25, Math.round(options.top_levels ?? 10)));

  const rawSnapshot = await ingestOrderbookSnapshot(symbol, {
    force_fresh: options.force_fresh === true,
  });

  const normalized = normalizeOrderbookSnapshot(rawSnapshot, depth);
  const history = orderflowSnapshotStore.listSnapshots(symbol, 30);

  const imbalance = computeImbalanceMetrics(normalized, { top_levels: topLevels });
  const absorption = detectAbsorption(normalized, imbalance, { history, persistence_window: 10 });
  const heatmap = buildLiquidityHeatmap(normalized, {
    bucket_pct: options.heatmap_bucket_pct,
    top_n: options.heatmap_top_n,
  });
  const tape = buildTradeTapeSummary(symbol, {
    window_sec: options.tape_window_sec,
  });

  const score = computeMicrostructureScore({
    orderbook: normalized,
    imbalance,
    absorption,
    heatmap,
    tape,
  });

  const composed: MicrostructureCurrentSnapshot = {
    symbol: normalized.symbol,
    generated_at: new Date().toISOString(),
    orderbook: normalized,
    imbalance,
    absorption,
    heatmap,
    tape,
    score,
  };

  const previous = orderflowSnapshotStore.latestSnapshot(symbol);
  orderflowSnapshotStore.pushSnapshot(composed);
  const events = emitDerivedEvents(symbol, composed, previous);

  return {
    snapshot: composed,
    events,
  };
}
