"use client";

import { useState } from "react";
import { Zap, TrendingUp, TrendingDown, Volume2, Gauge, AlertCircle, Clock } from "lucide-react";

interface FlowEvent {
  timestamp: string;
  type: "BUY_ABSORPTION" | "SELL_ABSORPTION" | "IMBALANCE" | "PRINT";
  symbol: string;
  size: number;
  price: number;
  note: string;
}

const symbols = ["AAPL", "MSFT", "TSLA", "NVDA", "SPY", "QQQ", "IWM"];

const mockFlowEvents: FlowEvent[] = [
  {
    timestamp: "14:32:15",
    type: "BUY_ABSORPTION",
    symbol: "AAPL",
    size: 125000,
    price: 182.45,
    note: "Large buyer absorption at ask",
  },
  {
    timestamp: "14:31:42",
    type: "SELL_ABSORPTION",
    symbol: "AAPL",
    size: 85000,
    price: 182.35,
    note: "Seller being absorbed into bid",
  },
  {
    timestamp: "14:30:58",
    type: "IMBALANCE",
    symbol: "AAPL",
    size: 245000,
    price: 182.40,
    note: "Strong delta imbalance - bullish",
  },
  {
    timestamp: "14:29:45",
    type: "BUY_ABSORPTION",
    symbol: "AAPL",
    size: 95000,
    price: 182.25,
    note: "Accumulation at support level",
  },
  {
    timestamp: "14:28:20",
    type: "PRINT",
    symbol: "AAPL",
    size: 180000,
    price: 182.15,
    note: "Large print executed, volume spike",
  },
];

