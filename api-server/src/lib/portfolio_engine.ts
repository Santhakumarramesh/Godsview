import { logger } from "./logger";

export interface PositionSizing {
  symbol: string;
  raw_weight: number;         // from conviction/quality
  vol_adjusted_weight: number; // adjusted for realized vol
  max_weight: number;         // capped by constraints
  final_weight: number;       // after all adjustments
  suggested_qty: number;
  risk_contribution_pct: number;
  reasoning: string;
}

export interface RiskMetrics {
  portfolio_vol: number;
  max_single_exposure_pct: number;
  correlation_risk: "low" | "moderate" | "high";
  sector_concentration: Record<string, number>;
}

export interface PortfolioState {
  timestamp: string;
  total_equity: number;
  cash_available: number;
  positions: PositionSizing[];
  total_allocated_pct: number;
  risk_metrics: RiskMetrics;
  constraints: PortfolioConstraints;
}

export interface PortfolioConstraints {
  max_single_position_pct: number;  // default 15%
  max_sector_pct: number;           // default 30%
  max_correlated_group_pct: number; // default 40%
  max_total_invested_pct: number;   // default 80%
  vol_target_annual: number;        // default 0.15 (15%)
  min_cash_pct: number;             // default 20%
}

export interface ComputeInput {
  symbol: string;
  conviction: number;  // 0-1 from SI quality/war room score
  realized_vol: number;
  sector: string;
  current_qty: number;
  current_price: number;
}

export const DEFAULT_CONSTRAINTS: PortfolioConstraints = {
  max_single_position_pct: 0.15,
  max_sector_pct: 0.30,
  max_correlated_group_pct: 0.40,
  max_total_invested_pct: 0.80,
  vol_target_annual: 0.15,
  min_cash_pct: 0.20,
};

let cachedState: PortfolioState | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 30000; // 30 seconds

export function computeRealizedVol(
  returns: number[],
  window: number = returns.length
): number {
  if (returns.length === 0) return 0;
  
  const windowReturns = returns.slice(-window);
  const mean = windowReturns.reduce((a, b) => a + b, 0) / windowReturns.length;
  const variance =
    windowReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) /
    windowReturns.length;
  const dailyStd = Math.sqrt(variance);
  
  // Annualize: sqrt(252) ≈ 15.87
  return dailyStd * Math.sqrt(252);
}

export function computeVolTargetedWeight(
  conviction: number,
  realized_vol: number,
  vol_target: number
): number {
  const safe_vol = Math.max(realized_vol, 0.01);
  return conviction * (vol_target / safe_vol);
}

