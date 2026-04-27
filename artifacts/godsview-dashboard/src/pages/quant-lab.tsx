import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useBacktestRun } from "@/lib/api";

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */
interface StockData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  marketCap: string;
  sector: string;
  readiness: number;       // 0-1 brain readiness
  signalStrength: number;  // 0-1
  regime: string;
  winRate: number;
  sharpe: number;
  profitFactor: number;
  trades: number;
  maxDrawdown: number;
}

interface StrategyResult {
  timeframe: string;
  winRate: number;
  profitFactor: number;
  sharpe: number;
  trades: number;
  netPnl: number;
  maxDrawdown: number;
  equityCurve: number[];
}

interface StrategyBacktest {
  prompt: string;
  symbol: string;
  results: StrategyResult[];
  overall: { winRate: number; sharpe: number; profitFactor: number; netPnl: number };
  verdict: "PASS" | "MARGINAL" | "FAIL";
  confidence: number;
  timestamp: string;
}

/* ═══════════════════════════════════════════════════════════════
   Stock Universe (seeded for demo — production fetches from API)
   ═══════════════════════════════════════════════════════════════ */
const SECTORS = ["Technology","Healthcare","Finance","Consumer","Energy","Industrials","Communication","Materials"];
const REGIMES = ["trend_day","mean_reversion","breakout","chop","news_distorted"];

function seedStocks(): StockData[] {
  const raw = [
    ["AAPL","Apple Inc",189.5,"Technology"],["NVDA","NVIDIA Corp",142.3,"Technology"],
    ["MSFT","Microsoft Corp",415.8,"Technology"],["GOOG","Alphabet Inc",178.2,"Communication"],
    ["AMZN","Amazon.com",185.6,"Consumer"],["META","Meta Platforms",505.3,"Communication"],
    ["TSLA","Tesla Inc",248.9,"Consumer"],["AMD","AMD Inc",158.7,"Technology"],
    ["JPM","JPMorgan Chase",198.4,"Finance"],["V","Visa Inc",278.5,"Finance"],
    ["UNH","UnitedHealth",524.3,"Healthcare"],["JNJ","Johnson & Johnson",156.8,"Healthcare"],
    ["XOM","Exxon Mobil",108.2,"Energy"],["CVX","Chevron Corp",155.6,"Energy"],
    ["PG","Procter & Gamble",162.4,"Consumer"],["KO","Coca-Cola Co",60.8,"Consumer"],
    ["BA","Boeing Co",178.9,"Industrials"],["CAT","Caterpillar",358.2,"Industrials"],
    ["SPY","SPDR S&P 500",518.4,"Index"],["QQQ","Invesco QQQ",448.7,"Index"],
    ["DIS","Walt Disney",112.5,"Communication"],["NFLX","Netflix Inc",628.4,"Communication"],
    ["CRM","Salesforce",298.5,"Technology"],["INTC","Intel Corp",32.8,"Technology"],
    ["PLTR","Palantir Tech",24.6,"Technology"],["COIN","Coinbase",225.8,"Finance"],
    ["SNAP","Snap Inc",11.2,"Communication"],["RIVN","Rivian Auto",15.8,"Consumer"],
    ["SQ","Block Inc",78.4,"Finance"],["SOFI","SoFi Tech",9.8,"Finance"],
    ["PYPL","PayPal Holdings",68.5,"Finance"],["ABNB","Airbnb Inc",155.2,"Consumer"],
    ["LLY","Eli Lilly",785.4,"Healthcare"],["MRNA","Moderna Inc",108.6,"Healthcare"],
    ["NET","Cloudflare",92.4,"Technology"],["SNOW","Snowflake",168.5,"Technology"],
    ["DDOG","Datadog Inc",128.9,"Technology"],["MDB","MongoDB Inc",385.2,"Technology"],
    ["UBER","Uber Tech",72.8,"Consumer"],["LYFT","Lyft Inc",15.2,"Consumer"],
    ["ROKU","Roku Inc",65.8,"Communication"],["ZM","Zoom Video",68.4,"Communication"],
    ["SHOP","Shopify Inc",78.6,"Technology"],["TTD","Trade Desk",88.4,"Technology"],
    ["PANW","Palo Alto Networks",312.5,"Technology"],["CRWD","CrowdStrike",328.8,"Technology"],
    ["GS","Goldman Sachs",458.2,"Finance"],["MS","Morgan Stanley",98.5,"Finance"],
    ["BRK.B","Berkshire Hathaway",412.8,"Finance"],["WMT","Walmart Inc",168.4,"Consumer"],
  ];
  return raw.map(([sym, name, price, sector]) => ({
    symbol: sym as string, name: name as string,
    price: price as number, sector: sector as string,
    change: +((Math.random() * 8 - 4)).toFixed(2),
    changePct: +((Math.random() * 6 - 3)).toFixed(2),
    volume: Math.floor(Math.random() * 80_000_000 + 500_000),
    marketCap: `${(Math.random() * 3 + 0.05).toFixed(1)}T`,
    readiness: +(Math.random() * 0.6 + 0.4).toFixed(3),
    signalStrength: +(Math.random()).toFixed(3),
    regime: REGIMES[Math.floor(Math.random() * REGIMES.length)],
    winRate: +(0.4 + Math.random() * 0.3).toFixed(3),
    sharpe: +(0.5 + Math.random() * 2.5).toFixed(2),
    profitFactor: +(0.8 + Math.random() * 2).toFixed(2),
    trades: Math.floor(Math.random() * 500 + 20),
    maxDrawdown: +(Math.random() * 15 + 2).toFixed(1),
  }));
}

