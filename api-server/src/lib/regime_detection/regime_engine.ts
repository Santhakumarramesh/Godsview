import { randomUUID } from 'crypto';

export type RegimeType =
  | 'trending_up'
  | 'trending_down'
  | 'ranging'
  | 'volatile'
  | 'low_volatility'
  | 'crisis'
  | 'recovery'
  | 'unknown';

export type RegimeConfidence = 'high' | 'medium' | 'low';

export interface RegimeSnapshot {
  id: string;
  symbol: string;
  regime: RegimeType;
  confidence: RegimeConfidence;
  confidence_score: number;
  volatility: number;
  trend_strength: number;
  volume_ratio: number;
  detected_at: string;
  indicators: Record<string, number>;
}

export interface RegimeTransition {
  id: string;
  symbol: string;
  from_regime: RegimeType;
  to_regime: RegimeType;
  transition_score: number;
  trigger_indicators: string[];
  detected_at: string;
  confirmed: boolean;
  confirmed_at?: string;
}

export interface RegimeHistory {
  symbol: string;
  snapshots: RegimeSnapshot[];
  current_regime: RegimeType;
  regime_duration_hours: number;
  transitions_24h: number;
  stability_score: number;
}

export interface StrategyAdaptation {
  id: string;
  strategy_id: string;
  symbol: string;
  current_regime: RegimeType;
  recommended_action: 'continue' | 'pause' | 'reduce_size' | 'increase_size' | 'switch_params' | 'exit';
  parameter_adjustments: Record<string, { current: number; recommended: number; reason: string }>;
  risk_adjustment: number;
  created_at: string;
}

export interface RegimeAlert {
  id: string;
  symbol: string;
  alert_type: 'regime_change' | 'volatility_spike' | 'trend_reversal' | 'stability_warning' | 'crisis_onset';
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  regime_before?: RegimeType;
  regime_after?: RegimeType;
  acknowledged: boolean;
  created_at: string;
}

export interface RegimeModel {
  id: string;
  name: string;
  version: string;
  symbols: string[];
  accuracy_score: number;
  last_trained_at: string;
  features: string[];
  status: 'active' | 'training' | 'deprecated';
}

export interface MarketData {
  price: number;
  sma_20: number;
  sma_50: number;
  atr: number;
  avg_atr: number;
  volume: number;
  avg_volume: number;
}

export interface RegimeStats {
  total_snapshots: number;
  regimes_detected: Record<RegimeType, number>;
  total_transitions: number;
  total_alerts: number;
  unacknowledged_alerts: number;
}

class RegimeEngine {
  private snapshots: Map<string, RegimeSnapshot> = new Map();
  private transitions: Map<string, RegimeTransition> = new Map();
  private adaptations: Map<string, StrategyAdaptation> = new Map();
  private alerts: Map<string, RegimeAlert> = new Map();
  private models: Map<string, RegimeModel> = new Map();
  private history: Map<string, string[]> = new Map();

