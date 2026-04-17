import { EventEmitter } from 'events';
import crypto from 'crypto';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface RawMarketEvent {
  id: string;
  type: 'tick' | 'candle' | 'book_update' | 'trade' | 'quote' | 'status';
  symbol: string;
  timestamp: number;
  receivedAt: number;
  source: string;
  sequence: number;
  payload: Record<string, unknown>;
  checksum: string;
  compressed: boolean;
}

export interface EventQuery {
  symbol?: string;
  startTime: number;
  endTime: number;
  types?: string[];
  source?: string;
  limit?: number;
}

export interface MarketSnapshot {
  id: string;
  timestamp: number;
  symbols: Record<string, SymbolSnapshot>;
  metadata: {
    eventCount: number;
    sourceCount: number;
    latencyMs: number;
  };
}

export interface SymbolSnapshot {
  symbol: string;
  lastPrice: number;
  bid: number;
  ask: number;
  volume24h: number;
  lastTradeTime: number;
  source: string;
}

export interface IntegrityReport {
  symbol: string;
  timeRange: { startTime: number; endTime: number };
  totalEvents: number;
  sequenceGaps: Array<{ from: number; to: number; count: number }>;
  duplicates: number;
  checksumViolations: number;
  isValid: boolean;
}

export interface StorageStats {
  totalEvents: number;
  eventsPerSymbol: Record<string, number>;
  estimatedMemoryMb: number;
  oldestEventTime: number;
  newestEventTime: number;
  eventsPerSecond: number;
  bufferUtilizationPercent: number;
  snapshotsRetained: number;
  sourcesTracked: Set<string>;
}

export interface DecisionContext {
  decisionId: string;
  timestamp: number;
  windowMs: number;
  events: RawMarketEvent[];
  snapshot: MarketSnapshot | null;
  eventCount: number;
}

// ============================================================================
// REPLAY EVENT STORE
// ============================================================================

export class ReplayEventStore extends EventEmitter {
  private events: RawMarketEvent[] = [];
  private eventsBySymbol: Map<string, RawMarketEvent[]> = new Map();
  private snapshots: Map<string, MarketSnapshot> = new Map();
  private symbolSequences: Map<string, Set<number>> = new Map();
  private decisionIndex: Map<string, { timestamp: number; snapshotId: string }> =
    new Map();

  private readonly maxEventsPerSymbol: number;
  private readonly maxTotalEvents: number;
  private readonly maxSnapshotsRetained: number;

  private lastEventTime: number = 0;
  private eventCountSinceLastStats: number = 0;
  private lastStatsTime: number = Date.now();

  constructor(
    maxEventsPerSymbol: number = 10000,
    maxTotalEvents: number = 500000,
    maxSnapshotsRetained: number = 1000
  ) {
    super();
    this.maxEventsPerSymbol = maxEventsPerSymbol;
    this.maxTotalEvents = maxTotalEvents;
    this.maxSnapshotsRetained = maxSnapshotsRetained;
    this.initializeMockData();
  }

  // ============================================================================
  // CORE STORAGE OPERATIONS
  // ============================================================================

  public store(event: RawMarketEvent): boolean {
    // Validation
    if (!this.validateEvent(event)) {
      return false;
    }

    // Check buffer capacity
    if (this.events.length >= this.maxTotalEvents) {
      this.emit('buffer:full', {
        currentSize: this.events.length,
        maxSize: this.maxTotalEvents,
      });
      this.evictOldestEvent();
    }

    // Per-symbol capacity check
    const symbolEvents = this.eventsBySymbol.get(event.symbol) || [];
    if (symbolEvents.length >= this.maxEventsPerSymbol) {
      this.evictOldestSymbolEvent(event.symbol);
    }

    // Store event
    this.events.push(event);
    if (!this.eventsBySymbol.has(event.symbol)) {
      this.eventsBySymbol.set(event.symbol, []);
    }
    this.eventsBySymbol.get(event.symbol)!.push(event);

    // Track sequence
    if (!this.symbolSequences.has(event.symbol)) {
      this.symbolSequences.set(event.symbol, new Set());
    }
    this.symbolSequences.get(event.symbol)!.add(event.sequence);

    this.lastEventTime = Math.max(this.lastEventTime, event.timestamp);
    this.eventCountSinceLastStats++;

    this.emit('event:stored', {
      id: event.id,
      symbol: event.symbol,
      type: event.type,
      timestamp: event.timestamp,
    });

    return true;
  }

