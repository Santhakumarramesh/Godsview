import { computeLiquidityZones } from "../market/liquidityMap";
import type {
  HeatmapZone,
  HeatmapZoneType,
  LiquidityHeatmapSnapshot,
  NormalizedOrderBook,
} from "./microstructure_types";

export interface LiquidityHeatmapParams {
  bucket_pct?: number;
  top_n?: number;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function classifyZone(strength: number, side: HeatmapZone["side"], distanceBps: number): HeatmapZoneType {
  if (strength >= 0.8) return side === "bid" ? "absorption" : "aggression";
  if (distanceBps >= 40 && strength <= 0.35) return "vacuum";
  return "rotation";
}

export function buildLiquidityHeatmap(
  orderbook: NormalizedOrderBook,
  params: LiquidityHeatmapParams = {},
): LiquidityHeatmapSnapshot {
  const bucketPct = Math.max(0.02, Math.min(2, params.bucket_pct ?? 0.1));
  const topN = Math.max(5, Math.min(40, Math.round(params.top_n ?? 20)));

  const { asks, bids } = computeLiquidityZones(orderbook.snapshot, {
    bucketPct,
    topN,
    minSize: 0,
    maxLevels: Math.max(25, orderbook.depth),
  });

  const mid = orderbook.mid_price;
  const zones: HeatmapZone[] = [...asks, ...bids]
    .map((zone) => {
      const priceStart = Math.min(zone.priceMin, zone.priceMax);
      const priceEnd = Math.max(zone.priceMin, zone.priceMax);
      const distanceBps = mid && mid > 0 ? Math.abs(((zone.price - mid) / mid) * 10_000) : 0;
      const intensity = Math.max(0, Math.min(1, zone.strength * (distanceBps <= 25 ? 1 : 0.85)));

      return {
        price_start: round(priceStart, 8),
        price_end: round(priceEnd, 8),
        side: zone.side,
        strength: round(zone.strength, 6),
        intensity: round(intensity, 6),
        distance_bps: round(distanceBps, 4),
        type: classifyZone(zone.strength, zone.side, distanceBps),
      };
    })
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, topN);

  const zoneScore = zones.length > 0
    ? zones.reduce((sum, z) => sum + z.intensity * (z.distance_bps <= 25 ? 1.1 : 0.9), 0) / zones.length
    : 0;

  return {
    generated_at: new Date().toISOString(),
    bucket_pct: bucketPct,
    top_n: topN,
    zone_score: round(Math.max(0, Math.min(1, zoneScore)), 6),
    zones,
  };
}