  detectRegime(symbol: string, market_data: MarketData): RegimeSnapshot {
    const { price, sma_20, sma_50, atr, avg_atr, volume, avg_volume } = market_data;

    const volatility_ratio = avg_atr > 0 ? atr / avg_atr : 1;
    const volume_ratio = avg_volume > 0 ? volume / avg_volume : 1;
    const price_sma20_pct = sma_20 > 0 ? Math.abs(price - sma_20) / sma_20 : 0;

    let regime: RegimeType;
    let confidence_score = 0;
    const trigger_indicators: string[] = [];

    // Crisis detection
    if (volatility_ratio > 2.0) {
      regime = 'crisis';
      confidence_score = Math.min(volatility_ratio / 3.0, 1.0);
      trigger_indicators.push('extreme_volatility');
    }
    // Volatile detection
    else if (volatility_ratio > 1.5) {
      regime = 'volatile';
      confidence_score = Math.min((volatility_ratio - 1.0) / 0.7, 1.0);
      trigger_indicators.push('high_volatility');
    }
    // Low volatility detection
    else if (volatility_ratio < 0.5) {
      regime = 'low_volatility';
      confidence_score = 1.0 - volatility_ratio;
      trigger_indicators.push('low_volatility');
    }
    // Trending up detection
    else if (price > sma_20 && sma_20 > sma_50) {
      regime = 'trending_up';
      const uptrend_strength = (price - sma_50) / sma_50;
      confidence_score = Math.min(uptrend_strength * 2, 1.0);
      trigger_indicators.push('price_above_smas', 'sma20_above_sma50');
    }
    // Trending down detection
    else if (price < sma_20 && sma_20 < sma_50) {
      regime = 'trending_down';
      const downtrend_strength = (sma_50 - price) / sma_50;
      confidence_score = Math.min(downtrend_strength * 2, 1.0);
      trigger_indicators.push('price_below_smas', 'sma20_below_sma50');
    }
    // Ranging detection
    else if (price_sma20_pct < 0.02) {
      regime = 'ranging';
      confidence_score = 1.0 - price_sma20_pct / 0.02;
      trigger_indicators.push('price_near_sma20');
    }
    // Unknown
    else {
      regime = 'unknown';
      confidence_score = 0.3;
    }

    const confidence = confidence_score > 0.8 ? 'high' : confidence_score > 0.5 ? 'medium' : 'low';

    const snapshot: RegimeSnapshot = {
      id: `reg_${randomUUID()}`,
      symbol,
      regime,
      confidence,
      confidence_score: Math.round(confidence_score * 100) / 100,
      volatility: Math.round(volatility_ratio * 100) / 100,
      trend_strength: Math.round(((price - sma_20) / sma_20) * 100) / 100,
      volume_ratio: Math.round(volume_ratio * 100) / 100,
      detected_at: new Date().toISOString(),
      indicators: {
        volatility_ratio,
        volume_ratio,
        price_sma20_diff_pct: price_sma20_pct,
        sma20_sma50_diff_pct: sma_20 > 0 ? Math.abs(sma_20 - sma_50) / sma_20 : 0,
      },
    };

    // Auto-detect transition (check BEFORE adding to history)
    const previous = this.getLatestForSymbol(symbol);

    this.snapshots.set(snapshot.id, snapshot);

    // Track in history
    if (!this.history.has(symbol)) {
      this.history.set(symbol, []);
    }
    this.history.get(symbol)!.push(snapshot.id);

    if (previous && previous.regime !== snapshot.regime) {
      this._createTransition(symbol, previous.regime, snapshot.regime, trigger_indicators, confidence_score);
    }

    return snapshot;
  }

  private _createTransition(
    symbol: string,
    from_regime: RegimeType,
    to_regime: RegimeType,
    trigger_indicators: string[],
    transition_score: number
  ): RegimeTransition {
    const transition: RegimeTransition = {
      id: `rtrans_${randomUUID()}`,
      symbol,
      from_regime,
      to_regime,
      transition_score: Math.round(transition_score * 100) / 100,
      trigger_indicators,
      detected_at: new Date().toISOString(),
      confirmed: false,
    };

    this.transitions.set(transition.id, transition);
    return transition;
  }

  getSnapshot(id: string): RegimeSnapshot | undefined {
    return this.snapshots.get(id);
  }

  getLatestForSymbol(symbol: string): RegimeSnapshot | undefined {
    const history = this.history.get(symbol);
    if (!history || history.length === 0) return undefined;
    const lastId = history[history.length - 1];
    return this.snapshots.get(lastId);
  }

