/**
 * Market structure events — BOS, CHOCH, OB, FVG.
 *
 * These are output by `services/control_plane` after detector pipelines
 * consume Bar series and emit structured events. The Fusion Engine and
 * Setup Detection Engine consume these as their primary input.
 */
import { z } from "zod";
import { DirectionSchema, TimeframeSchema } from "./market.js";

/** Pivot point — swing high or swing low. */
export const PivotKindSchema = z.enum(["swing_high", "swing_low"]);
export type PivotKind = z.infer<typeof PivotKindSchema>;

export const PivotSchema = z.object({
  kind: PivotKindSchema,
  price: z.number(),
  t: z.string().datetime(),
  /** Index into the Bar[] window the detector consumed. */
  barIndex: z.number().int().nonnegative(),
});
export type Pivot = z.infer<typeof PivotSchema>;

/** BOS / CHOCH / equilibrium event. */
export const StructureEventKindSchema = z.enum([
  "bos",
  "choch",
  "inducement",
  "equilibrium",
]);
export type StructureEventKind = z.infer<typeof StructureEventKindSchema>;

export const StructureEventSchema = z.object({
  id: z.string().min(1),
  symbolId: z.string().min(1),
  tf: TimeframeSchema,
  kind: StructureEventKindSchema,
  direction: DirectionSchema,
  /** Price the level was broken through. */
  level: z.number(),
  /** Pivot that defined the broken level. */
  brokenPivot: PivotSchema,
  /** Bar that confirmed the break. */
  confirmationT: z.string().datetime(),
  /** Detector confidence in [0, 1]. */
  confidence: z.number().min(0).max(1),
  detectedAt: z.string().datetime(),
});
export type StructureEvent = z.infer<typeof StructureEventSchema>;

/** Order block — last opposite candle before a structure shift. */
export const OrderBlockSchema = z.object({
  id: z.string().min(1),
  symbolId: z.string().min(1),
  tf: TimeframeSchema,
  direction: DirectionSchema,
  /** OB body high/low — the zone of interest for retest entries. */
  high: z.number(),
  low: z.number(),
  /** Bar time of the OB candle itself. */
  t: z.string().datetime(),
  /** Strength score in [0, 1] — combines volume, displacement, follow-through. */
  strength: z.number().min(0).max(1),
  /** Has price returned to retest the OB? */
  retested: z.boolean().default(false),
  /** Has the OB been violated (closed through)? */
  violated: z.boolean().default(false),
  /** Optional — the structure event this OB is associated with. */
  structureEventId: z.string().nullable().default(null),
  detectedAt: z.string().datetime(),
});
export type OrderBlock = z.infer<typeof OrderBlockSchema>;

/** Fair value gap — 3-bar imbalance. */
export const FvgSchema = z.object({
  id: z.string().min(1),
  symbolId: z.string().min(1),
  tf: TimeframeSchema,
  direction: DirectionSchema,
  /** Top of the gap. */
  top: z.number(),
  /** Bottom of the gap. */
  bottom: z.number(),
  /** Time of the middle bar (the displacement bar). */
  t: z.string().datetime(),
  /** Has the FVG been mitigated (price closed through)? */
  mitigated: z.boolean().default(false),
  /** Mitigation timestamp, if any. */
  mitigatedAt: z.string().datetime().nullable().default(null),
  detectedAt: z.string().datetime(),
});
export type Fvg = z.infer<typeof FvgSchema>;

/** Aggregated market context — what the Fusion Engine reads. */
export const MarketContextSchema = z.object({
  symbolId: z.string().min(1),
  /** HTF bias derived from 4H + 1H structure. */
  htfBias: DirectionSchema,
  /** LTF bias derived from 15m + 5m structure. */
  ltfBias: DirectionSchema,
  /** True when HTF and LTF disagree. */
  conflict: z.boolean(),
  /** Most recent structure event per timeframe. */
  recentEvents: z.array(StructureEventSchema),
  /** Active (un-mitigated) order blocks. */
  activeOrderBlocks: z.array(OrderBlockSchema),
  /** Active (un-mitigated) FVGs. */
  activeFvgs: z.array(FvgSchema),
  generatedAt: z.string().datetime(),
});
export type MarketContext = z.infer<typeof MarketContextSchema>;
