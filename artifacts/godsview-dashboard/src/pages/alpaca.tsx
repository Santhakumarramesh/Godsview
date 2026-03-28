import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";

const BASE = "/api";

type AnalyzeResult = {
  instrument: string;
  alpaca_symbol: string;
  analyzed_at: string;
  bars_analyzed: Record<string, number>;
  recall_features: Record<string, number>;
  setups_detected: number;
  setups: Array<{
    setup_type: string;
    direction: string;
    structure_score: number;
    order_flow_score: number;
    recall_score: number;
    final_quality: number;
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    tp_ticks: number;
    sl_ticks: number;
    bar_time: string;
    atr: number;
  }>;
};

type BacktestResult = {
  instrument: string;
  setup_type: string;
  days_analyzed: number;
  bars_scanned: number;
  total_signals: number;
  closed_signals: number;
  wins: number;
  losses: number;
  win_rate: number;
  profit_factor: number;
  expectancy_ticks: number;
  avg_final_quality: number;
  high_quality_signals: number;
  high_quality_win_rate: number;
  results: Array<{
    bar_time: string;
    entry_price: number;
    direction: string;
    structure_score: number;
    order_flow_score: number;
    recall_score: number;
    final_quality: number;
    outcome: string;
    hit_tp: boolean;
    bars_to_outcome: number;
    tp_ticks: number;
    sl_ticks: number;
  }>;
};

type AccuracyResult = {
  total_records: number;
  closed: number;
  wins: number;
  win_rate: number;
  by_setup: Array<{ setup_type: string; total: number; wins: number; win_rate: number; avg_quality: number }>;
  recent: Array<{ bar_time: string; setup_type: string; symbol: string; outcome: string; final_quality: string }>;
};

function pct(n: number) {
  return (n * 100).toFixed(1) + "%";
}
function fmt(n: number, d = 3) {
  return n.toFixed(d);
}

// Crypto instruments work with free Alpaca endpoint (no Trading API key needed)
// Stock instruments (MES→SPY, MNQ→QQQ) require Trading API keys (PK/AK prefix)
const INSTRUMENTS = [
  { value: "BTCUSDT", label: "BTC/USD (Crypto · Live)", live: true },
  { value: "ETHUSDT", label: "ETH/USD (Crypto · Live)", live: true },
  { value: "MES", label: "MES → SPY (Needs Trading Key)", live: false },
  { value: "MNQ", label: "MNQ → QQQ (Needs Trading Key)", live: false },
];
const SETUPS = ["absorption_reversal", "sweep_reclaim", "continuation_pullback"];

function QualityBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 55 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-white/10 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono w-10 text-right">{pct}%</span>
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${color}`}>
      {label}
    </span>
  );
}

export default function AlpacaPage() {
  const [instrument, setInstrument] = useState("BTCUSDT");
  const [selectedSetup, setSelectedSetup] = useState("absorption_reversal");
  const [backtestDays, setBacktestDays] = useState(3);
  const [activeTab, setActiveTab] = useState<"live" | "backtest" | "accuracy">("live");

  const { data: accuracy, refetch: refetchAccuracy } = useQuery<AccuracyResult>({
    queryKey: ["alpaca-accuracy"],
    queryFn: () => fetch(`${BASE}/alpaca/accuracy`).then((r) => r.json()),
  });

  const analyzeMutation = useMutation<AnalyzeResult>({
    mutationFn: () =>
      fetch(`${BASE}/alpaca/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instrument, setups: SETUPS }),
      }).then((r) => r.json()),
  });

  const backtestMutation = useMutation<BacktestResult>({
    mutationFn: () =>
      fetch(`${BASE}/alpaca/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instrument, setup_type: selectedSetup, days: backtestDays }),
      }).then((r) => {
        refetchAccuracy();
        return r.json();
      }),
  });

  const analyzeData = analyzeMutation.data;
  const btData = backtestMutation.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Alpaca Market Analysis</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Live recall engine · Setup detection · Walk-forward accuracy learning
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Crypto Data Live
          </div>
          <span className="text-xs text-amber-400/80">Stocks: Trading API key needed</span>
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Instrument</label>
          <select
            value={instrument}
            onChange={(e) => setInstrument(e.target.value)}
            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
          >
            {INSTRUMENTS.map((i) => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Setup Filter</label>
          <select
            value={selectedSetup}
            onChange={(e) => setSelectedSetup(e.target.value)}
            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
          >
            {SETUPS.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Backtest Days</label>
          <select
            value={backtestDays}
            onChange={(e) => setBacktestDays(Number(e.target.value))}
            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
          >
            {[1, 2, 3, 5, 7, 10, 14].map((d) => (
              <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 items-end">
          <button
            onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending}
            className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            {analyzeMutation.isPending ? "Scanning..." : "Scan Now"}
          </button>
          <button
            onClick={() => backtestMutation.mutate()}
            disabled={backtestMutation.isPending}
            className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            {backtestMutation.isPending ? "Running..." : "Backtest"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-card border border-border rounded-lg p-1 w-fit">
        {(["live", "backtest", "accuracy"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "live" ? "Live Analysis" : tab === "backtest" ? "Backtest Results" : "Accuracy DB"}
          </button>
        ))}
      </div>

      {/* Live Analysis Tab */}
      {activeTab === "live" && (
        <div className="space-y-4">
          {analyzeMutation.isPending && (
            <div className="bg-card border border-border rounded-xl p-8 text-center">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">Fetching live bars · Running recall engine · Detecting setups...</p>
            </div>
          )}
          {analyzeMutation.error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
              {String(analyzeMutation.error)}
            </div>
          )}
          {analyzeData && (analyzeData as any).error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
              {(analyzeData as any).message ?? "Analysis failed"}
            </div>
          )}
          {analyzeData && !(analyzeData as any).error && (
            <>
              {/* Summary bar */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground">Symbol</div>
                  <div className="text-lg font-bold mt-1">{analyzeData.alpaca_symbol}</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground">Bars Loaded</div>
                  <div className="text-lg font-bold mt-1">
                    {Object.values(analyzeData.bars_analyzed).join(" / ")}
                    <span className="text-xs text-muted-foreground ml-1">1m/5m/15m</span>
                  </div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground">Setups Detected</div>
                  <div className={`text-lg font-bold mt-1 ${analyzeData.setups_detected > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                    {analyzeData.setups_detected}
                  </div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs text-muted-foreground">Scanned At</div>
                  <div className="text-sm font-mono mt-1">
                    {new Date(analyzeData.analyzed_at).toLocaleTimeString()}
                  </div>
                </div>
              </div>

              {/* Recall Features */}
              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wide">Recall Engine Context</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Object.entries(analyzeData.recall_features).map(([key, val]) => (
                    <div key={key}>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{key.replace(/_/g, " ")}</div>
                      <div className={`text-sm font-mono font-semibold ${
                        typeof val === "number" && val > 0 ? "text-emerald-400" : typeof val === "number" && val < 0 ? "text-red-400" : "text-foreground"
                      }`}>
                        {typeof val === "number" ? fmt(val, 4) : String(val)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Detected Setups */}
              {analyzeData.setups_detected === 0 ? (
                <div className="bg-card border border-border rounded-xl p-8 text-center">
                  <div className="text-4xl mb-3">📊</div>
                  <p className="text-muted-foreground">No setups detected right now on {analyzeData.alpaca_symbol}</p>
                  <p className="text-xs text-muted-foreground mt-1">Run scan again during active market hours for best results</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Detected Setups</h3>
                  {analyzeData.setups.map((s, i) => (
                    <div key={i} className="bg-card border border-emerald-500/30 rounded-xl p-5">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-emerald-400">{s.setup_type.replace(/_/g, " ").toUpperCase()}</span>
                            <Badge
                              label={s.direction.toUpperCase()}
                              color={s.direction === "long" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}
                            />
                          </div>
                          <div className="text-xs text-muted-foreground">{new Date(s.bar_time).toLocaleTimeString()}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold">{pct(s.final_quality)}</div>
                          <div className="text-xs text-muted-foreground">Final Quality</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Entry</div>
                          <div className="font-mono font-semibold">${fmt(s.entry_price, 2)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-emerald-400 mb-1">Take Profit (+{s.tp_ticks} ticks)</div>
                          <div className="font-mono font-semibold text-emerald-400">${fmt(s.take_profit, 2)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-red-400 mb-1">Stop Loss (-{s.sl_ticks} ticks)</div>
                          <div className="font-mono font-semibold text-red-400">${fmt(s.stop_loss, 2)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">ATR</div>
                          <div className="font-mono font-semibold">{fmt(s.atr, 4)}</div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>Structure (30%)</span><span>{pct(s.structure_score)}</span>
                        </div>
                        <QualityBar value={s.structure_score} />
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>Order Flow (25%)</span><span>{pct(s.order_flow_score)}</span>
                        </div>
                        <QualityBar value={s.order_flow_score} />
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>Recall (20%)</span><span>{pct(s.recall_score)}</span>
                        </div>
                        <QualityBar value={s.recall_score} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {!analyzeData && !analyzeMutation.isPending && (
            <div className="bg-card border border-dashed border-border rounded-xl p-12 text-center">
              <div className="text-5xl mb-4">🔍</div>
              <p className="text-muted-foreground font-medium">Click "Scan Now" to run the recall engine on live Alpaca bars</p>
              <p className="text-xs text-muted-foreground mt-2">Fetches 1m · 5m · 15m bars → runs setup detection → scores each layer</p>
            </div>
          )}
        </div>
      )}

      {/* Backtest Tab */}
      {activeTab === "backtest" && (
        <div className="space-y-4">
          {backtestMutation.isPending && (
            <div className="bg-card border border-border rounded-xl p-8 text-center">
              <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">Fetching historical bars · Walk-forward scanning · Computing accuracy...</p>
            </div>
          )}
          {btData && !(btData as any).error && (
            <>
              {/* Stats grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Win Rate", value: pct(btData.win_rate), color: btData.win_rate >= 0.55 ? "text-emerald-400" : "text-red-400" },
                  { label: "Profit Factor", value: fmt(btData.profit_factor, 2), color: btData.profit_factor >= 1.5 ? "text-emerald-400" : "text-yellow-400" },
                  { label: "Expectancy (ticks)", value: fmt(btData.expectancy_ticks, 1), color: btData.expectancy_ticks > 0 ? "text-emerald-400" : "text-red-400" },
                  { label: "Avg Quality", value: pct(btData.avg_final_quality), color: "text-foreground" },
                  { label: "Total Signals", value: String(btData.total_signals), color: "text-foreground" },
                  { label: "Closed", value: String(btData.closed_signals), color: "text-foreground" },
                  { label: "High Quality WR", value: pct(btData.high_quality_win_rate), color: btData.high_quality_win_rate >= 0.6 ? "text-emerald-400" : "text-yellow-400" },
                  { label: "Bars Scanned", value: String(btData.bars_scanned), color: "text-muted-foreground" },
                ].map((m) => (
                  <div key={m.label} className="bg-card border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground">{m.label}</div>
                    <div className={`text-xl font-bold mt-1 ${m.color}`}>{m.value}</div>
                  </div>
                ))}
              </div>

              {/* Results table */}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <h3 className="font-semibold text-sm">Walk-Forward Results (last 50)</h3>
                  <span className="text-xs text-muted-foreground">{btData.setup_type.replace(/_/g, " ")} · {btData.instrument} · {btData.days_analyzed}d</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="px-4 py-2 text-left">Time</th>
                        <th className="px-4 py-2 text-left">Dir</th>
                        <th className="px-4 py-2 text-right">Entry</th>
                        <th className="px-4 py-2 text-right">Structure</th>
                        <th className="px-4 py-2 text-right">OF</th>
                        <th className="px-4 py-2 text-right">Recall</th>
                        <th className="px-4 py-2 text-right">Quality</th>
                        <th className="px-4 py-2 text-right">TP/SL</th>
                        <th className="px-4 py-2 text-center">Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {btData.results.map((r, i) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2 font-mono text-muted-foreground">
                            {new Date(r.bar_time).toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td className="px-4 py-2">
                            <Badge
                              label={r.direction.toUpperCase()}
                              color={r.direction === "long" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}
                            />
                          </td>
                          <td className="px-4 py-2 text-right font-mono">{fmt(r.entry_price, 2)}</td>
                          <td className="px-4 py-2 text-right">{pct(r.structure_score)}</td>
                          <td className="px-4 py-2 text-right">{pct(r.order_flow_score)}</td>
                          <td className="px-4 py-2 text-right">{pct(r.recall_score)}</td>
                          <td className="px-4 py-2 text-right font-semibold">{pct(r.final_quality)}</td>
                          <td className="px-4 py-2 text-right text-muted-foreground">+{r.tp_ticks} / -{r.sl_ticks}</td>
                          <td className="px-4 py-2 text-center">
                            <Badge
                              label={r.outcome.toUpperCase()}
                              color={
                                r.outcome === "win" ? "bg-emerald-500/20 text-emerald-400" :
                                r.outcome === "loss" ? "bg-red-500/20 text-red-400" :
                                "bg-yellow-500/20 text-yellow-400"
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
          {btData && (btData as any).error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
              {(btData as any).message ?? "Backtest failed"}
            </div>
          )}
          {!btData && !backtestMutation.isPending && (
            <div className="bg-card border border-dashed border-border rounded-xl p-12 text-center">
              <div className="text-5xl mb-4">📈</div>
              <p className="text-muted-foreground font-medium">Click "Backtest" to run a walk-forward accuracy scan</p>
              <p className="text-xs text-muted-foreground mt-2">Scans historical 1m bars · detects setups · checks TP/SL forward outcomes · saves to accuracy DB</p>
            </div>
          )}
        </div>
      )}

      {/* Accuracy DB Tab */}
      {activeTab === "accuracy" && accuracy && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-xs text-muted-foreground">Total Signals Learned</div>
              <div className="text-2xl font-bold mt-1">{accuracy.total_records}</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-xs text-muted-foreground">Closed Outcomes</div>
              <div className="text-2xl font-bold mt-1">{accuracy.closed}</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-xs text-muted-foreground">Overall Win Rate</div>
              <div className={`text-2xl font-bold mt-1 ${accuracy.win_rate >= 0.55 ? "text-emerald-400" : "text-yellow-400"}`}>
                {pct(accuracy.win_rate)}
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-xs text-muted-foreground">Total Wins</div>
              <div className="text-2xl font-bold mt-1 text-emerald-400">{accuracy.wins}</div>
            </div>
          </div>

          {accuracy.by_setup.length > 0 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="p-4 border-b border-border">
                <h3 className="font-semibold text-sm">Accuracy by Setup</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground text-xs">
                    <th className="px-4 py-2 text-left">Setup</th>
                    <th className="px-4 py-2 text-right">Signals</th>
                    <th className="px-4 py-2 text-right">Wins</th>
                    <th className="px-4 py-2 text-right">Win Rate</th>
                    <th className="px-4 py-2 text-right">Avg Quality</th>
                  </tr>
                </thead>
                <tbody>
                  {accuracy.by_setup.map((s) => (
                    <tr key={s.setup_type} className="border-b border-border/50">
                      <td className="px-4 py-3 font-medium">{s.setup_type.replace(/_/g, " ")}</td>
                      <td className="px-4 py-3 text-right">{s.total}</td>
                      <td className="px-4 py-3 text-right text-emerald-400">{s.wins}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={s.win_rate >= 0.55 ? "text-emerald-400 font-semibold" : "text-yellow-400"}>
                          {pct(s.win_rate)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">{pct(s.avg_quality)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {accuracy.recent.length > 0 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="p-4 border-b border-border">
                <h3 className="font-semibold text-sm">Recent Accuracy Records</h3>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="px-4 py-2 text-left">Time</th>
                    <th className="px-4 py-2 text-left">Symbol</th>
                    <th className="px-4 py-2 text-left">Setup</th>
                    <th className="px-4 py-2 text-right">Quality</th>
                    <th className="px-4 py-2 text-center">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {accuracy.recent.map((r, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="px-4 py-2 font-mono text-muted-foreground">
                        {new Date(r.bar_time).toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-4 py-2 font-semibold">{r.symbol}</td>
                      <td className="px-4 py-2 text-muted-foreground">{r.setup_type.replace(/_/g, " ")}</td>
                      <td className="px-4 py-2 text-right">{pct(Number(r.final_quality))}</td>
                      <td className="px-4 py-2 text-center">
                        <Badge
                          label={r.outcome?.toUpperCase() ?? "OPEN"}
                          color={
                            r.outcome === "win" ? "bg-emerald-500/20 text-emerald-400" :
                            r.outcome === "loss" ? "bg-red-500/20 text-red-400" :
                            "bg-yellow-500/20 text-yellow-400"
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {accuracy.total_records === 0 && (
            <div className="bg-card border border-dashed border-border rounded-xl p-12 text-center">
              <div className="text-5xl mb-4">🧠</div>
              <p className="text-muted-foreground font-medium">No accuracy data yet</p>
              <p className="text-xs text-muted-foreground mt-2">Run a backtest to start building the accuracy database</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