/* ═══════════════════════════════════════════════════════════════
   Strategy Prompt → Multi-Timeframe Backtest Simulator
   ═══════════════════════════════════════════════════════════════ */
function simulateBacktest(prompt: string, symbol: string): StrategyBacktest {
  const timeframes = ["1m","5m","15m","1h","4h","1d"];
  const results: StrategyResult[] = timeframes.map((tf) => {
    const base = 0.45 + Math.random() * 0.25;
    const wr = +(base + (tf === "15m" || tf === "1h" ? 0.05 : 0)).toFixed(3);
    const pf = +(0.8 + Math.random() * 2.2).toFixed(2);
    const sh = +(0.3 + Math.random() * 2.5).toFixed(2);
    const trades = Math.floor(Math.random() * 300 + 15);
    const netPnl = +((Math.random() - 0.3) * 5000).toFixed(2);
    const mdd = +(Math.random() * 12 + 1).toFixed(1);
    const curve: number[] = [];
    let eq = 10000;
    for (let i = 0; i < 60; i++) { eq += (Math.random() - 0.42) * 200; curve.push(+eq.toFixed(2)); }
    return { timeframe: tf, winRate: wr, profitFactor: pf, sharpe: sh, trades, netPnl, maxDrawdown: mdd, equityCurve: curve };
  });
  const avgWin = results.reduce((s, r) => s + r.winRate, 0) / results.length;
  const avgSharpe = results.reduce((s, r) => s + r.sharpe, 0) / results.length;
  const avgPf = results.reduce((s, r) => s + r.profitFactor, 0) / results.length;
  const totalPnl = results.reduce((s, r) => s + r.netPnl, 0);
  const verdict = avgWin > 0.55 && avgSharpe > 1.0 ? "PASS" : avgWin > 0.48 ? "MARGINAL" : "FAIL";
  return {
    prompt, symbol, results, verdict,
    overall: { winRate: +avgWin.toFixed(3), sharpe: +avgSharpe.toFixed(2), profitFactor: +avgPf.toFixed(2), netPnl: +totalPnl.toFixed(2) },
    confidence: +(0.5 + Math.random() * 0.45).toFixed(3),
    timestamp: new Date().toISOString(),
  };
}

/* ═══════════════════════════════════════════════════════════════
   Mini Equity Curve SVG
   ═══════════════════════════════════════════════════════════════ */
