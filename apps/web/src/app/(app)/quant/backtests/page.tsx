"use client";

import { useState } from "react";
import {
  BarChart3,
  TrendingUp,
  Calendar,
  Play,
  MoreVertical,
  Filter,
} from "lucide-react";

interface Trade {
  symbol: string;
  side: "LONG" | "SHORT";
  entry: number;
  exit: number;
  pnl: number;
  pnlPct: number;
  entryTime: string;
  exitTime: string;
}

interface BacktestResult {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  sharpe: number;
  maxDD: number;
  netPnL: number;
  avgHoldTime: string;
}

const strategies = ["RSI Mean Reversion", "Volume Breakout", "MACD Cross", "Bollinger Bands", "Ichimoku Signals"];
const symbols = ["AAPL", "MSFT", "TSLA", "NVDA", "SPY", "QQQ", "IWM", "GLD"];

const mockBacktestResult: BacktestResult = {
  totalTrades: 187,
  winRate: 62.5,
  profitFactor: 2.34,
  sharpe: 1.87,
  maxDD: -8.3,
  netPnL: 14250,
  avgHoldTime: "2h 34m",
};

const mockTrades: Trade[] = [
  {
    symbol: "AAPL",
    side: "LONG",
    entry: 182.45,
    exit: 185.20,
    pnl: 275,
    pnlPct: 1.51,
    entryTime: "09:45:12",
    exitTime: "12:32:58",
  },
  {
    symbol: "MSFT",
    side: "SHORT",
    entry: 418.20,
    exit: 415.80,
    pnl: 240,
    pnlPct: 0.57,
    entryTime: "10:15:45",
    exitTime: "14:20:15",
  },
  {
    symbol: "TSLA",
    side: "LONG",
    entry: 242.18,
    exit: 245.60,
    pnl: 340,
    pnlPct: 1.41,
    entryTime: "11:02:30",
    exitTime: "13:45:22",
  },
  {
    symbol: "NVDA",
    side: "LONG",
    entry: 895.50,
    exit: 888.20,
    pnl: -725,
    pnlPct: -0.81,
    entryTime: "11:30:15",
    exitTime: "12:55:45",
  },
  {
    symbol: "GOOG",
    side: "SHORT",
    entry: 175.82,
    exit: 176.45,
    pnl: -630,
    pnlPct: -0.36,
    entryTime: "12:00:00",
    exitTime: "14:30:20",
  },
];

const equityValues = [10000, 10250, 10480, 10720, 10450, 10850, 11200, 11450, 11850, 12150, 12420, 12890, 13200, 13580, 13920, 14250];

