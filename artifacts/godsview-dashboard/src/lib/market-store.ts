/**
 * GodsView Market Store
 * Central state store for live market data.
 * Combines API polling + WebSocket real-time updates.
 * Provides React hooks for consuming live data across all pages.
 */
import { useState, useEffect, useMemo, useCallback, useSyncExternalStore } from "react";
import { wsManager } from "./ws";

// ─── Types ───────────────────────────────────────────────────────────────────
export interface LivePrice {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  high: number;
  low: number;
  bid: number;
  ask: number;
  lastUpdate: number;
}

export interface LiveSignal {
  id: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  compositeScore: number;
  decision: "TRADE" | "PASS" | "REJECTED" | "BLOCKED_BY_RISK" | "DEGRADED_DATA";
  reason: string;
  scores: Record<string, number>;
  timestamp: number;
}
export interface RiskState {
  gate: "ALLOW" | "WATCH" | "REDUCE" | "BLOCK";
  dailyPnl: number;
  dailyLimit: number;
  exposure: number;
  positions: number;
  maxPositions: number;
  killSwitch: boolean;
  cooldownActive: boolean;
  cooldownEnds?: number;
}

export interface PipelineState {
  layers: {
    id: string;
    status: "OPTIMAL" | "SCANNING" | "PROCESSING" | "FORMING" | "DEGRADED" | "OFFLINE";
    score: number;
    latencyMs: number;
  }[];
  totalLatency: number;
  lastCycle: number;
}

// ─── Store ───────────────────────────────────────────────────────────────────
class MarketStore {
  private prices = new Map<string, LivePrice>();
  private signals: LiveSignal[] = [];
  private risk: RiskState = {
    gate: "ALLOW", dailyPnl: 0, dailyLimit: -250,
    exposure: 0, positions: 0, maxPositions: 3,
    killSwitch: false, cooldownActive: false,
  };  private pipeline: PipelineState = {
    layers: [], totalLatency: 0, lastCycle: 0,
  };
  private listeners = new Set<() => void>();
  private _version = 0;

  constructor() {
    // Wire up WS messages to store updates
    wsManager.on("ticker", (msg) => {
      const { symbol, price, change, change_pct, volume, high, low, bid, ask } = msg.payload;
      this.prices.set(symbol, {
        symbol, price, change, changePct: change_pct,
        volume: volume || 0, high: high || price, low: low || price,
        bid: bid || price, ask: ask || price,
        lastUpdate: msg.timestamp,
      });
      this.notify();
    });

    wsManager.on("signal", (msg) => {
      this.signals = [msg.payload as LiveSignal, ...this.signals].slice(0, 200);
      this.notify();
    });

    wsManager.on("decision", (msg) => {
      // Update the matching signal with the decision
      const { id, decision, reason } = msg.payload;
      this.signals = this.signals.map((s) =>
        s.id === id ? { ...s, decision, reason } : s
      );
      this.notify();
    });
    wsManager.on("risk_event", (msg) => {
      const { gate, dailyPnl, exposure, positions, killSwitch, cooldownActive, cooldownEnds } = msg.payload;
      if (gate !== undefined) this.risk.gate = gate;
      if (dailyPnl !== undefined) this.risk.dailyPnl = dailyPnl;
      if (exposure !== undefined) this.risk.exposure = exposure;
      if (positions !== undefined) this.risk.positions = positions;
      if (killSwitch !== undefined) this.risk.killSwitch = killSwitch;
      if (cooldownActive !== undefined) this.risk.cooldownActive = cooldownActive;
      if (cooldownEnds !== undefined) this.risk.cooldownEnds = cooldownEnds;
      this.notify();
    });

    wsManager.on("brain_update", (msg) => {
      if (msg.payload.pipeline) {
        this.pipeline = msg.payload.pipeline;
        this.notify();
      }
    });
  }

  // ─── Getters ─────────────────────────────────────────────────────────────
  getPrice(symbol: string): LivePrice | undefined { return this.prices.get(symbol); }
  getAllPrices(): LivePrice[] { return Array.from(this.prices.values()); }
  getSignals(): LiveSignal[] { return this.signals; }
  getRisk(): RiskState { return { ...this.risk }; }
  getPipeline(): PipelineState { return { ...this.pipeline }; }
  getVersion(): number { return this._version; }
  // ─── Bulk update (from API polling fallback) ─────────────────────────────
  updatePrices(data: Record<string, any>): void {
    Object.entries(data).forEach(([symbol, tick]) => {
      this.prices.set(symbol, {
        symbol,
        price: tick.price ?? tick.last ?? 0,
        change: tick.change ?? 0,
        changePct: tick.change_pct ?? tick.changePct ?? 0,
        volume: tick.volume ?? 0,
        high: tick.high ?? tick.price ?? 0,
        low: tick.low ?? tick.price ?? 0,
        bid: tick.bid ?? tick.price ?? 0,
        ask: tick.ask ?? tick.price ?? 0,
        lastUpdate: Date.now(),
      });
    });
    this.notify();
  }

  updateRisk(data: Partial<RiskState>): void {
    Object.assign(this.risk, data);
    this.notify();
  }

  updatePipeline(data: PipelineState): void {
    this.pipeline = data;
    this.notify();
  }

  pushSignal(signal: LiveSignal): void {
    this.signals = [signal, ...this.signals].slice(0, 200);
    this.notify();
  }
  // ─── Subscription (for useSyncExternalStore) ─────────────────────────────
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    this._version++;
    this.listeners.forEach((fn) => fn());
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────
export const marketStore = new MarketStore();

// ─── React Hooks ─────────────────────────────────────────────────────────────

export function useLivePrice(symbol: string): LivePrice | undefined {
  const version = useSyncExternalStore(
    (cb) => marketStore.subscribe(cb),
    () => marketStore.getVersion(),
  );
  return useMemo(() => marketStore.getPrice(symbol), [symbol, version]);
}

export function useLivePrices(): LivePrice[] {
  const version = useSyncExternalStore(
    (cb) => marketStore.subscribe(cb),
    () => marketStore.getVersion(),
  );
  return useMemo(() => marketStore.getAllPrices(), [version]);
}
export function useLiveSignals(): LiveSignal[] {
  const version = useSyncExternalStore(
    (cb) => marketStore.subscribe(cb),
    () => marketStore.getVersion(),
  );
  return useMemo(() => marketStore.getSignals(), [version]);
}

export function useLiveRisk(): RiskState {
  const version = useSyncExternalStore(
    (cb) => marketStore.subscribe(cb),
    () => marketStore.getVersion(),
  );
  return useMemo(() => marketStore.getRisk(), [version]);
}

export function useLivePipeline(): PipelineState {
  const version = useSyncExternalStore(
    (cb) => marketStore.subscribe(cb),
    () => marketStore.getVersion(),
  );
  return useMemo(() => marketStore.getPipeline(), [version]);
}