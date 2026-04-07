import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

const C = {
  bg: '#0e0e0f',
  card: '#1a191b',
  cardAlt: '#141316',
  border: '#2a2a2d',
  borderFocus: '#3a3a3f',
  text: '#e2e2e6',
  textDim: '#8b8b92',
  textMuted: '#5a5a62',
  accent: '#6c5ce7',
  accentGlow: 'rgba(108,92,231,0.25)',
  green: '#00e676',
  red: '#ff5252',
  yellow: '#ffd740',
  blue: '#40c4ff',
  orange: '#ff9100',
};

// ============ TYPE DEFINITIONS ============

interface QualityData {
  symbol: string;
  liquidity: number;
  efficiency: number;
  stability: number;
  overallGrade: string;
  spread: number;
  vwap: number;
  timestamp: string;
}

interface BookLevel {
  price: number;
  size: number;
  isWall?: boolean;
}

interface BookData {
  symbol: string;
  bids: BookLevel[];
  asks: BookLevel[];
  imbalance: number;
  timestamp: string;
}

interface FlowData {
  symbol: string;
  buyVolume: number;
  sellVolume: number;
  imbalance: number;
  intensity: number;
  timestamp: string;
}

interface HeatmapCell {
  time: number;
  price: number;
  volume: number;
}

interface HeatmapData {
  symbol: string;
  cells: HeatmapCell[];
  maxVolume: number;
  timestamp: string;
}

interface Signal {
  id: string;
  type: 'bid_heavy' | 'ask_heavy' | 'wall' | 'sweep' | 'absorption';
  direction: 'bullish' | 'bearish';
  strength: number;
  price: number;
  details: string;
  timestamp: string;
}

interface SignalsData {
  symbol: string;
  signals: Signal[];
}

interface SlippageResult {
  slippageBps: number;
  avgFillPrice: number;
  liquidityScore: number;
  levelsConsumed: number;
  recommendation: 'proceed' | 'split' | 'delay' | 'abort';
}

// ============ UTILITY FUNCTIONS ============

const gradeColor = (grade: string): string => {
  const map: Record<string, string> = {
    A: C.green,
    B: C.blue,
    C: C.yellow,
    D: C.orange,
    F: C.red,
  };
  return map[grade] || C.textDim;
};

const recommendationColor = (rec: string): string => {
  const map: Record<string, string> = {
    proceed: C.green,
    split: C.blue,
    delay: C.yellow,
    abort: C.red,
  };
  return map[rec] || C.textDim;
};

// ============ MOCK DATA ============

const mockQuality: QualityData = {
  symbol: 'AAPL',
  liquidity: 88,
  efficiency: 75,
  stability: 82,
  overallGrade: 'A',
  spread: 0.01,
  vwap: 189.45,
  timestamp: new Date().toISOString(),
};

const mockBook: BookData = {
  symbol: 'AAPL',
  bids: [
    { price: 189.40, size: 1200 },
    { price: 189.35, size: 950, isWall: true },
    { price: 189.30, size: 750 },
    { price: 189.25, size: 600 },
    { price: 189.20, size: 850 },
  ],
  asks: [
    { price: 189.50, size: 1100 },
    { price: 189.55, size: 850 },
    { price: 189.60, size: 680, isWall: true },
    { price: 189.65, size: 920 },
    { price: 189.70, size: 1050 },
  ],
  imbalance: 0.12,
  timestamp: new Date().toISOString(),
};

const mockFlow: FlowData = {
  symbol: 'AAPL',
  buyVolume: 4250000,
  sellVolume: 3100000,
  imbalance: 0.27,
  intensity: 0.68,
  timestamp: new Date().toISOString(),
};

const mockHeatmap: HeatmapData = {
  symbol: 'AAPL',
  cells: Array.from({ length: 400 }, (_, i) => ({
    time: i % 20,
    price: Math.floor(i / 20),
    volume: Math.random() * 1000000,
  })),
  maxVolume: 1000000,
  timestamp: new Date().toISOString(),
};

