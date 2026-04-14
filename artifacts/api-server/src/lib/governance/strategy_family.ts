/**
 * strategy_family.ts — Strategy Family Management & Comparison
 *
 * Groups related strategies into families, identifies the best performers,
 * and evaluates which strategies should be retired in favor of superior variants.
 */

import { logger } from "../logger";

// ── Types ──────────────────────────────────────────────────────────────────

export interface StrategyLineage {
  strategyId: string;
  name: string;
  variant: string;
  parentId?: string;
  children: string[];
  createdAt: string;
  baselineMetrics: {
    sharpe: number;
    winRate: number;
    maxDrawdown: number;
  };
  modifications: {
    timestamp: string;
    change: string;
    beforeMetrics: Record<string, number>;
    afterMetrics: Record<string, number>;
  }[];
}

export interface StrategyFamilyGroup {
  familyId: string;
  baseName: string;
  variants: string[];
  count: number;
  createdAt: string;
  members: {
    strategyId: string;
    name: string;
    variant: string;
    tier: string;
    sharpe: number;
    winRate: number;
    maxDrawdown: number;
    totalTrades: number;
    status: "active" | "paused" | "retired";
  }[];
}

export interface FamilyComparison {
  familyId: string;
  baseName: string;
  memberCount: number;
  metrics: {
    metric: string;
    best: { strategyId: string; value: number };
    worst: { strategyId: string; value: number };
    average: number;
    stdDev: number;
    range: { min: number; max: number };
  }[];
  recommendations: string[];
}

export interface RetirementDecision {
  strategyId: string;
  shouldRetire: boolean;
  reason: string;
  replacedBy?: string;
  estSavings: number; // Estimated maintenance cost savings
}

export interface FamilyAnalytics {
  familyId: string;
  baseName: string;
  totalMembers: number;
  activeMembers: number;
  retiredMembers: number;
  combinedTrades: number;
  avgSharpe: number;
  familyDrawdown: number;
  diversificationScore: number;
  recommendations: string[];
}

// ── Strategy Family Manager ────────────────────────────────────────────────

export class StrategyFamily {
  private families: Map<string, StrategyFamilyGroup> = new Map();
  private lineage: Map<string, StrategyLineage> = new Map();

  groupIntoFamilies(strategies: any[]): StrategyFamilyGroup[] {
    const familyMap = new Map<string, any[]>();

    // Group by base name (e.g., "Scalper_V1", "Scalper_V2" → "Scalper")
    for (const strategy of strategies) {
      const baseName = this.extractBaseName(strategy.name);
      if (!familyMap.has(baseName)) {
        familyMap.set(baseName, []);
      }
      familyMap.get(baseName)!.push(strategy);
    }

    const groups: StrategyFamilyGroup[] = [];

    for (const [baseName, members] of familyMap.entries()) {
      const familyId = `family_${baseName}_${Date.now()}`;
      const group: StrategyFamilyGroup = {
        familyId,
        baseName,
        variants: members.map((m) => m.name),
        count: members.length,
        createdAt: new Date().toISOString(),
        members: members.map((m) => ({
          strategyId: m.strategyId,
          name: m.name,
          variant: m.name.replace(baseName, "").trim(),
          tier: m.tier || "LEARNING",
          sharpe: m.sharpeRatio || 0,
          winRate: m.winRate || 0,
          maxDrawdown: m.maxDrawdown || 0,
          totalTrades: m.totalTrades || 0,
          status: m.status || "active",
        })),
      };

      this.families.set(familyId, group);
      groups.push(group);
    }

    logger.info({ familyCount: groups.length, totalStrategies: strategies.length }, "Grouped strategies into families");
    return groups;
  }