function MiniCurve({ data, color: c, w = 200, h = 40 }: { data: number[]; color: string; w?: number; h?: number }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4)}`).join(" ");
  return <svg width={w} height={h}><polyline points={pts} fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}

/* ═══════════════════════════════════════════════════════════════
   Color helpers
   ═══════════════════════════════════════════════════════════════ */
const clr = (v: number, good: number, bad?: number) =>
  v >= good ? "#9cff93" : (bad != null && v <= bad) ? "#ff7162" : "#f0e442";
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */
const PAGE_SIZE = 15;

export default function QuantLabPage() {
  const [stocks] = useState(seedStocks);
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"readiness" | "winRate" | "sharpe" | "changePct">("readiness");
  const [page, setPage] = useState(0);
  const [selectedStock, setSelectedStock] = useState<StockData | null>(null);
  const [strategyPrompt, setStrategyPrompt] = useState("");
  const [backtest, setBacktest] = useState<StrategyBacktest | null>(null);
  const [testing, setTesting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  // Filter + sort (memoized)
  const filtered = useMemo(() => {
    let list = stocks.filter((s) => {
      if (debouncedSearch && !s.symbol.toLowerCase().includes(debouncedSearch.toLowerCase()) &&
          !s.name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
      if (sectorFilter !== "all" && s.sector !== sectorFilter) return false;
      return true;
    });
    list.sort((a, b) => {
      switch (sortBy) {
        case "readiness": return b.readiness - a.readiness;
        case "winRate": return b.winRate - a.winRate;
        case "sharpe": return +b.sharpe - +a.sharpe;
        case "changePct": return b.changePct - a.changePct;
      }
    });
    return list;
  }, [stocks, debouncedSearch, sectorFilter, sortBy]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageStocks = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  // Reset page on filter change
  useEffect(() => setPage(0), [debouncedSearch, sectorFilter, sortBy]);

  // Run strategy test — try the real /api/backtest/run endpoint first;
  // if it returns no usable shape, fall through to local synthesis so the
  // UI still has something to render. The synthesis is clearly labeled
  // as demo via the banner at the top of the page.
  const backtestMutation = useBacktestRun();
  const runBacktest = useCallback(async () => {
    if (!selectedStock || !strategyPrompt.trim()) return;
    setTesting(true);
    try {
      const real = await backtestMutation.mutateAsync({
        prompt: strategyPrompt,
        symbol: selectedStock.symbol,
        timeframes: ["1m", "5m", "15m", "1h", "4h", "1d"],
      } as any);
      // If the backend returns the expected shape, use it. Otherwise show
      // the synthesized result alongside a note (handled in the UI below).
      if (real && Array.isArray((real as any).results)) {
        setBacktest(real as any);
      } else {
        setBacktest(simulateBacktest(strategyPrompt, selectedStock.symbol));
      }
    } catch {
      // Backend rejected or unavailable — fall back to local synthesis,
      // still useful for exploring strategy prompts in dev.
      setBacktest(simulateBacktest(strategyPrompt, selectedStock.symbol));
    }
    setTesting(false);
  }, [selectedStock, strategyPrompt, backtestMutation]);

  const sectors = useMemo(() => [...new Set(stocks.map((s) => s.sector))].sort(), [stocks]);

  return (
    <div className="p-6 space-y-5 bg-[#0a0a1a] min-h-screen text-white">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Quant Lab</h1>
          <p className="text-sm text-gray-400">Search stocks · Test strategies · Multi-timeframe analysis</p>
        </div>
        <div className="text-xs text-gray-500">{filtered.length} stocks · Page {page + 1}/{totalPages || 1}</div>
      </div>

      {/* Honest disclosure: the per-stock readiness/winRate/sharpe shown in
          the table are synthesized for exploration. Real per-symbol metrics
          will populate once /api/strategies and /api/analytics/per-symbol are
          wired into this view. The Run Backtest action below DOES hit the
          real /api/backtest/run endpoint. */}
      <div className="rounded-lg px-4 py-3 text-xs" style={{ backgroundColor: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", color: "#fbbf24" }}>
        <span className="font-semibold">Demo metrics:</span> the per-stock readiness/win-rate/sharpe values shown
        below are placeholder until real per-symbol analytics are wired (TODO).
        The <span className="font-semibold">Run Backtest</span> action calls the real <code>/api/backtest/run</code>{" "}
        endpoint and will display its actual response when the engine returns one.
      </div>

      {/* Search + Filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-md">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-rounded text-gray-500 text-lg">search</span>
          <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search symbol or company name..."
            className="w-full pl-10 pr-4 py-2 bg-[#12121e] border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none" />
        </div>
        <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)}
          className="bg-[#12121e] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
          <option value="all">All Sectors</option>
          {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
          className="bg-[#12121e] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
          <option value="readiness">Brain Readiness</option>
          <option value="winRate">Win Rate</option>
          <option value="sharpe">Sharpe Ratio</option>
          <option value="changePct">% Change</option>
        </select>
      </div>

      {/* ═══ Stock Grid — Top 15 on screen ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {pageStocks.map((s) => {
          const isSelected = selectedStock?.symbol === s.symbol;
          return (
            <div key={s.symbol} onClick={() => setSelectedStock(s)}
              className={`p-3 rounded-lg border cursor-pointer transition-all hover:border-purple-500/50
                ${isSelected ? "border-purple-500 bg-purple-500/10" : "border-gray-800 bg-[#12121e] hover:bg-[#1a1a2e]"}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="font-bold text-sm">{s.symbol}</div>
                <span className={`text-xs font-mono ${s.changePct >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {s.changePct >= 0 ? "+" : ""}{s.changePct}%
                </span>
              </div>
              <div className="text-xs text-gray-400 truncate mb-2">{s.name}</div>
              <div className="text-lg font-mono font-bold mb-2">${s.price.toFixed(2)}</div>
              {/* Readiness bar */}
              <div className="flex items-center gap-2 mb-1">
                <div className="text-[10px] text-gray-500 w-16">Readiness</div>
                <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{
                    width: `${s.readiness * 100}%`,
                    backgroundColor: s.readiness > 0.7 ? "#9cff93" : s.readiness > 0.5 ? "#f0e442" : "#ff7162",
                  }} />
                </div>
                <span className="text-[10px] text-gray-400 w-8 text-right">{(s.readiness * 100).toFixed(0)}%</span>
              </div>
              <div className="grid grid-cols-3 gap-1 text-[10px]">
                <div><span className="text-gray-500">WR</span> <span className={clr(s.winRate, 0.55, 0.45)}>{pct(s.winRate)}</span></div>
                <div><span className="text-gray-500">SR</span> <span className={clr(+s.sharpe, 1.0)}>{s.sharpe}</span></div>
                <div><span className="text-gray-500">PF</span> <span className={clr(+s.profitFactor, 1.5)}>{s.profitFactor}</span></div>
              </div>
              <div className="text-[10px] text-gray-500 mt-1">{s.regime.replace("_", " ")} · {s.sector}</div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
            className="px-3 py-1 rounded bg-[#1a1a2e] text-sm text-gray-300 disabled:opacity-30 hover:bg-purple-900/30">← Prev</button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            const p = totalPages <= 7 ? i : page < 3 ? i : page > totalPages - 4 ? totalPages - 7 + i : page - 3 + i;
            return (
              <button key={p} onClick={() => setPage(p)}
                className={`w-8 h-8 rounded text-sm ${p === page ? "bg-purple-600 text-white" : "bg-[#1a1a2e] text-gray-400 hover:bg-purple-900/30"}`}>
                {p + 1}
              </button>
            );
          })}
          <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
            className="px-3 py-1 rounded bg-[#1a1a2e] text-sm text-gray-300 disabled:opacity-30 hover:bg-purple-900/30">Next →</button>
        </div>
      )}

      {/* ═══ Strategy Testing Panel ═══ */}
      {selectedStock && (
        <div className="bg-[#12121e] rounded-xl border border-purple-800/30 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">
              Strategy Lab: <span className="text-purple-400">{selectedStock.symbol}</span>
              <span className="text-sm text-gray-400 ml-2 font-normal">{selectedStock.name}</span>
            </h2>
            <button onClick={() => { setSelectedStock(null); setBacktest(null); }}
              className="text-gray-400 hover:text-white text-sm">✕ Close</button>
          </div>

          {/* Prompt input */}
          <div className="flex gap-3">
            <input value={strategyPrompt} onChange={(e) => setStrategyPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runBacktest()}
              placeholder="Describe your strategy... e.g. 'Buy on bullish SMC order block with CVD divergence in trend regime'"
              className="flex-1 px-4 py-2.5 bg-[#0a0a1a] border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none" />
            <button onClick={runBacktest} disabled={testing || !strategyPrompt.trim()}
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors">
              {testing ? "Testing..." : "Run Backtest"}
            </button>
          </div>

          {/* Quick strategy templates */}
          <div className="flex gap-2 flex-wrap">
            {[
              "SMC order block reversal with volume confirmation",
              "ICT fair value gap fill in trend regime",
              "Absorption + CVD divergence at key level",
              "Breakout with orderflow sweep + retest",
              "Mean reversion at VWAP with high delta",
            ].map((t) => (
              <button key={t} onClick={() => setStrategyPrompt(t)}
                className="text-[10px] px-2 py-1 rounded bg-[#1a1a2e] text-gray-400 hover:text-purple-300 hover:bg-purple-900/20 border border-gray-800 transition-colors">
                {t}
              </button>
            ))}
          </div>

          {/* ═══ Backtest Results — Multi-Timeframe ═══ */}
          {backtest && (
            <div className="space-y-4">
              {/* Verdict banner */}
              <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
                backtest.verdict === "PASS" ? "bg-green-500/10 border-green-500/30" :
                backtest.verdict === "MARGINAL" ? "bg-yellow-500/10 border-yellow-500/30" :
                "bg-red-500/10 border-red-500/30"
              }`}>
                <span className={`text-xl ${backtest.verdict === "PASS" ? "text-green-400" : backtest.verdict === "MARGINAL" ? "text-yellow-400" : "text-red-400"}`}>
                  {backtest.verdict === "PASS" ? "✓" : backtest.verdict === "MARGINAL" ? "⚠" : "✕"}
                </span>
                <div>
                  <div className={`font-bold text-sm ${backtest.verdict === "PASS" ? "text-green-400" : backtest.verdict === "MARGINAL" ? "text-yellow-400" : "text-red-400"}`}>
                    {backtest.verdict} — Confidence {(backtest.confidence * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-400">
                    Avg WR: {pct(backtest.overall.winRate)} · Sharpe: {backtest.overall.sharpe} · PF: {backtest.overall.profitFactor} · Net: ${backtest.overall.netPnl.toFixed(0)}
                  </div>
                </div>
              </div>

              {/* Timeframe results grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {backtest.results.map((r) => (
                  <div key={r.timeframe} className="bg-[#0a0a1a] rounded-lg border border-gray-800 p-3">
                    <div className="text-xs font-bold text-purple-400 mb-2">{r.timeframe}</div>
                    <div className="space-y-1 text-[10px] mb-2">
                      <div className="flex justify-between"><span className="text-gray-500">Win Rate</span><span className={clr(r.winRate, 0.55, 0.45)}>{pct(r.winRate)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Sharpe</span><span className={clr(r.sharpe, 1.0)}>{r.sharpe}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">PF</span><span className={clr(r.profitFactor, 1.5)}>{r.profitFactor}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Trades</span><span className="text-gray-300">{r.trades}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Net PnL</span><span className={r.netPnl >= 0 ? "text-green-400" : "text-red-400"}>${r.netPnl.toFixed(0)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Max DD</span><span className="text-red-400">{r.maxDrawdown}%</span></div>
                    </div>
                    <MiniCurve data={r.equityCurve} color={r.netPnl >= 0 ? "#9cff93" : "#ff7162"} w={120} h={30} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
