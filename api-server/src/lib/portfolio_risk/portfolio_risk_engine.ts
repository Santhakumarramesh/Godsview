import { randomUUID } from "crypto";

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

export interface ConcentrationRisk {
  max_single_position_pct: number;
  top_3_concentration_pct: number;
  sector_concentration: Record<string, number>;
  level: "low" | "medium" | "high" | "critical";
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

export interface HedgeSuggestion {
  id: string;
  target_symbol: string;
  hedge_instrument: string;
  hedge_type: "direct_short" | "put_option" | "inverse_etf" | "pair_trade" | "sector_hedge";
  confidence: number;
  rationale: string;
  suggested_size: number;
  created_at: string;
}

export interface RiskAlert {
  id: string;
  type: "concentration" | "correlation" | "drawdown" | "leverage" | "var_breach";
  severity: "info" | "warning" | "critical";
  message: string;
  metric_value: number;
  threshold: number;
  created_at: string;
}

export class PortfolioRiskEngine {
  private positions: Map<string, PortfolioPosition> = new Map();
  private correlations: Map<string, CorrelationPair> = new Map();
  private hedgeSuggestions: Map<string, HedgeSuggestion> = new Map();
  private riskAlerts: Map<string, RiskAlert> = new Map();

  addPosition(
    pos: Omit<PortfolioPosition, "unrealized_pnl" | "weight_pct">
  ): void {
    const unrealized_pnl =
      pos.side === "long"
        ? pos.quantity * (pos.current_price - pos.entry_price)
        : pos.quantity * (pos.entry_price - pos.current_price);

    const key = `${pos.symbol}:${pos.strategy_id}`;
    const positions = Array.from(this.positions.values());
    const totalExposure = positions.reduce(
      (sum, p) => sum + Math.abs(p.quantity * p.current_price),
      0
    );
    const currentPositionExposure = Math.abs(pos.quantity * pos.current_price);
    const weight_pct =
      totalExposure + currentPositionExposure > 0
        ? (currentPositionExposure / (totalExposure + currentPositionExposure)) * 100
        : 0;

    const position: PortfolioPosition = {
      ...pos,
      unrealized_pnl,
      weight_pct,
    };

    this.positions.set(key, position);
  }

  updatePosition(
    symbol: string,
    strategy_id: string,
    updates: Partial<PortfolioPosition>
  ): { success: boolean; error?: string } {
    const key = `${symbol}:${strategy_id}`;
    const existing = this.positions.get(key);

    if (!existing) {
      return { success: false, error: "Position not found" };
    }

    const updated: PortfolioPosition = { ...existing, ...updates };

    if (
      updates.quantity !== undefined ||
      updates.current_price !== undefined ||
      updates.entry_price !== undefined
    ) {
      const qty = updates.quantity ?? existing.quantity;
      const curr = updates.current_price ?? existing.current_price;
      const entry = updates.entry_price ?? existing.entry_price;
      const side = updates.side ?? existing.side;

      updated.unrealized_pnl =
        side === "long"
          ? qty * (curr - entry)
          : qty * (entry - curr);
    }

    if (updates.quantity !== undefined || updates.current_price !== undefined) {
      const positions = Array.from(this.positions.values());
      const totalExposure = positions.reduce(
        (sum, p) => sum + Math.abs(p.quantity * p.current_price),
        0
      );
      const currentPositionExposure = Math.abs(
        updated.quantity * updated.current_price
      );
      updated.weight_pct =
        totalExposure + currentPositionExposure > 0
          ? (currentPositionExposure / (totalExposure + currentPositionExposure)) * 100
          : 0;
    }

    this.positions.set(key, updated);
    return { success: true };
  }

  removePosition(
    symbol: string,
    strategy_id: string
  ): { success: boolean; error?: string } {
    const key = `${symbol}:${strategy_id}`;

    if (!this.positions.has(key)) {
      return { success: false, error: "Position not found" };
    }

    this.positions.delete(key);
    return { success: true };
  }

  getPositions(): PortfolioPosition[] {
    return Array.from(this.positions.values());
  }