export default function OrderFlowDashboardPage() {
  const [selectedSymbol, setSelectedSymbol] = useState("AAPL");
  const [expanded, setExpanded] = useState<number | null>(0);

  // Simulated real-time metrics
  const [metrics] = useState({
    delta: 245,
    cumDelta: 1230,
    buyVol: 12400,
    sellVol: 10800,
    imbalanceScore: 0.73,
    absorptionQuality: 0.82,
    pressure: "BUY" as const,
  });

  const imbalancePercentage = Math.round((metrics.imbalanceScore / 1) * 100);
  const absorptionPercentage = Math.round((metrics.absorptionQuality / 1) * 100);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <Volume2 className="w-8 h-8 text-cyan-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Order Flow Dashboard</h1>
              <p className="text-slate-400 text-sm">Real-time delta, cumulative delta, and order flow metrics</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-green-500/20 border border-green-500/50 rounded text-green-300 text-xs font-semibold">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            LIVE
          </div>
        </div>

        {/* Symbol Selector */}
        <div className="flex gap-2 flex-wrap">
          {symbols.map((sym) => (
            <button
              key={sym}
              onClick={() => setSelectedSymbol(sym)}
              className={`px-4 py-2 rounded font-semibold text-sm transition-all ${
                selectedSymbol === sym
                  ? "bg-cyan-500/30 border border-cyan-400 text-cyan-300"
                  : "bg-slate-800 border border-slate-700 text-slate-400 hover:border-slate-600"
              }`}
            >
              {sym}
            </button>
          ))}
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Delta */}
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-400 text-xs font-medium uppercase">Delta</p>
              <TrendingUp className="w-4 h-4 text-green-400" />
            </div>
            <p className="text-3xl font-bold text-green-400">+{metrics.delta}</p>
            <p className="text-slate-500 text-xs mt-1">Buy pressure: Strong</p>
          </div>

          {/* Cumulative Delta */}
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-400 text-xs font-medium uppercase">Cum Delta</p>
              <TrendingUp className="w-4 h-4 text-cyan-400" />
            </div>
            <p className="text-3xl font-bold text-cyan-400">+{metrics.cumDelta}</p>
            <p className="text-slate-500 text-xs mt-1">Session positive</p>
          </div>

          {/* Buy Volume */}
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-400 text-xs font-medium uppercase">Buy Vol</p>
              <Volume2 className="w-4 h-4 text-green-400" />
            </div>
            <p className="text-3xl font-bold text-white">{(metrics.buyVol / 1000).toFixed(1)}K</p>
            <p className="text-slate-500 text-xs mt-1">Aggressive buys</p>
          </div>

          {/* Sell Volume */}
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-400 text-xs font-medium uppercase">Sell Vol</p>
              <Volume2 className="w-4 h-4 text-red-400" />
            </div>
            <p className="text-3xl font-bold text-white">{(metrics.sellVol / 1000).toFixed(1)}K</p>
            <p className="text-slate-500 text-xs mt-1">Supply present</p>
          </div>
        </div>

        {/* Imbalance Bar */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" />
              Order Imbalance Ratio
            </h3>
            <span className="text-2xl font-bold text-amber-400">{imbalancePercentage}%</span>
          </div>
          <div className="relative h-8 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
            <div
              className="h-full bg-gradient-to-r from-red-500 via-amber-500 to-green-500 transition-all duration-300"
              style={{ width: `${imbalancePercentage}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs font-bold text-white drop-shadow">
                {imbalancePercentage}% BUY WEIGHTED
              </span>
            </div>
          </div>
          <div className="flex justify-between text-xs text-slate-400 mt-2">
            <span>0% (Sell)</span>
            <span>50% (Neutral)</span>
            <span>100% (Buy)</span>
          </div>
        </div>

        {/* Absorption Score & Pressure */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Absorption Score */}
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Gauge className="w-5 h-5 text-blue-400" />
              Absorption Score
            </h3>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-4xl font-bold text-blue-400">{absorptionPercentage}%</p>
                <p className="text-slate-400 text-sm mt-2">
                  Quality of buyer/seller absorption is{" "}
                  <span
                    className={
                      absorptionPercentage > 75
                        ? "text-green-400 font-semibold"
                        : "text-yellow-400 font-semibold"
                    }
                  >
                    {absorptionPercentage > 75 ? "excellent" : "strong"}
                  </span>
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <div className="w-20 h-20 rounded-full relative flex items-center justify-center">
                  <svg viewBox="0 0 100 100" className="w-full h-full">
                    <circle
                      cx="50"
                      cy="50"
                      r="45"
                      fill="none"
                      stroke="#334155"
                      strokeWidth="8"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="45"
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="8"
                      strokeDasharray={`${(absorptionPercentage / 100) * (2 * Math.PI * 45)} ${2 * Math.PI * 45}`}
                      strokeLinecap="round"
                      transform="rotate(-90 50 50)"
                    />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Pressure Indicator */}
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-purple-400" />
              Pressure Indicator
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Current Pressure:</span>
                <span
                  className={`px-4 py-2 rounded font-bold text-lg ${
                    metrics.pressure === "BUY"
                      ? "bg-green-500/20 text-green-300 border border-green-500/50"
                      : metrics.pressure === "SELL"
                        ? "bg-red-500/20 text-red-300 border border-red-500/50"
                        : "bg-slate-700/50 text-slate-300 border border-slate-600"
                  }`}
                >
                  {metrics.pressure}
                </span>
              </div>
              <p className="text-slate-400 text-sm pt-2 border-t border-slate-700">
                Buyers are in control with strong absorption and positive cumulative delta. Watch for any shift in
                imbalance ratio below 45% for reversal signals.
              </p>
            </div>
          </div>
        </div>

        {/* Recent Flow Events */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-slate-400" />
            Recent Flow Events
          </h3>
          <div className="space-y-2">
            {mockFlowEvents.map((event, idx) => (
              <div
                key={idx}
                className="bg-slate-800/50 border border-slate-700 rounded p-3 cursor-pointer hover:border-slate-600 transition-all"
                onClick={() => setExpanded(expanded === idx ? null : idx)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <div>
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          event.type.includes("BUY")
                            ? "bg-green-500/20 text-green-300"
                            : event.type.includes("SELL")
                              ? "bg-red-500/20 text-red-300"
                              : "bg-amber-500/20 text-amber-300"
                        }`}
                      >
                        {event.type}
                      </span>
                    </div>
                    <div className="flex-1">
                      <p className="text-white font-semibold">{event.note}</p>
                      <p className="text-slate-400 text-sm">
                        {event.symbol} @ ${event.price} | {(event.size / 1000).toFixed(0)}K shares
                      </p>
                    </div>
                  </div>
                  <span className="text-slate-400 text-sm flex-shrink-0">{event.timestamp}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
