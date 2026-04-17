/**
 * replay_store.ts — Decision reconstruction storage for replay and analysis
 *
 * Stores complete decision snapshots with:
 * - Full market state at decision time
 * - All relevant data inputs (indicators, order flow, brain layers)
 * - Decision reasoning and approval chain
 * - Outcome tracking (PnL, hold duration)
 * - What-if analysis and counterfactual scenarios
 * - Storage optimization and pruning
 */

export enum DecisionType {
  ENTER_LONG = "enter_long",
  ENTER_SHORT = "enter_short",
  EXIT = "exit",
  SKIP = "skip",
  REDUCE = "reduce",
}

export interface DecisionSnapshot {
  id: string;
  timestamp: number;
  symbol: string;
  decision: DecisionType;
  reasoning: string[];

  // Market state at decision time
  price: number;
  regime: string;
  brainScore: number;
  siApproval: boolean;

  // Data available at decision
  layerOutputs: Record<string, any>;
  indicators: Record<string, number>;
  orderflow: Record<string, number>;

  // Outcome (filled after close/exit)
  outcome?: {
    pnl: number;
    rMultiple: number;
    holdBars: number;
    exitPrice: number;
    exitTime: number;
  };

  // Metadata
  source: string; // "brain" | "user" | "system"
  context?: Record<string, any>;
}

export interface WhatIfScenario {
  scenarioId: string;
  original: DecisionSnapshot;
  modification: Partial<DecisionSnapshot>;
  hypotheticalOutcome?: any;
}

export interface WhatIfResult {
  scenarioId: string;
  original: DecisionSnapshot;
  hypothetical: DecisionSnapshot;
  pnlDifference: number;
  rMultipleDifference: number;
  recommendation: string;
}

export interface ReplayStoreStats {
  totalDecisions: number;
  symbolsTracked: Set<string>;
  dateRange: { from: number; to: number };
  averageHoldBars: number;
  winRate: number;
  totalPnL: number;
  averageRMultiple: number;
}

export class ReplayStore {
  private decisions = new Map<string, DecisionSnapshot>();
  private bySymbol = new Map<string, Set<string>>();
  private byTimestamp = new Map<number, string[]>();
  private nextId = 1;

  /**
   * Store a complete decision snapshot
   */
  storeDecision(decision: Partial<DecisionSnapshot>): string {
    const id = `dec_${this.nextId++}_${Date.now()}`;
    const snapshot: DecisionSnapshot = {
      id,
      timestamp: decision.timestamp || Date.now(),
      symbol: decision.symbol || "UNKNOWN",
      decision: decision.decision || DecisionType.SKIP,
      reasoning: decision.reasoning || [],
      price: decision.price || 0,
      regime: decision.regime || "unknown",
      brainScore: decision.brainScore || 0,
      siApproval: decision.siApproval ?? false,
      layerOutputs: decision.layerOutputs || {},
      indicators: decision.indicators || {},
      orderflow: decision.orderflow || {},
      source: decision.source || "system",
      context: decision.context || {},
    };

    this.decisions.set(id, snapshot);

    // Index by symbol
    if (!this.bySymbol.has(snapshot.symbol)) {
      this.bySymbol.set(snapshot.symbol, new Set());
    }
    this.bySymbol.get(snapshot.symbol)!.add(id);

    // Index by date (key = YYYYMMDD)
    const date = Math.floor(snapshot.timestamp / 86400000) * 86400000;
    if (!this.byTimestamp.has(date)) {
      this.byTimestamp.set(date, []);
    }
    this.byTimestamp.get(date)!.push(id);

    return id;
  }

  /**
   * Replay a specific decision
   */
  replay(decisionId: string): DecisionSnapshot | null {
    return this.decisions.get(decisionId) || null;
  }