const mockSignals: SignalsData = {
  symbol: 'AAPL',
  signals: [
    {
      id: '1',
      type: 'bid_heavy',
      direction: 'bullish',
      strength: 0.85,
      price: 189.35,
      details: 'Large bid wall detected at 189.35',
      timestamp: new Date(Date.now() - 30000).toISOString(),
    },
    {
      id: '2',
      type: 'sweep',
      direction: 'bearish',
      strength: 0.72,
      price: 189.50,
      details: 'Ask sweep consumed 3 levels',
      timestamp: new Date(Date.now() - 120000).toISOString(),
    },
    {
      id: '3',
      type: 'absorption',
      direction: 'bullish',
      strength: 0.65,
      price: 189.42,
      details: 'Strong absorption at resistance',
      timestamp: new Date(Date.now() - 300000).toISOString(),
    },
  ],
};

// ============ COMPONENTS ============

// 1. Market Quality Banner
const MarketQualityBanner: React.FC<{ symbol: string }> = ({ symbol }) => {
  const { data = mockQuality, isLoading, error } = useQuery({
    queryKey: ['quality', symbol],
    queryFn: () => fetch(`/api/microstructure/quality?symbol=${symbol}`).then(r => r.json()).catch(() => mockQuality),
  });

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: 24,
      marginBottom: 24,
    }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ color: C.text, fontSize: 18, fontWeight: 600, margin: '0 0 8px 0' }}>
          Market Quality - {data.symbol}
        </h2>
        <p style={{ color: C.textMuted, fontSize: 12, margin: 0 }}>
          {error ? 'Using mock data' : 'Last updated: ' + new Date(data.timestamp).toLocaleTimeString()}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 24 }}>
        {/* Liquidity Gauge */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 100,
            height: 100,
            borderRadius: '50%',
            border: `3px solid ${C.accent}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px',
            background: `conic-gradient(${C.accent} 0deg ${data.liquidity * 3.6}deg, ${C.border} ${data.liquidity * 3.6}deg 360deg)`,
            position: 'relative',
          }}>
            <div style={{
              width: 92,
              height: 92,
              borderRadius: '50%',
              background: C.card,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              fontWeight: 700,
              color: C.accent,
            }}>
              {data.liquidity}
            </div>
          </div>
          <p style={{ color: C.textDim, fontSize: 12, margin: '0 0 4px 0' }}>Liquidity</p>
          <p style={{ color: C.textMuted, fontSize: 11, margin: 0 }}>Quality Score</p>
        </div>

        {/* Efficiency Gauge */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 100,
            height: 100,
            borderRadius: '50%',
            border: `3px solid ${C.blue}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px',
            background: `conic-gradient(${C.blue} 0deg ${data.efficiency * 3.6}deg, ${C.border} ${data.efficiency * 3.6}deg 360deg)`,
            position: 'relative',
          }}>
            <div style={{
              width: 92,
              height: 92,
              borderRadius: '50%',
              background: C.card,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              fontWeight: 700,
              color: C.blue,
            }}>
              {data.efficiency}
            </div>
          </div>
          <p style={{ color: C.textDim, fontSize: 12, margin: '0 0 4px 0' }}>Efficiency</p>
          <p style={{ color: C.textMuted, fontSize: 11, margin: 0 }}>Price Impact</p>
        </div>

        {/* Stability Gauge */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 100,
            height: 100,
            borderRadius: '50%',
            border: `3px solid ${C.green}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px',
            background: `conic-gradient(${C.green} 0deg ${data.stability * 3.6}deg, ${C.border} ${data.stability * 3.6}deg 360deg)`,
            position: 'relative',
          }}>
            <div style={{
              width: 92,
              height: 92,
              borderRadius: '50%',
              background: C.card,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              fontWeight: 700,
              color: C.green,
            }}>
              {data.stability}
            </div>
          </div>
          <p style={{ color: C.textDim, fontSize: 12, margin: '0 0 4px 0' }}>Stability</p>
          <p style={{ color: C.textMuted, fontSize: 11, margin: 0 }}>Volatility</p>
        </div>

        {/* Overall Grade */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 100,
            height: 100,
            borderRadius: '50%',
            border: `3px solid ${gradeColor(data.overallGrade)}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px',
            background: C.cardAlt,
          }}>
            <div style={{
              fontSize: 56,
              fontWeight: 700,
              color: gradeColor(data.overallGrade),
            }}>
              {data.overallGrade}
            </div>
          </div>
          <p style={{ color: C.textDim, fontSize: 12, margin: '0 0 4px 0' }}>Overall Grade</p>
          <p style={{ color: C.textMuted, fontSize: 11, margin: 0 }}>Market Health</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
        <div>
          <p style={{ color: C.textMuted, fontSize: 11, margin: '0 0 4px 0' }}>SPREAD</p>
          <p style={{ color: C.text, fontSize: 16, fontWeight: 600, margin: 0 }}>${data.spread.toFixed(4)}</p>
        </div>
        <div>
          <p style={{ color: C.textMuted, fontSize: 11, margin: '0 0 4px 0' }}>VWAP</p>
          <p style={{ color: C.text, fontSize: 16, fontWeight: 600, margin: 0 }}>${data.vwap.toFixed(2)}</p>
        </div>
      </div>
    </div>
  );
};