  public query(params: EventQuery): RawMarketEvent[] {
    const events = params.symbol
      ? this.eventsBySymbol.get(params.symbol) || []
      : this.events;

    let results = events.filter((e) => {
      if (e.timestamp < params.startTime || e.timestamp > params.endTime) {
        return false;
      }
      if (params.types && !params.types.includes(e.type)) {
        return false;
      }
      if (params.source && e.source !== params.source) {
        return false;
      }
      return true;
    });

    results.sort((a, b) => a.timestamp - b.timestamp);

    if (params.limit) {
      results = results.slice(0, params.limit);
    }

    return results;
  }

  // ============================================================================
  // SNAPSHOT SYSTEM
  // ============================================================================

  public takeSnapshot(): MarketSnapshot {
    const snapshotId = this.generateId();
    const now = Date.now();
    const symbolSnapshots: Record<string, SymbolSnapshot> = {};

    const sourceSet = new Set<string>();
    let totalEventCount = 0;

    // Build snapshot from latest event per symbol
    for (const [symbol, symbolEvents] of this.eventsBySymbol) {
      if (symbolEvents.length === 0) continue;

      const latestEvent = symbolEvents[symbolEvents.length - 1];
      sourceSet.add(latestEvent.source);
      totalEventCount += symbolEvents.length;

      const payload = latestEvent.payload as any;
      symbolSnapshots[symbol] = {
        symbol,
        lastPrice: payload.lastPrice || 0,
        bid: payload.bid || 0,
        ask: payload.ask || 0,
        volume24h: payload.volume24h || 0,
        lastTradeTime: payload.lastTradeTime || latestEvent.timestamp,
        source: latestEvent.source,
      };
    }

    const snapshot: MarketSnapshot = {
      id: snapshotId,
      timestamp: now,
      symbols: symbolSnapshots,
      metadata: {
        eventCount: totalEventCount,
        sourceCount: sourceSet.size,
        latencyMs: 0,
      },
    };

    this.snapshots.set(snapshotId, snapshot);

    // Evict old snapshots
    if (this.snapshots.size > this.maxSnapshotsRetained) {
      const sortedSnapshots = Array.from(this.snapshots.entries()).sort(
        (a, b) => a[1].timestamp - b[1].timestamp
      );
      const idsToRemove = sortedSnapshots
        .slice(0, sortedSnapshots.length - this.maxSnapshotsRetained)
        .map(([id]) => id);
      idsToRemove.forEach((id) => this.snapshots.delete(id));
    }

    this.emit('snapshot:taken', {
      id: snapshotId,
      timestamp: now,
      symbolCount: Object.keys(symbolSnapshots).length,
    });

    return snapshot;
  }

  public getSnapshot(id: string): MarketSnapshot | null {
    return this.snapshots.get(id) || null;
  }

  public compareSnapshots(
    id1: string,
    id2: string
  ): Record<string, { before: SymbolSnapshot; after: SymbolSnapshot }> {
    const snap1 = this.snapshots.get(id1);
    const snap2 = this.snapshots.get(id2);

    if (!snap1 || !snap2) return {};

    const changes: Record<string, { before: SymbolSnapshot; after: SymbolSnapshot }> =
      {};

    for (const symbol of new Set([
      ...Object.keys(snap1.symbols),
      ...Object.keys(snap2.symbols),
    ])) {
      const before = snap1.symbols[symbol];
      const after = snap2.symbols[symbol];

      if (before && after) {
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          changes[symbol] = { before, after };
        }
      } else if (before && !after) {
        changes[symbol] = { before, after: null as any };
      } else if (!before && after) {
        changes[symbol] = { before: null as any, after };
      }
    }

