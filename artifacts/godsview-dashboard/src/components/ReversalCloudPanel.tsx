/**
 * ReversalCloudPanel.tsx  —  Phase 5
 *
 * Visual "reversal cloud" overlay for the SK structure.
 * Renders a horizontal price ladder with:
 *  • Bull zone cloud  (near swing low  — potential long reversal)
 *  • Bear zone cloud  (near swing high — potential short reversal)
 *  • Current price line
 *  • ATR zone bands
 *  • Probability bars for each zone
 */

import { useMemo } from "react";

const C = {
  card: "#1a191b", border: "rgba(72,72,73,0.25)",
  primary: "#9cff93", secondary: "#669dff", tertiary: "#ff7162",
  muted: "#adaaab", outline: "#767576",
};

interface SKFeatures {
  bias?: string;
  swing_high?: number;
  swing_low?: number;
  current_price?: number;
  htf_high?: number;
  htf_low?: number;
  atr?: number;
  impulse_strength?: number;
  correction_complete?: boolean;
  zone_distance_atr?: number;
}

interface CVDFeatures {
  cvd_slope?: string;
  delta_momentum?: string;
  multi_tf_align?: boolean;
}

interface Props {
  sk?: SKFeatures | null;
  cvd?: CVDFeatures | null;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.18em", textTransform: "uppercase", color: C.outline }}>
      {children}
    </span>
  );
}

