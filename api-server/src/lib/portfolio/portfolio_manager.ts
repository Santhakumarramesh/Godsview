import { randomUUID } from "crypto";
import { logger } from "../logger";

export interface Allocation {
  allocation_id: string;
  portfolio_id: string;
  strategy_id: string;
  strategy_name?: string;
  target_weight: number;
  actual_weight: number;
  min_weight: number;
  max_weight: number;
  allocated_capital: number;
  used_capital: number;
  status: "active" | "inactive" | "paused";
  rebalance_needed: boolean;
  strategy_pnl: number;
  strategy_sharpe?: number;
  strategy_drawdown_pct?: number;
}

export interface ExposureSnapshot {
  snapshot_id: string;
  portfolio_id: string;
  total_exposure_usd: number;
  long_exposure_usd: number;
  short_exposure_usd: number;
  net_exposure_usd: number;
  gross_exposure_pct: number;
  net_exposure_pct: number;
  sector_exposure?: Record<string, number>;
  symbol_exposure?: Record<string, number>;
  portfolio_var_95?: number;
  portfolio_var_99?: number;
  max_single_position_pct?: number;
  concentration_score?: number;
  total_positions: number;
  total_strategies: number;
  total_capital: number;
  cash_remaining: number;
  snapshot_at: Date;
}

export interface CorrelationSnapshot {
  snapshot_id: string;
  portfolio_id: string;
  strategy_correlation_matrix?: Record<string, Record<string, number>>;
  asset_correlation_matrix?: Record<string, Record<string, number>>;
  max_correlation: number;
  avg_correlation: number;
  highly_correlated_pairs: Array<{
    pair: [string, string];
    correlation: number;
  }>;
  lookback_days: number;
  sample_count: number;
  snapshot_at: Date;
}

export interface RegimeAllocation {
  allocation_id: string;
  portfolio_id: string;
  regime: string;
  strategy_weights: Record<string, number>;
  regime_confidence: number;
  regime_indicators?: Record<string, any>;
  active: boolean;
  last_applied_at?: Date;
}

export interface PortfolioRiskAssessment {
  exposure_cap_breached: boolean;
  net_exposure_pct: number;
  exposure_cap_pct: number;
  correlation_warning: boolean;
  max_correlation: number;
  correlation_threshold: number;
  drawdown_warning: boolean;
  estimated_max_drawdown_pct: number;
  drawdown_limit_pct: number;
  rebalance_needed: boolean;
  num_allocations_needing_rebalance: number;
}

class PortfolioManager {
  private allocations: Map<string, Allocation> = new Map();
  private exposureSnapshots: Map<string, ExposureSnapshot> = new Map();
  private latestExposureSnapshot: Map<string, string> = new Map(); // portfolio_id -> snapshot_id
  private correlationSnapshots: Map<string, CorrelationSnapshot> = new Map();
  private latestCorrelationSnapshot: Map<string, string> = new Map(); // portfolio_id -> snapshot_id
  private regimeAllocations: Map<string, RegimeAllocation> = new Map();

  private readonly EXPOSURE_CAP_PCT = 0.8; // 80% net exposure max
  private readonly CORRELATION_THRESHOLD = 0.7; // Flag when > 0.7
  private readonly PORTFOLIO_DRAWDOWN_LIMIT = 0.15; // 15% max drawdown

