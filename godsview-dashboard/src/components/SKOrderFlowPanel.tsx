/**
 * SKOrderFlowPanel.tsx — Phase overlay: SK Structure + Order Flow (CVD)
 *
 * Visualises the Recall Engine's output after a live scan:
 *  - SK System: bias, sequence stage, zone distance, in-zone alert
 *  - CVD Order Flow: cumulative delta direction, buy/sell ratio, divergence
 *  - Market Microstructure: spread, imbalance, absorption signals (Phase 3)
 *
 * Props: recall_features from the /api/alpaca/analyze response,
 *        plus optional live microstructure from /api/market/microstructure.
 */

import type { ReactNode } from "react";

const C = {
  primary:    "#9cff93",
  secondary:  "#669dff",
  tertiary:   "#ff7162",
  card:       "#1a191b",
  cardHigh:   "#201f21",
  border:     "rgba(72,72,73,0.25)",
  muted:      "#adaaab",
  outline:    "#767576",
  outlineVar: "#484849",
};

// ── Types (mirror server types) ───────────────────────────────────────────────
type SKBias = "bull" | "bear" | "neutral";
type SequenceStage = "impulse" | "correction" | "completion" | "none";

interface SKFeatures {
  bias:                SKBias;
  sequence_stage:      SequenceStage;
  correction_complete: boolean;
  zone_distance_pct:   number;
  swing_high:          number;
  swing_low:           number;
  impulse_strength:    number;
  sequence_score:      number;
  rr_quality:          number;
  in_zone:             boolean;
}

interface CVDFeatures {
  cvd_value:        number;
  cvd_slope:        number;
  cvd_divergence:   boolean;
  buy_volume_ratio: number;
  delta_momentum:   number;
  large_delta_bar:  boolean;
}

interface RecallFeatures {
  trend_slope_1m:          number;
  trend_slope_5m:          number;
  trend_slope_15m:         number;
  vol_relative:            number;
  atr_pct:                 number;
  momentum_1m:             number;
  momentum_5m:             number;
  distance_from_high:      number;
  distance_from_low:       number;
  consec_bullish:          number;
  consec_bearish:          number;
  directional_persistence: number;
  regime:                  string;
  sk:                      SKFeatures;
  cvd:                     CVDFeatures;
}

interface Microstructure {
  mid:          number;
  bestBid:      number;
  bestAsk:      number;
  spread:       number;
  spreadBps:    number;
  imbalance:    number;
  topBidVolume: number;
  topAskVolume: number;
  absorbingBid: boolean;
  absorbingAsk: boolean;
  signal:       string;
}

interface Props {
  recall:         RecallFeatures;
  microstructure?: Microstructure | null;
  entryPrice?:    number;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MicroLabel({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase" as const, color: C.outline }}>
      {children}
    </span>
  );
}

function Gauge({ value, max = 1, color = C.primary, label }: { value: number; max?: number; color?: string; label?: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div>
      {label && <MicroLabel>{label}</MicroLabel>}
      <div style={{ marginTop: label ? "4px" : 0, height: "4px", borderRadius: "2px", backgroundColor: "rgba(72,72,73,0.35)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", backgroundColor: color, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid rgba(72,72,73,0.1)" }}>
      <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: C.outline, letterSpacing: "0.1em", textTransform: "uppercase" as const }}>{label}</span>
      <span style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", fontWeight: 600, color: color ?? "#ffffff" }}>{value}</span>
    </div>
  );
}

function Badge({ label, color, icon }: { label: string; color: string; icon?: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "3px",
      padding: "2px 8px", borderRadius: "3px",
      fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" as const,
      backgroundColor: `${color}18`, color, border: `1px solid ${color}30`,
    }}>
      {icon && <span className="material-symbols-outlined" style={{ fontSize: "11px" }}>{icon}</span>}
      {label}
    </span>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "6px", overflow: "hidden" }}>
      <div style={{ padding: "8px 12px", borderBottom: `1px solid rgba(72,72,73,0.15)`, display: "flex", alignItems: "center", gap: "8px" }}>
        <span className="material-symbols-outlined" style={{ fontSize: "14px", color: C.secondary }}>{icon}</span>
        <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase" as const, color: C.muted }}>{title}</span>
      </div>
      <div style={{ padding: "12px" }}>{children}</div>
    </div>
  );
}