function fmt(v: number) {
  return v > 1000 ? v.toFixed(2) : v.toFixed(4);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export default function ReversalCloudPanel({ sk, cvd }: Props) {
  if (!sk) {
    return (
      <div className="rounded p-6 text-center" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <span style={{ fontSize: "11px", color: C.outline, fontFamily: "Space Grotesk" }}>Run a scan to see the reversal cloud.</span>
      </div>
    );
  }

  const {
    bias = "neutral",
    swing_high,
    swing_low,
    current_price,
    atr = 50,
    impulse_strength = 0.5,
    correction_complete = false,
    zone_distance_atr = 1,
  } = sk;

  const cvdBull = cvd?.delta_momentum === "bullish" || cvd?.cvd_slope === "rising";
  const cvdBear = cvd?.delta_momentum === "bearish" || cvd?.cvd_slope === "falling";
  const multiAlign = cvd?.multi_tf_align ?? false;

  // ── Derived values ─────────────────────────────────────────────────────
  const swHigh = swing_high ?? (current_price ? current_price * 1.015 : null);
  const swLow  = swing_low  ?? (current_price ? current_price * 0.985 : null);
  const price  = current_price ?? ((swHigh && swLow) ? (swHigh + swLow) / 2 : null);

  // ── SVG price ladder ───────────────────────────────────────────────────
  const { priceRange, zones } = useMemo(() => {
    if (!price || !swHigh || !swLow) return { priceRange: null, zones: [] };

    const rangePad = Math.max(swHigh - swLow, atr * 4) * 0.1;
    const top    = swHigh + rangePad + atr * 0.5;
    const bottom = swLow  - rangePad - atr * 0.5;
    const span   = top - bottom;

    const yOf = (p: number) => ((top - p) / span) * 100; // % from top

    // Bull zone: swing_low ± 0.5 ATR
    const bullTop    = swLow + atr * 0.5;
    const bullBottom = swLow - atr * 0.5;

    // Bear zone: swing_high ± 0.5 ATR
    const bearTop    = swHigh + atr * 0.5;
    const bearBottom = swHigh - atr * 0.5;

    // Zone probability
    const distToLow  = price ? Math.abs(price - swLow)  / atr : 99;
    const distToHigh = price ? Math.abs(price - swHigh) / atr : 99;

    const bullProb = Math.max(0, Math.min(1, 1 - distToLow  / 3)) *
      (bias === "bull" ? 1.3 : bias === "bear" ? 0.5 : 1) *
      (correction_complete ? 1.4 : 1) *
      (cvdBull ? 1.2 : 1) *
      (multiAlign ? 1.15 : 1);

    const bearProb = Math.max(0, Math.min(1, 1 - distToHigh / 3)) *
      (bias === "bear" ? 1.3 : bias === "bull" ? 0.5 : 1) *
      (cvdBear ? 1.2 : 1) *
      (multiAlign ? 1.15 : 1);

    return {
      priceRange: { top, bottom, span, yOf },
      zones: [
        {
          label: "Bull Reversal Zone",
          color: C.primary,
          yTop:    Math.min(yOf(bullTop), 95),
          yBottom: Math.min(yOf(bullBottom), 99),
          prob:    Math.min(bullProb, 1),
          price:   swLow,
          active:  distToLow < 1.5,
          side:    "long" as const,
        },
        {
          label: "Bear Reversal Zone",
          color: C.tertiary,
          yTop:    Math.max(yOf(bearTop), 1),
          yBottom: Math.max(yOf(bearBottom), 5),
          prob:    Math.min(bearProb, 1),
          price:   swHigh,
          active:  distToHigh < 1.5,
          side:    "short" as const,
        },
      ],
    };
  }, [price, swHigh, swLow, atr, bias, correction_complete, cvdBull, cvdBear, multiAlign]);

  if (!priceRange || !price || !swHigh || !swLow) {
    return (
      <div className="rounded p-6 text-center" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <span style={{ fontSize: "11px", color: C.outline, fontFamily: "Space Grotesk" }}>Insufficient SK data for cloud rendering.</span>
      </div>
    );
  }

  const priceYpct = priceRange.yOf(price);

  return (
    <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: `1px solid rgba(72,72,73,0.15)` }}>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined" style={{ fontSize: "14px", color: "#a78bfa" }}>cloud</span>
          <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>
            Reversal Cloud · Phase 5
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: bias === "bull" ? C.primary : bias === "bear" ? C.tertiary : C.outline }}>
            {bias.toUpperCase()} BIAS
          </span>
          {correction_complete && (
            <span className="px-1.5 py-0.5 rounded" style={{ fontSize: "7px", fontFamily: "Space Grotesk", color: C.primary, backgroundColor: "rgba(156,255,147,0.1)", border: `1px solid rgba(156,255,147,0.2)` }}>
              CORRECTION ✓
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-0" style={{ padding: "16px", gap: "16px" }}>
        {/* ── SVG Price Ladder ──────────────────────────────────────────── */}
        <div className="md:col-span-2">
          <div style={{ position: "relative", height: "220px", userSelect: "none" }}>
            <svg width="100%" height="100%" viewBox="0 0 400 220" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
              <defs>
                <linearGradient id="bullGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={C.primary} stopOpacity="0.18" />
                  <stop offset="100%" stopColor={C.primary} stopOpacity="0.04" />
                </linearGradient>
                <linearGradient id="bearGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={C.tertiary} stopOpacity="0.18" />
                  <stop offset="100%" stopColor={C.tertiary} stopOpacity="0.04" />
                </linearGradient>
                <filter id="glow-green">
                  <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                  <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
                <filter id="glow-red">
                  <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                  <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              {/* Grid lines */}
              {[0, 25, 50, 75, 100].map((pct) => (
                <line key={pct} x1={0} y1={`${pct}%`} x2={400} y2={`${pct}%`}
                  stroke="rgba(72,72,73,0.15)" strokeWidth="1" strokeDasharray="4,4" />
              ))}

              {/* Zone clouds */}
              {zones.map((z) => {
                const y1 = z.yTop;
                const y2 = z.yBottom;
                const heightPct = Math.max(y2 - y1, 2);
                return (
                  <g key={z.label}>
                    {/* Cloud fill */}
                    <rect
                      x="0" y={`${y1}%`} width="100%" height={`${heightPct}%`}
                      fill={z.side === "long" ? "url(#bullGrad)" : "url(#bearGrad)"}
                    />
                    {/* Border lines */}
                    <line x1={0} y1={`${y1}%`} x2={400} y2={`${y1}%`}
                      stroke={z.color} strokeWidth="1" strokeDasharray="6,3" opacity="0.5" />
                    <line x1={0} y1={`${y2}%`} x2={400} y2={`${y2}%`}
                      stroke={z.color} strokeWidth="1" strokeDasharray="6,3" opacity="0.5" />
                    {/* Zone label */}
                    <text x={8} y={`${(y1 + y2) / 2 + 0.5}%`}
                      fill={z.color} fontSize="7" fontFamily="Space Grotesk" letterSpacing="1" opacity="0.8">
                      {z.label.toUpperCase()}
                    </text>
                    {/* Probability bar on right */}
                    <rect x={370} y={`${y1 + 1}%`} width={Math.round(z.prob * 28)} height={`${heightPct - 2}%`}
                      fill={z.color} opacity="0.25" rx="1" />
                    {z.active && (
                      <circle cx={395} cy={`${(y1 + y2) / 2}%`} r="4"
                        fill={z.color} filter={z.side === "long" ? "url(#glow-green)" : "url(#glow-red)"} opacity="0.9" />
                    )}
                  </g>
                );
              })}

              {/* Current price line */}
              <line x1={0} y1={`${priceYpct}%`} x2={400} y2={`${priceYpct}%`}
                stroke="#ffffff" strokeWidth="1.5" strokeDasharray="8,4" opacity="0.7" />
              <rect x={320} y={`${priceYpct - 2}%`} width={80} height="14"
                fill="#1a191b" rx="2" />
              <text x={324} y={`${priceYpct + 0.8}%`}
                fill="#ffffff" fontSize="8" fontFamily="JetBrains Mono, monospace" fontWeight="bold">
                ${fmt(price)}
              </text>

              {/* Swing High / Low labels */}
              <text x={8} y={`${priceRange.yOf(swHigh) - 1}%`}
                fill={C.tertiary} fontSize="7" fontFamily="Space Grotesk" letterSpacing="0.5" opacity="0.7">
                SW HIGH ${fmt(swHigh)}
              </text>
              <text x={8} y={`${priceRange.yOf(swLow) + 2.5}%`}
                fill={C.primary} fontSize="7" fontFamily="Space Grotesk" letterSpacing="0.5" opacity="0.7">
                SW LOW ${fmt(swLow)}
              </text>
            </svg>
          </div>
        </div>

        {/* ── Zone Detail Cards ──────────────────────────────────────────── */}
        <div className="flex flex-col gap-2 justify-center">
          {zones.map((z) => (
            <div key={z.label} className="rounded p-3" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${z.active ? `${z.color}30` : C.border}` }}>
              <div className="flex items-center justify-between mb-2">
                <Label>{z.side === "long" ? "Bull Reversal" : "Bear Reversal"}</Label>
                {z.active && (
                  <span style={{ fontSize: "7px", color: z.color, fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em" }}>
                    ● IN RANGE
                  </span>
                )}
              </div>
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", fontWeight: 700, color: z.color }}>
                ${fmt(z.price)}
              </div>
              <div className="mt-2">
                <div style={{ fontSize: "8px", color: C.outline, fontFamily: "Space Grotesk", marginBottom: "4px" }}>
                  Reversal probability
                </div>
                <div style={{ height: "4px", borderRadius: "2px", backgroundColor: "rgba(72,72,73,0.3)", overflow: "hidden" }}>
                  <div style={{ width: `${Math.round(z.prob * 100)}%`, height: "100%", backgroundColor: z.color, transition: "width 0.4s" }} />
                </div>
                <div style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: z.color, marginTop: "3px" }}>
                  {Math.round(z.prob * 100)}%
                </div>
              </div>
              <div style={{ fontSize: "8px", color: C.muted, fontFamily: "Space Grotesk", marginTop: "4px" }}>
                {Math.abs(price - z.price) / atr < 0.5
                  ? "Price inside zone"
                  : `${((Math.abs(price - z.price)) / atr).toFixed(1)}× ATR away`}
              </div>
            </div>
          ))}

          {/* Impulse Strength */}
          <div className="rounded p-3" style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}` }}>
            <Label>Impulse Strength</Label>
            <div style={{ height: "4px", borderRadius: "2px", backgroundColor: "rgba(72,72,73,0.3)", marginTop: "6px", overflow: "hidden" }}>
              <div style={{ width: `${Math.round(impulse_strength * 100)}%`, height: "100%", backgroundColor: C.secondary }} />
            </div>
            <div style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.secondary, marginTop: "3px" }}>
              {Math.round(impulse_strength * 100)}%
            </div>
            <div style={{ fontSize: "8px", color: C.muted, fontFamily: "Space Grotesk", marginTop: "3px" }}>
              {multiAlign ? "Multi-TF aligned ✓" : "No multi-TF confirm"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
