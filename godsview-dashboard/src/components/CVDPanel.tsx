import { useEffect, useRef, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart,
  CartesianGrid, Cell, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";

const C = {
  primary:   "#9cff93",
  secondary: "#669dff",
  tertiary:  "#ff7162",
  bg:        "#0e0e0f",
  card:      "#1a191b",
  border:    "rgba(72,72,73,0.25)",
  muted:     "#adaaab",
  bull:      "#9cff93",
  bear:      "#ff7162",
  exhaust:   "#f0a500",
  ranging:   "#669dff",
  diverg:    "#e879f9",
};

const BASE = "/api";

interface CvdBar {
  time: number;
  open: number;
  close: number;
  volume: number;
  delta: number;
  cum_delta: number;
  rel_vol: number;
  direction: "bull" | "bear";
}

interface CvdResponse {
  symbol: string;
  timeframe: string;
  bars: CvdBar[];
  regime: string;
  divergence: string | null;
  cvd_total: number;
  cvd_slope_20: number;
  bull_pct_20: number;
  avg_volume: number;
}

function regimeLabel(regime: string) {
  switch (regime) {
    case "bull_trend":       return { label: "BULL TREND",       color: C.bull };
    case "bear_trend":       return { label: "BEAR TREND",       color: C.bear };
    case "ranging":          return { label: "RANGING",          color: C.ranging };
    case "bull_exhaustion":  return { label: "BULL EXHAUSTION",  color: C.exhaust };
    case "bear_exhaustion":  return { label: "BEAR EXHAUSTION",  color: C.exhaust };
    case "transitioning":    return { label: "TRANSITIONING",    color: C.muted };
    default:                 return { label: regime.toUpperCase(), color: C.muted };
  }
}

function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700,
      color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase",
    }}>
      {children}
    </span>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <div style={{
        fontFamily: "JetBrains Mono", fontSize: "13px", fontWeight: 700,
        color: color ?? "#ffffff", marginTop: "2px",
      }}>
        {value}
      </div>
    </div>
  );
}

function fmtDelta(v: number) {
  if (Math.abs(v) >= 1) return v.toFixed(4);
  return v.toFixed(6);
}

