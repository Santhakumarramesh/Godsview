/**
 * institutional-intelligence.tsx
 *
 * Elliot Hewitt's 3-Layer Institutional Analysis:
 *   Layer 1 — Macro Bias (DXY, rate differentials, CPI, VIX)
 *   Layer 2 — Retail Sentiment (crowd positioning, contrarian edge)
 *   Layer 3 — Technical (links to War Room + Checklist)
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus, Users, Globe, AlertTriangle, CheckCircle, XCircle } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MacroBiasResult {
  bias: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
  direction: "long" | "short" | "flat";
  score: number;
  conviction: "high" | "medium" | "low";
  aligned: boolean;
  reasons: string[];
  blockedDirections: string[];
  tailwind: boolean;
  headwind: boolean;
  updatedAt: string;
}

interface SentimentResult {
  retailBias: "long_crowded" | "short_crowded" | "balanced";
  institutionalEdge: "fade_long" | "fade_short" | "none";
  sentimentScore: number;
  crowdingLevel: "extreme" | "high" | "moderate" | "low";
  aligned: boolean;
  contrarian: boolean;
  reasons: string[];
  updatedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const BIAS_COLORS: Record<string, string> = {
  strong_buy:  "text-emerald-400",
  buy:         "text-green-400",
  neutral:     "text-gray-400",
  sell:        "text-red-400",
  strong_sell: "text-red-600",
};

const BIAS_BG: Record<string, string> = {
  strong_buy:  "bg-emerald-500/10 border-emerald-500/30",
  buy:         "bg-green-500/10 border-green-500/30",
  neutral:     "bg-gray-500/10 border-gray-500/30",
  sell:        "bg-red-500/10 border-red-500/30",
  strong_sell: "bg-red-700/10 border-red-700/30",
};

const CROWDING_COLORS: Record<string, string> = {
  extreme:  "text-red-400",
  high:     "text-orange-400",
  moderate: "text-yellow-400",
  low:      "text-gray-400",
};

function BiasIcon({ direction }: { direction: "long" | "short" | "flat" }) {
  if (direction === "long")  return <TrendingUp  className="w-5 h-5 text-emerald-400" />;
  if (direction === "short") return <TrendingDown className="w-5 h-5 text-red-400" />;
  return <Minus className="w-5 h-5 text-gray-400" />;
}

function ScoreBar({ value, max = 1, color = "bg-blue-500" }: { value: number; max?: number; color?: string }) {
  const pct = Math.round((Math.abs(value) / max) * 100);
  return (
    <div className="w-full bg-gray-800 rounded-full h-2">
      <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MacroBiasPanel() {
  const [form, setForm] = useState({
    dxySlope: "0.003",
    rateDifferentialBps: "50",
    cpiMomentum: "0.1",
    vixLevel: "18",
    macroRiskScore: "0",
    assetClass: "crypto",
    intendedDirection: "long",
  });

  const mutation = useMutation<MacroBiasResult, Error, typeof form>({
    mutationFn: async (data) => {
      const res = await fetch("/api/macro/bias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dxySlope: Number(data.dxySlope),
          rateDifferentialBps: Number(data.rateDifferentialBps),
          cpiMomentum: Number(data.cpiMomentum),
          vixLevel: Number(data.vixLevel),
          macroRiskScore: Number(data.macroRiskScore),
          assetClass: data.assetClass,
          intendedDirection: data.intendedDirection,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<MacroBiasResult>;
    },
  });

  const result = mutation.data;

  return (
    <div className="bg-[#0f0f1a] border border-gray-800 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-5">
        <Globe className="w-5 h-5 text-blue-400" />
        <h2 className="text-lg font-semibold text-white">Layer 1 — Macro Bias</h2>
        <span className="text-xs text-gray-500 ml-auto">Elliot Hewitt · YoungTraderWealth</span>
      </div>

      {/* Input grid */}
      <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
        {[
          { key: "dxySlope",            label: "DXY Slope",         hint: "EMA-20 normalised" },
          { key: "rateDifferentialBps", label: "Rate Diff (bps)",   hint: "Fed minus target CB" },
          { key: "cpiMomentum",         label: "CPI Momentum",      hint: "ΔYoY %" },
          { key: "vixLevel",            label: "VIX Level",         hint: ">25 = risk-off" },
          { key: "macroRiskScore",      label: "Macro Risk",        hint: "0=clear, 1=lockout" },
        ].map(({ key, label, hint }) => (
          <div key={key}>
            <label className="block text-gray-400 mb-1">{label} <span className="text-gray-600">({hint})</span></label>
            <input
              type="number"
              step="any"
              value={form[key as keyof typeof form]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-white focus:border-blue-500 outline-none"
            />
          </div>
        ))}

        <div>
          <label className="block text-gray-400 mb-1">Asset Class</label>
          <select
            value={form.assetClass}
            onChange={(e) => setForm((f) => ({ ...f, assetClass: e.target.value }))}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-white"
          >
            {["crypto", "forex", "equity", "commodity"].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-gray-400 mb-1">Intended Direction</label>
          <select
            value={form.intendedDirection}
            onChange={(e) => setForm((f) => ({ ...f, intendedDirection: e.target.value }))}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-white"
          >
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </div>
      </div>

      <button
        onClick={() => mutation.mutate(form)}
        disabled={mutation.isPending}
        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
      >
        {mutation.isPending ? "Analysing…" : "Compute Macro Bias"}
      </button>

      {/* Result */}
      {result && (
        <div className={`mt-4 rounded-lg border p-4 ${BIAS_BG[result.bias]}`}>
          <div className="flex items-center gap-3 mb-3">
            <BiasIcon direction={result.direction} />
            <span className={`text-xl font-bold uppercase tracking-wide ${BIAS_COLORS[result.bias]}`}>
              {result.bias.replace("_", " ")}
            </span>
            <span className="ml-auto text-gray-400 text-sm">Conviction: <span className="text-white font-medium">{result.conviction}</span></span>
          </div>

          <div className="mb-3">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Score</span><span>{(result.score * 100).toFixed(0)}%</span>
            </div>
            <ScoreBar
              value={result.score}
              color={result.direction === "long" ? "bg-emerald-500" : result.direction === "short" ? "bg-red-500" : "bg-gray-500"}
            />
          </div>

          {result.tailwind && (
            <div className="flex items-center gap-1.5 text-emerald-400 text-sm mb-2">
              <CheckCircle className="w-4 h-4" />
              <span>Macro tailwind — trade aligns with institutional flow</span>
            </div>
          )}
          {result.headwind && (
            <div className="flex items-center gap-1.5 text-red-400 text-sm mb-2">
              <XCircle className="w-4 h-4" />
              <span>Macro headwind — trade against institutional flow</span>
            </div>
          )}
          {result.blockedDirections.length > 0 && (
            <div className="flex items-center gap-1.5 text-orange-400 text-sm mb-2">
              <AlertTriangle className="w-4 h-4" />
              <span>High-conviction block: {result.blockedDirections.join(", ")} trades suppressed</span>
            </div>
          )}

          <ul className="mt-2 space-y-1">
            {result.reasons.map((r, i) => (
              <li key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
                <span className="text-gray-600 mt-0.5">›</span>{r}
              </li>
            ))}
          </ul>
        </div>
      )}
      {mutation.isError && (
        <div className="mt-3 text-red-400 text-sm">{mutation.error.message}</div>
      )}
    </div>
  );
}

