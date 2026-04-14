/**
 * tax_tracking/index.ts — Phase 87: Tax Lot Tracking + Wash Sale
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. TaxLotTracker        — FIFO/LIFO/HIFO lot tracking.
 *   2. WashSaleDetector     — IRS 30-day wash-sale rule check.
 *   3. CapitalGainsReporter — short/long-term capital gains.
 *   4. Form1099Builder      — synthesize 1099-B style line items.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Lots ───────────────────────────────────────────────────────────────────

export type CostBasisMethod = "FIFO" | "LIFO" | "HIFO";

export interface Lot {
  id: string;
  symbol: string;
  acquiredAt: number;
  quantity: number;
  costPerShare: number;
  remainingQty: number;
}

export interface DisposalRecord {
  id: string;
  lotId: string;
  symbol: string;
  acquiredAt: number;
  disposedAt: number;
  quantity: number;
  costPerShare: number;
  proceedsPerShare: number;
  proceeds: number;
  costBasis: number;
  realizedGain: number;
  holdingPeriodDays: number;
  shortTerm: boolean;
  washSaleAdjustment: number;
}

export class TaxLotTracker {
  private readonly lots: Lot[] = [];
  private readonly disposals: DisposalRecord[] = [];
  private method: CostBasisMethod = "FIFO";

  setMethod(method: CostBasisMethod): void {
    this.method = method;
  }

  getMethod(): CostBasisMethod {
    return this.method;
  }

  acquire(symbol: string, quantity: number, costPerShare: number, at = Date.now()): Lot {
    const lot: Lot = {
      id: `lot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      symbol,
      acquiredAt: at,
      quantity,
      costPerShare,
      remainingQty: quantity,
    };
    this.lots.push(lot);
    return lot;
  }

  dispose(symbol: string, quantity: number, proceedsPerShare: number, at = Date.now()): DisposalRecord[] {
    const candidates = this.lots
      .filter((l) => l.symbol === symbol && l.remainingQty > 0);
    const sorted = this._sortLots(candidates);
    const disposals: DisposalRecord[] = [];
    let remaining = quantity;
    for (const lot of sorted) {
      if (remaining <= 0) break;
      const take = Math.min(lot.remainingQty, remaining);
      const holdingPeriodMs = at - lot.acquiredAt;
      const holdingPeriodDays = holdingPeriodMs / (24 * 60 * 60 * 1000);
      const shortTerm = holdingPeriodDays < 365;
      const proceeds = take * proceedsPerShare;
      const costBasis = take * lot.costPerShare;
      const record: DisposalRecord = {
        id: `dsp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        lotId: lot.id,
        symbol,
        acquiredAt: lot.acquiredAt,
        disposedAt: at,
        quantity: take,
        costPerShare: lot.costPerShare,
        proceedsPerShare,
        proceeds,
        costBasis,
        realizedGain: proceeds - costBasis,
        holdingPeriodDays,
        shortTerm,
        washSaleAdjustment: 0,
      };
      lot.remainingQty -= take;
      remaining -= take;
      this.disposals.push(record);
      disposals.push(record);
    }
    if (remaining > 0) {
      logger.warn({ symbol, requested: quantity, remaining }, "[Tax] Insufficient lots for disposal");
    }
    return disposals;
  }

  position(symbol: string): { quantity: number; avgCostBasis: number } {
    const open = this.lots.filter((l) => l.symbol === symbol && l.remainingQty > 0);
    const totalQty = open.reduce((s, l) => s + l.remainingQty, 0);
    if (totalQty === 0) return { quantity: 0, avgCostBasis: 0 };
    const totalCost = open.reduce((s, l) => s + l.remainingQty * l.costPerShare, 0);
    return { quantity: totalQty, avgCostBasis: totalCost / totalQty };
  }

  openLots(symbol?: string): Lot[] {
    return this.lots.filter((l) => l.remainingQty > 0 && (!symbol || l.symbol === symbol));
  }

  allDisposals(): DisposalRecord[] {
    return [...this.disposals];
  }

  private _sortLots(lots: Lot[]): Lot[] {
    if (this.method === "FIFO") return [...lots].sort((a, b) => a.acquiredAt - b.acquiredAt);
    if (this.method === "LIFO") return [...lots].sort((a, b) => b.acquiredAt - a.acquiredAt);
    return [...lots].sort((a, b) => b.costPerShare - a.costPerShare); // HIFO
  }
}

// ── Wash Sale Detector ────────────────────────────────────────────────────

export interface WashSaleViolation {
  disposalId: string;
  symbol: string;
  disposedAt: number;
  reacquiredAt: number;
  realizedLoss: number;
  disallowedLoss: number;
  newBasisAdjustment: number;
}

export class WashSaleDetector {
  /**
   * IRS 30-day rule: if a security is repurchased within 30 days before or after
   * a loss-realizing sale, the loss is disallowed and added to the new lot's basis.
   */
  detect(disposals: DisposalRecord[], lots: Lot[]): WashSaleViolation[] {
    const violations: WashSaleViolation[] = [];
    const windowMs = 30 * 24 * 60 * 60 * 1000;
    for (const d of disposals) {
      if (d.realizedGain >= 0) continue; // only losses trigger wash sale
      const candidateReplacements = lots.filter((l) =>
        l.symbol === d.symbol &&
        l.id !== d.lotId &&
        Math.abs(l.acquiredAt - d.disposedAt) <= windowMs &&
        l.acquiredAt !== d.acquiredAt,
      );
      if (candidateReplacements.length > 0) {
        const replacement = candidateReplacements[0]!;
        const disallowedLoss = -d.realizedGain;
        violations.push({
          disposalId: d.id,
          symbol: d.symbol,
          disposedAt: d.disposedAt,
          reacquiredAt: replacement.acquiredAt,
          realizedLoss: d.realizedGain,
          disallowedLoss,
          newBasisAdjustment: disallowedLoss,
        });
        // Apply the adjustment back to the disposal record
        d.washSaleAdjustment = disallowedLoss;
      }
    }
    return violations;
  }
}