  registerAllocation(params: {
    portfolio_id: string;
    strategy_id: string;
    strategy_name?: string;
    target_weight: number;
    min_weight?: number;
    max_weight?: number;
    allocated_capital: number;
  }): Allocation {
    // Validate weights
    if (params.target_weight < 0 || params.target_weight > 1) {
      throw new Error("target_weight must be between 0 and 1");
    }

    const min_weight = params.min_weight ?? 0;
    const max_weight = params.max_weight ?? 1;

    if (min_weight < 0 || min_weight > 1) {
      throw new Error("min_weight must be between 0 and 1");
    }
    if (max_weight < 0 || max_weight > 1) {
      throw new Error("max_weight must be between 0 and 1");
    }
    if (min_weight > max_weight) {
      throw new Error("min_weight cannot exceed max_weight");
    }

    // Check total weights don't exceed 100%
    const totalWeight = Array.from(this.allocations.values())
      .filter((a) => a.portfolio_id === params.portfolio_id && a.status !== "inactive")
      .reduce((sum, a) => sum + a.target_weight, 0);

    if (totalWeight + params.target_weight > 1.0 + 0.0001) {
      // Allow tiny floating point error
      throw new Error(
        `Total allocation weight would exceed 100% (current: ${(totalWeight * 100).toFixed(2)}%, new: ${(params.target_weight * 100).toFixed(2)}%)`
      );
    }

    const allocation: Allocation = {
      allocation_id: `pal_${randomUUID()}`,
      portfolio_id: params.portfolio_id,
      strategy_id: params.strategy_id,
      strategy_name: params.strategy_name,
      target_weight: params.target_weight,
      actual_weight: 0,
      min_weight,
      max_weight,
      allocated_capital: params.allocated_capital,
      used_capital: 0,
      status: "active",
      rebalance_needed: false,
      strategy_pnl: 0,
      strategy_sharpe: undefined,
      strategy_drawdown_pct: undefined,
    };

    this.allocations.set(allocation.allocation_id, allocation);
    logger.info(
      `Registered allocation ${allocation.allocation_id} for strategy ${params.strategy_id} with target weight ${(params.target_weight * 100).toFixed(2)}%`
    );

    return allocation;
  }

  updateExposure(params: {
    portfolio_id: string;
    long_exposure_usd: number;
    short_exposure_usd: number;
    net_exposure_usd: number;
    total_positions: number;
    total_strategies: number;
    total_capital: number;
    cash_remaining: number;
    portfolio_var_95?: number;
    portfolio_var_99?: number;
    max_single_position_pct?: number;
    concentration_score?: number;
    sector_exposure?: Record<string, number>;
    symbol_exposure?: Record<string, number>;
  }): ExposureSnapshot {
    const total_exposure = params.long_exposure_usd + Math.abs(params.short_exposure_usd);
    const gross_exposure_pct =
      params.total_capital > 0
        ? total_exposure / params.total_capital
        : 0;
    const net_exposure_pct =
      params.total_capital > 0
        ? params.net_exposure_usd / params.total_capital
        : 0;

    const snapshot: ExposureSnapshot = {
      snapshot_id: `pex_${randomUUID()}`,
      portfolio_id: params.portfolio_id,
      total_exposure_usd: total_exposure,
      long_exposure_usd: params.long_exposure_usd,
      short_exposure_usd: params.short_exposure_usd,
      net_exposure_usd: params.net_exposure_usd,
      gross_exposure_pct,
      net_exposure_pct,
      sector_exposure: params.sector_exposure,
      symbol_exposure: params.symbol_exposure,
      portfolio_var_95: params.portfolio_var_95,
      portfolio_var_99: params.portfolio_var_99,
      max_single_position_pct: params.max_single_position_pct,
      concentration_score: params.concentration_score,
      total_positions: params.total_positions,
      total_strategies: params.total_strategies,
      total_capital: params.total_capital,
      cash_remaining: params.cash_remaining,
      snapshot_at: new Date(),
    };

    this.exposureSnapshots.set(snapshot.snapshot_id, snapshot);
    this.latestExposureSnapshot.set(params.portfolio_id, snapshot.snapshot_id);
    logger.info(
      `Updated exposure snapshot ${snapshot.snapshot_id} for portfolio ${params.portfolio_id}: net exposure ${(net_exposure_pct * 100).toFixed(2)}%`
    );

    return snapshot;
  }

