/**
 * Phase 103 — Fusion + Explainability Layer
 * ==========================================
 * For every trade, build a structured rationale capturing:
 *   - which signals contributed and how much
 *   - why the trade was approved / reduced / rejected
 *   - a confidence breakdown
 *   - a recall context summary
 * The output object is JSON-serializable for storage in the audit trail
 * and renderable in the UI's decision drill-down.
 */

export interface SignalContribution {
  source: string;
  weight: number;       // [-1..1] signed contribution
  confidence: number;   // [0..1]
  notes?: string;
}

export interface FusionInputs {
  decision_id: string;
  symbol: string;
  side: "buy" | "sell";
  contributions: SignalContribution[];
  recall?: { matches: number; win_rate: number };
  regime?: string;
  governance_veto?: string;
  risk_adjustments?: string[];
  size_multiplier?: number;
}

export interface ConfidenceBreakdown {
  base: number;
  recall_adj: number;
  regime_adj: number;
  governance_adj: number;
  final: number;
}

export interface ExplainabilityRecord {
  decision_id: string;
  symbol: string;
  side: "buy" | "sell";
  ts: number;
  outcome: "approved" | "reduced" | "rejected" | "vetoed";
  reasons: string[];
  contributions_used: SignalContribution[];
  contributions_rejected: SignalContribution[];
  confidence: ConfidenceBreakdown;
  recall_context?: { matches: number; win_rate: number };
  regime?: string;
  size_multiplier: number;
}

export class FusionExplain {
  private readonly records = new Map<string, ExplainabilityRecord>();

  fuse(inputs: FusionInputs): ExplainabilityRecord {
    const used = inputs.contributions.filter((c) => c.confidence >= 0.3);
    const rejected = inputs.contributions.filter((c) => c.confidence < 0.3);

    const baseScore =
      used.reduce((s, c) => s + c.weight * c.confidence, 0) /
      Math.max(1, used.length);

    const recallAdj = inputs.recall
      ? (inputs.recall.win_rate - 0.5) * 0.4
      : 0;

    const regimeAdj =
      inputs.regime === "trending"
        ? 0.1
        : inputs.regime === "ranging"
          ? -0.05
          : inputs.regime === "volatile"
            ? -0.15
            : 0;

    const govAdj = inputs.governance_veto ? -1 : 0;

    const finalConf = clamp(baseScore + recallAdj + regimeAdj + govAdj, -1, 1);

    let outcome: ExplainabilityRecord["outcome"];
    let sizeMult = inputs.size_multiplier ?? 1;
    const reasons: string[] = [];

    if (inputs.governance_veto) {
      outcome = "vetoed";
      sizeMult = 0;
      reasons.push(`governance_veto:${inputs.governance_veto}`);
    } else if (finalConf < -0.1) {
      outcome = "rejected";
      sizeMult = 0;
      reasons.push("confidence_negative");
    } else if (finalConf < 0.3) {
      outcome = "reduced";
      sizeMult = Math.min(sizeMult, 0.5);
      reasons.push("confidence_marginal");
    } else {
      outcome = "approved";
      reasons.push("confidence_strong");
    }

    if (inputs.recall && inputs.recall.matches >= 5 && inputs.recall.win_rate < 0.4) {
      reasons.push("recall_warning_low_winrate");
      sizeMult *= 0.75;
      if (outcome === "approved") outcome = "reduced";
    }

    if (inputs.risk_adjustments) {
      for (const r of inputs.risk_adjustments) reasons.push(`risk:${r}`);
    }

    const rec: ExplainabilityRecord = {
      decision_id: inputs.decision_id,
      symbol: inputs.symbol,
      side: inputs.side,
      ts: Date.now(),
      outcome,
      reasons,
      contributions_used: used,
      contributions_rejected: rejected,
      confidence: {
        base: baseScore,
        recall_adj: recallAdj,
        regime_adj: regimeAdj,
        governance_adj: govAdj,
        final: finalConf,
      },
      recall_context: inputs.recall,
      regime: inputs.regime,
      size_multiplier: sizeMult,
    };
    this.records.set(inputs.decision_id, rec);
    return rec;
  }

  get(decision_id: string): ExplainabilityRecord | undefined {
    return this.records.get(decision_id);
  }

  list(limit = 100): ExplainabilityRecord[] {
    return Array.from(this.records.values()).slice(-limit);
  }

  reset(): void {
    this.records.clear();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

let SINGLETON: FusionExplain | undefined;
export function getFusionExplain(): FusionExplain {
  if (!SINGLETON) SINGLETON = new FusionExplain();
  return SINGLETON;
}