  /**
   * Query decisions by criteria
   */
  query(filter: {
    symbol?: string;
    decisionType?: DecisionType;
    startTime?: number;
    endTime?: number;
    minBrainScore?: number;
    siApprovedOnly?: boolean;
  }): DecisionSnapshot[] {
    const results: DecisionSnapshot[] = [];

    for (const decision of this.decisions.values()) {
      // Filter by symbol
      if (filter.symbol && decision.symbol !== filter.symbol) {
        continue;
      }

      // Filter by decision type
      if (filter.decisionType && decision.decision !== filter.decisionType) {
        continue;
      }

      // Filter by time range
      if (filter.startTime && decision.timestamp < filter.startTime) {
        continue;
      }
      if (filter.endTime && decision.timestamp > filter.endTime) {
        continue;
      }

      // Filter by brain score
      if (
        filter.minBrainScore &&
        decision.brainScore < filter.minBrainScore
      ) {
        continue;
      }

      // Filter by SI approval
      if (filter.siApprovedOnly && !decision.siApproval) {
        continue;
      }

      results.push(decision);
    }

    // Sort by timestamp descending (newest first)
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Reconstruct market state at a specific time
   */
  reconstructState(symbol: string, timestamp: number): {
    decision?: DecisionSnapshot;
    context: {
      recentDecisions: DecisionSnapshot[];
      timeDistance: number;
    };
  } {
    // Find closest decision before timestamp
    const symbolDecisions = this.bySymbol.get(symbol);
    if (!symbolDecisions || symbolDecisions.size === 0) {
      return {
        context: {
          recentDecisions: [],
          timeDistance: Infinity,
        },
      };
    }

    let closest: DecisionSnapshot | undefined;
    let closestDistance = Infinity;

    for (const id of symbolDecisions) {
      const dec = this.decisions.get(id);
      if (!dec) continue;

      if (dec.timestamp <= timestamp) {
        const distance = timestamp - dec.timestamp;
        if (distance < closestDistance) {
          closest = dec;
          closestDistance = distance;
        }
      }
    }

    // Get recent decisions for context
    const recentDecisions = this.query({
      symbol,
      endTime: timestamp,
    }).slice(0, 10);

    return {
      decision: closest,
      context: {
        recentDecisions,
        timeDistance: closestDistance,
      },
    };
  }

  /**
   * Compare actual vs hypothetical decisions (what-if analysis)
   */
  whatIf(decisionId: string, alternatives: Partial<DecisionSnapshot>[]): WhatIfResult[] {
    const original = this.decisions.get(decisionId);
    if (!original) return [];

    const results: WhatIfResult[] = [];

    for (let i = 0; i < alternatives.length; i++) {
      const alt = alternatives[i];
      const scenarioId = `whatif_${decisionId}_${i}`;

      // Build hypothetical decision
      const hypothetical: DecisionSnapshot = {
        ...original,
        id: scenarioId,
        ...alt,
        timestamp: original.timestamp,
      };

      // Estimate hypothetical outcome
      const pnlDiff = this.estimatePnLDifference(original, hypothetical);
      const rMultipleDiff = this.estimateRMultipleDifference(original, hypothetical);

      let recommendation = "No change";
      if (pnlDiff > 0 && rMultipleDiff > 0) {
        recommendation = `Hypothetical would have been ${pnlDiff > 0 ? "better" : "worse"}`;
      }

      results.push({
        scenarioId,
        original,
        hypothetical,
        pnlDifference: pnlDiff,
        rMultipleDifference: rMultipleDiff,
        recommendation,
      });
    }

    return results;
  }

  /**
   * Get storage statistics
   */
  getStats(): ReplayStoreStats {
    const symbolsTracked = new Set<string>();
    let totalOutcomeHoldBars = 0;
    let outcomeCount = 0;
    let winCount = 0;
    let totalPnL = 0;
    let totalRMultiple = 0;

    let minTime = Infinity;
    let maxTime = 0;

    for (const decision of this.decisions.values()) {
      symbolsTracked.add(decision.symbol);
      minTime = Math.min(minTime, decision.timestamp);
      maxTime = Math.max(maxTime, decision.timestamp);

      if (decision.outcome) {
        totalOutcomeHoldBars += decision.outcome.holdBars || 0;
        if (decision.outcome.pnl > 0) winCount++;
        totalPnL += decision.outcome.pnl || 0;
        totalRMultiple += decision.outcome.rMultiple || 0;
        outcomeCount++;
      }
    }

    return {
      totalDecisions: this.decisions.size,
      symbolsTracked,
      dateRange: {
        from: minTime === Infinity ? 0 : minTime,
        to: maxTime,
      },
      averageHoldBars:
        outcomeCount > 0 ? totalOutcomeHoldBars / outcomeCount : 0,
      winRate: outcomeCount > 0 ? winCount / outcomeCount : 0,
      totalPnL,
      averageRMultiple: outcomeCount > 0 ? totalRMultiple / outcomeCount : 0,
    };
  }

  /**
   * Prune old decisions
   */
  prune(maxAgeMs: number): number {
    const cutoffTime = Date.now() - maxAgeMs;
    let pruned = 0;

    for (const [id, decision] of this.decisions.entries()) {
      if (decision.timestamp < cutoffTime) {
        this.decisions.delete(id);
        pruned++;

        // Remove from indexes
        const symbolSet = this.bySymbol.get(decision.symbol);
        if (symbolSet) {
          symbolSet.delete(id);
        }

        const dateKey = Math.floor(decision.timestamp / 86400000) * 86400000;
        const dateArray = this.byTimestamp.get(dateKey);
        if (dateArray) {
          const idx = dateArray.indexOf(id);
          if (idx >= 0) {
            dateArray.splice(idx, 1);
          }
        }
      }
    }

    return pruned;
  }

  /**
   * Export decisions for analysis
   */
  export(format: "json" | "csv" = "json"): string {
    if (format === "json") {
      const decisions = Array.from(this.decisions.values());
      return JSON.stringify(decisions, null, 2);
    }

    // CSV format
    const rows: string[] = [];
    rows.push(
      "id,timestamp,symbol,decision,price,brainScore,siApproval,pnl,rMultiple,holdBars"
    );

    for (const decision of this.decisions.values()) {
      const row = [
        decision.id,
        new Date(decision.timestamp).toISOString(),
        decision.symbol,
        decision.decision,
        decision.price.toFixed(2),
        decision.brainScore.toFixed(2),
        decision.siApproval ? "yes" : "no",
        decision.outcome?.pnl.toFixed(2) || "",
        decision.outcome?.rMultiple.toFixed(2) || "",
        decision.outcome?.holdBars || "",
      ];
      rows.push(row.map((v) => `"${v}"`).join(","));
    }

    return rows.join("\n");
  }

  /**
   * Clear all decisions
   */
  clear(): void {
    this.decisions.clear();
    this.bySymbol.clear();
    this.byTimestamp.clear();
    this.nextId = 1;
  }

  // ───────────────────────────────────────────────────────────────────────────

  private estimatePnLDifference(original: DecisionSnapshot, hypothetical: DecisionSnapshot): number {
    if (!original.outcome || !hypothetical.outcome) return 0;
    return hypothetical.outcome.pnl - original.outcome.pnl;
  }

  private estimateRMultipleDifference(original: DecisionSnapshot, hypothetical: DecisionSnapshot): number {
    if (!original.outcome || !hypothetical.outcome) return 0;
    return hypothetical.outcome.rMultiple - original.outcome.rMultiple;
  }
}

// Export singleton
export const replayStore = new ReplayStore();