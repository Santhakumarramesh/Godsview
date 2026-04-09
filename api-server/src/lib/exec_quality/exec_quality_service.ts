import { randomUUID } from "crypto";

export interface ExecutionRecord {
  id: string; // prefix "exec_"
  order_id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  expected_price: number;
  fill_price: number;
  slippage_bps: number;
  fill_time_ms: number;
  broker_id: string;
  venue?: string;
  timestamp: number;
  strategy_id?: string;
}

export interface ExecutionScore {
  overall: number; // 0-100
  slippage_score: number;
  speed_score: number;
  fill_rate_score: number;
  cost_score: number;
  grade: "A" | "B" | "C" | "D" | "F";
}

export interface VenueComparison {
  venue: string;
  avg_slippage_bps: number;
  avg_fill_time_ms: number;
  trade_count: number;
  score: number;
}

export interface SlippageReport {
  period: string;
  total_trades: number;
  avg_slippage: number;
  median_slippage: number;
  worst_slippage: number;
  best_slippage: number;
  positive_count: number;
  negative_count: number;
  total_slippage_cost: number;
  by_symbol: Record<string, number>;
  by_strategy: Record<string, number>;
}

export interface ExecutionCostAnalysis {
  total_commission: number;
  total_slippage_cost: number;
  total_market_impact: number;
  total_cost: number;
  cost_per_trade: number;
  cost_as_pct_of_volume: number;
}

class ExecutionQualityService {
  private executionStore = new Map<string, ExecutionRecord>();

  private calculateSlippageBps(expectedPrice: number, fillPrice: number): number {
    return Math.abs(fillPrice - expectedPrice) / expectedPrice * 10000;
  }

  private calculateSlippageScore(slippageBps: number): number {
    if (slippageBps < 2) return 100;
    if (slippageBps < 5) return 80;
    if (slippageBps < 10) return 60;
    if (slippageBps < 20) return 40;
    return 20;
  }

  private calculateSpeedScore(fillTimeMs: number): number {
    if (fillTimeMs < 50) return 100;
    if (fillTimeMs < 200) return 80;
    if (fillTimeMs < 500) return 60;
    if (fillTimeMs < 1000) return 40;
    return 20;
  }

  private calculateGrade(overall: number): "A" | "B" | "C" | "D" | "F" {
    if (overall >= 90) return "A";
    if (overall >= 80) return "B";
    if (overall >= 70) return "C";
    if (overall >= 60) return "D";
    return "F";
  }

  recordExecution(
    orderId: string,
    symbol: string,
    side: "buy" | "sell",
    quantity: number,
    expectedPrice: number,
    fillPrice: number,
    fillTimeMs: number,
    brokerId: string,
    venue?: string,
    strategyId?: string
  ): { success: boolean; data?: ExecutionRecord; error?: string } {
    const id = `exec_${randomUUID()}`;
    const slippageBps = this.calculateSlippageBps(expectedPrice, fillPrice);

    const record: ExecutionRecord = {
      id,
      order_id: orderId,
      symbol,
      side,
      quantity,
      expected_price: expectedPrice,
      fill_price: fillPrice,
      slippage_bps: slippageBps,
      fill_time_ms: fillTimeMs,
      broker_id: brokerId,
      venue,
      timestamp: Date.now(),
      strategy_id: strategyId,
    };

    this.executionStore.set(id, record);
    return { success: true, data: record };
  }

  scoreExecution(executionId: string): { success: boolean; data?: ExecutionScore; error?: string } {
    const execution = this.executionStore.get(executionId);
    if (!execution) return { success: false, error: "Execution not found" };

    const slippageScore = this.calculateSlippageScore(execution.slippage_bps);
    const speedScore = this.calculateSpeedScore(execution.fill_time_ms);
    const fillRateScore = 90; // Assume good fill rate
    const costScore = Math.max(0, 100 - execution.slippage_bps);

    const overall = (slippageScore + speedScore + fillRateScore + costScore) / 4;
    const grade = this.calculateGrade(overall);

    return {
      success: true,
      data: {
        overall: Math.round(overall),
        slippage_score: slippageScore,
        speed_score: speedScore,
        fill_rate_score: fillRateScore,
        cost_score: costScore,
        grade,
      },
    };
  }

  getExecution(executionId: string): { success: boolean; data?: ExecutionRecord; error?: string } {
    const execution = this.executionStore.get(executionId);
    return execution ? { success: true, data: execution } : { success: false, error: "Execution not found" };
  }

  getExecutionsBySymbol(symbol: string): { success: boolean; data: ExecutionRecord[] } {
    const executions = Array.from(this.executionStore.values()).filter((e) => e.symbol === symbol);
    return { success: true, data: executions };
  }