function SentimentPanel() {
  const [form, setForm] = useState({
    retailLongRatio: "0.72",
    priceTrendSlope: "0.002",
    cvdNet: "5000",
    openInterestChange: "1000",
    fundingRate: "0.0003",
    assetClass: "crypto",
    intendedDirection: "long",
  });

  const mutation = useMutation<SentimentResult, Error, typeof form>({
    mutationFn: async (data) => {
      const res = await fetch("/api/macro/sentiment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          retailLongRatio: Number(data.retailLongRatio),
          priceTrendSlope: Number(data.priceTrendSlope),
          cvdNet: Number(data.cvdNet),
          openInterestChange: Number(data.openInterestChange),
          fundingRate: Number(data.fundingRate),
          intendedDirection: data.intendedDirection,
          assetClass: data.assetClass,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<SentimentResult>;
    },
  });

  const result = mutation.data;
  const crowdPct = result ? Math.round(
    result.retailBias === "long_crowded"  ? Number(form.retailLongRatio) * 100 :
    result.retailBias === "short_crowded" ? (1 - Number(form.retailLongRatio)) * 100 : 50
  ) : null;

  return (
    <div className="bg-[#0f0f1a] border border-gray-800 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-5">
        <Users className="w-5 h-5 text-purple-400" />
        <h2 className="text-lg font-semibold text-white">Layer 2 — Retail Sentiment</h2>
        <span className="text-xs text-gray-500 ml-auto">Contrarian Edge</span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
        {[
          { key: "retailLongRatio",    label: "Retail Long Ratio",  hint: "0–1, e.g. 0.72" },
          { key: "priceTrendSlope",    label: "Price Trend Slope",  hint: "normalised" },
          { key: "cvdNet",             label: "CVD Net (20 bars)",  hint: "buy pressure" },
          { key: "openInterestChange", label: "OI Change",          hint: "+ = rising" },
          { key: "fundingRate",        label: "Funding Rate",       hint: "crypto only" },
        ].map(({ key, label, hint }) => (
          <div key={key}>
            <label className="block text-gray-400 mb-1">{label} <span className="text-gray-600">({hint})</span></label>
            <input
              type="number"
              step="any"
              value={form[key as keyof typeof form]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-white focus:border-purple-500 outline-none"
            />
          </div>
        ))}

        <div>
          <label className="block text-gray-400 mb-1">Asset Class</label>
          <select
            value={form.assetClass}
            onChange={(e) => setForm((f) => ({ ...f, assetClass: e.target.value }))}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-white"
          >
            {["crypto", "forex", "equity", "commodity"].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-gray-400 mb-1">Intended Direction</label>
          <select
            value={form.intendedDirection}
            onChange={(e) => setForm((f) => ({ ...f, intendedDirection: e.target.value }))}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-white"
          >
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </div>
      </div>

      <button
        onClick={() => mutation.mutate(form)}
        disabled={mutation.isPending}
        className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
      >
        {mutation.isPending ? "Analysing…" : "Compute Sentiment Edge"}
      </button>

      {result && (
        <div className={`mt-4 rounded-lg border p-4 ${
          result.contrarian ? "bg-red-500/10 border-red-500/30" :
          result.aligned    ? "bg-purple-500/10 border-purple-500/30" :
                              "bg-gray-800/50 border-gray-700"
        }`}>
          {/* Crowd gauge */}
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Retail Short</span>
              <span className="font-medium text-white">
                {Math.round(Number(form.retailLongRatio) * 100)}% Long /&nbsp;
                {Math.round((1 - Number(form.retailLongRatio)) * 100)}% Short
              </span>
              <span>Retail Long</span>
            </div>
            <div className="relative w-full h-3 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-red-600 via-gray-600 to-emerald-600 opacity-30 absolute inset-0"
              />
              <div
                className="h-full w-1 bg-white absolute top-0 transition-all"
                style={{ left: `calc(${Math.round(Number(form.retailLongRatio) * 100)}% - 2px)` }}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 mb-3">
            <span className={`text-lg font-bold ${CROWDING_COLORS[result.crowdingLevel]}`}>
              {result.crowdingLevel.toUpperCase()} CROWDING
            </span>
            <span className="text-gray-400 text-sm ml-auto">
              Edge: <span className="text-white font-medium">{result.institutionalEdge.replace("_", " ")}</span>
            </span>
          </div>

          <div className="mb-3">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Sentiment Score</span>
              <span>{(result.sentimentScore * 100).toFixed(0)}%</span>
            </div>
            <ScoreBar
              value={Math.abs(result.sentimentScore)}
              color={result.sentimentScore > 0 ? "bg-purple-500" : "bg-orange-500"}
            />
          </div>

          {result.aligned && !result.contrarian && (
            <div className="flex items-center gap-1.5 text-purple-400 text-sm mb-2">
              <CheckCircle className="w-4 h-4" />
              <span>Trade aligned with institutional positioning</span>
            </div>
          )}
          {result.contrarian && (
            <div className="flex items-center gap-1.5 text-red-400 text-sm mb-2">
              <AlertTriangle className="w-4 h-4" />
              <span>Trading WITH the crowd — institutional counter-position likely</span>
            </div>
          )}

          <ul className="mt-2 space-y-1">
            {result.reasons.map((r, i) => (
              <li key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
                <span className="text-gray-600 mt-0.5">›</span>{r}
              </li>
            ))}
          </ul>
        </div>
      )}
      {mutation.isError && (
        <div className="mt-3 text-red-400 text-sm">{mutation.error.message}</div>
      )}
    </div>
  );
}

// ── Layer 3 quick-link card ───────────────────────────────────────────────────

function TechnicalLayer() {
  return (
    <div className="bg-[#0f0f1a] border border-gray-800 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-5 h-5 text-yellow-400" />
        <h2 className="text-lg font-semibold text-white">Layer 3 — Technical Entry</h2>
        <span className="text-xs text-gray-500 ml-auto">SMC + CVD + Checklist</span>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Once macro bias and sentiment confirm your directional thesis, use GodsView's
        structural analysis tools to find the precise entry within the institutional order flow.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {[
          { href: "/war-room",  label: "War Room",     desc: "Multi-agent consensus",   color: "border-blue-600 hover:bg-blue-600/10"    },
          { href: "/checklist", label: "Checklist",    desc: "Pre-trade validation",     color: "border-green-600 hover:bg-green-600/10"  },
          { href: "/pipeline",  label: "Pipeline",     desc: "7-layer SI decision",      color: "border-purple-600 hover:bg-purple-600/10"},
          { href: "/candle-xray",label:"Candle X-Ray", desc: "Microstructure analysis",  color: "border-yellow-600 hover:bg-yellow-600/10"},
        ].map(({ href, label, desc, color }) => (
          <a
            key={href}
            href={href}
            className={`block p-3 rounded-lg border bg-transparent transition-colors cursor-pointer ${color}`}
          >
            <div className="text-white font-medium text-sm">{label}</div>
            <div className="text-gray-500 text-xs mt-0.5">{desc}</div>
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Method explainer ─────────────────────────────────────────────────────────

function MethodExplainer() {
  return (
    <div className="bg-[#0f0f1a] border border-gray-800 rounded-xl p-6 col-span-full">
      <h2 className="text-base font-semibold text-white mb-3">
        YoungTraderWealth — 3-Layer Institutional Confluence
      </h2>
      <div className="grid grid-cols-3 gap-4 text-sm">
        {[
          {
            num: "01",
            title: "Macro Bias",
            color: "text-blue-400",
            body: "Trade WITH central bank policy. If DXY is strengthening and the Fed is hawkish relative to ECB/BOE, only take USD long setups. Counter-macro trades require 3× the technical confirmation.",
          },
          {
            num: "02",
            title: "Retail Sentiment",
            color: "text-purple-400",
            body: "When 70–80% of retail traders are on one side, institutions are on the other. Use OANDA/IG positioning, funding rates, and CVD divergence to identify the institutional counter-trade.",
          },
          {
            num: "03",
            title: "Technical Entry",
            color: "text-yellow-400",
            body: "Only enter at premium/discount zones, order blocks, or FVGs in the direction of macro + sentiment confluence. A technically perfect setup against macro/sentiment has poor R:R.",
          },
        ].map(({ num, title, color, body }) => (
          <div key={num} className="flex gap-3">
            <span className={`text-2xl font-black opacity-30 ${color}`}>{num}</span>
            <div>
              <div className={`font-semibold mb-1 ${color}`}>{title}</div>
              <p className="text-gray-400 text-xs leading-relaxed">{body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function InstitutionalIntelligence() {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Institutional Intelligence</h1>
          <p className="text-gray-400 text-sm mt-1">
            3-layer confluence analysis — macro · sentiment · technical
          </p>
        </div>
        <div className="text-xs text-gray-600 bg-gray-900 border border-gray-800 rounded px-3 py-1.5">
          YoungTraderWealth method
        </div>
      </div>

      <MethodExplainer />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MacroBiasPanel />
        <SentimentPanel />
      </div>

      <TechnicalLayer />
    </div>
  );
}