// 2. Order Book Depth Visualization
const OrderBookDepth: React.FC<{ symbol: string }> = ({ symbol }) => {
  const { data = mockBook, isLoading, error } = useQuery({
    queryKey: ['book', symbol],
    queryFn: () => fetch(`/api/microstructure/book?symbol=${symbol}`).then(r => r.json()).catch(() => mockBook),
  });

  const maxSize = Math.max(...data.bids.map(b => b.size), ...data.asks.map(a => a.size));
  const imbalancePercent = ((data.imbalance + 1) / 2) * 100;

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: 24,
      marginBottom: 24,
    }}>
      <h3 style={{ color: C.text, fontSize: 16, fontWeight: 600, margin: '0 0 16px 0' }}>
        Order Book Depth
      </h3>

      {/* Imbalance Meter */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: C.textMuted, fontSize: 11 }}>IMBALANCE</span>
          <span style={{ color: C.accent, fontSize: 11, fontWeight: 600 }}>
            {data.imbalance > 0 ? '↑ BULLISH' : '↓ BEARISH'} {Math.abs(data.imbalance * 100).toFixed(1)}%
          </span>
        </div>
        <div style={{
          width: '100%',
          height: 8,
          background: C.cardAlt,
          borderRadius: 4,
          overflow: 'hidden',
          border: `1px solid ${C.border}`,
        }}>
          <div style={{
            width: `${imbalancePercent}%`,
            height: '100%',
            background: data.imbalance > 0 ? C.green : C.red,
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* Book Visualization */}
      <svg width="100%" height={250} style={{ background: C.cardAlt, borderRadius: 8 }}>
        {/* Grid lines */}
        {Array.from({ length: 5 }).map((_, i) => (
          <line
            key={`grid-${i}`}
            x1={0}
            y1={(i * 250) / 4}
            x2="100%"
            y2={(i * 250) / 4}
            stroke={C.border}
            strokeWidth={0.5}
            opacity={0.3}
          />
        ))}

        {/* Bids (left side - green) */}
        {data.bids.map((bid: any, i: any) => {
          const width = (bid.size / maxSize) * 50;
          const x = 50 - width;
          const y = (i * 250) / data.bids.length;
          return (
            <g key={`bid-${i}`}>
              <rect
                x={`${x}%`}
                y={y}
                width={`${width}%`}
                height={(250 / data.bids.length) * 0.8}
                fill={C.green}
                opacity={0.7}
                stroke={bid.isWall ? C.orange : 'none'}
                strokeWidth={bid.isWall ? 2 : 0}
              />
              <text
                x={`${x + width / 2}%`}
                y={y + 15}
                textAnchor="middle"
                fill={C.text}
                fontSize={11}
                fontWeight={500}
              >
                ${bid.price.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* Asks (right side - red) */}
        {data.asks.map((ask: any, i: any) => {
          const width = (ask.size / maxSize) * 50;
          const y = (i * 250) / data.asks.length;
          return (
            <g key={`ask-${i}`}>
              <rect
                x="50%"
                y={y}
                width={`${width}%`}
                height={(250 / data.asks.length) * 0.8}
                fill={C.red}
                opacity={0.7}
                stroke={ask.isWall ? C.orange : 'none'}
                strokeWidth={ask.isWall ? 2 : 0}
              />
              <text
                x={`${50 + width / 2}%`}
                y={y + 15}
                textAnchor="middle"
                fill={C.text}
                fontSize={11}
                fontWeight={500}
              >
                ${ask.price.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* Center line */}
        <line x1="50%" y1={0} x2="50%" y2={250} stroke={C.border} strokeWidth={1} />
      </svg>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
        <div>
          <p style={{ color: C.textMuted, fontSize: 11, margin: '0 0 4px 0' }}>BID SIDE</p>
          <p style={{ color: C.green, fontSize: 14, fontWeight: 600, margin: 0 }}>
            {data.bids.reduce((a: any, b: any) => a + b.size, 0).toLocaleString()}
          </p>
        </div>
        <div>
          <p style={{ color: C.textMuted, fontSize: 11, margin: '0 0 4px 0' }}>ASK SIDE</p>
          <p style={{ color: C.red, fontSize: 14, fontWeight: 600, margin: 0 }}>
            {data.asks.reduce((a: any, b: any) => a + b.size, 0).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
};

// 3. Trade Flow Panel
const TradeFlowPanel: React.FC<{ symbol: string }> = ({ symbol }) => {
  const { data = mockFlow, isLoading, error } = useQuery({
    queryKey: ['flow', symbol],
    queryFn: () => fetch(`/api/microstructure/flow?symbol=${symbol}`).then(r => r.json()).catch(() => mockFlow),
  });

  const total = data.buyVolume + data.sellVolume;
  const buyPercent = (data.buyVolume / total) * 100;
  const flowIntensityColor = data.intensity > 0.7 ? C.green : data.intensity > 0.4 ? C.yellow : C.red;

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: 24,
      marginBottom: 24,
    }}>
      <h3 style={{ color: C.text, fontSize: 16, fontWeight: 600, margin: '0 0 16px 0' }}>
        Trade Flow Analysis
      </h3>

      {/* Volume Comparison */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: C.textMuted, fontSize: 11 }}>BUY vs SELL VOLUME</span>
          <span style={{ color: C.accent, fontSize: 11, fontWeight: 600 }}>
            {(data.imbalance * 100).toFixed(1)}% {data.imbalance > 0 ? 'BULLISH' : 'BEARISH'}
          </span>
        </div>
        <div style={{
          width: '100%',
          height: 12,
          background: C.cardAlt,
          borderRadius: 6,
          overflow: 'hidden',
          border: `1px solid ${C.border}`,
          display: 'flex',
        }}>
          <div style={{
            width: `${buyPercent}%`,
            height: '100%',
            background: C.green,
            transition: 'width 0.3s ease',
          }} />
          <div style={{
            width: `${100 - buyPercent}%`,
            height: '100%',
            background: C.red,
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* Volume Details */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div>
          <p style={{ color: C.textMuted, fontSize: 11, margin: '0 0 4px 0' }}>BUY VOLUME</p>
          <p style={{ color: C.green, fontSize: 16, fontWeight: 600, margin: 0 }}>
            {(data.buyVolume / 1000000).toFixed(2)}M
          </p>
        </div>
        <div>
          <p style={{ color: C.textMuted, fontSize: 11, margin: '0 0 4px 0' }}>SELL VOLUME</p>
          <p style={{ color: C.red, fontSize: 16, fontWeight: 600, margin: 0 }}>
            {(data.sellVolume / 1000000).toFixed(2)}M
          </p>
        </div>
      </div>

      {/* Trade Intensity */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: C.textMuted, fontSize: 11 }}>TRADE INTENSITY</span>
          <span style={{ color: flowIntensityColor, fontSize: 11, fontWeight: 600 }}>
            {(data.intensity * 100).toFixed(0)}%
          </span>
        </div>
        <div style={{
          width: '100%',
          height: 6,
          background: C.cardAlt,
          borderRadius: 3,
          overflow: 'hidden',
          border: `1px solid ${C.border}`,
        }}>
          <div style={{
            width: `${data.intensity * 100}%`,
            height: '100%',
            background: flowIntensityColor,
            boxShadow: `0 0 8px ${flowIntensityColor}`,
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* Net Flow Indicator */}
      <div style={{
        padding: 12,
        background: C.cardAlt,
        borderRadius: 8,
        border: `1px solid ${C.border}`,
        textAlign: 'center',
      }}>
        <p style={{ color: C.textMuted, fontSize: 11, margin: '0 0 4px 0' }}>NET FLOW</p>
        <p style={{
          color: data.imbalance > 0 ? C.green : C.red,
          fontSize: 18,
          fontWeight: 700,
          margin: 0,
        }}>
          {data.imbalance > 0 ? '↑' : '↓'} {Math.abs(data.imbalance).toFixed(3)}
        </p>
        <p style={{
          color: data.imbalance > 0 ? C.green : C.red,
          fontSize: 11,
          margin: '4px 0 0 0',
        }}>
          {data.imbalance > 0 ? 'BULLISH DOMINANCE' : 'BEARISH DOMINANCE'}
        </p>
      </div>
    </div>
  );
};

// 4. Liquidity Heatmap
const LiquidityHeatmap: React.FC<{ symbol: string }> = ({ symbol }) => {
  const { data = mockHeatmap, isLoading, error } = useQuery({
    queryKey: ['heatmap', symbol],
    queryFn: () => fetch(`/api/microstructure/heatmap?symbol=${symbol}`).then(r => r.json()).catch(() => mockHeatmap),
  });

  const cellSize = 15;
  const cellPadding = 2;

  const volumeToColor = (volume: number) => {
    const ratio = volume / data.maxVolume;
    if (ratio < 0.2) return C.cardAlt; // Dark blue
    if (ratio < 0.4) return '#1a3a52'; // Deep blue
    if (ratio < 0.6) return '#0080ff'; // Cyan
    if (ratio < 0.8) return C.green; // Green
    return C.red; // Red for hottest
  };

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: 24,
      marginBottom: 24,
    }}>
      <h3 style={{ color: C.text, fontSize: 16, fontWeight: 600, margin: '0 0 16px 0' }}>
        Liquidity Heatmap (Last 20 Periods)
      </h3>

      <div style={{ overflowX: 'auto', marginBottom: 16 }}>
        <svg
          width={Math.max(20 * (cellSize + cellPadding), 400)}
          height={Math.max(20 * (cellSize + cellPadding), 300)}
          style={{ background: C.cardAlt, borderRadius: 8, border: `1px solid ${C.border}` }}
        >
          {/* Y-axis labels */}
          {Array.from({ length: 20 }).map((_, i) => (
            <text
              key={`y-label-${i}`}
              x={-10}
              y={i * (cellSize + cellPadding) + cellSize / 2 + 5}
              textAnchor="end"
              fill={C.textMuted}
              fontSize={9}
            >
              L{i + 1}
            </text>
          ))}

          {/* X-axis labels */}
          {Array.from({ length: 20 }).map((_, i) => (
            <text
              key={`x-label-${i}`}
              x={i * (cellSize + cellPadding) + cellSize / 2}
              y={20 * (cellSize + cellPadding) + 12}
              textAnchor="middle"
              fill={C.textMuted}
              fontSize={9}
            >
              {i}
            </text>
          ))}

          {/* Heatmap cells */}
          {data.cells.map((cell: any, idx: any) => (
            <rect
              key={`cell-${idx}`}
              x={cell.time * (cellSize + cellPadding) + 30}
              y={cell.price * (cellSize + cellPadding)}
              width={cellSize}
              height={cellSize}
              fill={volumeToColor(cell.volume)}
              stroke={C.border}
              strokeWidth={0.5}
              opacity={0.85}
            />
          ))}
        </svg>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, fontSize: 11, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ width: 12, height: 12, background: C.cardAlt, borderRadius: 2 }} />
          <span style={{ color: C.textMuted }}>Low</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ width: 12, height: 12, background: '#0080ff', borderRadius: 2 }} />
          <span style={{ color: C.textMuted }}>Medium</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ width: 12, height: 12, background: C.green, borderRadius: 2 }} />
          <span style={{ color: C.textMuted }}>High</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ width: 12, height: 12, background: C.red, borderRadius: 2 }} />
          <span style={{ color: C.textMuted }}>Extreme</span>
        </div>
      </div>
    </div>
  );
};

