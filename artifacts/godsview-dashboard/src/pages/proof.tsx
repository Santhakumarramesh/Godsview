/**
 * proof.tsx — Comprehensive Proof Dashboard
 *
 * Features:
 * - Trade Proof Cards with entry/exit details and mini charts
 * - Strategy Comparison (bar charts, radar chart, star ratings)
 * - Equity Curve showing cumulative P&L
 * - Performance Summary Cards
 * - Strategy Leaderboard Table
 * - Market Readiness Indicator
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp, TrendingDown, AlertCircle, Star, ArrowUp, ArrowDown } from "lucide-react";
import { safeNum } from "@/lib/safe";

// Types
interface Trade {
  id: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  entry_time: string;
  exit_time?: string;
  position_type: "long" | "short";
  description: string;
  pnl: number;
  win: boolean;
  risk_reward_ratio: number;
  chart_data: Array<{ time: string; price: number }>;
}

interface PerformanceSummary {
  overall_win_rate: number;
  total_trades: number;
  profit_factor: number;
  sharpe_ratio: number;
  best_strategy: {
    name: string;
    win_rate: number;
  };
  worst_drawdown: number;
  equity_curve: Array<{ date: string; cumulative_pnl: number }>;
}

interface Strategy {
  id: string;
  name: string;
  win_rate: number;
  profit_factor: number;
  sharpe_ratio: number;
  consistency: number;
  accuracy: number;
  trades: number;
}

interface StrategyComparison {
  strategies: Strategy[];
  comparison_data: Array<{
    name: string;
    "Win Rate": number;
    "Profit Factor": number;
    Sharpe: number;
    Consistency: number;
  }>;
}

interface MarketReadiness {
  status: "green" | "yellow" | "red";
  regime: string;
  recommended_position_size: number;
}

interface ProofDashboardData {
  summary: PerformanceSummary;
  trades: Trade[];
  strategy_comparison: StrategyComparison;
  market_readiness: MarketReadiness;
}

const DAY_OPTIONS = [7, 14, 30, 60, 90];

const COLORS = {
  bg: "#0e0e0f",
  card: "#1a191b",
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  accent1: "#a78bfa",
  accent2: "#f472b6",
};

const StarRating = ({ rating }: { rating: number }) => {
  const stars = Math.min(5, Math.max(1, Math.round(rating * 5)));
  return (
    <div className="flex gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={16}
          className={i < stars ? "fill-yellow-400 text-yellow-400" : "text-gray-600"}
        />
      ))}
    </div>
  );
};

const MarketReadinessIndicator = ({ market_readiness }: { market_readiness: MarketReadiness }) => {
  const statusConfig = {
    green: { bg: "bg-emerald-500/20", border: "border-emerald-400/40", dot: "bg-emerald-500", text: "text-emerald-200" },
    yellow: { bg: "bg-yellow-500/20", border: "border-yellow-400/40", dot: "bg-yellow-500", text: "text-yellow-200" },
    red: { bg: "bg-red-500/20", border: "border-red-400/40", dot: "bg-red-500", text: "text-red-200" },
  };
  const config = statusConfig[market_readiness.status];

  return (
    <div className={`${config.bg} border ${config.border} rounded-lg p-6`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-200">Market Readiness</h3>
        <div className={`w-4 h-4 rounded-full animate-pulse ${config.dot}`} />
      </div>
      <div className="space-y-2">
        <div>
          <span className="text-gray-400 text-sm">Regime: </span>
          <span className={`${config.text} font-semibold`}>{market_readiness.regime}</span>
        </div>
        <div>
          <span className="text-gray-400 text-sm">Recommended Position Size: </span>
          <span className={`${config.text} font-semibold`}>{(market_readiness.recommended_position_size * 100).toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
};

const TradeProofCard = ({ trade }: { trade: Trade }) => {
  const isLong = trade.position_type === "long";
  const riskRewardColor = trade.risk_reward_ratio >= 2 ? "text-emerald-400" : "text-yellow-400";

  return (
    <div className="bg-[#1a191b] border border-gray-700/30 rounded-lg p-6 hover:border-gray-600/50 transition-colors">
      <div className="space-y-4">
        {/* Header with position type and result */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded ${isLong ? "bg-emerald-500/20" : "bg-red-500/20"}`}>
              {isLong ? (
                <ArrowUp className={`text-emerald-400`} size={20} />
              ) : (
                <ArrowDown className={`text-red-400`} size={20} />
              )}
            </div>
            <div>
              <h4 className="font-semibold text-gray-100">{trade.description}</h4>
              <p className="text-xs text-gray-400">{new Date(trade.entry_time).toLocaleDateString()}</p>
            </div>
          </div>
          <div className="text-right">
            <div className={`text-lg font-bold ${trade.win ? "text-emerald-400" : "text-red-400"}`}>
              {trade.win ? "+" : ""}{trade.pnl.toFixed(2)}
            </div>
            <div className="text-xs text-gray-400">{trade.win ? "Win" : "Loss"}</div>
          </div>
        </div>

        {/* Price levels */}
        <div className="grid grid-cols-3 gap-3 text-center text-sm">
          <div>
            <span className="text-gray-400 text-xs block mb-1">Entry</span>
            <span className="text-gray-100 font-mono font-semibold">${trade.entry_price.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-gray-400 text-xs block mb-1">Stop Loss</span>
            <span className="text-red-400 font-mono font-semibold">${trade.stop_loss.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-gray-400 text-xs block mb-1">Take Profit</span>
            <span className="text-emerald-400 font-mono font-semibold">${trade.take_profit.toFixed(2)}</span>
          </div>
        </div>

        {/* Risk:Reward Ratio */}
        <div className="flex justify-between items-center text-sm bg-gray-800/30 rounded px-3 py-2">
          <span className="text-gray-400">Risk:Reward</span>
          <span className={`font-semibold font-mono ${riskRewardColor}`}>
            1:{trade.risk_reward_ratio.toFixed(2)}
          </span>
        </div>

        {/* Mini chart */}
        {trade.chart_data.length > 0 && (
          <div className="h-32 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trade.chart_data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#2a2a2d", border: "1px solid #444" }}
                  formatter={(value) => {
                    const numeric = typeof value === "number" ? value : Number(value);
                    return Number.isFinite(numeric) ? `$${numeric.toFixed(2)}` : `$${String(value)}`;
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke={trade.win ? "#9cff93" : "#ff7162"}
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Time */}
        <div className="text-xs text-gray-500">
          {new Date(trade.entry_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {trade.exit_time && ` - ${new Date(trade.exit_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
        </div>
      </div>
    </div>
  );
};

