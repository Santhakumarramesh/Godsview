/**
 * institutional-intelligence.tsx
 *
 * Phase 16/17 — YoungTraderWealth 3-Layer Institutional Intelligence
 * Layer 1: Macro Bias  →  Layer 2: Retail Sentiment  →  Layer 3: Technical Entry
 *
 * Phase 17: Live data feed integration
 * - "Load Live Data" button fetches the current auto-computed macro context
 * - Status banner shows data quality, last refresh time, and next refresh ETA
 * - Form fields auto-fill from live Alpaca data (UUP/VIXY/BTC feeds)
 */

import { useState, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

// ─── Design tokens (match existing pages) ─────────────────────────────────────
const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  cardHigh: "#201f21",
  border: "rgba(72,72,73,0.25)",
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  muted: "#adaaab",
  outline: "#767576",
  outlineVar: "#484849",
  gold: "#fbbf24",
  purple: "#a78bfa",
  cyan: "#22d3ee",
  orange: "#fb923c",
};

// ─── Shared UI primitives ──────────────────────────────────────────────────────

function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: "8px", fontFamily: "Space Grotesk",
      letterSpacing: "0.2em", textTransform: "uppercase", color: C.outline,
    }}>
      {children}
    </span>
  );
}

function Card({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="rounded-lg p-5" style={{
      backgroundColor: C.card, border: `1px solid ${C.border}`, ...style,
    }}>
      {children}
    </div>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span className="px-2 py-0.5 rounded text-xs font-semibold uppercase" style={{
      backgroundColor: `${color}22`, color, border: `1px solid ${color}44`,
    }}>
      {label}
    </span>
  );
}

function ScoreBar({ value, max = 1, color }: { value: number; max?: number; color: string }) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  return (
    <div className="rounded-full overflow-hidden" style={{
      height: 6, backgroundColor: C.cardHigh, border: `1px solid ${C.outlineVar}`,
    }}>
      <div style={{
        width: `${pct}%`, height: "100%",
        background: `linear-gradient(90deg, ${color}88, ${color})`,
        transition: "width 0.4s ease",
      }} />
    </div>
  );
}

function FieldInput({
  label, value, onChange, step = "any", min, max,
}: {
  label: string; value: number; onChange: (v: number) => void;
  step?: string; min?: number; max?: number;
}) {
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="mt-1 w-full rounded px-2 py-1.5 text-sm text-white outline-none"
        style={{
          backgroundColor: C.cardHigh, border: `1px solid ${C.outlineVar}`,
          fontFamily: "Space Grotesk",
        }}
      />
    </div>
  );
}

