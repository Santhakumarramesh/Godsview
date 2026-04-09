import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MTFEngine,
  addCandles,
  getCandles,
  analyzeTimeframe,
  getAnalysis,
  getAnalysesForSymbol,
  getAllAnalyses,
  detectConfluence,
  getConfluence,
  getConfluencesForSymbol,
  getAllConfluences,
  detectDivergence,
  getDivergence,
  getDivergencesForSymbol,
  getAllDivergences,
  computeCorrelation,
  getCorrelation,
  getAllCorrelations,
  runScan,
  getScan,
  getScansForSymbol,
  getAllScans,
  _clearMtf,
  type Timeframe,
  type TimeframeCandle,
} from '../lib/mtf_analysis';

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('pino-pretty', () => ({
  default: vi.fn(),
}));

describe('MTF Analysis Engine', () => {
  beforeEach(() => {
    _clearMtf();
  });

  // ========== Candle Management Tests ==========

  describe('Candle Management', () => {
    it('should add candles to the engine', () => {
      const candles = [
        { open: 100, high: 105, low: 99, close: 102, volume: 1000, timestamp: '2024-01-01T00:00:00Z' },
        { open: 102, high: 107, low: 101, close: 106, volume: 1100, timestamp: '2024-01-01T01:00:00Z' },
      ];

      addCandles('BTC/USD', '1h', candles);
      const retrieved = getCandles('BTC/USD', '1h');

      expect(retrieved).toHaveLength(2);
      expect(retrieved[0].symbol).toBe('BTC/USD');
      expect(retrieved[0].timeframe).toBe('1h');
      expect(retrieved[0].close).toBe(102);
    });

    it('should accumulate candles on multiple adds', () => {
      addCandles('BTC/USD', '1h', [
        { open: 100, high: 105, low: 99, close: 102, volume: 1000, timestamp: '2024-01-01T00:00:00Z' },
      ]);
      addCandles('BTC/USD', '1h', [
        { open: 102, high: 107, low: 101, close: 106, volume: 1100, timestamp: '2024-01-01T01:00:00Z' },
      ]);

      const retrieved = getCandles('BTC/USD', '1h');
      expect(retrieved).toHaveLength(2);
    });

    it('should return limited candles when limit is specified', () => {
      const candles = Array.from({ length: 10 }, (_, i) => ({
        open: 100 + i,
        high: 105 + i,
        low: 99 + i,
        close: 102 + i,
        volume: 1000,
        timestamp: `2024-01-01T${i.toString().padStart(2, '0')}:00:00Z`,
      }));

      addCandles('BTC/USD', '1h', candles);
      const retrieved = getCandles('BTC/USD', '1h', 5);

      expect(retrieved).toHaveLength(5);
    });

    it('should return empty array for non-existent symbol/timeframe', () => {
      const retrieved = getCandles('ETH/USD', '1d');
      expect(retrieved).toHaveLength(0);
    });

    it('should handle multiple symbols and timeframes', () => {
      addCandles('BTC/USD', '1h', [
        { open: 100, high: 105, low: 99, close: 102, volume: 1000, timestamp: '2024-01-01T00:00:00Z' },
      ]);
      addCandles('ETH/USD', '1h', [
        { open: 50, high: 55, low: 49, close: 52, volume: 2000, timestamp: '2024-01-01T00:00:00Z' },
      ]);
      addCandles('BTC/USD', '4h', [
        { open: 100, high: 110, low: 95, close: 105, volume: 5000, timestamp: '2024-01-01T00:00:00Z' },
      ]);

      expect(getCandles('BTC/USD', '1h')).toHaveLength(1);
      expect(getCandles('ETH/USD', '1h')).toHaveLength(1);
      expect(getCandles('BTC/USD', '4h')).toHaveLength(1);
    });
  });

  // ========== Timeframe Analysis Tests ==========

  describe('Timeframe Analysis', () => {
    it('should analyze a bullish candle correctly', () => {
      const candle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 101.5,
        low: 99.5,
        close: 100.8,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const analysis = analyzeTimeframe('BTC/USD', '1h', candle);

      expect(analysis.trend).toBe('bullish');
      expect(analysis.strength).toBe('moderate');
      expect(analysis.support_level).toBe(99.5);
      expect(analysis.resistance_level).toBe(101.5);
      expect(analysis.momentum).toBeGreaterThan(0);
    });

    it('should analyze a bearish candle correctly', () => {
      const candle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 100.5,
        low: 98.5,
        close: 99.2,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const analysis = analyzeTimeframe('BTC/USD', '1h', candle);

      expect(analysis.trend).toBe('bearish');
      expect(analysis.strength).toBe('moderate');
      expect(analysis.momentum).toBeLessThan(0);
    });

    it('should analyze a neutral candle correctly', () => {
      const candle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 100.3,
        low: 99.8,
        close: 100.1,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const analysis = analyzeTimeframe('BTC/USD', '1h', candle);

      expect(analysis.trend).toBe('neutral');
      expect(analysis.strength).toBe('weak');
    });

    it('should classify strong strength correctly', () => {
      const candle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 102,
        low: 98,
        close: 101.2,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const analysis = analyzeTimeframe('BTC/USD', '1h', candle);

      expect(analysis.strength).toBe('strong');
    });

    it('should calculate momentum correctly', () => {
      const candle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const analysis = analyzeTimeframe('BTC/USD', '1h', candle);

      expect(analysis.momentum).toBe(5); // (105 - 100) / 100 * 100 = 5
    });

    it('should calculate volatility correctly', () => {
      const candle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const analysis = analyzeTimeframe('BTC/USD', '1h', candle);

      expect(analysis.volatility).toBe(20); // (110 - 90) / 100 * 100 = 20
    });

    it('should include key support/resistance levels', () => {
      const candle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const analysis = analyzeTimeframe('BTC/USD', '1h', candle);

      expect(analysis.key_levels).toContain(95);
      expect(analysis.key_levels).toContain(105);
      expect(analysis.key_levels).toContain(100);
      expect(analysis.key_levels).toContain(102);
    });

    it('should generate unique IDs for each analysis', () => {
      const candle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const analysis1 = analyzeTimeframe('BTC/USD', '1h', candle);
      const analysis2 = analyzeTimeframe('BTC/USD', '1h', candle);

      expect(analysis1.id).not.toBe(analysis2.id);
      expect(analysis1.id).toMatch(/^mtf_/);
      expect(analysis2.id).toMatch(/^mtf_/);
    });

    it('should retrieve analysis by ID', () => {
      const candle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const analysis = analyzeTimeframe('BTC/USD', '1h', candle);
      const retrieved = getAnalysis(analysis.id);

      expect(retrieved).toEqual(analysis);
    });

    it('should return undefined for non-existent analysis ID', () => {
      const retrieved = getAnalysis('mtf_nonexistent');
      expect(retrieved).toBeUndefined();
    });

    it('should retrieve all analyses for a symbol', () => {
      const candle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', candle);
      analyzeTimeframe('BTC/USD', '4h', candle);
      analyzeTimeframe('ETH/USD', '1h', candle);

      const btcAnalyses = getAnalysesForSymbol('BTC/USD');
      expect(btcAnalyses).toHaveLength(2);
      expect(btcAnalyses.every((a) => a.symbol === 'BTC/USD')).toBe(true);
    });

    it('should get all analyses with limit', () => {
      const candle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      for (let i = 0; i < 10; i++) {
        analyzeTimeframe('BTC/USD', '1h', candle);
      }

      const allAnalyses = getAllAnalyses(5);
      expect(allAnalyses).toHaveLength(5);
    });
  });

  // ========== Confluence Detection Tests ==========

  describe('Confluence Detection', () => {
    it('should detect full bullish confluence', () => {
      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', bullishCandle);
      analyzeTimeframe('BTC/USD', '4h', bullishCandle);
      analyzeTimeframe('BTC/USD', '1d', bullishCandle);

      const signal = detectConfluence('BTC/USD', ['1h', '4h', '1d']);

      expect(signal.direction).toBe('bullish');
      expect(signal.confluence_type).toBe('full');
      expect(signal.alignment_score).toBe(1);
      expect(signal.timeframes_aligned).toContain('1h');
      expect(signal.timeframes_aligned).toContain('4h');
      expect(signal.timeframes_aligned).toContain('1d');
    });

    it('should detect full bearish confluence', () => {
      const bearishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 102,
        low: 95,
        close: 96,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', bearishCandle);
      analyzeTimeframe('BTC/USD', '4h', bearishCandle);

      const signal = detectConfluence('BTC/USD', ['1h', '4h']);

      expect(signal.direction).toBe('bearish');
      expect(signal.confluence_type).toBe('full');
    });

    it('should detect partial confluence', () => {
      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const bearishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 102,
        low: 95,
        close: 96,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', bullishCandle);
      analyzeTimeframe('BTC/USD', '4h', bullishCandle);
      analyzeTimeframe('BTC/USD', '1d', bearishCandle);

      const signal = detectConfluence('BTC/USD', ['1h', '4h', '1d']);

      expect(signal.confluence_type).toBe('partial');
      expect(signal.alignment_score).toBeGreaterThan(0);
      expect(signal.alignment_score).toBeLessThan(1);
    });

    it('should detect divergent signals', () => {
      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const bearishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 102,
        low: 95,
        close: 96,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', bullishCandle);
      analyzeTimeframe('BTC/USD', '4h', bearishCandle);

      const signal = detectConfluence('BTC/USD', ['1h', '4h']);

      expect(signal.confluence_type).toBe('divergent');
      expect(signal.alignment_score).toBeLessThanOrEqual(0.5);
    });

    it('should identify strongest timeframe', () => {
      const strongBullish: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 102,
        low: 98,
        close: 101.5,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const weakBullish: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 100.3,
        low: 99.8,
        close: 100.2,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', strongBullish);
      analyzeTimeframe('BTC/USD', '4h', weakBullish);

      const signal = detectConfluence('BTC/USD', ['1h', '4h']);

      expect(signal.strongest_timeframe).toBe('1h');
    });

    it('should calculate entry zone correctly', () => {
      const candle1: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 98,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const candle2: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 108,
        low: 95,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', candle1);
      analyzeTimeframe('BTC/USD', '4h', candle2);

      const signal = detectConfluence('BTC/USD', ['1h', '4h']);

      expect(signal.entry_zone.low).toBe(95);
      expect(signal.entry_zone.high).toBe(108);
    });

    it('should retrieve confluence by ID', () => {
      const candle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', candle);
      analyzeTimeframe('BTC/USD', '4h', candle);

      const signal = detectConfluence('BTC/USD', ['1h', '4h']);
      const retrieved = getConfluence(signal.id);

      expect(retrieved).toEqual(signal);
      expect(signal.id).toMatch(/^conf_/);
    });

    it('should retrieve confluences for symbol', () => {
      const candle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', candle);
      analyzeTimeframe('BTC/USD', '4h', candle);
      detectConfluence('BTC/USD', ['1h', '4h']);

      const confluences = getConfluencesForSymbol('BTC/USD');

      expect(confluences.length).toBeGreaterThan(0);
      expect(confluences.every((c) => c.symbol === 'BTC/USD')).toBe(true);
    });

    it('should get all confluences with limit', () => {
      const candle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', candle);
      analyzeTimeframe('BTC/USD', '4h', candle);

      for (let i = 0; i < 5; i++) {
        detectConfluence('BTC/USD', ['1h', '4h']);
      }

      const allConfluences = getAllConfluences(3);
      expect(allConfluences).toHaveLength(3);
    });
  });

  // ========== Divergence Detection Tests ==========

  describe('Divergence Detection', () => {
    it('should detect bullish divergence', () => {
      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const bearishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 102,
        low: 95,
        close: 96,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1m', bullishCandle);
      analyzeTimeframe('BTC/USD', '1h', bearishCandle);

      const divergence = detectDivergence('BTC/USD', '1m', '1h');

      expect(divergence).not.toBeNull();
      expect(divergence?.divergence_type).toBe('bullish_divergence');
      expect(divergence?.short_trend).toBe('bullish');
      expect(divergence?.long_trend).toBe('bearish');
    });

    it('should detect bearish divergence', () => {
      const bearishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 102,
        low: 95,
        close: 96,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1m', bearishCandle);
      analyzeTimeframe('BTC/USD', '1h', bullishCandle);

      const divergence = detectDivergence('BTC/USD', '1m', '1h');

      expect(divergence).not.toBeNull();
      expect(divergence?.divergence_type).toBe('bearish_divergence');
    });

    it('should return null if no divergence exists', () => {
      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1m', bullishCandle);
      analyzeTimeframe('BTC/USD', '1h', bullishCandle);

      const divergence = detectDivergence('BTC/USD', '1m', '1h');

      expect(divergence).toBeNull();
    });

    it('should determine severity based on strength', () => {
      const strongBullish: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 102,
        low: 98,
        close: 101.5,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const bearishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 102,
        low: 95,
        close: 96,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1m', strongBullish);
      analyzeTimeframe('BTC/USD', '1h', bearishCandle);

      const divergence = detectDivergence('BTC/USD', '1m', '1h');

      expect(divergence?.severity).toBe('high');
    });

    it('should retrieve divergence by ID', () => {
      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const bearishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 102,
        low: 95,
        close: 96,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1m', bullishCandle);
      analyzeTimeframe('BTC/USD', '1h', bearishCandle);

      const divergence = detectDivergence('BTC/USD', '1m', '1h')!;
      const retrieved = getDivergence(divergence.id);

      expect(retrieved).toEqual(divergence);
      expect(divergence.id).toMatch(/^div_/);
    });

    it('should retrieve divergences for symbol', () => {
      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const bearishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 102,
        low: 95,
        close: 96,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1m', bullishCandle);
      analyzeTimeframe('BTC/USD', '1h', bearishCandle);
      detectDivergence('BTC/USD', '1m', '1h');

      const divergences = getDivergencesForSymbol('BTC/USD');

      expect(divergences.length).toBeGreaterThan(0);
      expect(divergences.every((d) => d.symbol === 'BTC/USD')).toBe(true);
    });

    it('should get all divergences with limit', () => {
      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const bearishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 102,
        low: 95,
        close: 96,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1m', bullishCandle);
      analyzeTimeframe('BTC/USD', '1h', bearishCandle);

      for (let i = 0; i < 5; i++) {
        detectDivergence('BTC/USD', '1m', '1h');
      }

      const allDivergences = getAllDivergences(3);
      expect(allDivergences).toHaveLength(3);
    });
  });

  // ========== Correlation Tests ==========

  describe('Correlation Computation', () => {
    it('should compute positive correlation for same trends', () => {
      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', bullishCandle);
      analyzeTimeframe('BTC/USD', '4h', bullishCandle);

      const corr = computeCorrelation('BTC/USD', '1h', '4h');

      expect(corr.correlation).toBe(1.0);
    });

    it('should compute negative correlation for opposite trends', () => {
      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const bearishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 102,
        low: 95,
        close: 96,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', bullishCandle);
      analyzeTimeframe('BTC/USD', '4h', bearishCandle);

      const corr = computeCorrelation('BTC/USD', '1h', '4h');

      expect(corr.correlation).toBe(-1.0);
    });

    it('should compute zero correlation for neutral trend', () => {
      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const neutralCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 100.3,
        low: 99.8,
        close: 100.1,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', bullishCandle);
      analyzeTimeframe('BTC/USD', '4h', neutralCandle);

      const corr = computeCorrelation('BTC/USD', '1h', '4h');

      expect(corr.correlation).toBe(0.0);
    });

    it('should retrieve correlation by ID', () => {
      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', bullishCandle);
      analyzeTimeframe('BTC/USD', '4h', bullishCandle);

      const corr = computeCorrelation('BTC/USD', '1h', '4h');
      const retrieved = getCorrelation(corr.id);

      expect(retrieved).toEqual(corr);
      expect(corr.id).toMatch(/^tfcor_/);
    });

    it('should get all correlations with limit', () => {
      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', bullishCandle);
      analyzeTimeframe('BTC/USD', '4h', bullishCandle);
      analyzeTimeframe('BTC/USD', '1d', bullishCandle);

      computeCorrelation('BTC/USD', '1h', '4h');
      computeCorrelation('BTC/USD', '4h', '1d');
      computeCorrelation('BTC/USD', '1h', '1d');

      const allCorrs = getAllCorrelations(2);
      expect(allCorrs).toHaveLength(2);
    });
  });

  // ========== Scan Tests ==========

  describe('Scan Operations', () => {
    it('should run confluence scan', () => {
      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', bullishCandle);
      analyzeTimeframe('BTC/USD', '4h', bullishCandle);

      const scan = runScan('BTC/USD', ['1h', '4h'], 'confluence');

      expect(scan.scan_type).toBe('confluence');
      expect(scan.score).toBeGreaterThan(0);
      expect(scan.findings.length).toBeGreaterThan(0);
      expect(scan.id).toMatch(/^scan_/);
    });

    it('should run divergence scan', () => {
      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const bearishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 102,
        low: 95,
        close: 96,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1m', bullishCandle);
      analyzeTimeframe('BTC/USD', '1h', bearishCandle);
      detectDivergence('BTC/USD', '1m', '1h');

      const scan = runScan('BTC/USD', ['1m', '1h'], 'divergence');

      expect(scan.scan_type).toBe('divergence');
      expect(scan.score).toBeGreaterThan(0);
    });

    it('should run breakout scan', () => {
      const breakoutCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 102.5,
        low: 98,
        close: 101.8,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', breakoutCandle);
      analyzeTimeframe('BTC/USD', '4h', breakoutCandle);

      const scan = runScan('BTC/USD', ['1h', '4h'], 'breakout');

      expect(scan.scan_type).toBe('breakout');
      expect(scan.findings.length).toBeGreaterThan(0);
    });

    it('should run reversal scan', () => {
      const reversalCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', reversalCandle);

      const scan = runScan('BTC/USD', ['1h'], 'reversal');

      expect(scan.scan_type).toBe('reversal');
      expect(scan.findings.length).toBeGreaterThan(0);
    });

    it('should retrieve scan by ID', () => {
      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', bullishCandle);

      const scan = runScan('BTC/USD', ['1h'], 'confluence');
      const retrieved = getScan(scan.id);

      expect(retrieved).toEqual(scan);
    });

    it('should retrieve scans for symbol', () => {
      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', bullishCandle);
      runScan('BTC/USD', ['1h'], 'confluence');

      const scans = getScansForSymbol('BTC/USD');

      expect(scans.length).toBeGreaterThan(0);
      expect(scans.every((s) => s.symbol === 'BTC/USD')).toBe(true);
    });

    it('should get all scans with limit', () => {
      const bullishCandle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', bullishCandle);

      for (let i = 0; i < 5; i++) {
        runScan('BTC/USD', ['1h'], 'confluence');
      }

      const allScans = getAllScans(3);
      expect(allScans).toHaveLength(3);
    });
  });

  // ========== Utility Tests ==========

  describe('Utilities', () => {
    it('should clear all MTF data', () => {
      const candle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      analyzeTimeframe('BTC/USD', '1h', candle);
      addCandles('BTC/USD', '1h', [
        { open: 100, high: 105, low: 99, close: 102, volume: 1000, timestamp: '2024-01-01T00:00:00Z' },
      ]);

      expect(getAllAnalyses()).toHaveLength(1);
      expect(getCandles('BTC/USD', '1h')).toHaveLength(1);

      _clearMtf();

      expect(getAllAnalyses()).toHaveLength(0);
      expect(getCandles('BTC/USD', '1h')).toHaveLength(0);
    });

    it('should instantiate MTFEngine class directly', () => {
      const engine = new MTFEngine();

      const candle: TimeframeCandle = {
        symbol: 'BTC/USD',
        timeframe: '1h',
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const analysis = engine.analyzeTimeframe('BTC/USD', '1h', candle);

      expect(analysis.symbol).toBe('BTC/USD');
      expect(analysis.trend).toBe('bullish');
    });
  });
});