// ── Bias helpers ──────────────────────────────────────────────────────────────

const BIAS_COLOR: Record<SKBias, string> = {
  bull:    C.primary,
  bear:    C.tertiary,
  neutral: C.outline,
};

const STAGE_LABEL: Record<SequenceStage, string> = {
  impulse:    "IMPULSE  →",
  correction: "CORRECTION ↘",
  completion: "COMPLETION ✓",
  none:       "NO SEQUENCE",
};

const STAGE_COLOR: Record<SequenceStage, string> = {
  impulse:    C.secondary,
  correction: "#fbbf24",
  completion: C.primary,
  none:       C.outlineVar,
};

// ─────────────────────────────────────────────────────────────────────────────
export default function SKOrderFlowPanel({ recall, microstructure, entryPrice }: Props) {
  const { sk, cvd } = recall;

  const biasColor   = BIAS_COLOR[sk.bias];
  const stageColor  = STAGE_COLOR[sk.sequence_stage];
  const cvdPositive = cvd.cvd_slope >= 0;
  const buyPct      = Math.round(cvd.buy_volume_ratio * 100);
  const sellPct     = 100 - buyPct;

  // Trend consensus across timeframes
  const trendBull = recall.trend_slope_5m > 0 && recall.trend_slope_15m > 0;
  const trendBear = recall.trend_slope_5m < 0 && recall.trend_slope_15m < 0;

  // Distance bars: % distance from swing high/low
  const distHigh = Math.min(recall.distance_from_high * 100, 100);
  const distLow  = Math.min(recall.distance_from_low  * 100, 100);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>

      {/* ── SK Structure ────────────────────────────────────────── */}
      <Section title="SK Structure Engine" icon="architecture">
        {/* Bias */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
          <Badge
            label={`${sk.bias.toUpperCase()} BIAS`}
            color={biasColor}
            icon={sk.bias === "bull" ? "trending_up" : sk.bias === "bear" ? "trending_down" : "swap_horiz"}
          />
          <Badge label={STAGE_LABEL[sk.sequence_stage]} color={stageColor} />
        </div>

        {/* In-zone alert */}
        {sk.in_zone && (
          <div style={{
            marginBottom: "10px", padding: "6px 10px", borderRadius: "4px",
            backgroundColor: `${C.primary}12`, border: `1px solid ${C.primary}35`,
            display: "flex", alignItems: "center", gap: "6px",
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: "13px", color: C.primary }}>my_location</span>
            <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.primary, letterSpacing: "0.1em" }}>PRICE IN SK ZONE — SETUP OPPORTUNITY</span>
          </div>
        )}

        {/* Correction complete */}
        {sk.correction_complete && (
          <div style={{
            marginBottom: "10px", padding: "6px 10px", borderRadius: "4px",
            backgroundColor: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.25)",
            display: "flex", alignItems: "center", gap: "6px",
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: "13px", color: "#a78bfa" }}>check_circle</span>
            <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, color: "#a78bfa", letterSpacing: "0.1em" }}>CORRECTION COMPLETE — ENTRY WINDOW OPEN</span>
          </div>
        )}

        {/* Gauge scores */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "10px" }}>
          <Gauge value={sk.sequence_score} label="Sequence Score" color={stageColor} />
          <Gauge value={sk.impulse_strength} label="Impulse Strength" color={biasColor} />
          <Gauge value={sk.rr_quality} label="R:R Quality" color={C.secondary} />
        </div>

        {/* Swing levels */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <Stat label="Swing High" value={`$${sk.swing_high.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} color={C.primary} />
          <Stat label="Swing Low"  value={`$${sk.swing_low.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}  color={C.tertiary} />
          <Stat label="Zone Dist" value={`${(sk.zone_distance_pct * 100).toFixed(1)}%`} color={sk.in_zone ? C.primary : C.muted} />
          {entryPrice && (
            <Stat label="Entry Price" value={`$${entryPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} color={C.secondary} />
          )}
        </div>

        {/* Distance from high/low visual */}
        <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
              <span style={{ fontSize: "7px", fontFamily: "Space Grotesk", color: C.outline }}>DIST FROM HIGH</span>
              <span style={{ fontSize: "7px", fontFamily: "JetBrains Mono", color: C.primary }}>{distHigh.toFixed(1)}%</span>
            </div>
            <div style={{ height: "3px", borderRadius: "1.5px", backgroundColor: "rgba(72,72,73,0.3)" }}>
              <div style={{ width: `${distHigh}%`, height: "100%", backgroundColor: C.primary, opacity: 0.5 }} />
            </div>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
              <span style={{ fontSize: "7px", fontFamily: "Space Grotesk", color: C.outline }}>DIST FROM LOW</span>
              <span style={{ fontSize: "7px", fontFamily: "JetBrains Mono", color: C.tertiary }}>{distLow.toFixed(1)}%</span>
            </div>
            <div style={{ height: "3px", borderRadius: "1.5px", backgroundColor: "rgba(72,72,73,0.3)" }}>
              <div style={{ width: `${distLow}%`, height: "100%", backgroundColor: C.tertiary, opacity: 0.5 }} />
            </div>
          </div>
        </div>
      </Section>

      {/* ── CVD Order Flow ──────────────────────────────────────── */}
      <Section title="CVD Order Flow" icon="waterfall_chart">
        {/* CVD direction badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
          <Badge
            label={cvdPositive ? "BUYING PRESSURE" : "SELLING PRESSURE"}
            color={cvdPositive ? C.primary : C.tertiary}
            icon={cvdPositive ? "arrow_upward" : "arrow_downward"}
          />
          {cvd.cvd_divergence && (
            <Badge label="CVD DIVERGENCE" color="#fbbf24" icon="warning" />
          )}
        </div>

        {/* Large delta bar alert */}
        {cvd.large_delta_bar && (
          <div style={{
            marginBottom: "10px", padding: "6px 10px", borderRadius: "4px",
            backgroundColor: `${C.secondary}10`, border: `1px solid ${C.secondary}30`,
            display: "flex", alignItems: "center", gap: "6px",
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: "13px", color: C.secondary }}>bolt</span>
            <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.secondary, letterSpacing: "0.1em" }}>LARGE DELTA BAR DETECTED</span>
          </div>
        )}

        {/* Buy/Sell ratio visual */}
        <div style={{ marginBottom: "12px" }}>
          <MicroLabel>Buy / Sell Pressure</MicroLabel>
          <div style={{ marginTop: "6px", height: "16px", borderRadius: "3px", overflow: "hidden", display: "flex" }}>
            <div style={{ width: `${buyPct}%`, height: "100%", backgroundColor: `${C.primary}80`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {buyPct > 20 && <span style={{ fontSize: "8px", fontFamily: "JetBrains Mono", color: C.primary, fontWeight: 700 }}>{buyPct}%</span>}
            </div>
            <div style={{ width: `${sellPct}%`, height: "100%", backgroundColor: `${C.tertiary}80`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {sellPct > 20 && <span style={{ fontSize: "8px", fontFamily: "JetBrains Mono", color: C.tertiary, fontWeight: 700 }}>{sellPct}%</span>}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "3px" }}>
            <span style={{ fontSize: "7px", color: C.primary, fontFamily: "Space Grotesk" }}>BUY</span>
            <span style={{ fontSize: "7px", color: C.tertiary, fontFamily: "Space Grotesk" }}>SELL</span>
          </div>
        </div>

        {/* CVD stats */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginBottom: "10px" }}>
          <Stat label="CVD Value"    value={cvd.cvd_value.toFixed(4)}    color={cvdPositive ? C.primary : C.tertiary} />
          <Stat label="CVD Slope"    value={cvd.cvd_slope >= 0 ? `+${cvd.cvd_slope.toFixed(4)}` : cvd.cvd_slope.toFixed(4)} color={cvd.cvd_slope >= 0 ? C.primary : C.tertiary} />
          <Stat label="Delta Momentum" value={cvd.delta_momentum.toFixed(4)} color={C.secondary} />
        </div>

        {/* Trend across timeframes */}
        <div style={{ marginTop: "10px" }}>
          <MicroLabel>Multi-TF Trend Alignment</MicroLabel>
          <div style={{ display: "flex", gap: "4px", marginTop: "6px" }}>
            {[
              { label: "1m", slope: recall.trend_slope_1m },
              { label: "5m", slope: recall.trend_slope_5m },
              { label: "15m", slope: recall.trend_slope_15m },
            ].map(({ label, slope }) => {
              const col = slope > 0.001 ? C.primary : slope < -0.001 ? C.tertiary : C.outlineVar;
              return (
                <div key={label} style={{ flex: 1, padding: "6px", borderRadius: "3px", backgroundColor: `${col}10`, border: `1px solid ${col}25`, textAlign: "center" as const }}>
                  <div style={{ fontSize: "7px", color: C.outline, fontFamily: "Space Grotesk", marginBottom: "2px" }}>{label}</div>
                  <div style={{ fontSize: "10px", fontFamily: "JetBrains Mono", color: col }}>
                    {slope > 0.001 ? "▲" : slope < -0.001 ? "▼" : "—"}
                  </div>
                </div>
              );
            })}
          </div>

          {(trendBull || trendBear) && (
            <div style={{ marginTop: "6px", padding: "5px 8px", borderRadius: "3px", backgroundColor: trendBull ? `${C.primary}10` : `${C.tertiary}10`, border: `1px solid ${trendBull ? C.primary : C.tertiary}30` }}>
              <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, color: trendBull ? C.primary : C.tertiary, letterSpacing: "0.1em" }}>
                {trendBull ? "✓ BULL ALIGNMENT ACROSS ALL TFs" : "✓ BEAR ALIGNMENT ACROSS ALL TFs"}
              </span>
            </div>
          )}
        </div>

        {/* ATR / Volatility */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: "10px" }}>
          <Stat label="ATR %" value={`${(recall.atr_pct * 100).toFixed(2)}%`} color={C.secondary} />
          <Stat label="Rel. Volume" value={recall.vol_relative.toFixed(2) + "x"} color={recall.vol_relative > 1.5 ? "#fbbf24" : C.muted} />
          <Stat label="Consec Bull" value={recall.consec_bullish} color={C.primary} />
          <Stat label="Consec Bear" value={recall.consec_bearish} color={C.tertiary} />
        </div>
      </Section>

      {/* ── Microstructure (Phase 3) ────────────────────────────── */}
      <Section title="Live Microstructure" icon="analytics">
        {microstructure ? (
          <>
            {/* Absorption alert */}
            {(microstructure.absorbingBid || microstructure.absorbingAsk) && (
              <div style={{
                marginBottom: "10px", padding: "6px 10px", borderRadius: "4px",
                backgroundColor: microstructure.absorbingBid ? `${C.primary}10` : `${C.tertiary}10`,
                border: `1px solid ${microstructure.absorbingBid ? C.primary : C.tertiary}30`,
                display: "flex", alignItems: "center", gap: "6px",
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: "13px", color: microstructure.absorbingBid ? C.primary : C.tertiary }}>
                  {microstructure.absorbingBid ? "shield" : "flash_on"}
                </span>
                <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, color: microstructure.absorbingBid ? C.primary : C.tertiary, letterSpacing: "0.1em" }}>
                  {microstructure.absorbingBid ? "BID ABSORPTION — BULLS DEFENDING" : "ASK ABSORPTION — BEARS DEFENDING"}
                </span>
              </div>
            )}

            {/* Mid + spread */}
            <div style={{ marginBottom: "10px", padding: "10px", borderRadius: "4px", backgroundColor: "#0e0e0f", textAlign: "center" as const }}>
              <div style={{ fontSize: "20px", fontFamily: "JetBrains Mono", fontWeight: 700, color: "#ffffff" }}>
                ${microstructure.mid.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </div>
              <div style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: C.outline, marginTop: "2px" }}>MID PRICE</div>
            </div>

            {/* Spread */}
            <div style={{ display: "flex", gap: "4px", marginBottom: "10px" }}>
              <div style={{ flex: 1, padding: "6px", borderRadius: "3px", backgroundColor: `${C.primary}08`, border: `1px solid ${C.primary}20`, textAlign: "center" as const }}>
                <div style={{ fontSize: "7px", color: C.outline, fontFamily: "Space Grotesk", marginBottom: "2px" }}>BID</div>
                <div style={{ fontSize: "10px", fontFamily: "JetBrains Mono", color: C.primary, fontWeight: 600 }}>${microstructure.bestBid.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
              </div>
              <div style={{ flex: 1, padding: "6px", borderRadius: "3px", backgroundColor: `${C.tertiary}08`, border: `1px solid ${C.tertiary}20`, textAlign: "center" as const }}>
                <div style={{ fontSize: "7px", color: C.outline, fontFamily: "Space Grotesk", marginBottom: "2px" }}>ASK</div>
                <div style={{ fontSize: "10px", fontFamily: "JetBrains Mono", color: C.tertiary, fontWeight: 600 }}>${microstructure.bestAsk.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
              </div>
            </div>

            {/* Imbalance gauge */}
            <div style={{ marginBottom: "10px" }}>
              <MicroLabel>Bid/Ask Imbalance</MicroLabel>
              <div style={{ marginTop: "5px", height: "10px", borderRadius: "5px", backgroundColor: "rgba(72,72,73,0.3)", position: "relative" as const, overflow: "hidden" }}>
                {/* Neutral line */}
                <div style={{ position: "absolute" as const, left: "50%", top: 0, bottom: 0, width: "1px", backgroundColor: "rgba(255,255,255,0.2)" }} />
                {/* Imbalance fill */}
                <div style={{
                  position: "absolute" as const,
                  top: 0, bottom: 0,
                  left: microstructure.imbalance >= 0 ? "50%" : `${50 + microstructure.imbalance * 50}%`,
                  width: `${Math.abs(microstructure.imbalance) * 50}%`,
                  backgroundColor: microstructure.imbalance >= 0 ? C.primary : C.tertiary,
                  opacity: 0.7,
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "3px" }}>
                <span style={{ fontSize: "7px", color: C.tertiary, fontFamily: "Space Grotesk" }}>SELL {(Math.abs(Math.min(microstructure.imbalance, 0)) * 100).toFixed(0)}%</span>
                <span style={{ fontSize: "7px", color: C.primary, fontFamily: "Space Grotesk" }}>BUY {(Math.max(microstructure.imbalance, 0) * 100).toFixed(0)}%</span>
              </div>
            </div>

            {/* Stats */}
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <Stat label="Spread"     value={`$${microstructure.spread.toFixed(2)}`}    color={C.muted} />
              <Stat label="Spread BPS" value={`${microstructure.spreadBps.toFixed(1)} bps`} color={microstructure.spreadBps < 5 ? C.primary : microstructure.spreadBps < 15 ? "#fbbf24" : C.tertiary} />
              <Stat label="Bid Vol"    value={microstructure.topBidVolume.toFixed(3)}    color={C.primary} />
              <Stat label="Ask Vol"    value={microstructure.topAskVolume.toFixed(3)}    color={C.tertiary} />
              <Stat label="Signal"     value={microstructure.signal.replace(/_/g, " ").toUpperCase()} color={microstructure.absorbingBid ? C.primary : microstructure.absorbingAsk ? C.tertiary : C.outline} />
            </div>
          </>
        ) : (
          <div style={{ padding: "24px 0", textAlign: "center" as const }}>
            <span className="material-symbols-outlined" style={{ color: C.outlineVar, fontSize: "28px", display: "block", marginBottom: "8px" }}>data_thresholding</span>
            <p style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.1em" }}>FETCHING MICROSTRUCTURE</p>
          </div>
        )}
      </Section>
    </div>
  );
}
