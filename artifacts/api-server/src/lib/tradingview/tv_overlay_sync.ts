/**
 * tv_overlay_sync.ts — Bidirectional TradingView Sync
 *
 * Manages pushing GodsView analysis back to TradingView via chart annotations.
 * Chrome extension polls these annotations and renders them on charts.
 *
 * Features:
 *  - Annotation storage by symbol
 *  - TTL-based cleanup
 *  - Confirmation tracking (ACK)
 *  - Support for: entry/exit lines, SL/TP lines, confidence labels, structure markings
 */

import { logger } from "../logger";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AnnotationLine {
  type: "entry" | "stop_loss" | "take_profit" | "resistance" | "support";
  price: number;
  color?: string;
  width?: number;
  style?: "solid" | "dashed" | "dotted";
  label?: string;
}

export interface AnnotationLabel {
  type: "confidence" | "setup" | "reasoning" | "risk_reward";
  text: string;
  x?: number;
  y?: number;
  color?: string;
  fontSize?: number;
  bgColor?: string;
}

export interface StructureMarking {
  type: "bos" | "choch" | "order_block" | "fvg" | "liquidity_pool";
  price_high: number;
  price_low: number;
  timeframe: string;
  color?: string;
  label?: string;
}

export interface ChartAnnotation {
  id: string;
  symbol: string;
  timeframe: string;
  created_at: number;
  expires_at: number;
  signal_id?: string;
  lines?: AnnotationLine[];
  labels?: AnnotationLabel[];
  structures?: StructureMarking[];
  confidence_score?: number;
  reasoning?: string;
  acknowledged?: boolean;
  acknowledged_at?: number;
}

interface SymbolAnnotationStore {
  pending: ChartAnnotation[];
  acknowledged: Map<string, number>; // id -> ack time
}

// ─── State Management ───────────────────────────────────────────────────────

const store = new Map<string, SymbolAnnotationStore>();
const defaultTtlMs = 3600000; // 1 hour

function getOrCreateStore(symbol: string): SymbolAnnotationStore {
  const key = symbol.toUpperCase();
  if (!store.has(key)) {
    store.set(key, { pending: [], acknowledged: new Map() });
  }
  return store.get(key)!;
}

