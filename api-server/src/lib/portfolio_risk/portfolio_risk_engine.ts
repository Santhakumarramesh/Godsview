import crypto from "crypto";
import pino from "pino";

const logger = pino({ name: "portfolio-risk-engine" });

// ── Types ──

export interface PortfolioPosition {
  symbol: string;
  strategy_id: string;
  quantity: number;
  entry_price: number;
  current_price: number;
  side: "long" | "short";
  unrealized_pnl: number;
  weight_pct: number;
}

export interface CorrelationPair {
  symbol_a: string;
  symbol_b: string;
  correlation: number;
  period_days: number;
  classification:
    | "high_positive"
    | "moderate_positive"
    | "low"
    | "moderate_negative"
    | "high_negative";
}

export interface PortfolioRiskMetrics {
  total_exposure: number;
  net_exposure: number;
  long_exposure: number;
  short_exposure: number;
  gross_leverage: number;
  portfolio_var_95: number;
  portfolio_var_99: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  concentration_risk: ConcentrationRisk;
  correlation_risk: number;
  diversification_score: number;
}

export interface ConcentrationRisk {
  max_single_position_pct: number;
  top_3_concentration_pct: number;
  sector_concentration: Record<string, number>;
  level: "low" | "medium" | "high" | "critical";
}

export interface HedgeSuggestion {
  id: string;
  target_symbol: string;
  hedge_instrument: string;
  hedge_type:
    | "direct_short"
    | "put_option"
    | "inverse_etf"
    | "pair_trade"
    | "sector_hedge";
  confidence: number;
  rationale: string;
  suggested_size: number;
  created_at: string;
}

export interface RiskAlert {
  id: string;
  type:
    | "concentration"
    | "correlation"
    | "drawdown"
    | "leverage"
    | "var_breach";
  severity: "info" | "warning" | "critical";
  message: string;
  metric_value: number;
  threshold: number;
  created_at: string;
}

// ── Inverse ETF map ──

const INVERSE_ETF_MAP: Record<string, string> = {
  SPY: "SH",
  QQQ: "PSQ",
  IWM: "RWM",
  DIA: "DOG",
  AAPL: "PSQ",
  MSFT: "PSQ",
  GOOGL: "PSQ",
  AMZN: "PSQ",
  TSLA: "SH",
};

// ── Storage ──

const positions = new Map<string, PortfolioPosition>(); // key: symbol:strategy_id
const correlations: CorrelationPair[] = [];
const hedgeSuggestions = new Map<string, HedgeSuggestion>();
const riskAlerts: RiskAlert[] = [];

// ── Helpers ──

function posKey(symbol: string, strategy_id: string): string {
  return `${symbol}:${strategy_id}`;
}

function classifyCorrelation(
  c: number
): CorrelationPair["classification"] {
  const abs = Math.abs(c);
  if (abs > 0.7) return c > 0 ? "high_positive" : "high_negative";
  if (abs > 0.4) return c > 0 ? "moderate_positive" : "moderate_negative";
  return "low";
}

function computeWeights(): void {
  const totalValue = Array.from(positions.values()).reduce(
    (sum, p) => sum + Math.abs(p.quantity * p.current_price),
    0
  );
  if (totalValue === 0) return;
  for (const p of positions.values()) {
    p.weight_pct =
      (Math.abs(p.quantity * p.current_price) / totalValue) * 100;
  }
}

function computePnl(p: PortfolioPosition): number {
  if (p.side === "long") {
    return (p.current_price - p.entry_price) * p.quantity;
  }
  return (p.entry_price - p.current_price) * p.quantity;
}

// ── Functions ──

export function addPosition(
  pos: Omit<PortfolioPosition, "unrealized_pnl" | "weight_pct">
): void {
  const position: PortfolioPosition = {
    ...pos,
    unrealized_pnl: 0,
    weight_pct: 0,
  };
  position.unrealized_pnl = computePnl(position);
  positions.set(posKey(pos.symbol, pos.strategy_id), position);
  computeWeights();
  logger.info(
    { symbol: pos.symbol, strategy_id: pos.strategy_id, side: pos.side },
    "Position added"
  );
}

export function updatePosition(
  symbol: string,
  strategy_id: string,
  updates: Partial<PortfolioPosition>
): { success: boolean; error?: string } {
  const key = posKey(symbol, strategy_id);
  const pos = positions.get(key);
  if (!pos) {
    return { success: false, error: "Position not found" };
  }
  Object.assign(pos, updates);
  pos.unrealized_pnl = computePnl(pos);
  computeWeights();
  return { success: true };
}

