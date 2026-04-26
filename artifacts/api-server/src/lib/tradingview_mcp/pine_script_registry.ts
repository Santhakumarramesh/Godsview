/**
 * Phase 97 — Pine Script Registry
 *
 * Maintains a registry of Pine Script strategy templates with their definitions,
 * parameters, and signal mappings. Supports lookup by name and by signal payload,
 * tracks active vs archived strategies.
 */
import { logger } from "../logger";

export interface PineScriptParameter {
  name: string;
  type: "int" | "float" | "bool" | "string";
  defaultValue: unknown;
  min?: number;
  max?: number;
  step?: number;
  description?: string;
}

export interface SignalMapping {
  signalName: string;
  direction: "long" | "short" | "none";
  confidence: number;
  triggerFields?: Record<string, unknown>;
  description?: string;
}

export interface PineScriptStrategy {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  createdAt: Date;
  updatedAt: Date;
  active: boolean;
  parameters: PineScriptParameter[];
  signals: SignalMapping[];
  timeframes: string[];
  symbols?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * PineScriptRegistry — manages Pine Script strategy definitions
 */
export class PineScriptRegistry {
  private strategies: Map<string, PineScriptStrategy> = new Map();
  private byName: Map<string, string> = new Map();
  private stats = { registered: 0, archived: 0, lookups: 0 };

  constructor() {
    logger.info("Pine Script Registry initialized");
  }

  /** Register a new Pine Script strategy */
  register(strategy: Omit<PineScriptStrategy, "createdAt" | "updatedAt">): PineScriptStrategy {
    const id = strategy.id || `pss_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const registered: PineScriptStrategy = {
      ...strategy,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.strategies.set(id, registered);
    this.byName.set(strategy.name, id);
    this.stats.registered++;

    logger.info(`Pine Script strategy registered: ${strategy.name} (v${strategy.version})`);
    return registered;
  }

  /** Unregister/archive a strategy */
  unregister(strategyId: string): boolean {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) return false;

    strategy.active = false;
    strategy.updatedAt = new Date();
    this.stats.archived++;

    logger.info(`Pine Script strategy archived: ${strategy.name}`);
    return true;
  }

  /** Look up strategy by ID */
  getById(strategyId: string): PineScriptStrategy | undefined {
    this.stats.lookups++;
    return this.strategies.get(strategyId);
  }

  /** Look up strategy by name */
  getByName(name: string): PineScriptStrategy | undefined {
    this.stats.lookups++;
    const id = this.byName.get(name);
    return id ? this.strategies.get(id) : undefined;
  }

  /** Find strategies matching a signal payload */
  findBySignalPayload(payload: Record<string, unknown>): PineScriptStrategy[] {
    const matches: PineScriptStrategy[] = [];

    for (const strategy of this.strategies.values()) {
      if (!strategy.active) continue;

      for (const signal of strategy.signals) {
        if (!this.signalPayloadMatches(payload, signal)) continue;
        matches.push(strategy);
        break;
      }
    }

    this.stats.lookups++;
    return matches;
  }

  /** Get all active strategies */
  getActive(): PineScriptStrategy[] {
    return Array.from(this.strategies.values()).filter((s) => s.active);
  }

  /** Get all archived strategies */
  getArchived(): PineScriptStrategy[] {
    return Array.from(this.strategies.values()).filter((s) => !s.active);
  }

  /** Update strategy definition */
  update(strategyId: string, updates: Partial<PineScriptStrategy>): PineScriptStrategy | null {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) return null;

    Object.assign(strategy, updates, { updatedAt: new Date() });
    if (updates.name && updates.name !== strategy.name) {
      this.byName.delete(strategy.name);
      this.byName.set(updates.name, strategyId);
    }

    logger.info(`Pine Script strategy updated: ${strategy.name}`);
    return strategy;
  }

  /** Get registry statistics */
  getStats() {
    return {
      total: this.strategies.size,
      active: Array.from(this.strategies.values()).filter((s) => s.active).length,
      archived: this.stats.archived,
      totalLookups: this.stats.lookups,
      totalRegistrations: this.stats.registered,
    };
  }

  /** Get all strategies */
  getAll(): PineScriptStrategy[] {
    return Array.from(this.strategies.values());
  }

  /** Clear all (for testing) */
  clear(): void {
    this.strategies.clear();
    this.byName.clear();
    logger.info("Pine Script Registry cleared");
  }

  private signalPayloadMatches(payload: Record<string, unknown>, signal: SignalMapping): boolean {
    if (!signal.triggerFields) return true;

    for (const [key, expectedValue] of Object.entries(signal.triggerFields)) {
      if (!(key in payload)) return false;
      if (payload[key] !== expectedValue) return false;
    }

    return true;
  }
}

export const pineScriptRegistry = new PineScriptRegistry();