  compareFamilyMembers(familyId: string): FamilyComparison {
    const family = this.families.get(familyId);
    if (!family) {
      return {
        familyId,
        baseName: "UNKNOWN",
        memberCount: 0,
        metrics: [],
        recommendations: ["Family not found"],
      };
    }

    const metricKeys = ["sharpe", "winRate", "maxDrawdown", "totalTrades"];
    const metrics = metricKeys.map((key) => {
      const values = family.members
        .map((m) => (key === "sharpe" ? m.sharpe : key === "winRate" ? m.winRate : key === "maxDrawdown" ? m.maxDrawdown : m.totalTrades))
        .filter((v) => typeof v === "number");

      const best = Math.max(...values);
      const worst = Math.min(...values);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const stdDev = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length);

      const bestMember = family.members.find(
        (m) =>
          (key === "sharpe" ? m.sharpe : key === "winRate" ? m.winRate : key === "maxDrawdown" ? m.maxDrawdown : m.totalTrades) === best,
      );
      const worstMember = family.members.find(
        (m) =>
          (key === "sharpe" ? m.sharpe : key === "winRate" ? m.winRate : key === "maxDrawdown" ? m.maxDrawdown : m.totalTrades) === worst,
      );

      return {
        metric: key,
        best: { strategyId: bestMember?.strategyId || "UNKNOWN", value: best },
        worst: { strategyId: worstMember?.strategyId || "UNKNOWN", value: worst },
        average: avg,
        stdDev,
        range: { min: worst, max: best },
      };
    });

    const recommendations = this.generateFamilyRecommendations(family, metrics);