export function removePosition(
  symbol: string,
  strategy_id: string
): { success: boolean; error?: string } {
  const key = posKey(symbol, strategy_id);
  if (!positions.has(key)) {
    return { success: false, error: "Position not found" };
  }
  positions.delete(key);
  computeWeights();
  return { success: true };
}

export function getPositions(): PortfolioPosition[] {
  return Array.from(positions.values());
}

export function computeRiskMetrics(): PortfolioRiskMetrics {
  const allPositions = Array.from(positions.values());

  if (allPositions.length === 0) {
    return {
      total_exposure: 0,
      net_exposure: 0,
      long_exposure: 0,
      short_exposure: 0,
      gross_leverage: 0,
      portfolio_var_95: 0,
      portfolio_var_99: 0,
      max_drawdown_pct: 0,
      sharpe_ratio: 0,
      concentration_risk: {
        max_single_position_pct: 0,
        top_3_concentration_pct: 0,
        sector_concentration: {},
        level: "low",
      },
      correlation_risk: 0,
      diversification_score: 100,
    };
  }

  let long_exposure = 0;
  let short_exposure = 0;

  for (const p of allPositions) {
    const notional = Math.abs(p.quantity * p.current_price);
    if (p.side === "long") {
      long_exposure += notional;
    } else {
      short_exposure += notional;
    }
  }

  const total_exposure = long_exposure + short_exposure;
  const net_exposure = long_exposure - short_exposure;
  const gross_leverage = total_exposure > 0 ? total_exposure / Math.max(total_exposure, 1) : 0;

  // VaR (simplified)
  const portfolio_var_95 = total_exposure * 0.02;
  const portfolio_var_99 = total_exposure * 0.03;

  // Max drawdown from PnL
  const totalPnl = allPositions.reduce((s, p) => s + p.unrealized_pnl, 0);
  const max_drawdown_pct =
    total_exposure > 0
      ? Math.abs(Math.min(0, totalPnl)) / total_exposure * 100
      : 0;

  // Sharpe (simplified — based on unrealized PnL ratio)
  const avgReturn = total_exposure > 0 ? totalPnl / total_exposure : 0;
  const sharpe_ratio = avgReturn >= 0 ? avgReturn * 15.87 : avgReturn * 15.87; // annualized proxy

  // Concentration
  const weights = allPositions.map((p) => p.weight_pct).sort((a, b) => b - a);
  const max_single_position_pct = weights[0] || 0;
  const top_3_concentration_pct = weights.slice(0, 3).reduce((s, w) => s + w, 0);

  let concentrationLevel: ConcentrationRisk["level"] = "low";
  if (max_single_position_pct > 30) concentrationLevel = "critical";
  else if (max_single_position_pct > 20) concentrationLevel = "high";
  else if (max_single_position_pct > 10) concentrationLevel = "medium";

  const concentration_risk: ConcentrationRisk = {
    max_single_position_pct,
    top_3_concentration_pct,
    sector_concentration: {},
    level: concentrationLevel,
  };

  // Correlation risk and diversification
  let avgCorrelation = 0;
  if (correlations.length > 0) {
    avgCorrelation =
      correlations.reduce((s, c) => s + Math.abs(c.correlation), 0) /
      correlations.length;
  }
  const correlation_risk = avgCorrelation;
  const diversification_score = Math.max(
    0,
    Math.min(100, Math.round(100 - avgCorrelation * 100))
  );

  return {
    total_exposure,
    net_exposure,
    long_exposure,
    short_exposure,
    gross_leverage,
    portfolio_var_95,
    portfolio_var_99,
    max_drawdown_pct,
    sharpe_ratio,
    concentration_risk,
    correlation_risk,
    diversification_score,
  };
}

export function addCorrelation(
  pair: Omit<CorrelationPair, "classification">
): CorrelationPair {
  const full: CorrelationPair = {
    ...pair,
    classification: classifyCorrelation(pair.correlation),
  };
  correlations.push(full);
  return full;
}

export function getCorrelations(): CorrelationPair[] {
  return [...correlations];
}

export function getCorrelationsForSymbol(symbol: string): CorrelationPair[] {
  return correlations.filter(
    (c) => c.symbol_a === symbol || c.symbol_b === symbol
  );
}

