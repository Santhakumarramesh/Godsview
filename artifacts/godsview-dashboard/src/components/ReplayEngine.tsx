/**
 * ReplayEngine.tsx  —  Phase 7
 *
 * Historical bar replay / training mode.
 * Fetches the last N bars and replays them candle-by-candle, showing:
 *   - Replay "candle" progress bar
 *   - Per-candle intelligence annotations in real time
 *   - Playback speed: 1× / 5× / 20× / Manual step
 *   - Pause / Play / Step Forward / Step Backward / Reset
 *   - The "live" price at each candle in the replay
 *   - Signal overlay (whether this candle would have triggered a signal)
 */

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

const BASE = "/api";
const C = {
  card: "#1a191b", border: "rgba(72,72,73,0.25)",
  primary: "#9cff93", secondary: "#669dff", tertiary: "#ff7162",
  muted: "#adaaab", outline: "#767576",
};

interface CandleBar {
  time: number; open: number; high: number; low: number; close: number; volume: number;
  imbalance: number; absorption: number; liquidity_strength: number; reversal_score: number;
  direction: "bull" | "bear"; is_doji: boolean; is_high_vol: boolean;
  is_absorption: boolean; is_reversal_signal: boolean;
}

interface IntelData {
  symbol: string; timeframe: string; bars: CandleBar[];
  summary: { total_bars: number; reversal_signals: number; absorption_zones: number; high_vol_events: number };
}

const SPEEDS: Array<{ label: string; ms: number }> = [
  { label: "Manual", ms: 0 },
  { label: "1×", ms: 1000 },
  { label: "5×", ms: 200 },
  { label: "20×", ms: 50 },
];

function CtrlBtn({ onClick, icon, title, active }: { onClick: () => void; icon: string; title: string; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: "30px", height: "30px", borderRadius: "4px",
        backgroundColor: active ? "rgba(156,255,147,0.12)" : "rgba(26,25,27,0.9)",
        border: `1px solid ${active ? "rgba(156,255,147,0.3)" : C.border}`,
        cursor: "pointer", color: active ? C.primary : C.muted,
        transition: "all 0.15s",
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>{icon}</span>
    </button>
  );
}

interface Props {
  symbol?:    string;
  timeframe?: string;
  barCount?:  number;
}