function fmtTime(unix: number) {
  const d = new Date(unix * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export interface CVDPanelProps {
  symbol?: string;
  timeframe?: string;
  bars?: number;
  autoRefresh?: number;
}

export default function CVDPanel({
  symbol    = "BTCUSD",
  timeframe = "5Min",
  bars      = 100,
  autoRefresh = 30,
}: CVDPanelProps) {
  const [data, setData]       = useState<CvdResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetch_() {
    try {
      setLoading(true);
      const r = await fetch(
        `${BASE}/market/cvd?symbol=${symbol}&timeframe=${timeframe}&bars=${bars}`
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json: CvdResponse = await r.json();
      setData(json);
      setLastFetch(new Date());
      setErr(null);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetch_();
    timerRef.current = setInterval(fetch_, autoRefresh * 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [symbol, timeframe, bars]);

  const regime = data ? regimeLabel(data.regime) : null;
  const chartData = data?.bars.slice(-60) ?? [];
  const minCD = Math.min(...chartData.map((b) => b.cum_delta));
  const maxCD = Math.max(...chartData.map((b) => b.cum_delta));

  return (
    <div style={{
      backgroundColor: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: "8px",
      padding: "16px",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "14px", color: C.secondary }}>
            show_chart
          </span>
          <MicroLabel>CVD · Cumulative Volume Delta · {symbol} {timeframe}</MicroLabel>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {data?.divergence && (
            <span style={{
              fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700,
              color: C.diverg, letterSpacing: "0.12em",
              padding: "2px 8px", borderRadius: "4px",
              border: `1px solid ${C.diverg}40`,
              backgroundColor: `${C.diverg}10`,
            }}>
              {data.divergence === "bearish_divergence" ? "⚠ BEARISH DIV" : "⚠ BULLISH DIV"}
            </span>
          )}
          {regime && (
            <span style={{
              fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700,
              color: regime.color, letterSpacing: "0.12em",
              padding: "2px 10px", borderRadius: "4px",
              border: `1px solid ${regime.color}40`,
              backgroundColor: `${regime.color}10`,
            }}>
              {regime.label}
            </span>
          )}
          <button
            onClick={fetch_}
            style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, padding: "0" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>refresh</span>
          </button>
        </div>
      </div>

      {/* Stats row */}
      {data && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
          gap: "12px", marginBottom: "16px",
        }}>
          <Stat
            label="CVD Total"
            value={fmtDelta(data.cvd_total)}
            color={data.cvd_total >= 0 ? C.bull : C.bear}
          />
          <Stat
            label="Slope 20"
            value={(data.cvd_slope_20 >= 0 ? "+" : "") + fmtDelta(data.cvd_slope_20)}
            color={data.cvd_slope_20 >= 0 ? C.bull : C.bear}
          />
          <Stat
            label="Bull % (20)"
            value={`${data.bull_pct_20}%`}
            color={data.bull_pct_20 >= 55 ? C.bull : data.bull_pct_20 <= 45 ? C.bear : C.muted}
          />
          <Stat
            label="Avg Volume"
            value={data.avg_volume < 0.001 ? data.avg_volume.toFixed(6) : data.avg_volume.toFixed(4)}
            color={C.muted}
          />
        </div>
      )}

      {loading && !data && (
        <div style={{
          height: "180px", display: "flex", alignItems: "center", justifyContent: "center",
          color: C.muted,
        }}>
          <MicroLabel>Loading CVD...</MicroLabel>
        </div>
      )}

      {err && (
        <div style={{ color: C.bear, fontSize: "11px", fontFamily: "JetBrains Mono" }}>
          {err}
        </div>
      )}

      {/* Cumulative Delta line chart */}
      {data && chartData.length > 0 && (
        <>
          <div style={{ marginBottom: "4px" }}>
            <MicroLabel>Cumulative Delta Line</MicroLabel>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="cvdGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.bull} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={C.bull} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="cvdRed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.bear} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={C.bear} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis
                dataKey="time"
                tickFormatter={fmtTime}
                tick={{ fontSize: 9, fill: C.muted, fontFamily: "JetBrains Mono" }}
                tickLine={false}
                axisLine={false}
                interval={Math.floor(chartData.length / 5)}
              />
              <YAxis
                domain={[minCD * 1.05, maxCD * 1.05]}
                tick={{ fontSize: 9, fill: C.muted, fontFamily: "JetBrains Mono" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => fmtDelta(v)}
                width={60}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: C.card, border: `1px solid ${C.border}`,
                  borderRadius: "6px", fontSize: "10px", fontFamily: "JetBrains Mono",
                }}
                formatter={(value: number) => [fmtDelta(value), "CVD"]}
                labelFormatter={(label) => fmtTime(Number(label))}
              />
              <Area
                type="monotone"
                dataKey="cum_delta"
                stroke={data.cvd_total >= 0 ? C.bull : C.bear}
                strokeWidth={1.5}
                fill={data.cvd_total >= 0 ? "url(#cvdGreen)" : "url(#cvdRed)"}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>

          {/* Per-bar delta histogram */}
          <div style={{ marginTop: "12px", marginBottom: "4px" }}>
            <MicroLabel>Per-Bar Delta Histogram</MicroLabel>
          </div>
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={chartData} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
              <XAxis hide />
              <YAxis hide />
              <Tooltip
                contentStyle={{
                  backgroundColor: C.card, border: `1px solid ${C.border}`,
                  borderRadius: "6px", fontSize: "10px", fontFamily: "JetBrains Mono",
                }}
                formatter={(value: number) => [fmtDelta(value), "Delta"]}
                labelFormatter={(label) => fmtTime(Number(label))}
              />
              <Bar dataKey="delta" isAnimationActive={false}>
                {chartData.map((bar, i) => (
                  <Cell
                    key={i}
                    fill={bar.delta >= 0 ? `${C.bull}99` : `${C.bear}99`}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Timestamp */}
          {lastFetch && (
            <div style={{ marginTop: "8px", textAlign: "right" }}>
              <MicroLabel>
                {chartData.length} bars · refreshed {lastFetch.toLocaleTimeString()} · auto {autoRefresh}s
              </MicroLabel>
            </div>
          )}
        </>
      )}
    </div>
  );
}
