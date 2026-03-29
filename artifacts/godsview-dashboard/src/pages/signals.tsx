import { useGetSignals, useCreateSignal, type CreateSignalRequest } from "@workspace/api-client-react";
import { formatNumber, cn } from "@/lib/utils";
import { format } from "date-fns";
import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import TradingViewChart from "@/components/TradingViewChart";
import ReplayEngine from "@/components/ReplayEngine";

const C = {
  card: "#1a191b",
  cardHigh: "#201f21",
  border: "rgba(72,72,73,0.25)",
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  muted: "#adaaab",
  outline: "#767576",
  outlineVar: "#484849",
};

type OrderBlockPlot = {
  time: number;
  ts: string;
  side: "bullish" | "bearish";
  low: number;
  high: number;
  mid: number;
  strength: number;
};

type SignalPlotResponse = {
  chart: {
    symbol: string;
    tradingview_symbol: string;
    timeframe: string;
    live_stream: string;
  };
  position: {
    direction: "long" | "short";
    entry_price: number | null;
    stop_loss: number | null;
    take_profit: number | null;
    risk_reward: number | null;
  };
  order_blocks: OrderBlockPlot[];
  generated_at: string;
};

type AutoBacktestSummary = {
  total_signals: number;
  closed_signals: number;
  wins: number;
  losses: number;
  win_rate: number;
  profit_factor: number;
  expectancy_dollars: number;
  gross_pnl_dollars: number;
  fake_entry_rate: number;
  claude_reviewed_signals: number;
  claude_approved_rate: number;
};

type AutoBacktestResponse = {
  signal_id: number;
  instrument: string;
  alpaca_symbol: string;
  setup_type: string;
  days_analyzed: number;
  summary: AutoBacktestSummary;
  recommendations: string[];
};

function toPct(v: number | null | undefined): number {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  return n <= 1 ? n * 100 : n;
}

function MicroLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", color: C.outline }}>{children}</span>;
}