  updateCorrelation(params: {
    portfolio_id: string;
    strategy_correlation_matrix?: Record<string, Record<string, number>>;
    asset_correlation_matrix?: Record<string, Record<string, number>>;
    max_correlation: number;
    avg_correlation: number;
    highly_correlated_pairs: Array<{
      pair: [string, string];
      correlation: number;
    }>;
    lookback_days?: number;
    sample_count?: number;
  }): CorrelationSnapshot {
    const snapshot: CorrelationSnapshot = {
      snapshot_id: `pcor_${randomUUID()}`,
      portfolio_id: params.portfolio_id,
      strategy_correlation_matrix: params.strategy_correlation_matrix,
      asset_correlation_matrix: params.asset_correlation_matrix,
      max_correlation: params.max_correlation,
      avg_correlation: params.avg_correlation,
      highly_correlated_pairs: params.highly_correlated_pairs,
      lookback_days: params.lookback_days ?? 30,
      sample_count: params.sample_count ?? 0,
      snapshot_at: new Date(),
    };

    this.correlationSnapshots.set(snapshot.snapshot_id, snapshot);
    this.latestCorrelationSnapshot.set(params.portfolio_id, snapshot.snapshot_id);
    logger.info(
      `Updated correlation snapshot ${snapshot.snapshot_id} for portfolio ${params.portfolio_id}: max correlation ${params.max_correlation.toFixed(4)}`
    );

    return snapshot;
  }

  registerRegimeAllocation(params: {
    portfolio_id: string;
    regime: string;
    strategy_weights: Record<string, number>;
    regime_confidence?: number;
    regime_indicators?: Record<string, any>;
  }): RegimeAllocation {
    // Validate weights sum to ~100%
    const totalWeight = Object.values(params.strategy_weights).reduce(
      (sum, w) => sum + w,
      0
    );
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      throw new Error(
        `Strategy weights must sum to 100%, got ${(totalWeight * 100).toFixed(2)}%`
      );
    }

    const allocation: RegimeAllocation = {
      allocation_id: `pra_${randomUUID()}`,
      portfolio_id: params.portfolio_id,
      regime: params.regime,
      strategy_weights: params.strategy_weights,
      regime_confidence: params.regime_confidence ?? 0,
      regime_indicators: params.regime_indicators,
      active: true,
      last_applied_at: undefined,
    };

    this.regimeAllocations.set(allocation.allocation_id, allocation);
    logger.info(
      `Registered regime allocation ${allocation.allocation_id} for regime ${params.regime}`
    );