function cleanupExpired(annotations: ChartAnnotation[]): ChartAnnotation[] {
  const now = Date.now();
  return annotations.filter((a) => a.expires_at > now);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Push an annotation to be displayed on TradingView charts.
 * Chrome extension will poll this endpoint and render it.
 */
export function pushAnnotation(
  symbol: string,
  annotation: Omit<ChartAnnotation, "id" | "created_at" | "expires_at">,
): ChartAnnotation {
  const now = Date.now();
  const full: ChartAnnotation = {
    ...annotation,
    id: `anno_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    created_at: now,
    expires_at: now + (annotation.expires_at || defaultTtlMs),
  };

  const symStore = getOrCreateStore(symbol);
  symStore.pending.push(full);

  logger.info(
    {
      annotation_id: full.id,
      symbol,
      timeframe: annotation.timeframe,
    },
    "Annotation pushed",
  );

  return full;
}

/**
 * Get pending annotations for a symbol (not yet acknowledged).
 */
export function getAnnotations(symbol: string): ChartAnnotation[] {
  const symStore = getOrCreateStore(symbol);
  symStore.pending = cleanupExpired(symStore.pending);
  return symStore.pending.filter((a) => !a.acknowledged);
}

/**
 * Get all annotations for a symbol (pending + acknowledged).
 */
export function getAllAnnotations(symbol: string): ChartAnnotation[] {
  const symStore = getOrCreateStore(symbol);
  symStore.pending = cleanupExpired(symStore.pending);
  return symStore.pending;
}

/**
 * Acknowledge an annotation (mark as delivered to Chrome extension).
 */
export function acknowledgeAnnotation(symbol: string, annotationId: string): boolean {
  const symStore = getOrCreateStore(symbol);
  const anno = symStore.pending.find((a) => a.id === annotationId);

  if (!anno) {
    logger.warn(
      { symbol, annotation_id: annotationId },
      "Annotation not found for ACK",
    );
    return false;
  }

  anno.acknowledged = true;
  anno.acknowledged_at = Date.now();
  symStore.acknowledged.set(annotationId, anno.acknowledged_at);

  logger.debug(
    { annotation_id: annotationId, symbol },
    "Annotation acknowledged",
  );

  return true;
}

/**
 * Clear all annotations for a symbol.
 */
export function clearAnnotations(symbol: string): void {
  const symStore = getOrCreateStore(symbol);
  symStore.pending = [];
  symStore.acknowledged.clear();

  logger.debug({ symbol }, "Annotations cleared");
}

/**
 * Build a standard entry/exit annotation from a signal.
 */
export function buildSignalAnnotation(
  symbol: string,
  timeframe: string,
  signal: {
    id?: string;
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    direction: "long" | "short";
    confidence: number;
    setup_type?: string;
  },
  reasoning?: string,
): ChartAnnotation {
  const entryColor = signal.direction === "long" ? "#00FF00" : "#FF0000";
  const slColor = "#FF0000";
  const tpColor = "#00FF00";

  return {
    id: `anno_${signal.id || Date.now()}`,
    symbol,
    timeframe,
    created_at: Date.now(),
    expires_at: Date.now() + defaultTtlMs,
    signal_id: signal.id,
    confidence_score: signal.confidence,
    reasoning,
    lines: [
      {
        type: "entry",
        price: signal.entry_price,
        color: entryColor,
        label: `Entry ${signal.direction === "long" ? "↑" : "↓"}`,
        style: "solid",
        width: 2,
      },
      {
        type: "stop_loss",
        price: signal.stop_loss,
        color: slColor,
        label: "SL",
        style: "dashed",
        width: 1,
      },
      {
        type: "take_profit",
        price: signal.take_profit,
        color: tpColor,
        label: "TP",
        style: "dashed",
        width: 1,
      },
    ],
    labels: [
      {
        type: "confidence",
        text: `Confidence: ${(signal.confidence * 100).toFixed(0)}%`,
        color: entryColor,
        fontSize: 10,
      },
      {
        type: "setup",
        text: signal.setup_type || "SMC",
        color: "#FFFFFF",
        fontSize: 9,
      },
    ],
  };
}

/**
 * Build a structure marking annotation (BOS, CHOCH, OB, FVG, etc).
 */
export function buildStructureAnnotation(
  symbol: string,
  timeframe: string,
  structures: StructureMarking[],
): ChartAnnotation {
  return {
    id: `struct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    symbol,
    timeframe,
    created_at: Date.now(),
    expires_at: Date.now() + defaultTtlMs,
    structures,
    labels: [
      {
        type: "reasoning",
        text: `${structures.map((s) => s.type).join(", ")}`,
        color: "#0099FF",
        fontSize: 10,
      },
    ],
  };
}

/**
 * Get annotation statistics.
 */
export function getAnnotationStats(): {
  total_symbols: number;
  total_pending: number;
  total_acknowledged: number;
  by_symbol: Record<
    string,
    { pending: number; acknowledged: number }
  >;
} {
  const stats = {
    total_symbols: store.size,
    total_pending: 0,
    total_acknowledged: 0,
    by_symbol: {} as Record<
      string,
      { pending: number; acknowledged: number }
    >,
  };

  for (const [symbol, symStore] of store.entries()) {
    const pending = cleanupExpired(symStore.pending).filter((a) => !a.acknowledged)
      .length;
    const acknowledged = symStore.acknowledged.size;

    stats.total_pending += pending;
    stats.total_acknowledged += acknowledged;
    stats.by_symbol[symbol] = { pending, acknowledged };
  }

  return stats;
}

/**
 * Reset all annotations (useful for testing).
 */
export function resetAllAnnotations(): void {
  store.clear();
  logger.info("All annotations reset");
}

export default {
  pushAnnotation,
  getAnnotations,
  getAllAnnotations,
  acknowledgeAnnotation,
  clearAnnotations,
  buildSignalAnnotation,
  buildStructureAnnotation,
  getAnnotationStats,
  resetAllAnnotations,
};