  computeRiskMetrics(): PortfolioRiskMetrics {
    const positions = this.getPositions();

    let total_exposure = 0;
    let long_exposure = 0;
    let short_exposure = 0;

    positions.forEach((pos) => {
      const exposure = Math.abs(pos.quantity * pos.current_price);
      total_exposure += exposure;

      if (pos.side === "long") {
        long_exposure += exposure;
      } else {
        short_exposure += exposure;
      }
    });

    const net_exposure = long_exposure - short_exposure;
    const gross_leverage =
      total_exposure > 0 ? (long_exposure + short_exposure) / total_exposure : 0;

    const portfolio_var_95 = total_exposure * 0.02;
    const portfolio_var_99 = total_exposure * 0.03;

    const max_drawdown_pct = this.calculateMaxDrawdown(positions);
    const sharpe_ratio = this.calculateSharpeRatio(positions);

    const concentration_risk = this.calculateConcentrationRisk(positions);
    const correlation_risk = this.calculateCorrelationRisk();
    const diversification_score = this.calculateDiversificationScore();

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

  addCorrelation(
    pair: Omit<CorrelationPair, "classification">
  ): CorrelationPair {
    const classification = this.classifyCorrelation(pair.correlation);

    const correlationPair: CorrelationPair = {
      ...pair,
      classification,
    };

    const key = `${pair.symbol_a}:${pair.symbol_b}`;
    this.correlations.set(key, correlationPair);

    return correlationPair;
  }

  private classifyCorrelation(
    correlation: number
  ): CorrelationPair["classification"] {
    const absCorr = Math.abs(correlation);

    if (absCorr > 0.7) {
      return correlation > 0 ? "high_positive" : "high_negative";
    } else if (absCorr > 0.4) {
      return correlation > 0 ? "moderate_positive" : "moderate_negative";
    } else {
      return "low";
    }
  }

  getCorrelations(): CorrelationPair[] {
    return Array.from(this.correlations.values());
  }

  getCorrelationsForSymbol(symbol: string): CorrelationPair[] {
    return this.getCorrelations().filter(
      (pair) => pair.symbol_a === symbol || pair.symbol_b === symbol
    );
  }

  suggestHedge(symbol: string): HedgeSuggestion | undefined {
    const positionExists = Array.from(this.positions.values()).some(
      (p) => p.symbol === symbol
    );

    if (!positionExists) {
      return undefined;
    }

    const correlations = this.getCorrelationsForSymbol(symbol);
    const negativeCorr = correlations.filter((c) =>
      c.classification.includes("negative")
    );

    if (negativeCorr.length === 0) {
      return undefined;
    }

    const targetCorr = negativeCorr[0];
    const hedgeSymbol =
      targetCorr.symbol_a === symbol
        ? targetCorr.symbol_b
        : targetCorr.symbol_a;

    const suggestion: HedgeSuggestion = {
      id: `hdg_${randomUUID()}`,
      target_symbol: symbol,
      hedge_instrument: hedgeSymbol,
      hedge_type: "direct_short",
      confidence: Math.min(0.95, 0.5 + Math.abs(targetCorr.correlation) * 0.4),
      rationale: `Inverse correlation (${targetCorr.correlation.toFixed(2)}) suggests hedging ${symbol} with short ${hedgeSymbol}`,
      suggested_size: 0.5,
      created_at: new Date().toISOString(),
    };

    const key = `${symbol}`;
    this.hedgeSuggestions.set(key, suggestion);

    return suggestion;
  }

  getHedgeSuggestions(): HedgeSuggestion[] {
    return Array.from(this.hedgeSuggestions.values());
  }

  checkRiskAlerts(): RiskAlert[] {
    this.riskAlerts.clear();

    const metrics = this.computeRiskMetrics();

    if (metrics.concentration_risk.level === "critical") {
      const alert: RiskAlert = {
        id: `ra_${randomUUID()}`,
        type: "concentration",
        severity: "critical",
        message: `Critical concentration risk: largest position is ${metrics.concentration_risk.max_single_position_pct.toFixed(2)}%`,
        metric_value: metrics.concentration_risk.max_single_position_pct,
        threshold: 30,
        created_at: new Date().toISOString(),
      };
      this.riskAlerts.set(alert.id, alert);
    } else if (metrics.concentration_risk.level === "high") {
      const alert: RiskAlert = {
        id: `ra_${randomUUID()}`,
        type: "concentration",
        severity: "warning",
        message: `High concentration risk: largest position is ${metrics.concentration_risk.max_single_position_pct.toFixed(2)}%`,
        metric_value: metrics.concentration_risk.max_single_position_pct,
        threshold: 20,
        created_at: new Date().toISOString(),
      };
      this.riskAlerts.set(alert.id, alert);
    }

    if (metrics.correlation_risk > 0.7) {
      const alert: RiskAlert = {
        id: `ra_${randomUUID()}`,
        type: "correlation",
        severity: "warning",
        message: `High portfolio correlation risk: ${metrics.correlation_risk.toFixed(2)}`,
        metric_value: metrics.correlation_risk,
        threshold: 0.7,
        created_at: new Date().toISOString(),
      };
      this.riskAlerts.set(alert.id, alert);
    }

    if (metrics.max_drawdown_pct > 15) {
      const alert: RiskAlert = {
        id: `ra_${randomUUID()}`,
        type: "drawdown",
        severity: "warning",
        message: `Significant drawdown: ${metrics.max_drawdown_pct.toFixed(2)}%`,
        metric_value: metrics.max_drawdown_pct,
        threshold: 15,
        created_at: new Date().toISOString(),
      };
      this.riskAlerts.set(alert.id, alert);
    }

    if (metrics.gross_leverage > 2) {
      const alert: RiskAlert = {
        id: `ra_${randomUUID()}`,
        type: "leverage",
        severity: "critical",
        message: `Excessive leverage: ${metrics.gross_leverage.toFixed(2)}x`,
        metric_value: metrics.gross_leverage,
        threshold: 2,
        created_at: new Date().toISOString(),
      };
      this.riskAlerts.set(alert.id, alert);
    }

    if (metrics.portfolio_var_99 > metrics.total_exposure * 0.05) {
      const alert: RiskAlert = {
        id: `ra_${randomUUID()}`,
        type: "var_breach",
        severity: "warning",
        message: `VaR 99% exceeds 5% of total exposure`,
        metric_value: metrics.portfolio_var_99,
        threshold: metrics.total_exposure * 0.05,
        created_at: new Date().toISOString(),
      };
      this.riskAlerts.set(alert.id, alert);
    }

    return Array.from(this.riskAlerts.values());
  }

  getRiskAlerts(): RiskAlert[] {
    return Array.from(this.riskAlerts.values());
  }

  private calculateConcentrationRisk(positions: PortfolioPosition[]): ConcentrationRisk {
    if (positions.length === 0) {
      return {
        max_single_position_pct: 0,
        top_3_concentration_pct: 0,
        sector_concentration: {},
        level: "low",
      };
    }

    const exposures = positions.map((p) => ({
      symbol: p.symbol,
      exposure: Math.abs(p.quantity * p.current_price),
    }));

    const totalExposure = exposures.reduce((sum, e) => sum + e.exposure, 0);

    const sortedByExposure = [...exposures].sort(
      (a, b) => b.exposure - a.exposure
    );

    const max_single_position_pct =
      totalExposure > 0
        ? (sortedByExposure[0].exposure / totalExposure) * 100
        : 0;

    const top_3_concentration_pct =
      totalExposure > 0
        ? (sortedByExposure
            .slice(0, 3)
            .reduce((sum, e) => sum + e.exposure, 0) / totalExposure) * 100
        : 0;

    const sector_concentration: Record<string, number> = {};

    let level: "low" | "medium" | "high" | "critical";
    if (max_single_position_pct > 30) {
      level = "critical";
    } else if (max_single_position_pct > 20) {
      level = "high";
    } else if (max_single_position_pct > 10) {
      level = "medium";
    } else {
      level = "low";
    }

    return {
      max_single_position_pct,
      top_3_concentration_pct,
      sector_concentration,
      level,
    };
  }

  private calculateCorrelationRisk(): number {
    const correlations = this.getCorrelations();

    if (correlations.length === 0) {
      return 0;
    }

    const positiveCorrs = correlations
      .filter((c) => c.correlation > 0)
      .map((c) => c.correlation);

    if (positiveCorrs.length === 0) {
      return 0;
    }

    const avgCorr =
      positiveCorrs.reduce((sum, c) => sum + c, 0) / positiveCorrs.length;

    return Math.max(0, Math.min(1, avgCorr));
  }

  private calculateDiversificationScore(): number {
    const correlationRisk = this.calculateCorrelationRisk();
    const score = 100 - correlationRisk * 100;
    return Math.max(0, Math.min(100, score));
  }

  private calculateMaxDrawdown(positions: PortfolioPosition[]): number {
    if (positions.length === 0) {
      return 0;
    }

    const totalUnrealizedPnL = positions.reduce(
      (sum, p) => sum + p.unrealized_pnl,
      0
    );
    const totalExposure = positions.reduce(
      (sum, p) => sum + Math.abs(p.quantity * p.entry_price),
      0
    );

    if (totalExposure === 0) {
      return 0;
    }

    const drawdownRatio = Math.abs(totalUnrealizedPnL) / totalExposure;
    return Math.min(100, drawdownRatio * 100);
  }

  private calculateSharpeRatio(positions: PortfolioPosition[]): number {
    if (positions.length === 0) {
      return 0;
    }

    const totalPnL = positions.reduce((sum, p) => sum + p.unrealized_pnl, 0);
    const totalExposure = positions.reduce(
      (sum, p) => sum + Math.abs(p.quantity * p.current_price),
      0
    );

    if (totalExposure === 0) {
      return 0;
    }

    const returnRatio = totalPnL / totalExposure;
    const volatility = Math.sqrt(positions.length) * 0.05;
    const riskFreeRate = 0.02;

    return (returnRatio - riskFreeRate) / (volatility || 1);
  }

  _clearPortfolioRisk(): void {
    this.positions.clear();
    this.correlations.clear();
    this.hedgeSuggestions.clear();
    this.riskAlerts.clear();
  }
}
