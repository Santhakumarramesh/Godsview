"use client";

import { useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  AlertCircle,
  DollarSign,
  Zap,
} from "lucide-react";

interface Position {
  id: string;
  symbol: string;
  side: "Long" | "Short";
  qty: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  stopLoss: number;
  takeProfit: number;
  strategy: string;
  duration: string;
}

interface PortfolioStats {
  totalEquity: number;
  cash: number;
  exposure: number;
  unrealizedPnL: number;
  realizedPnLToday: number;
  maxDrawdown: number;
}

const mockPositions: Position[] = [
  {
    id: "POS-001",
    symbol: "AAPL",
    side: "Long",
    qty: 2500,
    entryPrice: 178.20,
    currentPrice: 182.45,
    pnl: 13125,
    pnlPercent: 2.38,
    stopLoss: 174.50,
    takeProfit: 190.00,
    strategy: "Momentum",
    duration: "4d 6h",
  },
  {
    id: "POS-002",
    symbol: "MSFT",
    side: "Long",
    qty: 1200,
    entryPrice: 415.10,
    currentPrice: 418.20,
    pnl: 3720,
    pnlPercent: 0.74,
    stopLoss: 410.00,
    takeProfit: 425.50,
    strategy: "Mean Reversion",
    duration: "2d 3h",
  },
  {
    id: "POS-003",
    symbol: "TSLA",
    side: "Short",
    qty: 400,
    entryPrice: 245.80,
    currentPrice: 242.18,
    pnl: 1448,
    pnlPercent: 1.47,
    stopLoss: 250.25,
    takeProfit: 235.00,
    strategy: "OB Retest",
    duration: "1d 12h",
  },
  {
    id: "POS-004",
    symbol: "NVDA",
    side: "Long",
    qty: 600,
    entryPrice: 880.50,
    currentPrice: 895.50,
    pnl: 9000,
    pnlPercent: 1.70,
    stopLoss: 862.00,
    takeProfit: 920.00,
    strategy: "Momentum",
    duration: "3d 5h",
  },
  {
    id: "POS-005",
    symbol: "GLD",
    side: "Long",
    qty: 800,
    entryPrice: 195.30,
    currentPrice: 193.80,
    pnl: -1200,
    pnlPercent: -0.76,
    stopLoss: 190.00,
    takeProfit: 202.00,
    strategy: "Sweep",
    duration: "6d 8h",
  },
  {
    id: "POS-006",
    symbol: "QQQ",
    side: "Long",
    qty: 500,
    entryPrice: 385.20,
    currentPrice: 392.10,
    pnl: 3450,
    pnlPercent: 1.78,
    stopLoss: 378.00,
    takeProfit: 405.00,
    strategy: "Mean Reversion",
    duration: "5d 2h",
  },
];

const strategies = [
  { name: "Momentum", allocation: 30, color: "bg-blue-600" },
  { name: "Mean Reversion", allocation: 25, color: "bg-purple-600" },
  { name: "OB Retest", allocation: 20, color: "bg-cyan-600" },
  { name: "Sweep", allocation: 15, color: "bg-amber-600" },
  { name: "Cash", allocation: 10, color: "bg-gray-500" },
];

