/**
 * Phase 102 — Strategy Correlation & Portfolio Heat Map
 *
 * Three subsystems for portfolio-level risk visibility:
 * 1. StrategyCorrelator — NxN correlation matrix + dangerous pair detection
 * 2. PortfolioHeatmap — sector × timeframe exposure grid
 * 3. DrawdownAnalyzer — real-time drawdown tracking & recovery analysis
 */

export { StrategyCorrelator } from "./strategy_correlator.js";
export type { CorrelationMatrix, CorrelationPair, ConcentrationMetrics } from "./strategy_correlator.js";

export { PortfolioHeatmap } from "./portfolio_heatmap.js";
export type { PositionEntry, HeatmapCell, HeatmapData, ExposureBreakdown, RiskHotspot } from "./portfolio_heatmap.js";

export { DrawdownAnalyzer } from "./drawdown_analyzer.js";
export type { DrawdownState, DrawdownEvent, RecoveryAnalysis, EquityCurveStats } from "./drawdown_analyzer.js";