  getHistoryForSymbol(symbol: string, limit?: number): RegimeHistory {
    const history = this.history.get(symbol) || [];
    const snapshots = history.map(id => this.snapshots.get(id)!).filter(Boolean);

    const displaySnapshots = limit ? snapshots.slice(-limit) : snapshots;
    const current_regime = snapshots.length > 0 ? snapshots[snapshots.length - 1].regime : 'unknown';

    // Calculate regime duration
    let regime_duration_hours = 0;
    if (snapshots.length > 0) {
      const now = new Date();
      const lastSnapshotTime = new Date(snapshots[snapshots.length - 1].detected_at);
      regime_duration_hours = Math.round((now.getTime() - lastSnapshotTime.getTime()) / (1000 * 60 * 60));
    }

    // Count transitions in last 24 hours
    const transitions_24h = Array.from(this.transitions.values())
      .filter(t => {
        if (t.symbol !== symbol) return false;
        const tTime = new Date(t.detected_at);
        const now = new Date();
        return (now.getTime() - tTime.getTime()) < 24 * 60 * 60 * 1000;
      }).length;

    // Calculate stability score
    const stability_score = snapshots.length === 0
      ? 0.5
      : 1.0 - Math.min(transitions_24h / 10, 1.0);

    return {
      symbol,
      snapshots: displaySnapshots,
      current_regime,
      regime_duration_hours,
      transitions_24h,
      stability_score: Math.round(stability_score * 100) / 100,
    };
  }

  getTransition(id: string): RegimeTransition | undefined {
    return this.transitions.get(id);
  }

  getTransitionsForSymbol(symbol: string, limit?: number): RegimeTransition[] {
    const all = Array.from(this.transitions.values()).filter(t => t.symbol === symbol);
    return limit ? all.slice(-limit) : all;
  }

  getAllTransitions(limit?: number): RegimeTransition[] {
    const all = Array.from(this.transitions.values());
    return limit ? all.slice(-limit) : all;
  }

  confirmTransition(id: string): RegimeTransition | undefined {
    const transition = this.transitions.get(id);
    if (transition) {
      transition.confirmed = true;
      transition.confirmed_at = new Date().toISOString();
    }
    return transition;
  }

  suggestAdaptation(strategy_id: string, symbol: string): StrategyAdaptation | undefined {
    const latest = this.getLatestForSymbol(symbol);
    if (!latest) return undefined;

    let recommended_action: StrategyAdaptation['recommended_action'];
    let risk_adjustment: number;
    const parameter_adjustments: Record<string, { current: number; recommended: number; reason: string }> = {};

    switch (latest.regime) {
      case 'crisis':
        recommended_action = 'exit';
        risk_adjustment = -0.5;
        parameter_adjustments['position_size'] = {
          current: 1.0,
          recommended: 0,
          reason: 'Crisis regime requires full exit',
        };
        break;

      case 'volatile':
        recommended_action = 'reduce_size';
        risk_adjustment = -0.3;
        parameter_adjustments['position_size'] = {
          current: 1.0,
          recommended: 0.5,
          reason: 'Reduce position during volatile conditions',
        };
        parameter_adjustments['stop_loss_pct'] = {
          current: 2.0,
          recommended: 1.0,
          reason: 'Tighter stops in volatile markets',
        };
        break;

      case 'trending_up':
        recommended_action = 'continue';
        risk_adjustment = 0.1;
        parameter_adjustments['position_size'] = {
          current: 1.0,
          recommended: 1.2,
          reason: 'Can increase size in strong uptrend',
        };
        break;

      case 'trending_down':
        recommended_action = 'pause';
        risk_adjustment = -0.2;
        parameter_adjustments['position_size'] = {
          current: 1.0,
          recommended: 0.3,
          reason: 'Reduce exposure in downtrend',
        };
        break;

      case 'ranging':
        recommended_action = 'switch_params';
        risk_adjustment = 0;
        parameter_adjustments['entry_threshold'] = {
          current: 1.0,
          recommended: 0.5,
          reason: 'Use tighter ranges in ranging market',
        };
        break;

      case 'low_volatility':
        recommended_action = 'increase_size';
        risk_adjustment = 0.2;
        parameter_adjustments['position_size'] = {
          current: 1.0,
          recommended: 1.5,
          reason: 'Can safely increase size in low volatility',
        };
        break;

      case 'recovery':
      case 'unknown':
      default:
        recommended_action = 'continue';
        risk_adjustment = 0;
        break;
    }

    const adaptation: StrategyAdaptation = {
      id: `adapt_${randomUUID()}`,
      strategy_id,
      symbol,
      current_regime: latest.regime,
      recommended_action,
      parameter_adjustments,
      risk_adjustment,
      created_at: new Date().toISOString(),
    };

    this.adaptations.set(adaptation.id, adaptation);
    return adaptation;
  }

