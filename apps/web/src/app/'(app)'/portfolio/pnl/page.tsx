"use client";

import { useState, useEffect } from "react";
import { BarChart3, TrendingUp, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";

interface StrategyPnL {
  strategy: string;
  pnl: number;
  pnlPct: number;
  trades: number;
  winRate: number;
}

interface SymbolPnL {
  symbol: string;
  pnl: number;
  pnlPct: number;
  quantity: number;
  avgPrice: number;
}

interface PnLData {
  today: number;
  week: number;
  month: number;
  allTime: number;
  strategies: StrategyPnL[];
  symbols: SymbolPnL[];
}

const mockPnLData: PnLData = {
  today: 3250,
  week: 12840,
  month: 45230,
  allTime: 187450,
  strategies: [
    { strategy: "RSI Mean Reversion", pnl: 8420, pnlPct: 3.2, trades: 45, winRate: 64 },
    { strategy: "Volume Breakout", pnl: 5120, pnlPct: 2.1, trades: 28, winRate: 58 },
    { strategy: "MACD Cross", pnl: 2340, pnlPct: 1.5, trades: 15, winRate: 53 },
    { strategy: "Momentum", pnl: 1350, pnlPct: 0.8, trades: 12, winRate: 50 },
  ],
  symbols: [
    { symbol: "AAPL", pnl: 4500, pnlPct: 2.8, quantity: 100, avgPrice: 182.45 },
    { symbol: "MSFT", pnl: 3200, pnlPct: 1.9, quantity: 50, avgPrice: 425.50 },
    { symbol: "TSLA", pnl: 2800, pnlPct: 2.1, quantity: 75, avgPrice: 242.18 },
    { symbol: "NVDA", pnl: -1200, pnlPct: -0.5, quantity: 25, avgPrice: 895.50 },
    { symbol: "GLD", pnl: -2050, pnlPct: -1.2, quantity: 40, avgPrice: 185.20 },
  ],
};

export default function PortfolioPnLPage() {
  const [pnlData, setPnLData] = useState<PnLData>(mockPnLData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"summary" | "strategies" | "symbols">("summary");

  useEffect(() => {
    const fetchPnL = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.portfolio.getPnL?.();
        if (result) {
          setPnLData(result);
        }
      } catch (err) {
        console.error("Error fetching P&L:", err);
        setError("Failed to fetch P&L data");
      } finally {
        setLoading(false);
      }
    };

    fetchPnL();
  }, []);

  const getPnLColor = (pnl: number) => {
    return pnl > 0 ? "text-green-400" : pnl < 0 ? "text-red-400" : "text-slate-400";
  };

  const getPnLBg = (pnl: number) => {
    return pnl > 0
      ? "bg-green-500/20 border-green-500/30"
      : pnl < 0
        ? "bg-red-500/20 border-red-500/30"
        : "bg-slate-500/20 border-slate-500/30";
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-8 h-8 text-emerald-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">P&L Dashboard</h1>
              <p className="text-slate-400 text-sm">Portfolio profit and loss analysis</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 flex items-center gap-2 text-red-300">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <p className="text-slate-400">Loading P&L data...</p>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className={`rounded-lg p-6 border ${getPnLBg(pnlData.today)}`}>
                <p className="text-slate-400 text-xs font-semibold uppercase mb-2">
                  Today
                </p>
                <p className={`text-3xl font-bold ${getPnLColor(pnlData.today)}`}>
                  {pnlData.today > 0 ? "+" : ""}${pnlData.today.toLocaleString()}
                </p>
              </div>

              <div className={`rounded-lg p-6 border ${getPnLBg(pnlData.week)}`}>
                <p className="text-slate-400 text-xs font-semibold uppercase mb-2">
                  This Week
                </p>
                <p className={`text-3xl font-bold ${getPnLColor(pnlData.week)}`}>
                  {pnlData.week > 0 ? "+" : ""}${pnlData.week.toLocaleString()}
                </p>
              </div>

              <div className={`rounded-lg p-6 border ${getPnLBg(pnlData.month)}`}>
                <p className="text-slate-400 text-xs font-semibold uppercase mb-2">
                  This Month
                </p>
                <p className={`text-3xl font-bold ${getPnLColor(pnlData.month)}`}>
                  {pnlData.month > 0 ? "+" : ""}${pnlData.month.toLocaleString()}
                </p>
              </div>

              <div className={`rounded-lg p-6 border ${getPnLBg(pnlData.allTime)}`}>
                <p className="text-slate-400 text-xs font-semibold uppercase mb-2">
                  All Time
                </p>
                <p className={`text-3xl font-bold ${getPnLColor(pnlData.allTime)}`}>
                  {pnlData.allTime > 0 ? "+" : ""}${pnlData.allTime.toLocaleString()}
                </p>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b border-slate-700 pb-4">
              {(["summary", "strategies", "symbols"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    activeTab === tab
                      ? "bg-emerald-500/30 text-emerald-300 border border-emerald-500/50"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {tab === "summary"
                    ? "Summary"
                    : tab === "strategies"
                      ? "By Strategy"
                      : "By Symbol"}
                </button>
              ))}
            </div>

            {/* Strategy P&L Table */}
            {activeTab === "strategies" && (
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-white mb-4">
                  P&L by Strategy
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-700">
                      <tr className="text-slate-400 text-xs uppercase font-semibold">
                        <th className="text-left py-3 px-4">Strategy</th>
                        <th className="text-right py-3 px-4">P&L</th>
                        <th className="text-right py-3 px-4">%</th>
                        <th className="text-center py-3 px-4">Trades</th>
                        <th className="text-center py-3 px-4">Win Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pnlData.strategies.map((strategy) => (
                        <tr
                          key={strategy.strategy}
                          className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors"
                        >
                          <td className="py-3 px-4 font-semibold text-white">
                            {strategy.strategy}
                          </td>
                          <td
                            className={`py-3 px-4 text-right font-semibold ${getPnLColor(
                              strategy.pnl
                            )}`}
                          >
                            {strategy.pnl > 0 ? "+" : ""}${strategy.pnl.toLocaleString()}
                          </td>
                          <td
                            className={`py-3 px-4 text-right font-semibold ${getPnLColor(
                              strategy.pnlPct
                            )}`}
                          >
                            {strategy.pnlPct > 0 ? "+" : ""}
                            {strategy.pnlPct}%
                          </td>
                          <td className="py-3 px-4 text-center text-white">
                            {strategy.trades}
                          </td>
                          <td className="py-3 px-4 text-center text-green-400 font-semibold">
                            {strategy.winRate}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Symbol P&L Table */}
            {activeTab === "symbols" && (
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-white mb-4">P&L by Symbol</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-700">
                      <tr className="text-slate-400 text-xs uppercase font-semibold">
                        <th className="text-left py-3 px-4">Symbol</th>
                        <th className="text-right py-3 px-4">P&L</th>
                        <th className="text-right py-3 px-4">%</th>
                        <th className="text-right py-3 px-4">Quantity</th>
                        <th className="text-right py-3 px-4">Avg Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pnlData.symbols.map((symbol) => (
                        <tr
                          key={symbol.symbol}
                          className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors"
                        >
                          <td className="py-3 px-4 font-semibold text-white">
                            {symbol.symbol}
                          </td>
                          <td
                            className={`py-3 px-4 text-right font-semibold ${getPnLColor(
                              symbol.pnl
                            )}`}
                          >
                            {symbol.pnl > 0 ? "+" : ""}${symbol.pnl.toLocaleString()}
                          </td>
                          <td
                            className={`py-3 px-4 text-right font-semibold ${getPnLColor(
                              symbol.pnlPct
                            )}`}
                          >
                            {symbol.pnlPct > 0 ? "+" : ""}
                            {symbol.pnlPct}%
                          </td>
                          <td className="py-3 px-4 text-right text-white">
                            {symbol.quantity}
                          </td>
                          <td className="py-3 px-4 text-right text-slate-300">
                            ${symbol.avgPrice.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Summary View */}
            {activeTab === "summary" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Strategies */}
                <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
                  <h2 className="text-lg font-semibold text-white mb-4">
                    Top Performing Strategies
                  </h2>
                  <div className="space-y-3">
                    {pnlData.strategies
                      .sort((a, b) => b.pnl - a.pnl)
                      .slice(0, 3)
                      .map((strategy) => (
                        <div
                          key={strategy.strategy}
                          className="flex items-center justify-between p-3 bg-slate-800/50 rounded border border-slate-700"
                        >
                          <div>
                            <p className="text-sm font-semibold text-white">
                              {strategy.strategy}
                            </p>
                            <p className="text-xs text-slate-400">
                              {strategy.trades} trades • {strategy.winRate}% win rate
                            </p>
                          </div>
                          <p
                            className={`text-lg font-bold ${getPnLColor(strategy.pnl)}`}
                          >
                            {strategy.pnl > 0 ? "+" : ""}${(
                              strategy.pnl / 1000
                            ).toFixed(1)}K
                          </p>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Top Symbols */}
                <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
                  <h2 className="text-lg font-semibold text-white mb-4">
                    Top Performing Symbols
                  </h2>
                  <div className="space-y-3">
                    {pnlData.symbols
                      .sort((a, b) => b.pnl - a.pnl)
                      .slice(0, 3)
                      .map((symbol) => (
                        <div
                          key={symbol.symbol}
                          className="flex items-center justify-between p-3 bg-slate-800/50 rounded border border-slate-700"
                        >
                          <div>
                            <p className="text-sm font-semibold text-white">
                              {symbol.symbol}
                            </p>
                            <p className="text-xs text-slate-400">
                              {symbol.quantity} @ ${symbol.avgPrice.toFixed(2)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p
                              className={`text-lg font-bold ${getPnLColor(
                                symbol.pnl
                              )}`}
                            >
                              {symbol.pnl > 0 ? "+" : ""}${symbol.pnl.toLocaleString()}
                            </p>
                            <p className={`text-xs ${getPnLColor(symbol.pnlPct)}`}>
                              {symbol.pnlPct > 0 ? "+" : ""}
                              {symbol.pnlPct}%
                            </p>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