function InputField({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1">
      <MicroLabel>{label}</MicroLabel>
      <input {...props} className="w-full rounded px-3 py-2 text-sm outline-none transition-all focus:border-[#9cff93]"
        style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}`, color: "#ffffff", fontFamily: "JetBrains Mono, monospace", fontSize: "12px" }}
      />
    </div>
  );
}

export default function Signals() {
  const [instrumentFilter, setInstrumentFilter] = useState<string>("");
  const { data, isLoading } = useGetSignals({ instrument: instrumentFilter || undefined, limit: 50 });
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [learnBySignal, setLearnBySignal] = useState<Record<number, AutoBacktestResponse>>({});

  const plotQuery = useQuery<SignalPlotResponse>({
    queryKey: ["signal-plot", expandedId],
    queryFn: async () => {
      const r = await fetch(`/api/signals/${expandedId}/plot`);
      if (!r.ok) throw new Error(`signal plot fetch failed: ${r.status}`);
      return r.json();
    },
    enabled: expandedId != null,
    staleTime: 20_000,
  });

  const autoLearnMutation = useMutation({
    mutationFn: async (signalId: number) => {
      const r = await fetch(`/api/signals/${signalId}/autobacktest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days: 14, include_claude: true, claude_sample: 16 }),
      });
      if (!r.ok) throw new Error(`auto-backtest failed: ${r.status}`);
      return r.json() as Promise<AutoBacktestResponse>;
    },
    onSuccess: (result) => {
      setLearnBySignal((prev) => ({ ...prev, [result.signal_id]: result }));
    },
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: "6px" }}>
            Godsview · Signal Intelligence
          </div>
          <h1 className="font-headline font-bold text-2xl tracking-tight">Signal Feed</h1>
          <p style={{ fontSize: "11px", color: C.muted, marginTop: "8px", maxWidth: "780px" }}>
            Each signal now includes live chart context, order block plotting levels, and long/short position map. Use Auto Backtest + Claude Learn to replay past behavior and reduce fake entries.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={instrumentFilter}
            onChange={(e) => setInstrumentFilter(e.target.value)}
            className="rounded px-3 py-1.5 text-xs outline-none"
            style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, color: "#ffffff", fontFamily: "Space Grotesk" }}
          >
            <option value="">All Instruments</option>
            <option value="BTCUSDT">BTCUSDT</option>
            <option value="ETHUSDT">ETHUSDT</option>
            <option value="SOLUSDT">SOLUSDT</option>
            <option value="MES">MES</option>
            <option value="MNQ">MNQ</option>
          </select>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded transition-all hover:brightness-110"
            style={{ backgroundColor: "rgba(102,157,255,0.12)", border: `1px solid rgba(102,157,255,0.25)`, color: C.secondary, fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>add</span>
            Inject Signal
          </button>
        </div>
      </div>

      {showCreate && <CreateSignalDialog onClose={() => setShowCreate(false)} />}

      {/* Table */}
      <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        {isLoading ? (
          <div className="flex justify-center py-16">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: C.primary }} />
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.3)" }}>
                {["Timestamp", "Asset", "Setup", "Str", "OF", "Rcl", "ML", "Cld", "Final Q.", "Status", "View"].map((h) => (
                  <th key={h} className="px-4 py-2.5" style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: C.outlineVar, whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.signals.map((sig) => {
                const q = toPct(Number(sig.final_quality));
                const qColor = q > 75 ? C.primary : q > 50 ? "#fbbf24" : C.tertiary;
                const statusColor =
                  sig.status === "approved" ? C.primary :
                  sig.status === "pending" ? "#fbbf24" :
                  sig.status === "executed" ? C.secondary :
                  sig.status === "rejected" ? C.tertiary :
                  C.muted;
                const isExpanded = expandedId === sig.id;
                const plot = isExpanded ? plotQuery.data : null;
                const learn = learnBySignal[sig.id];
                return (
                  <Fragment key={sig.id}>
                    <tr className="hover:brightness-105 transition-all" style={{ borderBottom: "1px solid rgba(72,72,73,0.12)" }}>
                      <td className="px-4 py-2.5 whitespace-nowrap" style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
                        {format(new Date(sig.created_at), "MM/dd HH:mm:ss")}
                      </td>
                      <td className="px-4 py-2.5 font-headline font-bold text-xs">{sig.instrument}</td>
                      <td className="px-4 py-2.5" style={{ fontSize: "9px", color: C.muted, whiteSpace: "nowrap" }}>{sig.setup_type.replace(/_/g, " ")}</td>
                      {[sig.structure_score, sig.order_flow_score, sig.recall_score, sig.ml_probability, sig.claude_score].map((v, i) => (
                        <td key={i} className="px-4 py-2.5" style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
                          {formatNumber(toPct(Number(v)), 1)}
                        </td>
                      ))}
                      <td className="px-4 py-2.5">
                        <span className="font-mono-num font-bold text-xs" style={{ color: qColor }}>{formatNumber(q, 1)}%</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-0.5 rounded" style={{
                          fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                          backgroundColor: `${statusColor}1A`,
                          color: statusColor,
                          border: `1px solid ${statusColor}4D`,
                        }}>
                          {sig.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : sig.id)}
                          className="px-2 py-1 rounded text-[9px] uppercase tracking-wider"
                          style={{
                            border: `1px solid ${isExpanded ? "rgba(156,255,147,0.35)" : "rgba(102,157,255,0.35)"}`,
                            color: isExpanded ? C.primary : C.secondary,
                            backgroundColor: isExpanded ? "rgba(156,255,147,0.08)" : "rgba(102,157,255,0.08)",
                          }}
                        >
                          {isExpanded ? "Hide" : "Chart"}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={11} className="px-4 py-4" style={{ backgroundColor: C.cardHigh }}>
                          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                            <div className="xl:col-span-2 rounded overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
                              <TradingViewChart symbol={plot?.chart.symbol ?? sig.instrument} timeframe="5" height={360} />
                            </div>
                            <div className="space-y-3">
                              <div className="rounded p-3" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
                                <MicroLabel>Position Plot</MicroLabel>
                                <div className="mt-2 text-[10px]" style={{ color: C.muted }}>
                                  <div>Direction: <span style={{ color: plot?.position.direction === "long" ? C.primary : C.tertiary, fontWeight: 700 }}>{plot?.position.direction?.toUpperCase() ?? "N/A"}</span></div>
                                  <div>Entry: <span className="font-mono">{plot?.position.entry_price?.toFixed(4) ?? "—"}</span></div>
                                  <div>Stop: <span className="font-mono" style={{ color: C.tertiary }}>{plot?.position.stop_loss?.toFixed(4) ?? "—"}</span></div>
                                  <div>Take Profit: <span className="font-mono" style={{ color: C.primary }}>{plot?.position.take_profit?.toFixed(4) ?? "—"}</span></div>
                                  <div>R:R: <span className="font-mono">{plot?.position.risk_reward ? plot.position.risk_reward.toFixed(2) : "—"}</span></div>
                                </div>
                              </div>

                              <div className="rounded p-3" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
                                <div className="flex items-center justify-between mb-2">
                                  <MicroLabel>Order Blocks (Auto)</MicroLabel>
                                  <span style={{ fontSize: "9px", color: C.outlineVar }}>{plot?.order_blocks?.length ?? 0}</span>
                                </div>
                                <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                                  {(plot?.order_blocks ?? []).slice(-10).reverse().map((ob) => (
                                    <div key={`${ob.ts}-${ob.side}-${ob.low}`} className="rounded px-2 py-1" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0f0f10" }}>
                                      <div style={{ fontSize: "9px", color: ob.side === "bullish" ? C.primary : C.tertiary, fontWeight: 700 }}>{ob.side.toUpperCase()}</div>
                                      <div style={{ fontSize: "9px", color: C.muted, fontFamily: "JetBrains Mono, monospace" }}>
                                        {ob.low.toFixed(2)} - {ob.high.toFixed(2)} · S {ob.strength.toFixed(2)}
                                      </div>
                                    </div>
                                  ))}
                                  {(plot?.order_blocks?.length ?? 0) === 0 && (
                                    <div style={{ fontSize: "10px", color: C.outlineVar }}>No recent order blocks found.</div>
                                  )}
                                </div>
                              </div>

                              <button
                                onClick={() => autoLearnMutation.mutate(sig.id)}
                                disabled={autoLearnMutation.isPending}
                                className={cn("w-full px-3 py-2 rounded text-[10px] uppercase tracking-wider", "disabled:opacity-60")}
                                style={{ border: "1px solid rgba(156,255,147,0.35)", color: C.primary, backgroundColor: "rgba(156,255,147,0.12)" }}
                              >
                                {autoLearnMutation.isPending ? "Running Auto Backtest..." : "Auto Backtest + Claude Learn"}
                              </button>
                            </div>
                          </div>

                          {plotQuery.isLoading && (
                            <div className="mt-3 text-xs" style={{ color: C.outlineVar }}>Loading chart payload...</div>
                          )}

                          {learn && (
                            <div className="mt-4 rounded p-3" style={{ border: `1px solid ${C.border}`, backgroundColor: "#101112" }}>
                              <div className="flex items-center justify-between mb-2">
                                <MicroLabel>Auto Backtest Summary ({learn.days_analyzed}d)</MicroLabel>
                                <span style={{ fontSize: "9px", color: C.outlineVar }}>{learn.setup_type}</span>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
                                <div>Win Rate: <span className="font-mono" style={{ color: learn.summary.win_rate > 0.5 ? C.primary : C.tertiary }}>{(learn.summary.win_rate * 100).toFixed(1)}%</span></div>
                                <div>Profit Factor: <span className="font-mono">{learn.summary.profit_factor.toFixed(2)}</span></div>
                                <div>Expectancy: <span className="font-mono">${learn.summary.expectancy_dollars.toFixed(2)}</span></div>
                                <div>Fake Entry: <span className="font-mono" style={{ color: learn.summary.fake_entry_rate < 0.25 ? C.primary : C.tertiary }}>{(learn.summary.fake_entry_rate * 100).toFixed(1)}%</span></div>
                                <div>Closed: <span className="font-mono">{learn.summary.closed_signals}</span></div>
                                <div>Wins/Losses: <span className="font-mono">{learn.summary.wins}/{learn.summary.losses}</span></div>
                                <div>Claude Reviewed: <span className="font-mono">{learn.summary.claude_reviewed_signals}</span></div>
                                <div>Claude Approved: <span className="font-mono">{(learn.summary.claude_approved_rate * 100).toFixed(1)}%</span></div>
                              </div>
                              {learn.recommendations.length > 0 && (
                                <div className="mt-3 space-y-1">
                                  {learn.recommendations.map((item, idx) => (
                                    <div key={`${learn.signal_id}-rec-${idx}`} style={{ fontSize: "10px", color: C.muted }}>
                                      {idx + 1}. {item}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          <div className="mt-4">
                            <ReplayEngine symbol={plot?.chart.symbol ?? sig.instrument} timeframe="5Min" barCount={120} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {(!data?.signals || data.signals.length === 0) && (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center" style={{ color: C.outlineVar, fontSize: "11px", fontFamily: "Space Grotesk" }}>
                    No signals found. Run a live scan or backtest to generate signals.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function CreateSignalDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const mutation = useCreateSignal({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
        onClose();
      },
    },
  });

  const [formData, setFormData] = useState<Partial<CreateSignalRequest>>({
    instrument: "BTCUSDT",
    setup_type: "sweep_reclaim",
    structure_score: 85,
    order_flow_score: 70,
    recall_score: 90,
    ml_probability: 75,
    claude_score: 88,
    news_lockout: false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({ data: formData as CreateSignalRequest });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-lg rounded overflow-hidden" style={{ backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.4)" }}>
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "rgba(72,72,73,0.25)" }}>
          <span className="font-headline font-bold text-sm tracking-wide">Inject Manual Signal</span>
          <button onClick={onClose} className="material-symbols-outlined text-base" style={{ color: C.outline }}>close</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <MicroLabel>Instrument</MicroLabel>
              <input value={formData.instrument} onChange={e => setFormData({ ...formData, instrument: e.target.value })} required
                className="w-full rounded px-3 py-2 text-xs outline-none" style={{ backgroundColor: "#0e0e0f", border: "1px solid rgba(72,72,73,0.35)", color: "#fff", fontFamily: "Space Grotesk" }} />
            </div>
            <div className="space-y-1">
              <MicroLabel>Setup Type</MicroLabel>
              <input value={formData.setup_type} onChange={e => setFormData({ ...formData, setup_type: e.target.value })} required
                className="w-full rounded px-3 py-2 text-xs outline-none" style={{ backgroundColor: "#0e0e0f", border: "1px solid rgba(72,72,73,0.35)", color: "#fff", fontFamily: "Space Grotesk" }} />
            </div>
            {(["structure_score", "order_flow_score", "recall_score", "ml_probability", "claude_score"] as const).map((field) => (
              <div key={field} className="space-y-1">
                <MicroLabel>{field.replace(/_/g, " ")}</MicroLabel>
                <input type="number" value={formData[field] as number} onChange={e => setFormData({ ...formData, [field]: Number(e.target.value) })} required
                  className="w-full rounded px-3 py-2 text-xs outline-none" style={{ backgroundColor: "#0e0e0f", border: "1px solid rgba(72,72,73,0.35)", color: "#fff", fontFamily: "JetBrains Mono, monospace" }} />
              </div>
            ))}
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="nl" checked={formData.news_lockout} onChange={e => setFormData({ ...formData, news_lockout: e.target.checked })}
                className="w-3.5 h-3.5 rounded" style={{ accentColor: C.primary }} />
              <label htmlFor="nl" style={{ fontSize: "10px", fontFamily: "Space Grotesk", color: C.muted }}>News Lockout Override</label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs rounded" style={{ color: C.outline, fontFamily: "Space Grotesk" }}>Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="px-6 py-2 text-xs rounded font-bold transition-all hover:brightness-110 disabled:opacity-50"
              style={{ backgroundColor: "rgba(156,255,147,0.12)", border: "1px solid rgba(156,255,147,0.25)", color: C.primary, fontFamily: "Space Grotesk", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              {mutation.isPending ? "Processing..." : "Inject Signal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