export function suggestHedge(symbol: string): HedgeSuggestion | undefined {
  const pos = Array.from(positions.values()).find(
    (p) => p.symbol === symbol
  );
  if (!pos) return undefined;

  const inverseEtf = INVERSE_ETF_MAP[symbol];
  const id = `hdg_${crypto.randomUUID()}`;

  const suggestion: HedgeSuggestion = {
    id,
    target_symbol: symbol,
    hedge_instrument: inverseEtf || `${symbol}_PUT`,
    hedge_type: inverseEtf ? "inverse_etf" : "put_option",
    confidence: inverseEtf ? 0.75 : 0.6,
    rationale: inverseEtf
      ? `Use ${inverseEtf} as inverse ETF hedge for ${symbol} exposure`
      : `Purchase put options on ${symbol} to protect downside`,
    suggested_size: Math.round(pos.quantity * 0.5),
    created_at: new Date().toISOString(),
  };

  hedgeSuggestions.set(id, suggestion);
  return suggestion;
}

export function getHedgeSuggestions(): HedgeSuggestion[] {
  return Array.from(hedgeSuggestions.values());
}

export function checkRiskAlerts(): RiskAlert[] {
  const metrics = computeRiskMetrics();
  const newAlerts: RiskAlert[] = [];
  const now = new Date().toISOString();

  // Concentration alerts
  if (metrics.concentration_risk.max_single_position_pct > 30) {
    newAlerts.push({
      id: `ra_${crypto.randomUUID()}`,
      type: "concentration",
      severity: "critical",
      message: `Single position concentration at ${metrics.concentration_risk.max_single_position_pct.toFixed(1)}% exceeds 30% threshold`,
      metric_value: metrics.concentration_risk.max_single_position_pct,
      threshold: 30,
      created_at: now,
    });
  } else if (metrics.concentration_risk.max_single_position_pct > 20) {
    newAlerts.push({
      id: `ra_${crypto.randomUUID()}`,
      type: "concentration",
      severity: "warning",
      message: `Single position concentration at ${metrics.concentration_risk.max_single_position_pct.toFixed(1)}% exceeds 20% threshold`,
      metric_value: metrics.concentration_risk.max_single_position_pct,
      threshold: 20,
      created_at: now,
    });
  }

  // Correlation alerts
  if (metrics.correlation_risk > 0.7) {
    newAlerts.push({
      id: `ra_${crypto.randomUUID()}`,
      type: "correlation",
      severity: "critical",
      message: `Portfolio correlation risk at ${(metrics.correlation_risk * 100).toFixed(0)}% exceeds 70% threshold`,
      metric_value: metrics.correlation_risk,
      threshold: 0.7,
      created_at: now,
    });
  } else if (metrics.correlation_risk > 0.5) {
    newAlerts.push({
      id: `ra_${crypto.randomUUID()}`,
      type: "correlation",
      severity: "warning",
      message: `Portfolio correlation risk at ${(metrics.correlation_risk * 100).toFixed(0)}% exceeds 50% threshold`,
      metric_value: metrics.correlation_risk,
      threshold: 0.5,
      created_at: now,
    });
  }

  // Drawdown alerts
  if (metrics.max_drawdown_pct > 10) {
    newAlerts.push({
      id: `ra_${crypto.randomUUID()}`,
      type: "drawdown",
      severity: "critical",
      message: `Max drawdown at ${metrics.max_drawdown_pct.toFixed(1)}% exceeds 10% threshold`,
      metric_value: metrics.max_drawdown_pct,
      threshold: 10,
      created_at: now,
    });
  } else if (metrics.max_drawdown_pct > 5) {
    newAlerts.push({
      id: `ra_${crypto.randomUUID()}`,
      type: "drawdown",
      severity: "warning",
      message: `Max drawdown at ${metrics.max_drawdown_pct.toFixed(1)}% exceeds 5% threshold`,
      metric_value: metrics.max_drawdown_pct,
      threshold: 5,
      created_at: now,
    });
  }

  // Leverage alerts
  if (metrics.gross_leverage > 3) {
    newAlerts.push({
      id: `ra_${crypto.randomUUID()}`,
      type: "leverage",
      severity: "critical",
      message: `Gross leverage at ${metrics.gross_leverage.toFixed(2)}x exceeds 3x threshold`,
      metric_value: metrics.gross_leverage,
      threshold: 3,
      created_at: now,
    });
  }

  riskAlerts.push(...newAlerts);
  return newAlerts;
}

export function getRiskAlerts(): RiskAlert[] {
  return [...riskAlerts];
}

export function _clearPortfolioRisk(): void {
  positions.clear();
  correlations.length = 0;
  hedgeSuggestions.clear();
  riskAlerts.length = 0;
}
