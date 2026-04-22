import type {
  MicrostructureCurrentSnapshot,
  MicrostructureEventRecord,
  MicrostructureEventType,
} from "./microstructure_types";
import { normalizeMicrostructureSymbol } from "./orderbook_ingestor";

const MAX_SNAPSHOTS_PER_SYMBOL = Math.max(
  50,
  Math.min(10_000, Number.parseInt(process.env.MICROSTRUCTURE_STORE_MAX_SNAPSHOTS ?? "1500", 10) || 1500),
);
const MAX_EVENTS_PER_SYMBOL = Math.max(
  100,
  Math.min(25_000, Number.parseInt(process.env.MICROSTRUCTURE_STORE_MAX_EVENTS ?? "5000", 10) || 5000),
);

class OrderflowSnapshotStore {
  private snapshotsBySymbol = new Map<string, MicrostructureCurrentSnapshot[]>();
  private eventsBySymbol = new Map<string, MicrostructureEventRecord[]>();
  private eventCounter = 0;

  pushSnapshot(snapshot: MicrostructureCurrentSnapshot): void {
    const symbol = normalizeMicrostructureSymbol(snapshot.symbol);
    const list = this.snapshotsBySymbol.get(symbol) ?? [];
    list.push(snapshot);
    while (list.length > MAX_SNAPSHOTS_PER_SYMBOL) list.shift();
    this.snapshotsBySymbol.set(symbol, list);
  }

  latestSnapshot(symbolInput: string): MicrostructureCurrentSnapshot | null {
    const symbol = normalizeMicrostructureSymbol(symbolInput);
    const list = this.snapshotsBySymbol.get(symbol);
    if (!list || list.length === 0) return null;
    return list[list.length - 1] ?? null;
  }

  listSnapshots(symbolInput: string, limit = 50): MicrostructureCurrentSnapshot[] {
    const symbol = normalizeMicrostructureSymbol(symbolInput);
    const list = this.snapshotsBySymbol.get(symbol) ?? [];
    const capped = Math.max(1, Math.min(5000, Math.round(limit)));
    return list.slice(-capped);
  }

  createEvent(input: {
    symbol: string;
    type: MicrostructureEventType;
    direction: MicrostructureEventRecord["direction"];
    strength: number;
    detail: string;
    metadata?: Record<string, unknown>;
    timestamp?: string;
  }): MicrostructureEventRecord {
    const symbol = normalizeMicrostructureSymbol(input.symbol);
    const event: MicrostructureEventRecord = {
      id: `ms_${Date.now()}_${(this.eventCounter += 1)}`,
      symbol,
      type: input.type,
      direction: input.direction,
      strength: Number(Math.max(0, Math.min(1, input.strength)).toFixed(6)),
      detail: input.detail,
      metadata: input.metadata ?? {},
      timestamp: input.timestamp ?? new Date().toISOString(),
    };

    const list = this.eventsBySymbol.get(symbol) ?? [];
    list.push(event);
    while (list.length > MAX_EVENTS_PER_SYMBOL) list.shift();
    this.eventsBySymbol.set(symbol, list);

    return event;
  }

  listEvents(symbolInput: string, limit = 150): MicrostructureEventRecord[] {
    const symbol = normalizeMicrostructureSymbol(symbolInput);
    const list = this.eventsBySymbol.get(symbol) ?? [];
    const capped = Math.max(1, Math.min(10_000, Math.round(limit)));
    return list.slice(-capped).reverse();
  }

  listEventsInRange(symbolInput: string, startMs: number, endMs: number): MicrostructureEventRecord[] {
    const symbol = normalizeMicrostructureSymbol(symbolInput);
    const list = this.eventsBySymbol.get(symbol) ?? [];
    return list.filter((event) => {
      const ts = Date.parse(event.timestamp);
      return Number.isFinite(ts) && ts >= startMs && ts <= endMs;
    });
  }

  status(symbolInput?: string): {
    symbols: number;
    snapshot_count: number;
    event_count: number;
    symbol?: string;
  } {
    if (symbolInput) {
      const symbol = normalizeMicrostructureSymbol(symbolInput);
      return {
        symbol,
        symbols: this.snapshotsBySymbol.has(symbol) || this.eventsBySymbol.has(symbol) ? 1 : 0,
        snapshot_count: this.snapshotsBySymbol.get(symbol)?.length ?? 0,
        event_count: this.eventsBySymbol.get(symbol)?.length ?? 0,
      };
    }

    let snapshotCount = 0;
    for (const list of this.snapshotsBySymbol.values()) snapshotCount += list.length;

    let eventCount = 0;
    for (const list of this.eventsBySymbol.values()) eventCount += list.length;

    const symbolSet = new Set<string>([
      ...this.snapshotsBySymbol.keys(),
      ...this.eventsBySymbol.keys(),
    ]);

    return {
      symbols: symbolSet.size,
      snapshot_count: snapshotCount,
      event_count: eventCount,
    };
  }
}

export const orderflowSnapshotStore = new OrderflowSnapshotStore();