    return {
      familyId,
      baseName: family.baseName,
      memberCount: family.members.length,
      metrics,
      recommendations,
    };
  }

  getBestMember(familyId: string): { strategyId: string; score: number; reasoning: string } {
    const family = this.families.get(familyId);
    if (!family || family.members.length === 0) {
      return { strategyId: "UNKNOWN", score: 0, reasoning: "Family not found" };
    }

    // Composite scoring: 40% Sharpe, 30% Win Rate, 20% Drawdown, 10% Trade Count
    const scored = family.members.map((m) => {
      const sharpeScore = m.sharpe > 0 ? Math.min(1, m.sharpe / 2.0) : 0;
      const winRateScore = Math.min(1, m.winRate / 0.65);
      const drawdownScore = Math.max(0, 1 - m.maxDrawdown / 0.25);
      const tradeScore = Math.min(1, m.totalTrades / 100);

      const composite = sharpeScore * 0.4 + winRateScore * 0.3 + drawdownScore * 0.2 + tradeScore * 0.1;

      return {
        ...m,
        score: composite,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    return {
      strategyId: best.strategyId,
      score: best.score,
      reasoning: `Best performer: Sharpe ${best.sharpe.toFixed(2)}, WR ${(best.winRate * 100).toFixed(1)}%, DD ${(best.maxDrawdown * 100).toFixed(1)}%`,
    };
  }

  evaluateRetirement(strategyId: string): RetirementDecision {
    // Find family containing this strategy
    let containingFamily: StrategyFamilyGroup | null = null;
    for (const family of this.families.values()) {
      if (family.members.some((m) => m.strategyId === strategyId)) {
        containingFamily = family;
        break;
      }
    }

    if (!containingFamily) {
      return {
        strategyId,
        shouldRetire: false,
        reason: "Not in a family — no comparison baseline",
        estSavings: 0,
      };
    }

    if (containingFamily.members.length < 2) {
      return {
        strategyId,
        shouldRetire: false,
        reason: "Only member of family — keep for diversification",
        estSavings: 0,
      };
    }

    // Get the strategy's metrics
    const strategy = containingFamily.members.find((m) => m.strategyId === strategyId);
    if (!strategy) {
      return {
        strategyId,
        shouldRetire: false,
        reason: "Strategy not found",
        estSavings: 0,
      };
    }

    // Get best member
    const best = this.getBestMember(containingFamily.familyId);
    const bestMember = containingFamily.members.find((m) => m.strategyId === best.strategyId);

    if (!bestMember) {
      return {
        strategyId,
        shouldRetire: false,
        reason: "Could not evaluate against best member",
        estSavings: 0,
      };
    }

    // Decision: retire if significantly worse than best
    const sharpeGap = bestMember.sharpe - strategy.sharpe;
    const winRateGap = bestMember.winRate - strategy.winRate;

    const shouldRetire = (sharpeGap > 0.5 && winRateGap > 0.05) || (sharpeGap > 1.0);

    const estSavings = shouldRetire ? 5000 : 0; // Estimated annual operational savings

    return {
      strategyId,
      shouldRetire,
      reason: shouldRetire
        ? `Outperformed by ${bestMember.name}: Sharpe gap ${sharpeGap.toFixed(2)}, WR gap ${(winRateGap * 100).toFixed(1)}%`
        : `Competitive within family — Sharpe gap only ${sharpeGap.toFixed(2)}`,
      replacedBy: shouldRetire ? bestMember.strategyId : undefined,
      estSavings,
    };
  }

  getFamilyAnalytics(familyId: string): FamilyAnalytics {
    const family = this.families.get(familyId);
    if (!family) {
      return {
        familyId,
        baseName: "UNKNOWN",
        totalMembers: 0,
        activeMembers: 0,
        retiredMembers: 0,
        combinedTrades: 0,
        avgSharpe: 0,
        familyDrawdown: 0,
        diversificationScore: 0,
        recommendations: [],
      };
    }

    const activeMembers = family.members.filter((m) => m.status === "active").length;
    const retiredMembers = family.members.filter((m) => m.status === "retired").length;
    const combinedTrades = family.members.reduce((sum, m) => sum + m.totalTrades, 0);
    const avgSharpe = family.members.reduce((sum, m) => sum + m.sharpe, 0) / family.members.length;
    const familyDrawdown = Math.max(...family.members.map((m) => m.maxDrawdown));

    // Diversification: measure correlation-like metric from win rate variance
    const winRates = family.members.map((m) => m.winRate);
    const avgWR = winRates.reduce((a, b) => a + b, 0) / winRates.length;
    const variance = winRates.reduce((sum, wr) => sum + Math.pow(wr - avgWR, 2), 0) / winRates.length;
    const diversificationScore = Math.min(1, variance / 0.01); // Higher variance = more diversified

    const recommendations: string[] = [];
    if (avgSharpe < 1.0) recommendations.push("Family underperforming — consider consolidation");
    if (familyDrawdown > 0.25) recommendations.push("Family-wide drawdown risk high");
    if (retiredMembers > 0) recommendations.push(`${retiredMembers} retired members — archive old variants`);
    if (diversificationScore > 0.7) recommendations.push("Good diversification across variants");

    return {
      familyId,
      baseName: family.baseName,
      totalMembers: family.members.length,
      activeMembers,
      retiredMembers,
      combinedTrades,
      avgSharpe,
      familyDrawdown,
      diversificationScore,
      recommendations,
    };
  }

  getLineage(strategyId: string): StrategyLineage {
    const existing = this.lineage.get(strategyId);
    if (existing) return existing;

    // Build from scratch
    const lineage: StrategyLineage = {
      strategyId,
      name: "UNKNOWN",
      variant: "V1",
      children: [],
      createdAt: new Date().toISOString(),
      baselineMetrics: { sharpe: 0, winRate: 0, maxDrawdown: 0 },
      modifications: [],
    };

    this.lineage.set(strategyId, lineage);
    return lineage;
  }

  private extractBaseName(strategyName: string): string {
    // "Scalper_V1" → "Scalper", "MA_Cross_V2_MTF" → "MA_Cross"
    return strategyName.replace(/_V\d+.*$/, "").replace(/_v\d+.*$/i, "");
  }

  private generateFamilyRecommendations(family: StrategyFamilyGroup, metrics: any[]): string[] {
    const recommendations: string[] = [];

    const sharpeMetric = metrics.find((m) => m.metric === "sharpe");
    if (sharpeMetric && sharpeMetric.stdDev > 0.5) {
      recommendations.push("High variance in Sharpe across variants — consolidate around best performer");
    }

    const activeCount = family.members.filter((m) => m.status === "active").length;
    if (activeCount > 5) {
      recommendations.push("Many active variants — reduce portfolio complexity");
    }

    const underperformers = family.members.filter((m) => m.sharpe < 0.8 && m.status === "active");
    if (underperformers.length > 0) {
      recommendations.push(`${underperformers.length} underperforming variant(s) — evaluate for retirement`);
    }

    return recommendations.length > 0 ? recommendations : ["Family is well-optimized"];
  }
}