// 5. Imbalance Signals Feed
const ImbalanceSignalsFeed: React.FC<{ symbol: string }> = ({ symbol }) => {
  const { data = mockSignals, isLoading, error } = useQuery({
    queryKey: ['signals', symbol],
    queryFn: () => fetch(`/api/microstructure/signals?symbol=${symbol}`).then(r => r.json()).catch(() => mockSignals),
  });

  const signalTypeLabel = (type: string): string => {
    const map: Record<string, string> = {
      bid_heavy: 'Bid Heavy',
      ask_heavy: 'Ask Heavy',
      wall: 'Wall Detected',
      sweep: 'Sweep',
      absorption: 'Absorption',
    };
    return map[type] || type;
  };

  const signalTypeBg = (type: string): string => {
    const map: Record<string, string> = {
      bid_heavy: C.accent,
      ask_heavy: C.orange,
      wall: C.yellow,
      sweep: C.red,
      absorption: C.green,
    };
    return map[type] || C.border;
  };

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: 24,
      marginBottom: 24,
    }}>
      <h3 style={{ color: C.text, fontSize: 16, fontWeight: 600, margin: '0 0 16px 0' }}>
        Imbalance Signals Feed
      </h3>

      <div style={{ maxHeight: 500, overflowY: 'auto' }}>
        {data.signals.map((signal: any) => (
          <div
            key={signal.id}
            style={{
              padding: 12,
              background: C.cardAlt,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              marginBottom: 8,
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
            }}
          >
            {/* Direction Arrow */}
            <div style={{
              fontSize: 20,
              color: signal.direction === 'bullish' ? C.green : C.red,
              fontWeight: 700,
              minWidth: 30,
            }}>
              {signal.direction === 'bullish' ? '↑' : '↓'}
            </div>

            {/* Type Badge */}
            <div style={{
              padding: '2px 8px',
              background: signalTypeBg(signal.type),
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 600,
              color: '#000',
              minWidth: 'fit-content',
              marginTop: 2,
            }}>
              {signalTypeLabel(signal.type)}
            </div>

            {/* Content */}
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <p style={{ color: C.text, fontSize: 13, fontWeight: 600, margin: 0 }}>
                  ${signal.price.toFixed(2)}
                </p>
                <p style={{ color: C.textMuted, fontSize: 11, margin: 0 }}>
                  {new Date(signal.timestamp).toLocaleTimeString()}
                </p>
              </div>
              <p style={{ color: C.textDim, fontSize: 12, margin: '0 0 4px 0' }}>
                {signal.details}
              </p>

              {/* Strength Bar */}
              <div style={{
                width: '100%',
                height: 4,
                background: C.border,
                borderRadius: 2,
                overflow: 'hidden',
                marginTop: 6,
              }}>
                <div style={{
                  width: `${signal.strength * 100}%`,
                  height: '100%',
                  background: signal.direction === 'bullish' ? C.green : C.red,
                }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// 6. Slippage Estimator
const SlippageEstimator: React.FC<{ symbol: string }> = ({ symbol }) => {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [quantity, setQuantity] = useState<number>(100);
  const [selectedSymbol, setSelectedSymbol] = useState(symbol);

  const { data: slippageData, isLoading, error } = useQuery({
    queryKey: ['slippage', selectedSymbol, side, quantity],
    queryFn: () =>
      fetch(`/api/microstructure/slippage?symbol=${selectedSymbol}&side=${side}&quantity=${quantity}`)
        .then(r => r.json())
        .catch(() => ({
          slippageBps: Math.random() * 5 + 1,
          avgFillPrice: 189.45,
          liquidityScore: 0.85,
          levelsConsumed: Math.floor(Math.random() * 3) + 1,
          recommendation: ['proceed', 'split', 'delay', 'abort'][Math.floor(Math.random() * 4)] as any,
        })),
  });

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: 24,
    }}>
      <h3 style={{ color: C.text, fontSize: 16, fontWeight: 600, margin: '0 0 20px 0' }}>
        Slippage Estimator
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Symbol Selector */}
        <div>
          <label style={{ display: 'block', color: C.textMuted, fontSize: 11, marginBottom: 6, fontWeight: 500 }}>
            SYMBOL
          </label>
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            style={{
              width: '100%',
              padding: 8,
              background: C.cardAlt,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              color: C.text,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <option>AAPL</option>
            <option>NVDA</option>
            <option>TSLA</option>
            <option>BTC-USD</option>
          </select>
        </div>

        {/* Side Toggle */}
        <div>
          <label style={{ display: 'block', color: C.textMuted, fontSize: 11, marginBottom: 6, fontWeight: 500 }}>
            SIDE
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['buy', 'sell'].map((s) => (
              <button
                key={s}
                onClick={() => setSide(s as 'buy' | 'sell')}
                style={{
                  flex: 1,
                  padding: 8,
                  background: side === s ? C.accent : C.cardAlt,
                  border: `1px solid ${side === s ? C.borderFocus : C.border}`,
                  color: side === s ? C.bg : C.text,
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                {s.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Quantity Input */}
        <div>
          <label style={{ display: 'block', color: C.textMuted, fontSize: 11, marginBottom: 6, fontWeight: 500 }}>
            QUANTITY
          </label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            style={{
              width: '100%',
              padding: 8,
              background: C.cardAlt,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              color: C.text,
              fontSize: 13,
            }}
          />
        </div>
      </div>

      {/* Results Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <div style={{
          padding: 12,
          background: C.cardAlt,
          borderRadius: 8,
          border: `1px solid ${C.border}`,
        }}>
          <p style={{ color: C.textMuted, fontSize: 10, margin: '0 0 4px 0', fontWeight: 500 }}>SLIPPAGE</p>
          <p style={{ color: C.accent, fontSize: 18, fontWeight: 700, margin: 0 }}>
            {slippageData?.slippageBps.toFixed(2)}bps
          </p>
        </div>

        <div style={{
          padding: 12,
          background: C.cardAlt,
          borderRadius: 8,
          border: `1px solid ${C.border}`,
        }}>
          <p style={{ color: C.textMuted, fontSize: 10, margin: '0 0 4px 0', fontWeight: 500 }}>AVG FILL PRICE</p>
          <p style={{ color: C.text, fontSize: 18, fontWeight: 700, margin: 0 }}>
            ${slippageData?.avgFillPrice.toFixed(2)}
          </p>
        </div>

        <div style={{
          padding: 12,
          background: C.cardAlt,
          borderRadius: 8,
          border: `1px solid ${C.border}`,
        }}>
          <p style={{ color: C.textMuted, fontSize: 10, margin: '0 0 4px 0', fontWeight: 500 }}>LIQUIDITY SCORE</p>
          <p style={{ color: C.green, fontSize: 18, fontWeight: 700, margin: 0 }}>
            {(slippageData?.liquidityScore || 0).toFixed(2)}
          </p>
        </div>

        <div style={{
          padding: 12,
          background: C.cardAlt,
          borderRadius: 8,
          border: `1px solid ${C.border}`,
        }}>
          <p style={{ color: C.textMuted, fontSize: 10, margin: '0 0 4px 0', fontWeight: 500 }}>LEVELS CONSUMED</p>
          <p style={{ color: C.blue, fontSize: 18, fontWeight: 700, margin: 0 }}>
            {slippageData?.levelsConsumed}
          </p>
        </div>
      </div>

      {/* Recommendation Badge */}
      <div style={{
        padding: 16,
        background: C.cardAlt,
        border: `2px solid ${recommendationColor(slippageData?.recommendation || 'proceed')}`,
        borderRadius: 8,
        textAlign: 'center',
      }}>
        <p style={{ color: C.textMuted, fontSize: 11, margin: '0 0 6px 0' }}>RECOMMENDATION</p>
        <p style={{
          color: recommendationColor(slippageData?.recommendation || 'proceed'),
          fontSize: 16,
          fontWeight: 700,
          margin: 0,
          textTransform: 'uppercase',
        }}>
          {slippageData?.recommendation || 'proceed'}
        </p>
      </div>
    </div>
  );
};

// ============ MAIN PAGE ============

export default function MicrostructurePage() {
  const [symbol, setSymbol] = useState<string>('AAPL');

  return (
    <div style={{
      background: C.bg,
      minHeight: '100vh',
      padding: 24,
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{
            color: C.text,
            fontSize: 28,
            fontWeight: 700,
            margin: '0 0 8px 0',
          }}>
            Market Microstructure
          </h1>
          <p style={{
            color: C.textMuted,
            fontSize: 14,
            margin: 0,
          }}>
            Real-time order book analysis, liquidity metrics, and trade flow signals
          </p>

          {/* Symbol Selector */}
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            {['AAPL', 'NVDA', 'TSLA', 'BTC-USD'].map((sym) => (
              <button
                key={sym}
                onClick={() => setSymbol(sym)}
                style={{
                  padding: '8px 16px',
                  background: symbol === sym ? C.accent : C.card,
                  border: `1px solid ${symbol === sym ? C.borderFocus : C.border}`,
                  color: symbol === sym ? C.bg : C.text,
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                {sym}
              </button>
            ))}
          </div>
        </div>

        {/* Sections */}
        <MarketQualityBanner symbol={symbol} />
        <OrderBookDepth symbol={symbol} />
        <TradeFlowPanel symbol={symbol} />
        <LiquidityHeatmap symbol={symbol} />
        <ImbalanceSignalsFeed symbol={symbol} />
        <SlippageEstimator symbol={symbol} />
      </div>
    </div>
  );
}