  getExecutionsByStrategy(strategyId: string): { success: boolean; data: ExecutionRecord[] } {
    const executions = Array.from(this.executionStore.values()).filter((e) => e.strategy_id === strategyId);
    return { success: true, data: executions };
  }

  getAllExecutions(): { success: boolean; data: ExecutionRecord[] } {
    return { success: true, data: Array.from(this.executionStore.values()) };
  }

  generateSlippageReport(period: string): { success: boolean; data?: SlippageReport; error?: string } {
    const executions = Array.from(this.executionStore.values());
    if (executions.length === 0) return { success: false, error: "No executions found" };

    const slippages = executions.map((e) => e.slippage_bps).sort((a, b) => a - b);
    const avgSlippage = slippages.reduce((a, b) => a + b, 0) / slippages.length;
    const medianSlippage = slippages[Math.floor(slippages.length / 2)];
    const worstSlippage = slippages[slippages.length - 1];
    const bestSlippage = slippages[0];

    const positiveCount = executions.filter((e) => e.fill_price > e.expected_price).length;
    const negativeCount = executions.filter((e) => e.fill_price < e.expected_price).length;

    const totalSlippageCost = executions.reduce((sum, e) => sum + (e.slippage_bps / 10000) * e.expected_price * e.quantity, 0);

    const bySymbol: Record<string, number> = {};
    const byStrategy: Record<string, number> = {};

    executions.forEach((e) => {
      bySymbol[e.symbol] = (bySymbol[e.symbol] ?? 0) + e.slippage_bps;
      if (e.strategy_id) {
        byStrategy[e.strategy_id] = (byStrategy[e.strategy_id] ?? 0) + e.slippage_bps;
      }
    });

    return {
      success: true,
      data: {
        period,
        total_trades: executions.length,
        avg_slippage: avgSlippage,
        median_slippage: medianSlippage,
        worst_slippage: worstSlippage,
        best_slippage: bestSlippage,
        positive_count: positiveCount,
        negative_count: negativeCount,
        total_slippage_cost: totalSlippageCost,
        by_symbol: bySymbol,
        by_strategy: byStrategy,
      },
    };
  }

  compareVenues(): { success: boolean; data: VenueComparison[] } {
    const executions = Array.from(this.executionStore.values());
    const venueMap = new Map<string, ExecutionRecord[]>();

    executions.forEach((e) => {
      const venue = e.venue ?? "unknown";
      if (!venueMap.has(venue)) venueMap.set(venue, []);
      venueMap.get(venue)!.push(e);
    });

    const comparisons: VenueComparison[] = [];
    venueMap.forEach((records, venue) => {
      const avgSlippage = records.reduce((sum, r) => sum + r.slippage_bps, 0) / records.length;
      const avgFillTime = records.reduce((sum, r) => sum + r.fill_time_ms, 0) / records.length;
      const score = 100 - avgSlippage;

      comparisons.push({
        venue,
        avg_slippage_bps: avgSlippage,
        avg_fill_time_ms: avgFillTime,
        trade_count: records.length,
        score: Math.max(0, score),
      });
    });

    return { success: true, data: comparisons.sort((a, b) => b.score - a.score) };
  }

  analyzeExecutionCosts(commissionPerTrade: number = 0): { success: boolean; data?: ExecutionCostAnalysis; error?: string } {
    const executions = Array.from(this.executionStore.values());
    if (executions.length === 0) return { success: false, error: "No executions found" };

    const totalCommission = commissionPerTrade * executions.length;
    const totalSlippageCost = executions.reduce((sum, e) => sum + (e.slippage_bps / 10000) * e.expected_price * e.quantity, 0);
    const totalMarketImpact = 0; // Placeholder
    const totalCost = totalCommission + totalSlippageCost + totalMarketImpact;
    const costPerTrade = totalCost / executions.length;

    const totalVolume = executions.reduce((sum, e) => sum + e.expected_price * e.quantity, 0);
    const costAsPctOfVolume = (totalCost / totalVolume) * 100;

    return {
      success: true,
      data: {
        total_commission: totalCommission,
        total_slippage_cost: totalSlippageCost,
        total_market_impact: totalMarketImpact,
        total_cost: totalCost,
        cost_per_trade: costPerTrade,
        cost_as_pct_of_volume: costAsPctOfVolume,
      },
    };
  }

  getBestVenue(): { success: boolean; data?: VenueComparison; error?: string } {
    const comparisons = this.compareVenues();
    if (comparisons.data.length === 0) return { success: false, error: "No venues found" };
    return { success: true, data: comparisons.data[0] };
  }

  _clearExecutions() {
    this.executionStore.clear();
  }
}

export const execQualityService = new ExecutionQualityService();