    return allocation;
  }

  rebalanceCheck(portfolio_id: string): {
    needs_rebalance: boolean;
    misallocations: Array<{
      strategy_id: string;
      target_weight: number;
      actual_weight: number;
      difference: number;
      severity: "low" | "medium" | "high";
    }>;
  } {
    const allocations = Array.from(this.allocations.values()).filter(
      (a) => a.portfolio_id === portfolio_id && a.status === "active"
    );

    const misallocations = allocations
      .map((a) => {
        const difference = a.actual_weight - a.target_weight;
        const absDiff = Math.abs(difference);

        let severity: "low" | "medium" | "high" = "low";
        if (absDiff > 0.05) severity = "high";
        else if (absDiff > 0.02) severity = "medium";

        return {
          strategy_id: a.strategy_id,
          target_weight: a.target_weight,
          actual_weight: a.actual_weight,
          difference,
          severity,
        };
      })
      .filter((m) => m.severity !== "low");

    const needs_rebalance = misallocations.some((m) => m.severity === "high");

    // Update allocations
    allocations.forEach((a) => {
      const misalloc = misallocations.find((m) => m.strategy_id === a.strategy_id);
      a.rebalance_needed = misalloc ? misalloc.severity === "high" : false;
    });

    if (needs_rebalance) {
      logger.info(
        `Portfolio ${portfolio_id} needs rebalancing: ${misallocations.length} misallocations`
      );
    }

    return {
      needs_rebalance,
      misallocations,
    };
  }

  getPortfolioSummary(portfolio_id: string): {
    allocations: Allocation[];
    latest_exposure?: ExposureSnapshot;
    latest_correlation?: CorrelationSnapshot;
    regime_allocations: RegimeAllocation[];
    rebalance_status: {
      needs_rebalance: boolean;
      misallocations: Array<{
        strategy_id: string;
        target_weight: number;
        actual_weight: number;
        difference: number;
        severity: "low" | "medium" | "high";
      }>;
    };
    risk_assessment: PortfolioRiskAssessment;
  } {
    const allocations = Array.from(this.allocations.values()).filter(
      (a) => a.portfolio_id === portfolio_id
    );

    // Get latest snapshots by ID reference
    const latestExposureId = this.latestExposureSnapshot.get(portfolio_id);
    const latest_exposure = latestExposureId
      ? this.exposureSnapshots.get(latestExposureId)
      : undefined;

    const latestCorrelationId = this.latestCorrelationSnapshot.get(portfolio_id);
    const latest_correlation = latestCorrelationId
      ? this.correlationSnapshots.get(latestCorrelationId)
      : undefined;

    const regime_allocations = Array.from(this.regimeAllocations.values()).filter(
      (a) => a.portfolio_id === portfolio_id
    );

    const rebalance_status = this.rebalanceCheck(portfolio_id);

    // Compute risk assessment
    const net_exposure_pct = latest_exposure?.net_exposure_pct ?? 0;
    const max_correlation = latest_correlation?.max_correlation ?? 0;
    const estimated_max_drawdown_pct = allocations.reduce((max, a) => {
      return Math.max(max, a.strategy_drawdown_pct ?? 0);
    }, 0);

    const risk_assessment: PortfolioRiskAssessment = {
      exposure_cap_breached: net_exposure_pct > this.EXPOSURE_CAP_PCT,
      net_exposure_pct,
      exposure_cap_pct: this.EXPOSURE_CAP_PCT,
      correlation_warning: max_correlation > this.CORRELATION_THRESHOLD,
      max_correlation,
      correlation_threshold: this.CORRELATION_THRESHOLD,
      drawdown_warning: estimated_max_drawdown_pct > this.PORTFOLIO_DRAWDOWN_LIMIT,
      estimated_max_drawdown_pct,
      drawdown_limit_pct: this.PORTFOLIO_DRAWDOWN_LIMIT,
      rebalance_needed: rebalance_status.needs_rebalance,
      num_allocations_needing_rebalance: rebalance_status.misallocations.filter(
        (m) => m.severity === "high"
      ).length,
    };

    return {
      allocations,
      latest_exposure,
      latest_correlation,
      regime_allocations,
      rebalance_status,
      risk_assessment,
    };
  }

  updateAllocationWeights(
    portfolio_id: string,
    weights: Record<string, number>
  ): void {
    const allocations = Array.from(this.allocations.values()).filter(
      (a) => a.portfolio_id === portfolio_id
    );

    allocations.forEach((a) => {
      if (weights[a.strategy_id] !== undefined) {
        a.actual_weight = weights[a.strategy_id];
      }
    });
  }

  updateAllocationMetrics(
    allocation_id: string,
    metrics: {
      pnl?: number;
      sharpe?: number;
      drawdown_pct?: number;
      used_capital?: number;
    }
  ): void {
    const allocation = this.allocations.get(allocation_id);
    if (!allocation) {
      throw new Error(`Allocation ${allocation_id} not found`);
    }

    if (metrics.pnl !== undefined) allocation.strategy_pnl = metrics.pnl;
    if (metrics.sharpe !== undefined) allocation.strategy_sharpe = metrics.sharpe;
    if (metrics.drawdown_pct !== undefined)
      allocation.strategy_drawdown_pct = metrics.drawdown_pct;
    if (metrics.used_capital !== undefined)
      allocation.used_capital = metrics.used_capital;
  }

  getAllocation(allocation_id: string): Allocation | undefined {
    return this.allocations.get(allocation_id);
  }

  getExposureSnapshot(snapshot_id: string): ExposureSnapshot | undefined {
    return this.exposureSnapshots.get(snapshot_id);
  }

  getCorrelationSnapshot(snapshot_id: string): CorrelationSnapshot | undefined {
    return this.correlationSnapshots.get(snapshot_id);
  }

  getRegimeAllocation(allocation_id: string): RegimeAllocation | undefined {
    return this.regimeAllocations.get(allocation_id);
  }

  // For testing
  _clearAll(): void {
    this.allocations.clear();
    this.exposureSnapshots.clear();
    this.latestExposureSnapshot.clear();
    this.correlationSnapshots.clear();
    this.latestCorrelationSnapshot.clear();
    this.regimeAllocations.clear();
  }
}

export const portfolioManager = new PortfolioManager();
