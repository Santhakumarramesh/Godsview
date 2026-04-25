import { useQuery } from '@tanstack/react-query';

const API_BASE = import.meta.env.VITE_API_URL || '/api/signal-engine';

interface C4Direction {
  total_score: number;
  decision: string;
  c1_context: { total: number; bos_choch: number; order_block: number; sweep_zone: number };
  c2_confirmation: { total: number; retest: number; rejection: number; close_confirms: number };
  c3_commitment: { total: number; delta: number; cvd: number; volume: number; imbalance: number; absorption: number };
  c4_control: { total: number; risk_reward: number; sl_quality: number; risk_gate: number };
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  risk_reward: number;
  confirmations: string[];
  warnings: string[];
}

interface C4SymbolData {
  timeframe: string;
  price: number;
  directions: { long?: C4Direction; short?: C4Direction };
  c4_threshold: number;
  watchlist_threshold: number;
  data_type: string;
  error?: string;
}

function decisionColor(decision: string) {
  if (decision === 'PAPER_TRADE') return '#00ff88';
  if (decision === 'WATCHLIST') return '#ffaa00';
  return '#ff4466';
}

function scoreColor(score: number, max: number) {
  const pct = score / max;
  if (pct >= 0.8) return '#00ff88';
  if (pct >= 0.6) return '#44ddff';
  if (pct >= 0.4) return '#ffaa00';
  return '#ff4466';
}

function C4Bar({ label, score, max }: { label: string; score: number; max: number }) {
  const pct = Math.min(100, (score / max) * 100);
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#aaa', marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ color: scoreColor(score, max) }}>{score.toFixed(1)}/{max}</span>
      </div>
      <div style={{ background: '#1a1a3a', borderRadius: 4, height: 8, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: `linear-gradient(90deg, ${scoreColor(score, max)}88, ${scoreColor(score, max)})`,
          borderRadius: 4, transition: 'width 0.5s ease'
        }} />
      </div>
    </div>
  );
}

function C4Checklist({ dir }: { dir: C4Direction }) {
  const items = [
    { label: 'C1 Context', score: dir.c1_context.total, max: 25,
      subs: [`BOS/CHOCH: ${dir.c1_context.bos_choch.toFixed(1)}`, `OB: ${dir.c1_context.order_block.toFixed(1)}`, `Sweep: ${dir.c1_context.sweep_zone.toFixed(1)}`] },
    { label: 'C2 Confirmation', score: dir.c2_confirmation.total, max: 25,
      subs: [`Retest: ${dir.c2_confirmation.retest.toFixed(1)}`, `Rejection: ${dir.c2_confirmation.rejection.toFixed(1)}`, `Close: ${dir.c2_confirmation.close_confirms.toFixed(1)}`] },
    { label: 'C3 Commitment', score: dir.c3_commitment.total, max: 25,
      subs: [`Delta: ${dir.c3_commitment.delta.toFixed(1)}`, `CVD: ${dir.c3_commitment.cvd.toFixed(1)}`, `Vol: ${dir.c3_commitment.volume.toFixed(1)}`, `Imb: ${dir.c3_commitment.imbalance.toFixed(1)}`, `Abs: ${dir.c3_commitment.absorption.toFixed(1)}`] },
    { label: 'C4 Control', score: dir.c4_control.total, max: 25,
      subs: [`RR: ${dir.c4_control.risk_reward.toFixed(1)}`, `SL: ${dir.c4_control.sl_quality.toFixed(1)}`, `Gate: ${dir.c4_control.risk_gate.toFixed(1)}`] },
  ];

  return (
    <div>
      {items.map((item, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          <C4Bar label={item.label} score={item.score} max={item.max} />
          <div style={{ fontSize: 10, color: '#666', paddingLeft: 8 }}>{item.subs.join(' | ')}</div>
        </div>
      ))}
    </div>
  );
}