export default function BacktestsPage() {
  const [selectedStrategy, setSelectedStrategy] = useState("RSI Mean Reversion");
  const [selectedSymbol, setSelectedSymbol] = useState("AAPL");
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [hasRun, setHasRun] = useState(false);

  const handleRunBacktest = () => {
    setHasRun(true);
  };

  const maxEquity = Math.max(...equityValues);
  const minEquity = Math.min(...equityValues);
  const range = maxEquity - minEquity;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-8 h-8 text-amber-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Backtesting Engine</h1>
              <p className="text-slate-400 text-sm">Strategy performance analysis on historical data</p>
            </div>
          </div>
        </div>

        {/* Controls Panel */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            {/* Strategy Selector */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Strategy</label>
              <select
                value={selectedStrategy}
                onChange={(e) => setSelectedStrategy(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white focus:outline-none focus:border-amber-400"
              >
                {strategies.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* Symbol Selector */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Symbol</label>
              <select
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white focus:outline-none focus:border-amber-400"
              >
                {symbols.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* Start Date */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white focus:outline-none focus:border-amber-400"
              />
            </div>

            {/* End Date */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white focus:outline-none focus:border-amber-400"
              />
            </div>

            {/* Run Button */}
            <div className="flex items-end">
              <button
                onClick={handleRunBacktest}
                className="w-full px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-semibold rounded flex items-center justify-center gap-2 transition-all"
              >
                <Play className="w-4 h-4" />
                Run Backtest
              </button>
            </div>
          </div>
        </div>

        {hasRun && (
          <>
            {/* Results Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-xs font-medium uppercase mb-1">Total Trades</p>
                <p className="text-2xl font-bold text-white">{mockBacktestResult.totalTrades}</p>
              </div>
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-xs font-medium uppercase mb-1">Win Rate</p>
                <p className="text-2xl font-bold text-green-400">{mockBacktestResult.winRate}%</p>
              </div>
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-xs font-medium uppercase mb-1">Profit Factor</p>
                <p className="text-2xl font-bold text-blue-400">{mockBacktestResult.profitFactor}</p>
              </div>
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-xs font-medium uppercase mb-1">Sharpe</p>
                <p className="text-2xl font-bold text-cyan-400">{mockBacktestResult.sharpe}</p>
              </div>
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-xs font-medium uppercase mb-1">Max DD</p>
                <p className="text-2xl font-bold text-red-400">{mockBacktestResult.maxDD}%</p>
              </div>
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-xs font-medium uppercase mb-1">Net P&L</p>
                <p className="text-2xl font-bold text-green-400">${mockBacktestResult.netPnL.toLocaleString()}</p>
              </div>
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-xs font-medium uppercase mb-1">Avg Hold</p>
                <p className="text-lg font-bold text-amber-400">{mockBacktestResult.avgHoldTime}</p>
              </div>
            </div>

            {/* Equity Curve */}
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-400" />
                Equity Curve
              </h2>
              <div className="flex items-end justify-between h-48 gap-1 px-4">
                {equityValues.map((value, idx) => {
                  const normalized = (value - minEquity) / range;
                  return (
                    <div
                      key={idx}
                      className="flex-1 bg-gradient-to-t from-amber-500 to-amber-400 rounded-t opacity-80 hover:opacity-100 transition-opacity cursor-pointer"
                      style={{ height: `${normalized * 100}%` }}
                      title={`${new Date(2024, 0, 1 + idx).toLocaleDateString()}: $${value}`}
                    />
                  );
                })}
              </div>
              <p className="text-slate-400 text-xs text-center mt-2">16 data points spanning backtest period</p>
            </div>

            {/* Trade List Table */}
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Trade History</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-700">
                    <tr className="text-slate-400 text-xs uppercase font-semibold">
                      <th className="text-left py-3 px-4">Symbol</th>
                      <th className="text-left py-3 px-4">Side</th>
                      <th className="text-right py-3 px-4">Entry</th>
                      <th className="text-right py-3 px-4">Exit</th>
                      <th className="text-right py-3 px-4">P&L</th>
                      <th className="text-right py-3 px-4">%</th>
                      <th className="text-left py-3 px-4">Entry Time</th>
                      <th className="text-left py-3 px-4">Exit Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockTrades.map((trade, idx) => (
                      <tr key={idx} className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 px-4 font-semibold text-white">{trade.symbol}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-1 rounded text-xs font-semibold ${
                              trade.side === "LONG"
                                ? "bg-green-500/20 text-green-300"
                                : "bg-red-500/20 text-red-300"
                            }`}
                          >
                            {trade.side}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right text-slate-300">${trade.entry.toFixed(2)}</td>
                        <td className="py-3 px-4 text-right text-slate-300">${trade.exit.toFixed(2)}</td>
                        <td
                          className={`py-3 px-4 text-right font-semibold ${
                            trade.pnl >= 0 ? "text-green-400" : "text-red-400"
                          }`}
                        >
                          ${trade.pnl >= 0 ? "+" : ""}{trade.pnl}
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-semibold ${
                            trade.pnlPct >= 0 ? "text-green-400" : "text-red-400"
                          }`}
                        >
                          {trade.pnlPct >= 0 ? "+" : ""}{trade.pnlPct}%
                        </td>
                        <td className="py-3 px-4 text-slate-400">{trade.entryTime}</td>
                        <td className="py-3 px-4 text-slate-400">{trade.exitTime}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {!hasRun && (
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-12 text-center">
            <BarChart3 className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">Configure your backtest parameters and click "Run Backtest" to analyze strategy performance</p>
          </div>
        )}
      </div>
    </div>
  );
}