  getAdaptation(id: string): StrategyAdaptation | undefined {
    return this.adaptations.get(id);
  }

  getAdaptationsForStrategy(strategy_id: string): StrategyAdaptation[] {
    return Array.from(this.adaptations.values()).filter(a => a.strategy_id === strategy_id);
  }

  getAllAdaptations(limit?: number): StrategyAdaptation[] {
    const all = Array.from(this.adaptations.values());
    return limit ? all.slice(-limit) : all;
  }

  createAlert(
    symbol: string,
    alert_type: RegimeAlert['alert_type'],
    severity: RegimeAlert['severity'],
    message: string,
    regime_before?: RegimeType,
    regime_after?: RegimeType
  ): RegimeAlert {
    const alert: RegimeAlert = {
      id: `ralert_${randomUUID()}`,
      symbol,
      alert_type,
      severity,
      message,
      regime_before,
      regime_after,
      acknowledged: false,
      created_at: new Date().toISOString(),
    };

    this.alerts.set(alert.id, alert);
    return alert;
  }

  acknowledgeAlert(id: string): RegimeAlert | undefined {
    const alert = this.alerts.get(id);
    if (alert) {
      alert.acknowledged = true;
    }
    return alert;
  }

  getAlert(id: string): RegimeAlert | undefined {
    return this.alerts.get(id);
  }

  getAlertsForSymbol(symbol: string): RegimeAlert[] {
    return Array.from(this.alerts.values()).filter(a => a.symbol === symbol);
  }

  getUnacknowledgedAlerts(): RegimeAlert[] {
    return Array.from(this.alerts.values()).filter(a => !a.acknowledged);
  }

  getAllAlerts(limit?: number): RegimeAlert[] {
    const all = Array.from(this.alerts.values());
    return limit ? all.slice(-limit) : all;
  }

  registerModel(name: string, version: string, symbols: string[], features: string[]): RegimeModel {
    const model: RegimeModel = {
      id: `rmod_${randomUUID()}`,
      name,
      version,
      symbols,
      accuracy_score: 0.5,
      last_trained_at: new Date().toISOString(),
      features,
      status: 'active',
    };

    this.models.set(model.id, model);
    return model;
  }

  updateModelAccuracy(id: string, accuracy_score: number): RegimeModel | undefined {
    const model = this.models.get(id);
    if (model) {
      model.accuracy_score = accuracy_score;
      model.last_trained_at = new Date().toISOString();
    }
    return model;
  }

  getModel(id: string): RegimeModel | undefined {
    return this.models.get(id);
  }

  getAllModels(): RegimeModel[] {
    return Array.from(this.models.values());
  }

  getRegimeStats(): RegimeStats {
    const regimes_detected: Record<RegimeType, number> = {
      trending_up: 0,
      trending_down: 0,
      ranging: 0,
      volatile: 0,
      low_volatility: 0,
      crisis: 0,
      recovery: 0,
      unknown: 0,
    };

    for (const snapshot of this.snapshots.values()) {
      regimes_detected[snapshot.regime]++;
    }

    const unacknowledged_alerts = Array.from(this.alerts.values()).filter(a => !a.acknowledged).length;

    return {
      total_snapshots: this.snapshots.size,
      regimes_detected,
      total_transitions: this.transitions.size,
      total_alerts: this.alerts.size,
      unacknowledged_alerts,
    };
  }