function SelectInput({
  label, value, options, onChange,
}: {
  label: string; value: string; options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded px-2 py-1.5 text-sm text-white outline-none"
        style={{
          backgroundColor: C.cardHigh, border: `1px solid ${C.outlineVar}`,
          fontFamily: "Space Grotesk",
        }}
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// ─── Types (mirrors backend) ───────────────────────────────────────────────────

interface MacroBiasResult {
  bias: string; direction: string; score: number; conviction: string;
  aligned: boolean; reasons: string[]; blockedDirections: string[];
  tailwind: boolean; headwind: boolean; updatedAt: string;
}

interface SentimentResult {
  retailBias: string; institutionalEdge: string; sentimentScore: number;
  crowdingLevel: string; aligned: boolean; contrarian: boolean;
  reasons: string[]; updatedAt: string;
}

interface MacroBiasInput {
  dxySlope: number; rateDifferentialBps: number; cpiMomentum: number;
  vixLevel: number; macroRiskScore: number;
  assetClass: string; intendedDirection: string;
}

interface SentimentInput {
  retailLongRatio: number; priceTrendSlope: number; cvdNet: number;
  openInterestChange: number; fundingRate: number;
  intendedDirection: string; assetClass: string;
}

interface LiveMacroContext {
  snapshot: {
    macroBiasInput: MacroBiasInput;
    sentimentInput: SentimentInput;
    fetchedAt: string;
    dataQuality: "full" | "partial" | "stale";
    sources: Record<string, string>;
  };
  macroBias: MacroBiasResult;
  sentiment: SentimentResult;
  lastRefreshedAt: string;
  nextRefreshAt: string;
  refreshCount: number;
  isLive: boolean;
}

// ─── Live Status Banner ───────────────────────────────────────────────────────

function LiveStatusBanner({
  liveCtx,
  onRefresh,
  isRefreshing,
}: {
  liveCtx: LiveMacroContext | null;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  if (!liveCtx) return null;

  const quality = liveCtx.snapshot.dataQuality;
  const qualityColor = quality === "full" ? C.primary : quality === "partial" ? C.gold : C.muted;
  const lastUpdate = liveCtx.lastRefreshedAt
    ? new Date(liveCtx.lastRefreshedAt).toLocaleTimeString()
    : "—";
  const nextUpdate = liveCtx.nextRefreshAt
    ? new Date(liveCtx.nextRefreshAt).toLocaleTimeString()
    : "—";

  return (
    <div className="rounded-lg px-4 py-3 flex items-center gap-4 flex-wrap" style={{
      backgroundColor: C.card, border: `1px solid ${qualityColor}44`,
    }}>
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full" style={{
          backgroundColor: quality === "full" ? C.primary : C.gold,
          boxShadow: quality === "full" ? `0 0 6px ${C.primary}` : "none",
        }} />
        <span className="text-xs font-semibold" style={{ color: qualityColor }}>
          {quality === "full" ? "Live" : quality === "partial" ? "Partial" : "Cached"}
        </span>
      </div>
      <div className="text-xs" style={{ color: C.muted }}>
        Updated: <span style={{ color: C.secondary }}>{lastUpdate}</span>
      </div>
      <div className="text-xs" style={{ color: C.muted }}>
        Next: <span style={{ color: C.muted }}>{nextUpdate}</span>
      </div>
      <div className="text-xs" style={{ color: C.muted }}>
        Refresh #{liveCtx.refreshCount}
      </div>
      <button
        onClick={onRefresh}
        disabled={isRefreshing}
        className="ml-auto rounded px-3 py-1 text-xs font-semibold"
        style={{
          backgroundColor: C.secondary + "22", color: C.secondary,
          border: `1px solid ${C.secondary}44`, cursor: "pointer",
          opacity: isRefreshing ? 0.5 : 1,
        }}
      >
        {isRefreshing ? "Refreshing…" : "⟳ Refresh Now"}
      </button>
    </div>
  );
}

// ─── Colour helpers ────────────────────────────────────────────────────────────

function biasColor(bias: string): string {
  if (bias === "strong_buy") return C.primary;
  if (bias === "buy")        return "#4ade80";
  if (bias === "neutral")    return C.muted;
  if (bias === "sell")       return C.orange;
  if (bias === "strong_sell") return C.tertiary;
  return C.muted;
}

function convictionColor(conviction: string): string {
  if (conviction === "high")   return C.tertiary;
  if (conviction === "medium") return C.gold;
  return C.muted;
}

function crowdingColor(level: string): string {
  if (level === "extreme")  return C.tertiary;
  if (level === "high")     return C.orange;
  if (level === "moderate") return C.gold;
  return C.primary;
}

// ─── Macro Bias Panel ─────────────────────────────────────────────────────────

function MacroBiasPanel({ liveInput }: { liveInput?: MacroBiasInput }) {
  const [form, setForm] = useState({
    dxySlope: 0,
    rateDifferentialBps: 0,
    cpiMomentum: 0,
    vixLevel: 20,
    macroRiskScore: 0.3,
    assetClass: "crypto",
    intendedDirection: "long",
  });

  // Auto-fill from live data when liveInput changes
  const prevLiveRef = useState<MacroBiasInput | undefined>(undefined);
  if (liveInput && liveInput !== prevLiveRef[0]) {
    prevLiveRef[1](liveInput);
    setForm({
      dxySlope: liveInput.dxySlope,
      rateDifferentialBps: liveInput.rateDifferentialBps,
      cpiMomentum: liveInput.cpiMomentum,
      vixLevel: liveInput.vixLevel,
      macroRiskScore: liveInput.macroRiskScore,
      assetClass: liveInput.assetClass,
      intendedDirection: liveInput.intendedDirection,
    });
  }

  const mutation = useMutation<{ bias: MacroBiasResult }, Error, typeof form>({
    mutationFn: async (body) => {
      const res = await fetch("/api/macro/bias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ bias: MacroBiasResult }>;
    },
  });

  const result = mutation.data?.bias;

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <span className="material-icons text-sm" style={{ color: C.secondary }}>public</span>
        <div>
          <div className="font-bold text-sm text-white">Layer 1 — Macro Bias</div>
          <MicroLabel>DXY · Rate Differential · CPI · VIX</MicroLabel>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <FieldInput label="DXY Slope" value={form.dxySlope}
          onChange={(v) => setForm(f => ({ ...f, dxySlope: v }))} step="0.001" />
        <FieldInput label="Rate Diff (bps)" value={form.rateDifferentialBps}
          onChange={(v) => setForm(f => ({ ...f, rateDifferentialBps: v }))} step="1" />
        <FieldInput label="CPI Momentum" value={form.cpiMomentum}
          onChange={(v) => setForm(f => ({ ...f, cpiMomentum: v }))} step="0.01" />
        <FieldInput label="VIX Level" value={form.vixLevel}
          onChange={(v) => setForm(f => ({ ...f, vixLevel: v }))} step="0.5" min={0} max={100} />
        <FieldInput label="Macro Risk Score (0-1)" value={form.macroRiskScore}
          onChange={(v) => setForm(f => ({ ...f, macroRiskScore: v }))} step="0.01" min={0} max={1} />
        <SelectInput label="Asset Class" value={form.assetClass}
          options={["crypto", "forex", "equity", "commodity"]}
          onChange={(v) => setForm(f => ({ ...f, assetClass: v }))} />
        <SelectInput label="Intended Direction" value={form.intendedDirection}
          options={["long", "short"]}
          onChange={(v) => setForm(f => ({ ...f, intendedDirection: v }))} />
      </div>

      <button
        onClick={() => mutation.mutate(form)}
        disabled={mutation.isPending}
        className="w-full rounded py-2 text-sm font-semibold uppercase tracking-wider"
        style={{
          backgroundColor: C.secondary + "22", color: C.secondary,
          border: `1px solid ${C.secondary}44`, cursor: "pointer",
          opacity: mutation.isPending ? 0.6 : 1,
        }}
      >
        {mutation.isPending ? "Computing…" : "Compute Macro Bias"}
      </button>

      {mutation.isError && (
        <div className="mt-3 rounded p-2 text-xs" style={{ color: C.tertiary, backgroundColor: C.tertiary + "11" }}>
          {mutation.error.message}
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <Pill label={result.bias.replace("_", " ")} color={biasColor(result.bias)} />
            <Pill label={result.conviction + " conviction"} color={convictionColor(result.conviction)} />
            <Pill label={result.direction} color={C.secondary} />
          </div>

          <div>
            <div className="flex justify-between mb-1">
              <MicroLabel>Composite Score</MicroLabel>
              <span className="text-xs font-mono" style={{ color: biasColor(result.bias) }}>
                {(result.score * 100).toFixed(1)}%
              </span>
            </div>
            <ScoreBar value={result.score} color={biasColor(result.bias)} />
          </div>

          <div className="flex gap-4">
            {result.tailwind && (
              <div className="flex items-center gap-1 text-xs" style={{ color: C.primary }}>
                <span className="material-icons text-sm">trending_up</span> Tailwind
              </div>
            )}
            {result.headwind && (
              <div className="flex items-center gap-1 text-xs" style={{ color: C.tertiary }}>
                <span className="material-icons text-sm">trending_down</span> Headwind
              </div>
            )}
            {result.aligned ? (
              <div className="flex items-center gap-1 text-xs" style={{ color: C.primary }}>
                <span className="material-icons text-sm">check_circle</span> Aligned
              </div>
            ) : (
              <div className="flex items-center gap-1 text-xs" style={{ color: C.tertiary }}>
                <span className="material-icons text-sm">cancel</span> Not aligned
              </div>
            )}
          </div>

          {result.blockedDirections.length > 0 && (
            <div className="rounded p-2 text-xs" style={{
              backgroundColor: C.tertiary + "11", border: `1px solid ${C.tertiary}33`,
            }}>
              <span style={{ color: C.tertiary }}>⊘ Blocked: </span>
              <span style={{ color: C.muted }}>{result.blockedDirections.join(", ")}</span>
            </div>
          )}

          <div className="space-y-1">
            {result.reasons.map((r, i) => (
              <div key={i} className="text-xs" style={{ color: C.muted }}>· {r}</div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Retail Sentiment Panel ───────────────────────────────────────────────────

function SentimentPanel({ liveInput }: { liveInput?: SentimentInput }) {
  const [form, setForm] = useState({
    retailLongRatio: 0.55,
    priceTrendSlope: 0.005,
    cvdNet: 0,
    openInterestChange: 0,
    fundingRate: 0.0001,
    intendedDirection: "long",
    assetClass: "crypto",
  });

  const prevLiveRef = useState<SentimentInput | undefined>(undefined);
  if (liveInput && liveInput !== prevLiveRef[0]) {
    prevLiveRef[1](liveInput);
    setForm({
      retailLongRatio: liveInput.retailLongRatio,
      priceTrendSlope: liveInput.priceTrendSlope,
      cvdNet: liveInput.cvdNet,
      openInterestChange: liveInput.openInterestChange,
      fundingRate: liveInput.fundingRate,
      intendedDirection: liveInput.intendedDirection,
      assetClass: liveInput.assetClass,
    });
  }

  const mutation = useMutation<{ sentiment: SentimentResult }, Error, typeof form>({
    mutationFn: async (body) => {
      const res = await fetch("/api/macro/sentiment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ sentiment: SentimentResult }>;
    },
  });

  const result = mutation.data?.sentiment;

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <span className="material-icons text-sm" style={{ color: C.gold }}>people</span>
        <div>
          <div className="font-bold text-sm text-white">Layer 2 — Retail Sentiment</div>
          <MicroLabel>Positioning · Funding · CVD · OI</MicroLabel>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <FieldInput label="Retail Long Ratio (0-1)" value={form.retailLongRatio}
          onChange={(v) => setForm(f => ({ ...f, retailLongRatio: v }))} step="0.01" min={0} max={1} />
        <FieldInput label="Price Trend Slope" value={form.priceTrendSlope}
          onChange={(v) => setForm(f => ({ ...f, priceTrendSlope: v }))} step="0.001" />
        <FieldInput label="CVD Net ($)" value={form.cvdNet}
          onChange={(v) => setForm(f => ({ ...f, cvdNet: v }))} step="100000" />
        <FieldInput label="OI Change (fraction)" value={form.openInterestChange}
          onChange={(v) => setForm(f => ({ ...f, openInterestChange: v }))} step="0.01" />
        <FieldInput label="Funding Rate" value={form.fundingRate}
          onChange={(v) => setForm(f => ({ ...f, fundingRate: v }))} step="0.0001" />
        <SelectInput label="Intended Direction" value={form.intendedDirection}
          options={["long", "short"]}
          onChange={(v) => setForm(f => ({ ...f, intendedDirection: v }))} />
        <SelectInput label="Asset Class" value={form.assetClass}
          options={["crypto", "forex", "equity", "commodity"]}
          onChange={(v) => setForm(f => ({ ...f, assetClass: v }))} />
      </div>

      <button
        onClick={() => mutation.mutate(form)}
        disabled={mutation.isPending}
        className="w-full rounded py-2 text-sm font-semibold uppercase tracking-wider"
        style={{
          backgroundColor: C.gold + "22", color: C.gold,
          border: `1px solid ${C.gold}44`, cursor: "pointer",
          opacity: mutation.isPending ? 0.6 : 1,
        }}
      >
        {mutation.isPending ? "Analysing…" : "Analyse Retail Sentiment"}
      </button>

      {mutation.isError && (
        <div className="mt-3 rounded p-2 text-xs" style={{ color: C.tertiary, backgroundColor: C.tertiary + "11" }}>
          {mutation.error.message}
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Pill label={result.retailBias.replace("_", " ")} color={C.gold} />
            <Pill label={result.crowdingLevel + " crowding"} color={crowdingColor(result.crowdingLevel)} />
            {result.institutionalEdge !== "none" && (
              <Pill label={result.institutionalEdge.replace("_", " ")} color={C.cyan} />
            )}
          </div>

          <div>
            <div className="flex justify-between mb-1">
              <MicroLabel>Sentiment Score (Long Pressure)</MicroLabel>
              <span className="text-xs font-mono" style={{ color: C.gold }}>
                {(result.sentimentScore * 100).toFixed(1)}%
              </span>
            </div>
            <ScoreBar value={result.sentimentScore} color={C.gold} />
          </div>

          {result.crowdingLevel === "extreme" && (
            <div className="rounded p-2 text-xs font-semibold" style={{
              backgroundColor: C.tertiary + "11", border: `1px solid ${C.tertiary}44`,
              color: C.tertiary,
            }}>
              ⚠ EXTREME CROWDING — institutional likely to fade this side
            </div>
          )}

          <div className="flex gap-4">
            {result.contrarian && (
              <div className="flex items-center gap-1 text-xs" style={{ color: C.cyan }}>
                <span className="material-icons text-sm">contrast</span> Contrarian (institutional)
              </div>
            )}
            {result.aligned ? (
              <div className="flex items-center gap-1 text-xs" style={{ color: C.primary }}>
                <span className="material-icons text-sm">check_circle</span> Not trading with crowd
              </div>
            ) : (
              <div className="flex items-center gap-1 text-xs" style={{ color: C.tertiary }}>
                <span className="material-icons text-sm">groups</span> Trading WITH crowd — caution
              </div>
            )}
          </div>

          <div className="space-y-1">
            {result.reasons.map((r, i) => (
              <div key={i} className="text-xs" style={{ color: C.muted }}>· {r}</div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Technical Layer Reference ────────────────────────────────────────────────

function TechnicalLayer() {
  const techs = [
    { label: "SMC Structure", icon: "architecture", desc: "Order blocks, breakers, FVG" },
    { label: "Order Flow", icon: "swap_vert", desc: "CVD, delta, volume footprint" },
    { label: "SK Sequence", icon: "timeline", desc: "Impulse → Correction → Completion" },
    { label: "Entry Timing", icon: "timer", desc: "M5 POI + candle confirmation" },
  ];

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <span className="material-icons text-sm" style={{ color: C.primary }}>candlestick_chart</span>
        <div>
          <div className="font-bold text-sm text-white">Layer 3 — Technical Entry</div>
          <MicroLabel>SMC · Order Flow · Timing</MicroLabel>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {techs.map((t) => (
          <a
            key={t.label}
            href="/alpaca"
            className="rounded p-3 hover:opacity-80 transition-opacity"
            style={{ backgroundColor: C.cardHigh, border: `1px solid ${C.outlineVar}`, textDecoration: "none" }}
          >
            <span className="material-icons text-sm mb-1 block" style={{ color: C.primary }}>{t.icon}</span>
            <div className="text-xs font-semibold text-white">{t.label}</div>
            <div className="text-xs mt-0.5" style={{ color: C.muted }}>{t.desc}</div>
          </a>
        ))}
      </div>
    </Card>
  );
}

// ─── Method Explainer ─────────────────────────────────────────────────────────

function MethodExplainer() {
  const layers = [
    {
      num: "1",
      color: C.secondary,
      title: "Macro Bias",
      body: "Before entering any trade, align with the macro tailwind. DXY trend, rate differential, CPI momentum, and VIX regime collectively score the directional environment. High conviction blocks counter-direction trades.",
    },
    {
      num: "2",
      color: C.gold,
      title: "Retail Sentiment",
      body: "When retail is extremely crowded on one side, institutions fade them. Retail long ratio, funding rate, OI change, and CVD score the crowd. Extreme crowding blocks trades aligned with the retail mob.",
    },
    {
      num: "3",
      color: C.primary,
      title: "Technical Entry",
      body: "Only after Layers 1 and 2 confirm, seek the technical setup: SMC order block, CVD divergence, or SK sequence completion at a key level. This is where the trade materialises.",
    },
  ];

  return (
    <Card style={{ gridColumn: "1 / -1" }}>
      <div className="flex items-center gap-3 mb-4">
        <span className="material-icons text-sm" style={{ color: C.purple }}>school</span>
        <div>
          <div className="font-bold text-sm text-white">YoungTraderWealth — 3-Layer Method</div>
          <MicroLabel>Elliot Hewitt Institutional Methodology</MicroLabel>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {layers.map((l) => (
          <div key={l.num} className="rounded p-4" style={{
            backgroundColor: C.cardHigh, border: `1px solid ${l.color}33`,
          }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ backgroundColor: l.color + "22", color: l.color, border: `1px solid ${l.color}44` }}>
                {l.num}
              </div>
              <span className="text-sm font-semibold" style={{ color: l.color }}>{l.title}</span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: C.muted }}>{l.body}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function InstitutionalIntelligencePage() {
  const [liveCtx, setLiveCtx] = useState<LiveMacroContext | null>(null);

  // Fetch live context on mount
  const { refetch: fetchLive, isFetching } = useQuery<{ context: LiveMacroContext }>({
    queryKey: ["macro-live"],
    queryFn: () => fetch("/api/macro/live").then(r => r.json()) as Promise<{ context: LiveMacroContext }>,
    enabled: true,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  // On initial load, populate liveCtx
  const handleFetchLive = useCallback(async () => {
    const result = await fetchLive();
    if (result.data?.context) setLiveCtx(result.data.context);
  }, [fetchLive]);

  // Force refresh mutation
  const refreshMutation = useMutation<{ context: LiveMacroContext }, Error>({
    mutationFn: async () => {
      const res = await fetch("/api/macro/live/refresh", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ context: LiveMacroContext }>;
    },
    onSuccess: (data) => setLiveCtx(data.context),
  });

  // Auto-load on mount
  useState(() => { void handleFetchLive(); });

  return (
    <div className="h-full overflow-auto" style={{ backgroundColor: C.bg, fontFamily: "Space Grotesk" }}>
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: C.secondary + "22", border: `1px solid ${C.secondary}44` }}>
            <span className="material-icons text-lg" style={{ color: C.secondary }}>trending_up</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Institutional Intelligence</h1>
            <div style={{ color: C.muted, fontSize: "11px" }}>
              YoungTraderWealth · Macro Bias → Retail Sentiment → Technical Entry
            </div>
          </div>
        </div>

        {/* Live status banner */}
        <LiveStatusBanner
          liveCtx={liveCtx}
          onRefresh={() => refreshMutation.mutate()}
          isRefreshing={refreshMutation.isPending || isFetching}
        />

        {/* Live result cards (when live data is loaded) */}
        {liveCtx?.isLive && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <span className="material-icons text-sm" style={{ color: C.secondary }}>public</span>
                <MicroLabel>Live Macro Bias</MicroLabel>
                <Pill label={liveCtx.macroBias.bias.replace("_", " ")} color={biasColor(liveCtx.macroBias.bias)} />
                <Pill label={liveCtx.macroBias.conviction} color={convictionColor(liveCtx.macroBias.conviction)} />
              </div>
              <div className="mb-2">
                <div className="flex justify-between mb-1">
                  <MicroLabel>Score</MicroLabel>
                  <span className="text-xs font-mono" style={{ color: biasColor(liveCtx.macroBias.bias) }}>
                    {(liveCtx.macroBias.score * 100).toFixed(1)}%
                  </span>
                </div>
                <ScoreBar value={liveCtx.macroBias.score} color={biasColor(liveCtx.macroBias.bias)} />
              </div>
              <div className="space-y-0.5">
                {liveCtx.macroBias.reasons.slice(0, 3).map((r, i) => (
                  <div key={i} className="text-xs" style={{ color: C.muted }}>· {r}</div>
                ))}
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <span className="material-icons text-sm" style={{ color: C.gold }}>people</span>
                <MicroLabel>Live Sentiment</MicroLabel>
                <Pill label={liveCtx.sentiment.crowdingLevel} color={crowdingColor(liveCtx.sentiment.crowdingLevel)} />
                {liveCtx.sentiment.institutionalEdge !== "none" && (
                  <Pill label={liveCtx.sentiment.institutionalEdge.replace("_", " ")} color={C.cyan} />
                )}
              </div>
              <div className="mb-2">
                <div className="flex justify-between mb-1">
                  <MicroLabel>Sentiment Score</MicroLabel>
                  <span className="text-xs font-mono" style={{ color: C.gold }}>
                    {(liveCtx.sentiment.sentimentScore * 100).toFixed(1)}%
                  </span>
                </div>
                <ScoreBar value={liveCtx.sentiment.sentimentScore} color={C.gold} />
              </div>
              <div className="space-y-0.5">
                {liveCtx.sentiment.reasons.slice(0, 3).map((r, i) => (
                  <div key={i} className="text-xs" style={{ color: C.muted }}>· {r}</div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* 3-Layer Method explainer */}
        <MethodExplainer />

        {/* Layer 1 + Layer 2 manual/auto panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <MacroBiasPanel liveInput={liveCtx?.snapshot.macroBiasInput} />
          <SentimentPanel liveInput={liveCtx?.snapshot.sentimentInput} />
        </div>

        {/* Layer 3 Technical Reference */}
        <TechnicalLayer />
      </div>
    </div>
  );
}
