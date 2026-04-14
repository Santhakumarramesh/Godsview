/**
 * event_sourcing/index.ts — Phase 77: Event Sourcing + Time Travel
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. EventStore        — append-only event log per aggregate.
 *   2. ProjectionEngine  — fold events into state snapshots.
 *   3. SnapshotStore     — periodic snapshots for fast hydration.
 *   4. TimeTravelEngine  — query state at any past point in time.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Event Store ────────────────────────────────────────────────────────────

export interface DomainEvent<T = Record<string, unknown>> {
  id: string;
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  eventVersion: number;
  payload: T;
  metadata: Record<string, unknown>;
  recordedAt: number;
  sequence: number;
}

export class EventStore {
  private readonly events: DomainEvent[] = [];
  private readonly perAggregate = new Map<string, DomainEvent[]>();
  private nextSequence = 1;

  append<T extends Record<string, unknown> = Record<string, unknown>>(params: {
    aggregateId: string;
    aggregateType: string;
    eventType: string;
    payload: T;
    metadata?: Record<string, unknown>;
  }): DomainEvent<T> {
    const list = this.perAggregate.get(params.aggregateId) ?? [];
    const eventVersion = list.length + 1;
    const event: DomainEvent<T> = {
      id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      aggregateId: params.aggregateId,
      aggregateType: params.aggregateType,
      eventType: params.eventType,
      eventVersion,
      payload: params.payload,
      metadata: params.metadata ?? {},
      recordedAt: Date.now(),
      sequence: this.nextSequence++,
    };
    list.push(event);
    this.perAggregate.set(params.aggregateId, list);
    this.events.push(event);
    if (this.events.length > 500_000) {
      const removed = this.events.shift();
      if (removed) {
        const arr = this.perAggregate.get(removed.aggregateId);
        if (arr) {
          const idx = arr.findIndex((e) => e.id === removed.id);
          if (idx >= 0) arr.splice(idx, 1);
        }
      }
    }
    return event;
  }

  forAggregate(aggregateId: string, atOrBefore?: number): DomainEvent[] {
    const list = this.perAggregate.get(aggregateId) ?? [];
    if (atOrBefore === undefined) return [...list];
    return list.filter((e) => e.recordedAt <= atOrBefore);
  }

  recent(limit = 100): DomainEvent[] {
    return this.events.slice(-limit).reverse();
  }

  query(filter?: { aggregateType?: string; eventType?: string; since?: number; until?: number }): DomainEvent[] {
    return this.events.filter((e) => {
      if (filter?.aggregateType && e.aggregateType !== filter.aggregateType) return false;
      if (filter?.eventType && e.eventType !== filter.eventType) return false;
      if (filter?.since && e.recordedAt < filter.since) return false;
      if (filter?.until && e.recordedAt > filter.until) return false;
      return true;
    });
  }

  size(): number {
    return this.events.length;
  }
}

// ── Projection Engine ──────────────────────────────────────────────────────

export type Projector<S> = (state: S, event: DomainEvent) => S;

export class ProjectionEngine {
  private readonly projectors = new Map<string, { initial: unknown; project: Projector<unknown> }>();

  register<S>(name: string, initial: S, project: Projector<S>): void {
    this.projectors.set(name, { initial, project: project as Projector<unknown> });
  }

  fold<S>(name: string, events: DomainEvent[]): S {
    const def = this.projectors.get(name);
    if (!def) throw new Error(`No projector ${name}`);
    let state = def.initial;
    for (const e of events) state = def.project(state, e);
    return state as S;
  }

  list(): string[] {
    return Array.from(this.projectors.keys());
  }
}

// ── Snapshot Store ─────────────────────────────────────────────────────────

export interface Snapshot<S = unknown> {
  id: string;
  aggregateId: string;
  projection: string;
  asOfSequence: number;
  asOfTime: number;
  state: S;
}

export class SnapshotStore {
  private readonly snapshots: Snapshot[] = [];

  save<S>(params: {
    aggregateId: string;
    projection: string;
    asOfSequence: number;
    state: S;
  }): Snapshot<S> {
    const snap: Snapshot<S> = {
      id: `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      asOfTime: Date.now(),
      ...params,
    };
    this.snapshots.push(snap as Snapshot);
    if (this.snapshots.length > 10_000) this.snapshots.shift();
    return snap;
  }

  latest(aggregateId: string, projection: string): Snapshot | null {
    const all = this.snapshots
      .filter((s) => s.aggregateId === aggregateId && s.projection === projection)
      .sort((a, b) => b.asOfSequence - a.asOfSequence);
    return all[0] ?? null;
  }

  list(aggregateId?: string): Snapshot[] {
    return aggregateId
      ? this.snapshots.filter((s) => s.aggregateId === aggregateId)
      : [...this.snapshots];
  }
}

// ── Time Travel ───────────────────────────────────────────────────────────

export class TimeTravelEngine {
  constructor(
    private readonly events: EventStore,
    private readonly projections: ProjectionEngine,
    private readonly snapshots: SnapshotStore,
  ) {}

  stateAt<S>(aggregateId: string, projection: string, atTime: number): S {
    const snap = this.snapshots.latest(aggregateId, projection);
    let baseEvents: DomainEvent[];
    let initial: S;
    if (snap && snap.asOfTime <= atTime) {
      initial = snap.state as S;
      baseEvents = this.events.forAggregate(aggregateId, atTime).filter((e) => e.sequence > snap.asOfSequence);
    } else {
      const def = (this.projections as unknown as { projectors: Map<string, { initial: unknown }> }).projectors.get(projection);
      initial = (def?.initial ?? {}) as S;
      baseEvents = this.events.forAggregate(aggregateId, atTime);
    }
    let state = initial;
    const def = (this.projections as unknown as { projectors: Map<string, { project: Projector<unknown> }> }).projectors.get(projection);
    if (!def) throw new Error(`No projector ${projection}`);
    for (const e of baseEvents) state = def.project(state, e) as S;
    return state;
  }

  current<S>(aggregateId: string, projection: string): S {
    return this.stateAt<S>(aggregateId, projection, Date.now());
  }

  diff<S>(aggregateId: string, projection: string, fromTime: number, toTime: number): { from: S; to: S } {
    return {
      from: this.stateAt<S>(aggregateId, projection, fromTime),
      to: this.stateAt<S>(aggregateId, projection, toTime),
    };
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const eventStore = new EventStore();
export const projectionEngine = new ProjectionEngine();
export const snapshotStore = new SnapshotStore();
export const timeTravelEngine = new TimeTravelEngine(eventStore, projectionEngine, snapshotStore);

// Built-in "counter" projector: counts events per type.
projectionEngine.register<Record<string, number>>(
  "event_counts",
  {},
  (state, event) => {
    const next = { ...state };
    next[event.eventType] = (next[event.eventType] ?? 0) + 1;
    return next;
  },
);

logger.info({ projectors: projectionEngine.list().length }, "[EventSourcing] initialized");