export function computePortfolio(inputs: {
  positions: ComputeInput[];
  equity: number;
  constraints?: Partial<PortfolioConstraints>;
}): PortfolioState {
  const constraints: PortfolioConstraints = {
    ...DEFAULT_CONSTRAINTS,
    ...inputs.constraints,
  };

  const positions = inputs.positions;
  
  type PosData = typeof positions[number] & { raw_weight: number; vol_adjusted_weight: number; max_weight: number };

  // Step 1: Compute vol-targeted raw weights + Step 2: Apply max_single_position_pct cap
  let positionData: PosData[] = positions.map((p) => {
    const raw_weight = computeVolTargetedWeight(
      p.conviction,
      p.realized_vol,
      constraints.vol_target_annual
    );
    return {
      ...p,
      raw_weight,
      vol_adjusted_weight: raw_weight,
      max_weight: Math.min(raw_weight, constraints.max_single_position_pct),
    };
  });

  // Step 3: Apply sector caps
  const sectorMap: Record<string, number> = {};
  positionData.forEach((p) => {
    sectorMap[p.sector] = (sectorMap[p.sector] || 0) + p.max_weight;
  });

  let scaledByIndustry = positionData.map((p) => {
    const sectorTotal = sectorMap[p.sector];
    if (sectorTotal > constraints.max_sector_pct) {
      const scale = constraints.max_sector_pct / sectorTotal;
      return {
        ...p,
        max_weight: p.max_weight * scale,
      };
    }
    return p;
  });

  // Step 4: Apply max_total_invested_pct cap
  const totalWeight = scaledByIndustry.reduce((sum, p) => sum + p.max_weight, 0);
  const scaledByTotal =
    totalWeight > constraints.max_total_invested_pct
      ? scaledByIndustry.map((p) => ({
          ...p,
          max_weight: (p.max_weight / totalWeight) * constraints.max_total_invested_pct,
        }))
      : scaledByIndustry;

  // Step 5: Compute suggested_qty and prepare for risk metrics
  const finalPositions = scaledByTotal.map((p) => {
    const suggested_qty = (p.max_weight * inputs.equity) / p.current_price;
    return {
      ...p,
      final_weight: p.max_weight,
      suggested_qty,
    };
  });

  // Step 6: Compute portfolio volatility (simplified: weighted sum)
  const portfolioVol = finalPositions.reduce(
    (sum, p) => sum + p.final_weight * p.realized_vol,
    0
  );

  // Step 7: Compute risk contribution
  const positionsWithRisk = finalPositions.map((p) => {
    const risk_contribution =
      portfolioVol > 0 ? (p.final_weight * p.realized_vol) / portfolioVol : 0;
    return {
      ...p,
      risk_contribution_pct: risk_contribution,
    };
  });

  // Step 8: Classify correlation risk
  const sectorGroupMap: Record<string, number> = {};
  positionsWithRisk.forEach((p) => {
    sectorGroupMap[p.sector] =
      (sectorGroupMap[p.sector] || 0) + p.final_weight;
  });

  let correlationRisk: "low" | "moderate" | "high" = "low";
  const sectorWeights = Object.values(sectorGroupMap);
  if (sectorWeights.some((w) => w > 0.25)) {
    correlationRisk = "high";
  } else if (sectorWeights.some((w) => w > 0.15)) {
    correlationRisk = "moderate";
  }

  // Compute max single exposure
  const maxSingleExposure = Math.max(
    ...positionsWithRisk.map((p) => p.final_weight),
    0
  );

  // Build final position sizing array with reasoning
  const sizingPositions: PositionSizing[] = positionsWithRisk.map((p) => ({
    symbol: p.symbol,
    raw_weight: p.raw_weight,
    vol_adjusted_weight: p.vol_adjusted_weight,
    max_weight: p.max_weight,
    final_weight: p.final_weight,
    suggested_qty: p.suggested_qty,
    risk_contribution_pct: p.risk_contribution_pct,
    reasoning: `Conviction: ${(p.conviction * 100).toFixed(1)}%, Vol: ${(p.realized_vol * 100).toFixed(1)}%, Raw: ${(p.raw_weight * 100).toFixed(1)}% → Final: ${(p.final_weight * 100).toFixed(1)}%`,
  }));

  const totalAllocated = sizingPositions.reduce(
    (sum, p) => sum + p.final_weight,
    0
  );
  const cashAvailable = inputs.equity * (1 - totalAllocated);

  const state: PortfolioState = {
    timestamp: new Date().toISOString(),
    total_equity: inputs.equity,
    cash_available: cashAvailable,
    positions: sizingPositions,
    total_allocated_pct: totalAllocated,
    risk_metrics: {
      portfolio_vol: portfolioVol,
      max_single_exposure_pct: maxSingleExposure,
      correlation_risk: correlationRisk,
      sector_concentration: sectorGroupMap,
    },
    constraints,
  };

  logger.info(`Computed portfolio with ${sizingPositions.length} positions, total allocation: ${(totalAllocated * 100).toFixed(1)}%`);
  cachedState = state;
  cacheTimestamp = Date.now();

  return state;
}

export function getPortfolioState(): PortfolioState | null {
  if (
    cachedState &&
    Date.now() - cacheTimestamp < CACHE_TTL_MS
  ) {
    return cachedState;
  }
  return null;
}

export function updatePortfolioState(state: PortfolioState): void {
  cachedState = state;
  cacheTimestamp = Date.now();
  logger.info(`Updated cached portfolio state`);
}
