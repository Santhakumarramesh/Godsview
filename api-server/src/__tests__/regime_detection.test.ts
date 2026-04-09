import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  detectRegime,
  getSnapshot,
  getLatestForSymbol,
  getHistoryForSymbol,
  getTransition,
  getTransitionsForSymbol,
  getAllTransitions,
  confirmTransition,
  suggestAdaptation,
  getAdaptation,
  getAdaptationsForStrategy,
  getAllAdaptations,
  createAlert,
  acknowledgeAlert,
  getAlert,
  getAlertsForSymbol,
  getUnacknowledgedAlerts,
  getAllAlerts,
  registerModel,
  updateModelAccuracy,
  getModel,
  getAllModels,
  getRegimeStats,
  _clearRegime,
  type MarketData,
} from '../lib/regime_detection';

// Mock pino logger
vi.mock('pino', () => ({
  default: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('pino-pretty', () => ({
  default: vi.fn(),
}));

describe('Regime Detection Engine', () => {
  beforeEach(() => {
    _clearRegime();
  });

  describe('Regime Detection', () => {
    it('should detect crisis regime when volatility is extreme', () => {
      const marketData: MarketData = {
        price: 100,
        sma_20: 100,
        sma_50: 100,
        atr: 10,
        avg_atr: 4,
        volume: 1000000,
        avg_volume: 1000000,
      };

      const snapshot = detectRegime('AAPL', marketData);

      expect(snapshot.regime).toBe('crisis');
      expect(snapshot.confidence).toBe('high');
      expect(snapshot.symbol).toBe('AAPL');
      expect(snapshot.id).toMatch(/^reg_/);
    });

    it('should detect volatile regime when volatility is elevated', () => {
      const marketData: MarketData = {
        price: 100,
        sma_20: 100,
        sma_50: 100,
        atr: 7,
        avg_atr: 4,
        volume: 1000000,
        avg_volume: 1000000,
      };

      const snapshot = detectRegime('GOOGL', marketData);

      expect(snapshot.regime).toBe('volatile');
      expect(snapshot.confidence).toBe('high');
    });

    it('should detect low_volatility regime', () => {
      const marketData: MarketData = {
        price: 100,
        sma_20: 100,
        sma_50: 100,
        atr: 1,
        avg_atr: 3,
        volume: 1000000,
        avg_volume: 1000000,
      };

      const snapshot = detectRegime('MSFT', marketData);

      expect(snapshot.regime).toBe('low_volatility');
    });

    it('should detect trending_up regime', () => {
      const marketData: MarketData = {
        price: 110,
        sma_20: 105,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      const snapshot = detectRegime('TSLA', marketData);

      expect(snapshot.regime).toBe('trending_up');
    });

    it('should detect trending_down regime', () => {
      const marketData: MarketData = {
        price: 90,
        sma_20: 95,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      const snapshot = detectRegime('NFLX', marketData);

      expect(snapshot.regime).toBe('trending_down');
    });

    it('should detect ranging regime', () => {
      const marketData: MarketData = {
        price: 100.01,
        sma_20: 100,
        sma_50: 102,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      const snapshot = detectRegime('SPY', marketData);

      expect(snapshot.regime).toBe('ranging');
    });

    it('should handle zero average values gracefully', () => {
      const marketData: MarketData = {
        price: 100,
        sma_20: 100,
        sma_50: 100,
        atr: 2,
        avg_atr: 0,
        volume: 1000000,
        avg_volume: 0,
      };

      const snapshot = detectRegime('QQQ', marketData);

      expect(snapshot).toBeDefined();
      expect(snapshot.confidence_score).toBeGreaterThanOrEqual(0);
      expect(snapshot.confidence_score).toBeLessThanOrEqual(1);
    });

    it('should calculate confidence score between 0 and 1', () => {
      const marketData: MarketData = {
        price: 105,
        sma_20: 103,
        sma_50: 100,
        atr: 3,
        avg_atr: 2,
        volume: 1500000,
        avg_volume: 1000000,
      };

      const snapshot = detectRegime('IWM', marketData);

      expect(snapshot.confidence_score).toBeGreaterThanOrEqual(0);
      expect(snapshot.confidence_score).toBeLessThanOrEqual(1);
    });
  });

  describe('Snapshot Retrieval', () => {
    it('should get snapshot by id', () => {
      const marketData: MarketData = {
        price: 100,
        sma_20: 100,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      const snapshot = detectRegime('AAPL', marketData);
      const retrieved = getSnapshot(snapshot.id);

      expect(retrieved).toEqual(snapshot);
    });

    it('should return undefined for non-existent snapshot', () => {
      const snapshot = getSnapshot('reg_nonexistent');
      expect(snapshot).toBeUndefined();
    });

    it('should get latest snapshot for symbol', () => {
      const marketData1: MarketData = {
        price: 100,
        sma_20: 100,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      const snapshot1 = detectRegime('AAPL', marketData1);

      const marketData2: MarketData = {
        price: 105,
        sma_20: 104,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1200000,
        avg_volume: 1000000,
      };

      const snapshot2 = detectRegime('AAPL', marketData2);

      const latest = getLatestForSymbol('AAPL');

      expect(latest?.id).toBe(snapshot2.id);
      expect(latest?.regime).toBe('trending_up');
    });

    it('should return undefined for symbol with no snapshots', () => {
      const latest = getLatestForSymbol('UNKNOWN');
      expect(latest).toBeUndefined();
    });

    it('should get history for symbol', () => {
      const marketData: MarketData = {
        price: 100,
        sma_20: 100,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('AAPL', marketData);
      detectRegime('AAPL', marketData);

      const history = getHistoryForSymbol('AAPL');

      expect(history.symbol).toBe('AAPL');
      expect(history.snapshots.length).toBe(2);
      expect(history.current_regime).toBeDefined();
    });

    it('should limit history snapshots', () => {
      const marketData: MarketData = {
        price: 100,
        sma_20: 100,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      for (let i = 0; i < 5; i++) {
        detectRegime('GOOGL', marketData);
      }

      const history = getHistoryForSymbol('GOOGL', 2);

      expect(history.snapshots.length).toBe(2);
    });
  });

  describe('Regime Transitions', () => {
    it('should auto-detect transition on regime change', () => {
      const uptrend: MarketData = {
        price: 110,
        sma_20: 105,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('AAPL', uptrend);

      const downtrend: MarketData = {
        price: 90,
        sma_20: 95,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('AAPL', downtrend);

      const transitions = getTransitionsForSymbol('AAPL');

      expect(transitions.length).toBe(1);
      expect(transitions[0].from_regime).toBe('trending_up');
      expect(transitions[0].to_regime).toBe('trending_down');
      expect(transitions[0].confirmed).toBe(false);
    });

    it('should get transition by id', () => {
      const uptrend: MarketData = {
        price: 110,
        sma_20: 105,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('TSLA', uptrend);

      const downtrend: MarketData = {
        price: 90,
        sma_20: 95,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('TSLA', downtrend);

      const transitions = getTransitionsForSymbol('TSLA');
      const retrieved = getTransition(transitions[0].id);

      expect(retrieved).toEqual(transitions[0]);
    });

    it('should confirm transition', () => {
      const uptrend: MarketData = {
        price: 110,
        sma_20: 105,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('NFLX', uptrend);

      const downtrend: MarketData = {
        price: 90,
        sma_20: 95,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('NFLX', downtrend);

      const transitions = getTransitionsForSymbol('NFLX');
      const confirmed = confirmTransition(transitions[0].id);

      expect(confirmed?.confirmed).toBe(true);
      expect(confirmed?.confirmed_at).toBeDefined();
    });

    it('should get all transitions', () => {
      const uptrend: MarketData = {
        price: 110,
        sma_20: 105,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('AAPL', uptrend);
      detectRegime('GOOGL', uptrend);

      const downtrend: MarketData = {
        price: 90,
        sma_20: 95,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('AAPL', downtrend);
      detectRegime('GOOGL', downtrend);

      const allTransitions = getAllTransitions();

      expect(allTransitions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Strategy Adaptation', () => {
    it('should suggest exit in crisis regime', () => {
      const crisis: MarketData = {
        price: 100,
        sma_20: 100,
        sma_50: 100,
        atr: 10,
        avg_atr: 4,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('AAPL', crisis);

      const adaptation = suggestAdaptation('strat_123', 'AAPL');

      expect(adaptation?.recommended_action).toBe('exit');
      expect(adaptation?.risk_adjustment).toBe(-0.5);
    });

    it('should suggest reduce_size in volatile regime', () => {
      const volatile: MarketData = {
        price: 100,
        sma_20: 100,
        sma_50: 100,
        atr: 7,
        avg_atr: 4,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('GOOGL', volatile);

      const adaptation = suggestAdaptation('strat_456', 'GOOGL');

      expect(adaptation?.recommended_action).toBe('reduce_size');
      expect(adaptation?.risk_adjustment).toBe(-0.3);
    });

    it('should suggest continue in trending_up regime', () => {
      const trending_up: MarketData = {
        price: 110,
        sma_20: 105,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('TSLA', trending_up);

      const adaptation = suggestAdaptation('strat_789', 'TSLA');

      expect(adaptation?.recommended_action).toBe('continue');
      expect(adaptation?.risk_adjustment).toBe(0.1);
    });

    it('should suggest pause in trending_down regime', () => {
      const trending_down: MarketData = {
        price: 90,
        sma_20: 95,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('NFLX', trending_down);

      const adaptation = suggestAdaptation('strat_101', 'NFLX');

      expect(adaptation?.recommended_action).toBe('pause');
      expect(adaptation?.risk_adjustment).toBe(-0.2);
    });

    it('should suggest switch_params in ranging regime', () => {
      const ranging: MarketData = {
        price: 100.01,
        sma_20: 100,
        sma_50: 102,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('SPY', ranging);

      const adaptation = suggestAdaptation('strat_202', 'SPY');

      expect(adaptation?.recommended_action).toBe('switch_params');
      expect(adaptation?.risk_adjustment).toBe(0);
    });

    it('should suggest increase_size in low_volatility regime', () => {
      const low_vol: MarketData = {
        price: 100,
        sma_20: 100,
        sma_50: 100,
        atr: 1,
        avg_atr: 3,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('QQQ', low_vol);

      const adaptation = suggestAdaptation('strat_303', 'QQQ');

      expect(adaptation?.recommended_action).toBe('increase_size');
      expect(adaptation?.risk_adjustment).toBe(0.2);
    });

    it('should return undefined for non-existent symbol', () => {
      const adaptation = suggestAdaptation('strat_404', 'NONEXISTENT');

      expect(adaptation).toBeUndefined();
    });

    it('should get adaptation by id', () => {
      const trending_up: MarketData = {
        price: 110,
        sma_20: 105,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('AAPL', trending_up);

      const adaptation = suggestAdaptation('strat_505', 'AAPL');

      const retrieved = getAdaptation(adaptation!.id);

      expect(retrieved).toEqual(adaptation);
    });

    it('should get adaptations for strategy', () => {
      const trending_up: MarketData = {
        price: 110,
        sma_20: 105,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('AAPL', trending_up);
      detectRegime('GOOGL', trending_up);

      suggestAdaptation('strat_606', 'AAPL');
      suggestAdaptation('strat_606', 'GOOGL');

      const adaptations = getAdaptationsForStrategy('strat_606');

      expect(adaptations.length).toBeGreaterThanOrEqual(2);
    });

    it('should get all adaptations', () => {
      const trending_up: MarketData = {
        price: 110,
        sma_20: 105,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('AAPL', trending_up);
      detectRegime('GOOGL', trending_up);

      suggestAdaptation('strat_707', 'AAPL');
      suggestAdaptation('strat_808', 'GOOGL');

      const allAdaptations = getAllAdaptations();

      expect(allAdaptations.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Alerts', () => {
    it('should create alert', () => {
      const alert = createAlert('AAPL', 'regime_change', 'high', 'Regime changed to crisis');

      expect(alert.id).toMatch(/^ralert_/);
      expect(alert.symbol).toBe('AAPL');
      expect(alert.alert_type).toBe('regime_change');
      expect(alert.severity).toBe('high');
      expect(alert.acknowledged).toBe(false);
    });

    it('should create alert with regime info', () => {
      const alert = createAlert(
        'GOOGL',
        'regime_change',
        'critical',
        'Transition to crisis',
        'trending_up',
        'crisis'
      );

      expect(alert.regime_before).toBe('trending_up');
      expect(alert.regime_after).toBe('crisis');
    });

    it('should acknowledge alert', () => {
      const alert = createAlert('TSLA', 'volatility_spike', 'medium', 'High volatility detected');

      const acknowledged = acknowledgeAlert(alert.id);

      expect(acknowledged?.acknowledged).toBe(true);
    });

    it('should get alert by id', () => {
      const alert = createAlert('NFLX', 'trend_reversal', 'high', 'Trend reversed');

      const retrieved = getAlert(alert.id);

      expect(retrieved).toEqual(alert);
    });

    it('should return undefined for non-existent alert', () => {
      const alert = getAlert('ralert_nonexistent');

      expect(alert).toBeUndefined();
    });

    it('should get alerts for symbol', () => {
      createAlert('AAPL', 'regime_change', 'high', 'Regime changed');
      createAlert('AAPL', 'volatility_spike', 'medium', 'Volatility spiked');
      createAlert('GOOGL', 'trend_reversal', 'high', 'Trend reversed');

      const aapl_alerts = getAlertsForSymbol('AAPL');

      expect(aapl_alerts.length).toBe(2);
      expect(aapl_alerts.every(a => a.symbol === 'AAPL')).toBe(true);
    });

    it('should get unacknowledged alerts', () => {
      const alert1 = createAlert('AAPL', 'regime_change', 'high', 'Regime changed');
      const alert2 = createAlert('GOOGL', 'volatility_spike', 'medium', 'Volatility spiked');

      acknowledgeAlert(alert1.id);

      const unacknowledged = getUnacknowledgedAlerts();

      expect(unacknowledged.length).toBe(1);
      expect(unacknowledged[0].id).toBe(alert2.id);
    });

    it('should get all alerts', () => {
      createAlert('AAPL', 'regime_change', 'high', 'Regime changed');
      createAlert('GOOGL', 'volatility_spike', 'medium', 'Volatility spiked');
      createAlert('TSLA', 'trend_reversal', 'low', 'Trend reversed');

      const allAlerts = getAllAlerts();

      expect(allAlerts.length).toBe(3);
    });

    it('should limit alerts', () => {
      for (let i = 0; i < 5; i++) {
        createAlert('AAPL', 'regime_change', 'high', `Alert ${i}`);
      }

      const limited = getAllAlerts(2);

      expect(limited.length).toBe(2);
    });
  });

  describe('Models', () => {
    it('should register model', () => {
      const model = registerModel('Model-v1', '1.0.0', ['AAPL', 'GOOGL'], ['sma', 'atr']);

      expect(model.id).toMatch(/^rmod_/);
      expect(model.name).toBe('Model-v1');
      expect(model.version).toBe('1.0.0');
      expect(model.status).toBe('active');
      expect(model.accuracy_score).toBe(0.5);
    });

    it('should update model accuracy', () => {
      const model = registerModel('Model-v2', '2.0.0', ['TSLA'], ['volatility']);

      const updated = updateModelAccuracy(model.id, 0.95);

      expect(updated?.accuracy_score).toBe(0.95);
      expect(updated?.last_trained_at).toBeDefined();
    });

    it('should get model by id', () => {
      const model = registerModel('Model-v3', '3.0.0', ['NFLX'], ['trend']);

      const retrieved = getModel(model.id);

      expect(retrieved).toEqual(model);
    });

    it('should return undefined for non-existent model', () => {
      const model = getModel('rmod_nonexistent');

      expect(model).toBeUndefined();
    });

    it('should get all models', () => {
      registerModel('Model-v4', '4.0.0', ['SPY'], ['sma']);
      registerModel('Model-v5', '5.0.0', ['QQQ'], ['atr']);

      const allModels = getAllModels();

      expect(allModels.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Statistics', () => {
    it('should return regime stats', () => {
      const marketData: MarketData = {
        price: 110,
        sma_20: 105,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('AAPL', marketData);

      const stats = getRegimeStats();

      expect(stats.total_snapshots).toBeGreaterThan(0);
      expect(stats.total_alerts).toBeDefined();
      expect(stats.total_transitions).toBeDefined();
      expect(stats.unacknowledged_alerts).toBeDefined();
    });

    it('should track regimes detected', () => {
      const uptrend: MarketData = {
        price: 110,
        sma_20: 105,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      const crisis: MarketData = {
        price: 100,
        sma_20: 100,
        sma_50: 100,
        atr: 10,
        avg_atr: 4,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('AAPL', uptrend);
      detectRegime('GOOGL', crisis);

      const stats = getRegimeStats();

      expect(stats.regimes_detected['trending_up']).toBeGreaterThan(0);
      expect(stats.regimes_detected['crisis']).toBeGreaterThan(0);
    });

    it('should count unacknowledged alerts', () => {
      const alert1 = createAlert('AAPL', 'regime_change', 'high', 'Alert 1');
      createAlert('GOOGL', 'volatility_spike', 'medium', 'Alert 2');

      acknowledgeAlert(alert1.id);

      const stats = getRegimeStats();

      expect(stats.unacknowledged_alerts).toBe(1);
    });
  });

  describe('Clear Function', () => {
    it('should clear all regime data', () => {
      const marketData: MarketData = {
        price: 110,
        sma_20: 105,
        sma_50: 100,
        atr: 2,
        avg_atr: 2,
        volume: 1000000,
        avg_volume: 1000000,
      };

      detectRegime('AAPL', marketData);
      createAlert('AAPL', 'regime_change', 'high', 'Alert');

      _clearRegime();

      const stats = getRegimeStats();

      expect(stats.total_snapshots).toBe(0);
      expect(stats.total_alerts).toBe(0);
    });
  });
});
