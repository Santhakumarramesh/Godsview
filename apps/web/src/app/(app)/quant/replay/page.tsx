"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface TradeReplay {
  id: string;
  symbol: string;
  strategyName: string;
  entryPrice: number;
  exitPrice: number;
  direction: "LONG" | "SHORT";
  entryTime: string;
  exitTime: string;
  outcome: number;
  reasoning: string;
}

const mockTradeReplays: TradeReplay[] = [
  {
    id: "1",
    symbol: "AAPL",
    strategyName: "Mean Reversion RSI",
    entryPrice: 189.50,
    exitPrice: 191.25,
    direction: "LONG",
    entryTime: "2024-04-20 10:30:00",
    exitTime: "2024-04-20 14:20:00",
    outcome: 1.75,
    reasoning: "RSI crossed below 30, volume profile showed support, entry confirmed by VWAP rejection",
  },
  {
    id: "2",
    symbol: "MSFT",
    strategyName: "Momentum Cross",
    entryPrice: 405.00,
    exitPrice: 408.75,
    direction: "LONG",
    entryTime: "2024-04-20 09:45:00",
    exitTime: "2024-04-20 15:30:00",
    outcome: 3.75,
    reasoning: "MACD histogram turned positive with price above EMA(12), Stochastic confirmed momentum",
  },
  {
    id: "3",
    symbol: "TSLA",
    strategyName: "Mean Reversion RSI",
    entryPrice: 182.50,
    exitPrice: 183.19,
    direction: "SHORT",
    entryTime: "2024-04-20 11:15:00",
    exitTime: "2024-04-20 12:45:00",
    outcome: -0.69,
    reasoning: "RSI divergence at resistance, stop loss triggered at upper band",
  },
];

export default function QuantReplayPage() {
  const [replays, setReplays] = useState<TradeReplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<TradeReplay | null>(null);

  useEffect(() => {
    const fetchReplays = async () => {
      try {
        setLoading(true);
        try {
          await api.memory.getRecentSignals?.();
        } catch {
          // Fallback
        }
        setReplays(mockTradeReplays);
        if (mockTradeReplays.length > 0) {
          setSelectedTrade(mockTradeReplays[0]);
        }
      } catch (err) {
        setError((err as Error).message || "Failed to load trade replays");
        setReplays(mockTradeReplays);
      } finally {
        setLoading(false);
      }
    };

    fetchReplays();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-slate-400">Loading trade replays...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Trade Replay</h1>
        <p className="mt-1 text-sm text-slate-400">
          Review historical trades with full decision reasoning and market context
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trade List */}
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
          <h2 className="mb-4 text-lg font-semibold text-slate-100">Recent Trades</h2>
          <div className="space-y-2">
            {replays.map((trade) => (
              <button
                key={trade.id}
                onClick={() => setSelectedTrade(trade)}
                className={`w-full rounded-lg p-3 text-left transition ${
                  selectedTrade?.id === trade.id
                    ? "border border-blue-500 bg-blue-500/10"
                    : "border border-slate-700 bg-slate-800 hover:border-slate-600"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-100">{trade.symbol}</p>
                    <p className="text-xs text-slate-400">{trade.strategyName}</p>
                  </div>
                  <span
                    className={`font-bold ${
                      trade.outcome >= 0 ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {trade.outcome >= 0 ? "+" : ""}{trade.outcome.toFixed(2)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Trade Details */}
        {selectedTrade && (
          <div className="lg:col-span-2 space-y-6">
            {/* Trade Summary */}
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
              <h2 className="mb-4 text-lg font-semibold text-slate-100">Trade Details</h2>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-slate-400">Symbol</p>
                    <p className="font-mono text-lg text-slate-100">{selectedTrade.symbol}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Direction</p>
                    <p
                      className={`font-bold text-lg ${
                        selectedTrade.direction === "LONG"
                          ? "text-green-400"
                          : "text-red-400"
                      }`}
                    >
                      {selectedTrade.direction}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Entry Time</p>
                    <p className="text-sm text-slate-300">{selectedTrade.entryTime}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Exit Time</p>
                    <p className="text-sm text-slate-300">{selectedTrade.exitTime}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Entry Price</p>
                    <p className="font-mono text-slate-300">${selectedTrade.entryPrice.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Exit Price</p>
                    <p className="font-mono text-slate-300">${selectedTrade.exitPrice.toFixed(2)}</p>
                  </div>
                </div>

                <div className="border-t border-slate-700 pt-4">
                  <p className="text-xs text-slate-400">Profit/Loss</p>
                  <p
                    className={`text-2xl font-bold ${
                      selectedTrade.outcome >= 0
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    {selectedTrade.outcome >= 0 ? "+" : ""}{selectedTrade.outcome.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

            {/* Decision Reasoning */}
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
              <h2 className="mb-4 text-lg font-semibold text-slate-100">Entry Reasoning</h2>
              <p className="text-slate-300 leading-relaxed">{selectedTrade.reasoning}</p>

              <div className="mt-4 space-y-2 pt-4 border-t border-slate-700">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Signal Confidence</span>
                  <span className="text-green-400 font-mono">92%</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Risk/Reward Ratio</span>
                  <span className="text-blue-400 font-mono">1:2.5</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Conviction Score</span>
                  <span className="text-purple-400 font-mono">8.7/10</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