export default function PortfolioCommandPage() {
  const [selectedPosition, setSelectedPosition] = useState<string | null>(null);

  // Calculate portfolio stats
  const totalEquity = 850000;
  const unrealizedPnL = mockPositions.reduce((sum, p) => sum + p.pnl, 0);
  const cash = totalEquity - (totalEquity * 0.9); // 90% invested
  const exposure = totalEquity - cash;
  const realizedPnLToday = 2450;
  const maxDrawdown = -3.2;

  const portfolioStats: PortfolioStats = {
    totalEquity,
    cash,
    exposure,
    unrealizedPnL,
    realizedPnLToday,
    maxDrawdown,
  };

  const riskLimits = {
    dailyPnLLimit: -2000,
    dailyPnLUsed: -420,
    maxPositions: 8,
    maxPositionsUsed: 4,
    maxExposure: 15,
    maxExposureUsed: 8.2,
    correlationLimit: 0.7,
    correlationCurrent: 0.42,
  };

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Portfolio Command</h1>
        <span className="rounded bg-primary/15 px-2 py-1 font-mono text-xs text-primary">
          live
        </span>
      </header>

      {/* Portfolio Summary Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <div className="overflow-hidden rounded-lg border border-border bg-surface p-4">
          <p className="text-xs font-medium text-foreground/60">Total Equity</p>
          <p className="mt-2 text-lg font-bold">
            ${(portfolioStats.totalEquity / 1000).toFixed(0)}K
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-surface p-4">
          <p className="text-xs font-medium text-foreground/60">Cash</p>
          <p className="mt-2 text-lg font-bold">
            ${(portfolioStats.cash / 1000).toFixed(1)}K
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-surface p-4">
          <p className="text-xs font-medium text-foreground/60">Exposure</p>
          <p className="mt-2 text-lg font-bold">
            ${(portfolioStats.exposure / 1000).toFixed(0)}K
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-surface p-4">
          <p className="text-xs font-medium text-foreground/60">
            Unrealized P&L
          </p>
          <p
            className={`mt-2 text-lg font-bold ${
              portfolioStats.unrealizedPnL > 0
                ? "text-green-600"
                : "text-red-600"
            }`}
          >
            {portfolioStats.unrealizedPnL > 0 ? "+" : ""}$
            {(portfolioStats.unrealizedPnL / 1000).toFixed(1)}K
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-surface p-4">
          <p className="text-xs font-medium text-foreground/60">
            Realized P&L Today
          </p>
          <p
            className={`mt-2 text-lg font-bold ${
              portfolioStats.realizedPnLToday > 0
                ? "text-green-600"
                : "text-red-600"
            }`}
          >
            {portfolioStats.realizedPnLToday > 0 ? "+" : ""}$
            {portfolioStats.realizedPnLToday}
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-surface p-4">
          <p className="text-xs font-medium text-foreground/60">Max Drawdown</p>
          <p className="mt-2 text-lg font-bold text-red-600">
            {portfolioStats.maxDrawdown}%
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Position Table */}
        <div className="space-y-6 lg:col-span-2">
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-6 py-4">
              <h2 className="text-sm font-semibold">Open Positions</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-border bg-surface/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">
                      Symbol
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">Side</th>
                    <th className="px-4 py-3 text-right font-semibold">Qty</th>
                    <th className="px-4 py-3 text-right font-semibold">Entry</th>
                    <th className="px-4 py-3 text-right font-semibold">
                      Current
                    </th>
                    <th className="px-4 py-3 text-right font-semibold">P&L</th>
                    <th className="px-4 py-3 text-right font-semibold">%</th>
                    <th className="px-4 py-3 text-right font-semibold">Stop</th>
                    <th className="px-4 py-3 text-right font-semibold">
                      Target
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">
                      Strategy
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">
                      Duration
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {mockPositions.map((pos) => (
                    <tr
                      key={pos.id}
                      onClick={() => setSelectedPosition(pos.id)}
                      className={`cursor-pointer transition-colors hover:bg-surface/50 ${
                        selectedPosition === pos.id ? "bg-surface/70" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-semibold">{pos.symbol}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`font-medium ${
                            pos.side === "Long"
                              ? "text-green-600"
                              : "text-red-600"
                          }`}
                        >
                          {pos.side}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">{pos.qty}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        ${pos.entryPrice.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        ${pos.currentPrice.toFixed(2)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono font-semibold ${
                          pos.pnl > 0
                            ? "text-green-600"
                            : pos.pnl < 0
                              ? "text-red-600"
                              : ""
                        }`}
                      >
                        {pos.pnl > 0 ? "+" : ""}${pos.pnl.toLocaleString()}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono font-semibold ${
                          pos.pnlPercent > 0
                            ? "text-green-600"
                            : pos.pnlPercent < 0
                              ? "text-red-600"
                              : ""
                        }`}
                      >
                        {pos.pnlPercent > 0 ? "+" : ""}
                        {pos.pnlPercent.toFixed(2)}%
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-foreground/60">
                        ${pos.stopLoss.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-foreground/60">
                        ${pos.takeProfit.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-xs text-foreground/70">
                        {pos.strategy}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-foreground/60">
                        {pos.duration}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Allocation Chart */}
          <div className="overflow-hidden rounded-lg border border-border bg-surface p-6">
            <h2 className="mb-4 text-sm font-semibold">
              Strategy Allocation
            </h2>
            <div className="space-y-4">
              {strategies.map((strategy) => (
                <div key={strategy.name}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium">{strategy.name}</span>
                    <span className="font-semibold">{strategy.allocation}%</span>
                  </div>
                  <div className="h-6 overflow-hidden rounded-full bg-surface/50">
                    <div
                      className={`h-full transition-all ${strategy.color}`}
                      style={{ width: `${strategy.allocation}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Risk Overview Panel */}
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-border bg-surface p-6">
            <div className="mb-4 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <h2 className="text-sm font-semibold">Risk Overview</h2>
            </div>

            <div className="space-y-5">
              {/* Daily P&L Limit */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/70">
                    Daily P&L Limit
                  </span>
                  <span className="font-mono text-xs font-semibold">
                    {riskLimits.dailyPnLUsed > riskLimits.dailyPnLLimit ? (
                      <span className="text-green-600">
                        ${Math.abs(riskLimits.dailyPnLUsed)} / $
                        {Math.abs(riskLimits.dailyPnLLimit)}
                      </span>
                    ) : (
                      <span className="text-red-600">
                        ${Math.abs(riskLimits.dailyPnLUsed)} / $
                        {Math.abs(riskLimits.dailyPnLLimit)}
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface/50">
                  <div
                    className="h-full bg-green-600/70"
                    style={{
                      width: `${
                        (Math.abs(riskLimits.dailyPnLUsed) /
                          Math.abs(riskLimits.dailyPnLLimit)) *
                        100
                      }%`,
                    }}
                  />
                </div>
              </div>

              {/* Max Positions */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/70">
                    Max Positions
                  </span>
                  <span className="font-mono text-xs font-semibold">
                    {riskLimits.maxPositionsUsed} / {riskLimits.maxPositions}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface/50">
                  <div
                    className="h-full bg-blue-600/70"
                    style={{
                      width: `${
                        (riskLimits.maxPositionsUsed /
                          riskLimits.maxPositions) *
                        100
                      }%`,
                    }}
                  />
                </div>
              </div>

              {/* Max Single Exposure */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/70">
                    Max Single Exposure
                  </span>
                  <span className="font-mono text-xs font-semibold">
                    {riskLimits.maxExposureUsed}% / {riskLimits.maxExposure}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface/50">
                  <div
                    className="h-full bg-purple-600/70"
                    style={{
                      width: `${
                        (riskLimits.maxExposureUsed /
                          riskLimits.maxExposure) *
                        100
                      }%`,
                    }}
                  />
                </div>
              </div>

              {/* Correlation Limit */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/70">
                    Correlation Limit
                  </span>
                  <span className="font-mono text-xs font-semibold text-green-600">
                    {riskLimits.correlationCurrent.toFixed(2)} /{" "}
                    {riskLimits.correlationLimit.toFixed(2)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface/50">
                  <div
                    className="h-full bg-green-600/70"
                    style={{
                      width: `${
                        (riskLimits.correlationCurrent /
                          riskLimits.correlationLimit) *
                        100
                      }%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="space-y-2">
            <button className="w-full rounded-lg bg-red-600/20 px-4 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-600/30 transition-colors">
              Close All Positions
            </button>
            <button className="w-full rounded-lg bg-amber-600/20 px-4 py-2.5 text-xs font-semibold text-amber-600 hover:bg-amber-600/30 transition-colors">
              Reduce Exposure
            </button>
            <button className="w-full rounded-lg bg-blue-600/20 px-4 py-2.5 text-xs font-semibold text-blue-600 hover:bg-blue-600/30 transition-colors">
              Rebalance
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