    return changes;
  }

  // ============================================================================
  // REPLAY ENGINE
  // ============================================================================

  public replay(query: EventQuery): RawMarketEvent[] {
    this.emit('replay:start', { query });
    const events = this.query(query);
    this.emit('replay:complete', { eventCount: events.length, duration: 0 });
    return events;
  }

  public replayForDecision(decisionId: string, windowMs: number): DecisionContext {
    const decision = this.decisionIndex.get(decisionId);
    if (!decision) {
      return {
        decisionId,
        timestamp: 0,
        windowMs,
        events: [],
        snapshot: null,
        eventCount: 0,
      };
    }

    const startTime = decision.timestamp - windowMs;
    const endTime = decision.timestamp;

    const events = this.query({
      startTime,
      endTime,
    });

    const snapshot = this.snapshots.get(decision.snapshotId) || null;

    return {
      decisionId,
      timestamp: decision.timestamp,
      windowMs,
      events,
      snapshot,
      eventCount: events.length,
    };
  }

  public getEventStream(
    symbol: string,
    startTime: number,
    endTime: number
  ): RawMarketEvent[] {
    return this.query({
      symbol,
      startTime,
      endTime,
    });
  }

  public replayAtSpeed(
    query: EventQuery,
    speed: number = 1
  ): Promise<RawMarketEvent[]> {
    return new Promise((resolve) => {
      const events = this.query(query);
      if (events.length === 0) {
        resolve([]);
        return;
      }

      const timeRange = events[events.length - 1].timestamp - events[0].timestamp;
      const delayMs = Math.max(10, timeRange / speed / events.length);

      let processed = 0;
      const processNext = () => {
        processed++;
        if (processed < events.length) {
          setTimeout(processNext, delayMs);
        } else {
          resolve(events);
        }
      };

      processNext();
    });
  }

  // ============================================================================
  // INTEGRITY CHECKS
  // ============================================================================

  public verifyIntegrity(symbol: string, timeRange?: {
    startTime: number;
    endTime: number;
  }): IntegrityReport {
    const events = timeRange
      ? this.query({
          symbol,
          startTime: timeRange.startTime,
          endTime: timeRange.endTime,
        })
      : this.eventsBySymbol.get(symbol) || [];

    const sequenceGaps: Array<{ from: number; to: number; count: number }> = [];
    const checksumViolations = events.filter((e) => {
      const calculatedChecksum = this.calculateChecksum(e);
      return calculatedChecksum !== e.checksum;
    }).length;

    // Detect sequence gaps
    if (events.length > 0) {
      const sequences = events.map((e) => e.sequence).sort((a, b) => a - b);
      for (let i = 1; i < sequences.length; i++) {
        if (sequences[i] - sequences[i - 1] > 1) {
          sequenceGaps.push({
            from: sequences[i - 1],
            to: sequences[i],
            count: sequences[i] - sequences[i - 1] - 1,
          });
        }
      }
    }

    // Detect duplicates
    const seen = new Set<string>();
    let duplicates = 0;
    for (const e of events) {
      if (seen.has(e.id)) {
        duplicates++;
      }
      seen.add(e.id);
    }

    const isValid =
      sequenceGaps.length === 0 && checksumViolations === 0 && duplicates === 0;

    const report: IntegrityReport = {
      symbol,
      timeRange: timeRange || {
        startTime: events[0]?.timestamp || 0,
        endTime: events[events.length - 1]?.timestamp || 0,
      },
      totalEvents: events.length,
      sequenceGaps,
      duplicates,
      checksumViolations,
      isValid,
    };

    if (!isValid) {
      this.emit('integrity:violation', report);
    }

    return report;
  }

  // ============================================================================
  // STORAGE STATISTICS
  // ============================================================================

  public getStats(): StorageStats {
    const eventsPerSymbol: Record<string, number> = {};
    const sources = new Set<string>();

    for (const [symbol, symbolEvents] of this.eventsBySymbol) {
      eventsPerSymbol[symbol] = symbolEvents.length;
      symbolEvents.forEach((e) => sources.add(e.source));
    }

    const memoryEstimate = this.estimateMemoryUsage();
    const timeDiff = Date.now() - this.lastStatsTime;
    const eventsPerSecond =
      timeDiff > 0 ? (this.eventCountSinceLastStats / (timeDiff / 1000)) * 1000 : 0;

    const oldestEvent = this.events[0];
    const newestEvent = this.events[this.events.length - 1];

    const stats: StorageStats = {
      totalEvents: this.events.length,
      eventsPerSymbol,
      estimatedMemoryMb: memoryEstimate,
      oldestEventTime: oldestEvent?.timestamp || 0,
      newestEventTime: newestEvent?.timestamp || 0,
      eventsPerSecond: Math.round(eventsPerSecond),
      bufferUtilizationPercent: (this.events.length / this.maxTotalEvents) * 100,
      snapshotsRetained: this.snapshots.size,
      sourcesTracked: sources,
    };

    return stats;
  }

  // ============================================================================
  // DECISION CONTEXT
  // ============================================================================

  public getDecisionContext(
    decisionId: string,
    timestamp: number,
    windowMs: number
  ): DecisionContext {
    const snapshotId = this.generateId();
    const snapshot = this.takeSnapshot();

    this.decisionIndex.set(decisionId, {
      timestamp,
      snapshotId: snapshot.id,
    });

    return this.replayForDecision(decisionId, windowMs);
  }

  // ============================================================================
  // CLEANUP & MAINTENANCE
  // ============================================================================

  public purgeOlderThan(timestamp: number): number {
    const initialLength = this.events.length;

    const eventsToKeep = this.events.filter((e) => e.timestamp >= timestamp);
    this.events = eventsToKeep;

    for (const [symbol, symbolEvents] of this.eventsBySymbol) {
      const filtered = symbolEvents.filter((e) => e.timestamp >= timestamp);
      if (filtered.length === 0) {
        this.eventsBySymbol.delete(symbol);
        this.symbolSequences.delete(symbol);
      } else {
        this.eventsBySymbol.set(symbol, filtered);
      }
    }

    return initialLength - this.events.length;
  }

  public clear(): void {
    this.events = [];
    this.eventsBySymbol.clear();
    this.snapshots.clear();
    this.symbolSequences.clear();
    this.decisionIndex.clear();
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private validateEvent(event: RawMarketEvent): boolean {
    if (!event.id || !event.symbol || !event.timestamp) {
      return false;
    }

    const calculatedChecksum = this.calculateChecksum(event);
    if (!event.checksum) {
      event.checksum = calculatedChecksum;
    }

    return true;
  }

  private calculateChecksum(event: RawMarketEvent): string {
    const data = `${event.type}${event.symbol}${event.timestamp}${event.sequence}${JSON.stringify(
      event.payload
    )}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  private generateId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  private evictOldestEvent(): void {
    if (this.events.length === 0) return;

    const oldestEvent = this.events[0];
    const symbolEvents = this.eventsBySymbol.get(oldestEvent.symbol);

    if (symbolEvents) {
      const index = symbolEvents.indexOf(oldestEvent);
      if (index !== -1) {
        symbolEvents.splice(index, 1);
      }
    }

    this.events.shift();
  }

  private evictOldestSymbolEvent(symbol: string): void {
    const symbolEvents = this.eventsBySymbol.get(symbol);
    if (!symbolEvents || symbolEvents.length === 0) return;

    const oldestEvent = symbolEvents[0];
    const globalIndex = this.events.indexOf(oldestEvent);

    if (globalIndex !== -1) {
      this.events.splice(globalIndex, 1);
    }

    symbolEvents.shift();
  }

  private estimateMemoryUsage(): number {
    let bytes = 0;

    for (const event of this.events) {
      bytes += 8; // id string (rough)
      bytes += 50; // other fields
      bytes += JSON.stringify(event.payload).length;
    }

    for (const snapshot of this.snapshots.values()) {
      bytes += JSON.stringify(snapshot).length;
    }

    return Math.round(bytes / 1024 / 1024 * 100) / 100;
  }

  // ============================================================================
  // MOCK DATA INITIALIZATION
  // ============================================================================

  private initializeMockData(): void {
    const symbols = [
      'BTC/USD',
      'ETH/USD',
      'SOL/USD',
      'XRP/USD',
      'ADA/USD',
      'AAPL',
      'MSFT',
      'GOOGL',
      'AMZN',
      'TSLA',
    ];
    const sources = ['binance', 'coinbase', 'kraken', 'nyse', 'nasdaq'];

    const now = Date.now();
    const oneHourAgo = now - 3600000;
    let sequence = 1;

    // Generate ~200 mock events
    for (let i = 0; i < 200; i++) {
      const symbol = symbols[Math.floor(Math.random() * symbols.length)];
      const timestamp = oneHourAgo + Math.random() * 3600000;
      const source = sources[Math.floor(Math.random() * sources.length)];

      const basePrice = 100 + Math.random() * 50000;
      const spread = basePrice * 0.0005;

      const event: RawMarketEvent = {
        id: this.generateId(),
        type: ['tick', 'trade', 'quote'][Math.floor(Math.random() * 3)] as any,
        symbol,
        timestamp: Math.floor(timestamp),
        receivedAt: now,
        source,
        sequence: sequence++,
        payload: {
          lastPrice: basePrice,
          bid: basePrice - spread,
          ask: basePrice + spread,
          volume24h: Math.random() * 1000000,
          lastTradeTime: timestamp,
        },
        checksum: '',
        compressed: false,
      };

      event.checksum = this.calculateChecksum(event);
      this.store(event);
    }

    this.eventCountSinceLastStats = 0;
    this.lastStatsTime = Date.now();
  }
}