  _clearRegime(): void {
    this.snapshots.clear();
    this.transitions.clear();
    this.adaptations.clear();
    this.alerts.clear();
    this.models.clear();
    this.history.clear();
  }
}

// Singleton instance
const regimeEngine = new RegimeEngine();

// Delegate functions
export function detectRegime(symbol: string, market_data: MarketData): RegimeSnapshot {
  return regimeEngine.detectRegime(symbol, market_data);
}

export function getSnapshot(id: string): RegimeSnapshot | undefined {
  return regimeEngine.getSnapshot(id);
}

export function getLatestForSymbol(symbol: string): RegimeSnapshot | undefined {
  return regimeEngine.getLatestForSymbol(symbol);
}

export function getHistoryForSymbol(symbol: string, limit?: number): RegimeHistory {
  return regimeEngine.getHistoryForSymbol(symbol, limit);
}

export function getTransition(id: string): RegimeTransition | undefined {
  return regimeEngine.getTransition(id);
}

export function getTransitionsForSymbol(symbol: string, limit?: number): RegimeTransition[] {
  return regimeEngine.getTransitionsForSymbol(symbol, limit);
}

export function getAllTransitions(limit?: number): RegimeTransition[] {
  return regimeEngine.getAllTransitions(limit);
}

export function confirmTransition(id: string): RegimeTransition | undefined {
  return regimeEngine.confirmTransition(id);
}

export function suggestAdaptation(strategy_id: string, symbol: string): StrategyAdaptation | undefined {
  return regimeEngine.suggestAdaptation(strategy_id, symbol);
}

export function getAdaptation(id: string): StrategyAdaptation | undefined {
  return regimeEngine.getAdaptation(id);
}

export function getAdaptationsForStrategy(strategy_id: string): StrategyAdaptation[] {
  return regimeEngine.getAdaptationsForStrategy(strategy_id);
}

export function getAllAdaptations(limit?: number): StrategyAdaptation[] {
  return regimeEngine.getAllAdaptations(limit);
}

export function createAlert(
  symbol: string,
  alert_type: RegimeAlert['alert_type'],
  severity: RegimeAlert['severity'],
  message: string,
  regime_before?: RegimeType,
  regime_after?: RegimeType
): RegimeAlert {
  return regimeEngine.createAlert(symbol, alert_type, severity, message, regime_before, regime_after);
}

export function acknowledgeAlert(id: string): RegimeAlert | undefined {
  return regimeEngine.acknowledgeAlert(id);
}

export function getAlert(id: string): RegimeAlert | undefined {
  return regimeEngine.getAlert(id);
}

export function getAlertsForSymbol(symbol: string): RegimeAlert[] {
  return regimeEngine.getAlertsForSymbol(symbol);
}

export function getUnacknowledgedAlerts(): RegimeAlert[] {
  return regimeEngine.getUnacknowledgedAlerts();
}

export function getAllAlerts(limit?: number): RegimeAlert[] {
  return regimeEngine.getAllAlerts(limit);
}

export function registerModel(name: string, version: string, symbols: string[], features: string[]): RegimeModel {
  return regimeEngine.registerModel(name, version, symbols, features);
}

export function updateModelAccuracy(id: string, accuracy_score: number): RegimeModel | undefined {
  return regimeEngine.updateModelAccuracy(id, accuracy_score);
}

export function getModel(id: string): RegimeModel | undefined {
  return regimeEngine.getModel(id);
}

export function getAllModels(): RegimeModel[] {
  return regimeEngine.getAllModels();
}

export function getRegimeStats(): RegimeStats {
  return regimeEngine.getRegimeStats();
}

export function _clearRegime(): void {
  regimeEngine._clearRegime();
}