export default function Proof() {
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ["proof-dashboard", days],
    queryFn: async () => {
      const res = await fetch(`/api/proof/dashboard?days=${days}`);
      if (!res.ok) throw new Error("Failed to fetch proof data");
      return (await res.json()) as ProofDashboardData;
    },
  });

  return (
    <div style={{ backgroundColor: COLORS.bg }} className="min-h-screen text-white">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: "Space Grotesk" }}>
                Proof Dashboard
              </h1>
              <p className="text-gray-400">Comprehensive Trading Performance Analysis</p>
            </div>
            <div className="flex gap-2">
              {DAY_OPTIONS.map((day) => (
                <button
                  key={day}
                  onClick={() => setDays(day)}
                  className={`px-4 py-2 rounded font-medium transition-colors ${
                    days === day
                      ? "bg-[#9cff93] text-black"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                  style={{ fontFamily: "Space Grotesk" }}
                >
                  {day}d
                </button>
              ))}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-gray-400">Loading proof data...</div>
        ) : data ? (
          <div className="space-y-12">
            {/* Performance Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div style={{ backgroundColor: COLORS.card }} className="border border-gray-700/30 rounded-lg p-6">
                <div className="text-gray-400 text-sm mb-2">Overall Win Rate</div>
                <div
                  className="text-5xl font-bold"
                  style={{ color: COLORS.primary, fontFamily: "JetBrains Mono" }}
                >
                  {(data.safeNum(summary?.overall_win_rate) * 100).toFixed(1)}%
                </div>
              </div>

              <div style={{ backgroundColor: COLORS.card }} className="border border-gray-700/30 rounded-lg p-6">
                <div className="text-gray-400 text-sm mb-2">Total Trades</div>
                <div
                  className="text-5xl font-bold"
                  style={{ color: COLORS.secondary, fontFamily: "JetBrains Mono" }}
                >
                  {data.summary.total_trades}
                </div>
              </div>

              <div style={{ backgroundColor: COLORS.card }} className="border border-gray-700/30 rounded-lg p-6">
                <div className="text-gray-400 text-sm mb-2">Profit Factor</div>
                <div
                  className="text-5xl font-bold"
                  style={{ color: COLORS.accent1, fontFamily: "JetBrains Mono" }}
                >
                  {data.summary.profit_factor.toFixed(2)}
                </div>
              </div>

              <div style={{ backgroundColor: COLORS.card }} className="border border-gray-700/30 rounded-lg p-6">
                <div className="text-gray-400 text-sm mb-2">Sharpe Ratio</div>
                <div
                  className="text-5xl font-bold"
                  style={{ color: COLORS.accent2, fontFamily: "JetBrains Mono" }}
                >
                  {data.summary.sharpe_ratio.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Additional Performance Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div style={{ backgroundColor: COLORS.card }} className="border border-gray-700/30 rounded-lg p-6">
                <div className="mb-4">
                  <span className="text-gray-400 text-sm">Best Strategy</span>
                  <h3 className="text-2xl font-bold text-gray-100">{data.summary.best_strategy.name}</h3>
                </div>
                <div className="flex items-end justify-between">
                  <span className="text-gray-400">Win Rate:</span>
                  <span
                    className="text-3xl font-bold"
                    style={{ color: COLORS.primary, fontFamily: "JetBrains Mono" }}
                  >
                    {(data.summary.best_strategy.win_rate * 100).toFixed(1)}%
                  </span>
                </div>
              </div>

              <div style={{ backgroundColor: COLORS.card }} className="border border-gray-700/30 rounded-lg p-6">
                <div className="text-gray-400 text-sm mb-2">Worst Drawdown</div>
                <div
                  className="text-5xl font-bold text-red-400"
                  style={{ fontFamily: "JetBrains Mono" }}
                >
                  {data.summary.worst_drawdown.toFixed(2)}%
                </div>
              </div>
            </div>

            {/* Equity Curve */}
            {data.summary.equity_curve.length > 0 && (
              <div>
                <h2 className="text-2xl font-semibold mb-6 text-gray-100" style={{ fontFamily: "Space Grotesk" }}>
                  Equity Curve
                </h2>
                <div style={{ backgroundColor: COLORS.card }} className="border border-gray-700/30 rounded-lg p-6 h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.summary.equity_curve}>
                      <defs>
                        <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.8} />
                          <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis dataKey="date" stroke="#666" style={{ fontSize: "12px" }} />
                      <YAxis stroke="#666" style={{ fontSize: "12px" }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#2a2a2d", border: "1px solid #444" }}
                        formatter={(value) => {
                          const numeric = typeof value === "number" ? value : Number(value);
                          return Number.isFinite(numeric) ? `$${numeric.toFixed(2)}` : `$${String(value)}`;
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="cumulative_pnl"
                        stroke={COLORS.primary}
                        fill="url(#equityGradient)"
                        dot={false}
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Market Readiness */}
            <div>
              <h2 className="text-2xl font-semibold mb-6 text-gray-100" style={{ fontFamily: "Space Grotesk" }}>
                Market Conditions
              </h2>
              <MarketReadinessIndicator market_readiness={data.market_readiness} />
            </div>

            {/* Strategy Comparison Section */}
            {data.strategy_comparison.strategies.length > 0 && (
              <div className="space-y-8">
                <h2 className="text-2xl font-semibold text-gray-100" style={{ fontFamily: "Space Grotesk" }}>
                  Strategy Analysis
                </h2>

                {/* Win Rate Bar Chart */}
                {data.strategy_comparison.comparison_data.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-4 text-gray-200">Win Rate Comparison</h3>
                    <div style={{ backgroundColor: COLORS.card }} className="border border-gray-700/30 rounded-lg p-6 h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data.strategy_comparison.comparison_data}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                          <XAxis dataKey="name" stroke="#666" style={{ fontSize: "12px" }} />
                          <YAxis stroke="#666" style={{ fontSize: "12px" }} />
                          <Tooltip contentStyle={{ backgroundColor: "#2a2a2d", border: "1px solid #444" }} />
                          <Bar dataKey="Win Rate" fill={COLORS.primary} isAnimationActive={false} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Radar Chart */}
                {data.strategy_comparison.comparison_data.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-4 text-gray-200">Strategy Attributes</h3>
                    <div style={{ backgroundColor: COLORS.card }} className="border border-gray-700/30 rounded-lg p-6 h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={data.strategy_comparison.comparison_data.slice(0, 1)}>
                          <PolarGrid stroke="#444" />
                          <PolarAngleAxis dataKey="name" stroke="#666" style={{ fontSize: "12px" }} />
                          <PolarRadiusAxis stroke="#666" />
                          <Radar name="Win Rate" dataKey="Win Rate" stroke={COLORS.primary} fill={COLORS.primary} fillOpacity={0.6} />
                          <Radar name="Profit Factor" dataKey="Profit Factor" stroke={COLORS.secondary} fillOpacity={0.6} />
                          <Radar name="Sharpe" dataKey="Sharpe" stroke={COLORS.accent1} fillOpacity={0.6} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Strategy Leaderboard Table */}
                <div>
                  <h3 className="text-lg font-semibold mb-4 text-gray-200">Strategy Leaderboard</h3>
                  <div style={{ backgroundColor: COLORS.card }} className="border border-gray-700/30 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-700" style={{ backgroundColor: "#0e0e0f" }}>
                          <th className="text-left py-4 px-6 font-semibold text-gray-300">Rank</th>
                          <th className="text-left py-4 px-6 font-semibold text-gray-300">Strategy</th>
                          <th className="text-center py-4 px-6 font-semibold text-gray-300">Win Rate</th>
                          <th className="text-center py-4 px-6 font-semibold text-gray-300">Profit Factor</th>
                          <th className="text-center py-4 px-6 font-semibold text-gray-300">Trades</th>
                          <th className="text-center py-4 px-6 font-semibold text-gray-300">Rating</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.strategy_comparison.strategies.map((strategy, idx) => (
                          <tr
                            key={strategy.id}
                            className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors"
                          >
                            <td className="py-4 px-6 text-gray-300 font-semibold">#{idx + 1}</td>
                            <td className="py-4 px-6 text-gray-100">{strategy.name}</td>
                            <td className="py-4 px-6 text-center">
                              <span className="text-emerald-400 font-semibold font-mono">
                                {(strategy.win_rate * 100).toFixed(1)}%
                              </span>
                            </td>
                            <td className="py-4 px-6 text-center">
                              <span
                                className={`font-semibold font-mono ${
                                  strategy.profit_factor >= 1.5 ? "text-emerald-400" : "text-yellow-400"
                                }`}
                              >
                                {strategy.profit_factor.toFixed(2)}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-center text-gray-400">{strategy.trades}</td>
                            <td className="py-4 px-6 text-center">
                              <div className="flex justify-center">
                                <StarRating rating={strategy.accuracy} />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Trade Proof Cards */}
            {data.trades.length > 0 && (
              <div>
                <h2 className="text-2xl font-semibold mb-6 text-gray-100" style={{ fontFamily: "Space Grotesk" }}>
                  Trade Details ({data.trades.length} trades)
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {data.trades.map((trade) => (
                    <TradeProofCard key={trade.id} trade={trade} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