function DirectionCard({ symbol, direction, dir }: { symbol: string; direction: string; dir: C4Direction }) {
  const isLong = direction === 'long';
  const arrow = isLong ? '▲' : '▼';
  const dirColor = isLong ? '#00ff88' : '#ff4466';

  return (
    <div style={{
      background: '#0d0d2b', border: `1px solid ${decisionColor(dir.decision)}33`,
      borderRadius: 12, padding: 16, marginBottom: 12
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: dirColor, fontSize: 20 }}>{arrow}</span>
          <span style={{ color: '#fff', fontSize: 16, fontWeight: 700 }}>{direction.toUpperCase()}</span>
        </div>
        <div style={{
          background: `${decisionColor(dir.decision)}22`,
          border: `1px solid ${decisionColor(dir.decision)}`,
          borderRadius: 8, padding: '4px 12px', fontSize: 13, fontWeight: 700,
          color: decisionColor(dir.decision)
        }}>
          {dir.decision} — {dir.total_score.toFixed(0)}/100
        </div>
      </div>

      {/* Big score gauge */}
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 40, fontWeight: 800, color: decisionColor(dir.decision) }}>
          {dir.total_score.toFixed(0)}
        </div>
        <div style={{ fontSize: 11, color: '#666' }}>C4 Score</div>
      </div>

      {/* C1-C4 checklist */}
      <C4Checklist dir={dir} />

      {/* Trade levels */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
        gap: 8, marginTop: 12, padding: 8,
        background: '#0a0a1f', borderRadius: 8
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#888' }}>Entry</div>
          <div style={{ fontSize: 12, color: '#fff', fontFamily: 'monospace' }}>{dir.entry_price.toFixed(2)}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#888' }}>SL</div>
          <div style={{ fontSize: 12, color: '#ff4466', fontFamily: 'monospace' }}>{dir.stop_loss.toFixed(2)}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#888' }}>TP</div>
          <div style={{ fontSize: 12, color: '#00ff88', fontFamily: 'monospace' }}>{dir.take_profit.toFixed(2)}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#888' }}>R:R</div>
          <div style={{ fontSize: 12, color: dir.risk_reward >= 2 ? '#00ff88' : '#ffaa00', fontFamily: 'monospace' }}>
            {dir.risk_reward.toFixed(1)}:1
          </div>
        </div>
      </div>

      {/* Confirmations / Warnings */}
      {dir.confirmations.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {dir.confirmations.map((c, i) => (
            <div key={i} style={{ fontSize: 11, color: '#00ff88', padding: '2px 0' }}>✓ {c}</div>
          ))}
        </div>
      )}
      {dir.warnings.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {dir.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: '#ff8844', padding: '2px 0' }}>⚠ {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function SymbolC4Card({ symbol, data }: { symbol: string; data: C4SymbolData }) {
  if (data.error) {
    return (
      <div style={{ background: '#0d0d2b', borderRadius: 12, padding: 16, border: '1px solid #333' }}>
        <h3 style={{ color: '#fff', margin: 0 }}>{symbol}</h3>
        <p style={{ color: '#ff4466' }}>Error: {data.error}</p>
      </div>
    );
  }

  return (
    <div style={{ background: '#0a0a1a', borderRadius: 12, padding: 16, border: '1px solid #1a1a3a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h3 style={{ color: '#fff', margin: 0, fontSize: 18 }}>{symbol}</h3>
          <span style={{ fontSize: 12, color: '#888' }}>{data.timeframe} | ${data.price?.toFixed(2)}</span>
        </div>
        <div style={{
          background: '#1a1a3a', borderRadius: 6, padding: '2px 8px',
          fontSize: 10, color: '#ff8844', alignSelf: 'flex-start'
        }}>
          {data.data_type}
        </div>
      </div>

      {data.directions?.long && (
        <DirectionCard symbol={symbol} direction="long" dir={data.directions.long} />
      )}
      {data.directions?.short && (
        <DirectionCard symbol={symbol} direction="short" dir={data.directions.short} />
      )}
    </div>
  );
}

export default function C4StrategyPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['c4-strategy'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/c4-strategy`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<Record<string, C4SymbolData>>;
    },
    refetchInterval: 30000,
  });

  return (
    <div style={{ padding: 24, background: '#050510', minHeight: '100vh' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ color: '#fff', fontSize: 24, fontWeight: 800, margin: 0 }}>
          C4 Order Flow Strategy
        </h1>
        <p style={{ color: '#888', fontSize: 13, margin: '4px 0 0' }}>
          C1 Context + C2 Confirmation + C3 Commitment + C4 Control = TRADE
        </p>
        <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12 }}>
          <span style={{ color: '#00ff88' }}>● ≥80 PAPER TRADE</span>
          <span style={{ color: '#ffaa00' }}>● 65-79 WATCHLIST</span>
          <span style={{ color: '#ff4466' }}>● &lt;65 REJECT</span>
        </div>
      </div>

      {isLoading && <p style={{ color: '#888' }}>Loading C4 analysis...</p>}
      {error && <p style={{ color: '#ff4466' }}>Error: {(error as Error).message}</p>}

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16 }}>
          {Object.entries(data).map(([symbol, symbolData]) => (
            <SymbolC4Card key={symbol} symbol={symbol} data={symbolData} />
          ))}
        </div>
      )}
    </div>
  );
}