export default function ReplayEngine({ symbol = "BTCUSD", timeframe = "5Min", barCount = 100 }: Props) {
  const [speedIdx,  setSpeedIdx]  = useState(1);           // 1× by default
  const [cursor,    setCursor]    = useState(0);            // current bar index
  const [playing,   setPlaying]   = useState(false);
  const [loaded,    setLoaded]    = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data, isLoading, refetch } = useQuery<IntelData>({
    queryKey: ["replay-bars", symbol, timeframe, barCount],
    queryFn: () => fetch(`${BASE}/market/candle-intelligence?symbol=${symbol}&timeframe=${timeframe}&bars=${barCount}`).then((r) => r.json()),
    staleTime: Infinity,   // don't auto-refresh — user controls this
    enabled: loaded,
  });

  // Sorted oldest → newest for playback
  const bars = data?.bars ? [...data.bars].sort((a, b) => a.time - b.time) : [];
  const totalBars = bars.length;
  const currentBar = bars[cursor] ?? null;
  const speed = SPEEDS[speedIdx];

  // Playback timer
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (!playing || speed.ms === 0 || totalBars === 0) return;

    timerRef.current = setInterval(() => {
      setCursor((c) => {
        if (c >= totalBars - 1) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, speed.ms);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [playing, speed.ms, totalBars]);

  const play     = useCallback(() => setPlaying(true),  []);
  const pause    = useCallback(() => setPlaying(false), []);
  const stepFwd  = useCallback(() => { setPlaying(false); setCursor((c) => Math.min(c + 1, totalBars - 1)); }, [totalBars]);
  const stepBack = useCallback(() => { setPlaying(false); setCursor((c) => Math.max(c - 1, 0)); }, []);
  const reset    = useCallback(() => { setPlaying(false); setCursor(0); }, []);
  const goToEnd  = useCallback(() => { setPlaying(false); setCursor(Math.max(totalBars - 1, 0)); }, [totalBars]);

  const handleLoad = () => { setLoaded(true); refetch(); setCursor(0); setPlaying(false); };

  const progPct = totalBars > 0 ? (cursor / (totalBars - 1)) * 100 : 0;

  // Count events seen up to cursor
  const seenBars = bars.slice(0, cursor + 1);
  const reversalsSeen = seenBars.filter((b) => b.is_reversal_signal).length;
  const absorptionSeen = seenBars.filter((b) => b.is_absorption).length;
  const highVolSeen = seenBars.filter((b) => b.is_high_vol).length;

  return (
    <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: `1px solid rgba(72,72,73,0.15)` }}>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined" style={{ fontSize: "14px", color: C.secondary }}>play_circle</span>
          <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>
            Replay Engine · Phase 7 · {symbol} {timeframe}
          </span>
        </div>
        <button
          onClick={handleLoad}
          style={{
            fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
            padding: "4px 10px", borderRadius: "3px", cursor: "pointer",
            backgroundColor: "rgba(102,157,255,0.1)", border: `1px solid rgba(102,157,255,0.25)`, color: C.secondary,
          }}
        >
          {isLoading ? "Loading…" : loaded ? "↺ Reload" : "Load Bars"}
        </button>
      </div>

      {!loaded ? (
        <div className="p-10 text-center">
          <span className="material-symbols-outlined text-3xl mb-3 block" style={{ color: C.outline }}>play_circle</span>
          <p style={{ fontSize: "11px", color: C.muted, fontFamily: "Space Grotesk" }}>Click "Load Bars" to fetch the last {barCount} {timeframe} bars for replay</p>
          <p style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "6px" }}>Step through history · See per-candle intelligence · Practice reading market structure</p>
        </div>
      ) : isLoading ? (
        <div className="p-10 text-center">
          <span className="w-3 h-3 rounded-full animate-pulse inline-block mb-3" style={{ backgroundColor: C.secondary }} />
          <p style={{ fontSize: "11px", color: C.muted, fontFamily: "Space Grotesk" }}>Fetching {barCount} bars…</p>
        </div>
      ) : totalBars === 0 ? (
        <div className="p-8 text-center">
          <span style={{ fontSize: "11px", color: C.tertiary, fontFamily: "Space Grotesk" }}>No bars available. Market may be closed.</span>
        </div>
      ) : (
        <div className="p-4 space-y-4">
          {/* ── Progress bar ─────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span style={{ fontSize: "8px", color: C.outline, fontFamily: "Space Grotesk" }}>
                Bar {cursor + 1} of {totalBars}
              </span>
              <span style={{ fontSize: "8px", color: C.muted, fontFamily: "JetBrains Mono, monospace" }}>
                {currentBar ? new Date(currentBar.time * 1000).toLocaleString() : "—"}
              </span>
            </div>
            <div
              style={{ height: "6px", borderRadius: "3px", backgroundColor: "rgba(72,72,73,0.3)", cursor: "pointer", position: "relative" }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pct  = (e.clientX - rect.left) / rect.width;
                setCursor(Math.round(pct * (totalBars - 1)));
                setPlaying(false);
              }}
            >
              <div style={{ width: `${progPct}%`, height: "100%", backgroundColor: C.secondary, borderRadius: "3px", transition: speed.ms > 0 ? "width 0.05s" : "none" }} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* ── Current candle detail ─────────────────────────────── */}
            {currentBar && (
              <div className="rounded p-4 space-y-3" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${currentBar.is_reversal_signal ? "rgba(232,121,249,0.25)" : currentBar.is_absorption ? "rgba(251,146,60,0.2)" : C.border}` }}>
                {/* OHLCV */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded font-bold" style={{ fontSize: "9px", fontFamily: "Space Grotesk", backgroundColor: currentBar.direction === "bull" ? "rgba(156,255,147,0.12)" : "rgba(255,113,98,0.12)", color: currentBar.direction === "bull" ? C.primary : C.tertiary }}>
                    {currentBar.direction.toUpperCase()}
                  </span>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "13px", fontWeight: 700, color: "#fff" }}>
                    ${currentBar.close > 100 ? currentBar.close.toFixed(2) : currentBar.close.toFixed(6)}
                  </span>
                  {currentBar.is_reversal_signal && (
                    <span style={{ fontSize: "8px", color: "#e879f9", fontFamily: "Space Grotesk", fontWeight: 700 }}>● REVERSAL SIGNAL</span>
                  )}
                  {currentBar.is_absorption && !currentBar.is_reversal_signal && (
                    <span style={{ fontSize: "8px", color: "#fb923c", fontFamily: "Space Grotesk", fontWeight: 700 }}>● ABSORPTION</span>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {[
                    { l: "O", v: currentBar.open.toFixed(currentBar.open > 100 ? 2 : 5), c: C.outline },
                    { l: "H", v: currentBar.high.toFixed(currentBar.high > 100 ? 2 : 5), c: C.primary },
                    { l: "L", v: currentBar.low.toFixed(currentBar.low > 100 ? 2 : 5), c: C.tertiary },
                    { l: "C", v: currentBar.close.toFixed(currentBar.close > 100 ? 2 : 5), c: "#fff" },
                  ].map((ohlc) => (
                    <div key={ohlc.l}>
                      <div style={{ fontSize: "7px", color: C.outline, fontFamily: "Space Grotesk" }}>{ohlc.l}</div>
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "8px", color: ohlc.c }}>{ohlc.v}</div>
                    </div>
                  ))}
                </div>

                {/* Intelligence metrics */}
                {[
                  { label: "Imbalance", value: currentBar.imbalance, color: currentBar.imbalance > 0 ? C.primary : C.tertiary, note: Math.abs(currentBar.imbalance) > 0.5 ? "strong" : currentBar.is_doji ? "doji" : "mild" },
                  { label: "Absorption", value: currentBar.absorption, color: currentBar.is_absorption ? "#fb923c" : C.secondary, note: currentBar.is_absorption ? "absorbing" : "clear" },
                  { label: "Liq Strength", value: Math.min(currentBar.liquidity_strength / 3, 1), color: currentBar.is_high_vol ? "#fbbf24" : C.secondary, note: `${currentBar.liquidity_strength.toFixed(1)}×` },
                  { label: "Rev Score", value: currentBar.reversal_score, color: currentBar.is_reversal_signal ? "#e879f9" : C.outline, note: `${Math.round(currentBar.reversal_score * 100)}%` },
                ].map((metric) => (
                  <div key={metric.label}>
                    <div className="flex justify-between mb-0.5">
                      <span style={{ fontSize: "7px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.1em", textTransform: "uppercase" }}>{metric.label}</span>
                      <span style={{ fontSize: "7px", color: metric.color, fontFamily: "Space Grotesk" }}>{metric.note}</span>
                    </div>
                    <div style={{ height: "3px", borderRadius: "2px", backgroundColor: "rgba(72,72,73,0.3)" }}>
                      <div style={{ width: `${Math.round(Math.abs(metric.value) * 100)}%`, height: "100%", backgroundColor: metric.color, borderRadius: "2px" }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Controls + Session stats ──────────────────────────── */}
            <div className="space-y-3">
              {/* Transport controls */}
              <div className="flex items-center gap-2">
                <CtrlBtn onClick={reset}    icon="first_page"    title="Reset to start" />
                <CtrlBtn onClick={stepBack} icon="skip_previous" title="Step back" />
                {playing
                  ? <CtrlBtn onClick={pause} icon="pause"  title="Pause" active />
                  : <CtrlBtn onClick={play}  icon="play_arrow" title="Play" />}
                <CtrlBtn onClick={stepFwd} icon="skip_next"  title="Step forward" />
                <CtrlBtn onClick={goToEnd} icon="last_page"  title="Go to latest" />
              </div>

              {/* Speed selector */}
              <div>
                <div style={{ fontSize: "8px", color: C.outline, fontFamily: "Space Grotesk", marginBottom: "6px", letterSpacing: "0.1em", textTransform: "uppercase" }}>Playback Speed</div>
                <div className="flex gap-1.5">
                  {SPEEDS.map((s, i) => (
                    <button
                      key={s.label}
                      onClick={() => { setSpeedIdx(i); if (s.ms === 0) setPlaying(false); }}
                      style={{
                        fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, padding: "4px 8px", borderRadius: "3px", cursor: "pointer",
                        backgroundColor: speedIdx === i ? "rgba(102,157,255,0.12)" : "transparent",
                        color: speedIdx === i ? C.secondary : C.outline,
                        border: `1px solid ${speedIdx === i ? "rgba(102,157,255,0.3)" : C.border}`,
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Keyboard hint */}
              <div style={{ fontSize: "8px", color: C.outline, fontFamily: "Space Grotesk" }}>
                Click progress bar to jump · Manual = arrow keys only
              </div>

              {/* Session running stats */}
              <div className="rounded p-3 space-y-2" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: "8px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "6px" }}>
                  Events Seen (bar 1–{cursor + 1})
                </div>
                {[
                  { label: "Reversal Signals", value: reversalsSeen, total: data.summary.reversal_signals, color: "#e879f9" },
                  { label: "Absorption Zones", value: absorptionSeen, total: data.summary.absorption_zones, color: "#fb923c" },
                  { label: "High Volume Bars", value: highVolSeen,    total: data.summary.high_vol_events,  color: "#fbbf24" },
                ].map((stat) => (
                  <div key={stat.label} className="flex items-center justify-between">
                    <span style={{ fontSize: "8px", color: C.muted, fontFamily: "Space Grotesk" }}>{stat.label}</span>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "9px", color: stat.color }}>
                      {stat.value} <span style={{ color: C.outline }}>/ {stat.total}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