// ── Capital Gains Reporter ────────────────────────────────────────────────

export interface CapitalGainsSummary {
  shortTermProceeds: number;
  shortTermBasis: number;
  shortTermGain: number;
  longTermProceeds: number;
  longTermBasis: number;
  longTermGain: number;
  totalGain: number;
  washSaleAdjustments: number;
  netGain: number;
}

export class CapitalGainsReporter {
  summarize(disposals: DisposalRecord[], range?: { start?: number; end?: number }): CapitalGainsSummary {
    const filtered = disposals.filter((d) => {
      if (range?.start !== undefined && d.disposedAt < range.start) return false;
      if (range?.end !== undefined && d.disposedAt > range.end) return false;
      return true;
    });
    let stP = 0, stB = 0, ltP = 0, ltB = 0, washAdj = 0;
    for (const d of filtered) {
      if (d.shortTerm) {
        stP += d.proceeds;
        stB += d.costBasis;
      } else {
        ltP += d.proceeds;
        ltB += d.costBasis;
      }
      washAdj += d.washSaleAdjustment;
    }
    const stGain = stP - stB;
    const ltGain = ltP - ltB;
    const totalGain = stGain + ltGain;
    return {
      shortTermProceeds: stP, shortTermBasis: stB, shortTermGain: stGain,
      longTermProceeds: ltP, longTermBasis: ltB, longTermGain: ltGain,
      totalGain,
      washSaleAdjustments: washAdj,
      netGain: totalGain + washAdj,
    };
  }
}

// ── Form 1099 Builder ─────────────────────────────────────────────────────

export interface Form1099Line {
  symbol: string;
  acquiredAt: string;        // YYYY-MM-DD
  disposedAt: string;
  quantity: number;
  proceeds: number;
  costBasis: number;
  shortTerm: boolean;
  washSale: boolean;
  washSaleAmount: number;
}

export class Form1099Builder {
  build(disposals: DisposalRecord[]): Form1099Line[] {
    const fmt = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
    return disposals.map((d) => ({
      symbol: d.symbol,
      acquiredAt: fmt(d.acquiredAt),
      disposedAt: fmt(d.disposedAt),
      quantity: d.quantity,
      proceeds: Number(d.proceeds.toFixed(2)),
      costBasis: Number(d.costBasis.toFixed(2)),
      shortTerm: d.shortTerm,
      washSale: d.washSaleAdjustment > 0,
      washSaleAmount: Number(d.washSaleAdjustment.toFixed(2)),
    }));
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const taxLotTracker = new TaxLotTracker();
export const washSaleDetector = new WashSaleDetector();
export const capitalGainsReporter = new CapitalGainsReporter();
export const form1099Builder = new Form1099Builder();
