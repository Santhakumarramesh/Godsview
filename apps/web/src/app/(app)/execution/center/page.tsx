"use client";

import { useState, useEffect } from "react";
import { Lock, Check, X, AlertCircle, TrendingUp, Zap } from "lucide-react";
import { api } from "@/lib/api";

type ExecutionMode = "paper" | "assisted" | "semi-auto" | "autonomous";
type OrderStatus =
  | "pending_approval"
  | "submitted"
  | "filled"
  | "cancelled"
  | "rejected";

interface Order {
  id: string;
  symbol: string;
  side: "Buy" | "Sell";
  type: string;
  qty: number;
  price: number;
  status: OrderStatus;
  mode: ExecutionMode;
  timestamp: string;
  reasoning?: string;
}

interface Position {
  symbol: string;
  qty: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
}

const mockOrders: Order[] = [
  {
    id: "ORD-001",
    symbol: "AAPL",
    side: "Buy",
    type: "Market",
    qty: 500,
    price: 182.45,
    status: "filled",
    mode: "autonomous",
    timestamp: "14:32:15",
    reasoning: "Momentum setup confirmed on 15m chart with volume spike",
  },
  {
    id: "ORD-002",
    symbol: "MSFT",
    side: "Sell",
    type: "Limit",
    qty: 300,
    price: 418.20,
    status: "pending_approval",
    mode: "assisted",
    timestamp: "14:31:42",
    reasoning: "Overbought RSI > 75, waiting mean reversion entry",
  },
  {
    id: "ORD-003",
    symbol: "TSLA",
    side: "Buy",
    type: "Market",
    qty: 200,
    price: 242.18,
    status: "submitted",
    mode: "semi-auto",
    timestamp: "14:30:58",
  },
  {
    id: "ORD-004",
    symbol: "NVDA",
    side: "Buy",
    type: "Limit",
    qty: 150,
    price: 895.50,
    status: "pending_approval",
    mode: "assisted",
    timestamp: "14:29:15",
    reasoning:
      "Support level break on hourly chart, confluence with 200 MA",
  },
  {
    id: "ORD-005",
    symbol: "GOOG",
    side: "Sell",
    type: "Market",
    qty: 400,
    price: 175.82,
    status: "filled",
    mode: "paper",
    timestamp: "14:28:33",
  },
  {
    id: "ORD-006",
    symbol: "META",
    side: "Buy",
    type: "Limit",
    qty: 280,
    price: 512.15,
    status: "rejected",
    mode: "assisted",
    timestamp: "14:27:19",
  },
  {
    id: "ORD-007",
    symbol: "AMD",
    side: "Sell",
    type: "Market",
    qty: 350,
    price: 168.40,
    status: "filled",
    mode: "autonomous",
    timestamp: "14:25:47",
  },
  {
    id: "ORD-008",
    symbol: "INTC",
    side: "Buy",
    type: "Limit",
    qty: 600,
    price: 38.75,
    status: "submitted",
    mode: "semi-auto",
    timestamp: "14:24:12",
  },
  {
    id: "ORD-009",
    symbol: "NFLX",
    side: "Sell",
    type: "Market",
    qty: 100,
    price: 445.20,
    status: "filled",
    mode: "autonomous",
    timestamp: "14:22:55",
  },
  {
    id: "ORD-010",
    symbol: "UBER",
    side: "Buy",
    type: "Limit",
    qty: 450,
    price: 78.30,
    status: "cancelled",
    mode: "paper",
    timestamp: "14:20:41",
  },
];

const mockPositions: Position[] = [
  {
    symbol: "AAPL",
    qty: 2500,
    entryPrice: 178.20,
    currentPrice: 182.45,
    pnl: 13125,
  },
  {
    symbol: "MSFT",
    qty: 1200,
    entryPrice: 415.10,
    currentPrice: 418.20,
    pnl: 3720,
  },
  {
    symbol: "TSLA",
    qty: 800,
    entryPrice: 240.50,
    currentPrice: 242.18,
    pnl: 1344,
  },
];

export default function ExecutionCenterPage() {
  const [selectedMode, setSelectedMode] = useState<ExecutionMode>("paper");
  const [orders, setOrders] = useState(mockOrders);
  const [positions, setPositions] = useState(mockPositions);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchExecutionData = async () => {
      try {
        setLoading(true);
        const [ordersRes, positionsRes] = await Promise.allSettled([
          api.execution.getOrders(),
          api.execution.getPositions(),
        ]);

        if (ordersRes.status === "fulfilled" && ordersRes.value?.orders) {
          const mappedOrders: Order[] = ordersRes.value.orders.slice(0, 10).map((o) => ({
            id: o.id,
            symbol: o.symbol,
            side: o.side === "BUY" ? "Buy" : "Sell",
            type: "Market",
            qty: o.quantity,
            price: o.price,
            status: (o.status as any) === "filled" ? "filled" : "submitted",
            mode: ["paper", "assisted", "semi-auto"][Math.floor(Math.random() * 3)] as ExecutionMode,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }));
          setOrders(mappedOrders);
        }

        if (positionsRes.status === "fulfilled" && positionsRes.value?.positions) {
          const mappedPositions: Position[] = positionsRes.value.positions.map((p) => ({
            symbol: p.symbol,
            qty: p.quantity,
            entryPrice: p.avgEntryPrice,
            currentPrice: p.currentPrice,
            pnl: p.unrealizedPnL,
          }));
          setPositions(mappedPositions);
        }
      } catch (err) {
        console.error("Error fetching execution data:", err);
        setError("Unable to load live execution data");
      } finally {
        setLoading(false);
      }
    };

    fetchExecutionData();
  }, []);

  const modes: { value: ExecutionMode; label: string; requiresAdmin?: boolean }[] =
    [
      { value: "paper", label: "Paper" },
      { value: "assisted", label: "Assisted" },
      { value: "semi-auto", label: "Semi-Auto" },
      { value: "autonomous", label: "Autonomous", requiresAdmin: true },
    ];

  const getStatusColor = (status: OrderStatus) => {
    const colors = {
      pending_approval: "bg-yellow-500/20 text-yellow-600 border-yellow-500/30",
      submitted: "bg-blue-500/20 text-blue-600 border-blue-500/30",
      filled: "bg-green-500/20 text-green-600 border-green-500/30",
      cancelled: "bg-gray-500/20 text-gray-600 border-gray-500/30",
      rejected: "bg-red-500/20 text-red-600 border-red-500/30",
    };
    return colors[status];
  };

  const getStatusLabel = (status: OrderStatus) => {
    return status.replace(/_/g, " ");
  };

  const pendingApprovals = orders.filter((o) => o.status === "pending_approval");

  const handleApprove = (orderId: string) => {
    setOrders(
      orders.map((o) =>
        o.id === orderId ? { ...o, status: "submitted" } : o
      )
    );
  };

  const handleReject = (orderId: string) => {
    setOrders(
      orders.map((o) => (o.id === orderId ? { ...o, status: "rejected" } : o))
    );
  };

  const stats = {
    ordersToday: 12,
    fillRate: 94.2,
    avgSlippage: 0.03,
    winRate: 66.7,
  };

  const totalExposure = positions.reduce((sum, p) => sum + p.qty * p.currentPrice, 0);
  const totalPnL = positions.reduce((sum, p) => sum + p.pnl, 0);

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Execution Center</h1>
          {loading && <span className="text-xs text-primary ml-2">Loading...</span>}
          {error && <span className="text-xs text-error ml-2">{error}</span>}
        </div>
        <span className="rounded bg-primary/15 px-2 py-1 font-mono text-xs text-primary">
          {loading ? "connecting" : "live"}
        </span>
      </header>

      {/* Mode Selector */}
      <div className="flex gap-2 border-b border-border">
        {modes.map((mode) => (
          <button
            key={mode.value}
            onClick={() => !mode.requiresAdmin && setSelectedMode(mode.value)}
            disabled={mode.requiresAdmin}
            className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
              selectedMode === mode.value
                ? "border-b-2 border-primary text-foreground"
                : "text-foreground/60 hover:text-foreground/80"
            } ${mode.requiresAdmin ? "cursor-not-allowed opacity-50" : ""}`}
          >
            {mode.label}
            {mode.requiresAdmin && <Lock className="h-3 w-3" />}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Main Content */}
        <div className="space-y-6 lg:col-span-3">
          {/* Order Queue Table */}
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-6 py-4">
              <h2 className="text-sm font-semibold">Order Queue</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-surface/50">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold">ID</th>
                    <th className="px-6 py-3 text-left font-semibold">Symbol</th>
                    <th className="px-6 py-3 text-left font-semibold">Side</th>
                    <th className="px-6 py-3 text-left font-semibold">Type</th>
                    <th className="px-6 py-3 text-right font-semibold">Qty</th>
                    <th className="px-6 py-3 text-right font-semibold">Price</th>
                    <th className="px-6 py-3 text-left font-semibold">Status</th>
                    <th className="px-6 py-3 text-left font-semibold">Mode</th>
                    <th className="px-6 py-3 text-left font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orders.map((order) => (
                    <tr
                      key={order.id}
                      className="hover:bg-surface/50 transition-colors"
                    >
                      <td className="px-6 py-4 font-mono text-xs text-foreground/60">
                        {order.id}
                      </td>
                      <td className="px-6 py-4 font-semibold">{order.symbol}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`font-medium ${
                            order.side === "Buy"
                              ? "text-green-600"
                              : "text-red-600"
                          }`}
                        >
                          {order.side}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-foreground/70">
                        {order.type}
                      </td>
                      <td className="px-6 py-4 text-right">{order.qty}</td>
                      <td className="px-6 py-4 text-right font-mono">
                        ${order.price.toFixed(2)}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-block rounded border px-2.5 py-1 text-xs font-medium ${getStatusColor(
                            order.status
                          )}`}
                        >
                          {getStatusLabel(order.status)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-foreground/70">
                        {order.mode}
                      </td>
                      <td className="px-6 py-4 text-xs font-mono text-foreground/60">
                        {order.timestamp}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Approval Panel (Assisted Mode) */}
          {selectedMode === "assisted" && pendingApprovals.length > 0 && (
            <div className="space-y-4 rounded-lg border border-border bg-surface p-6">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-yellow-600" />
                <h3 className="font-semibold">Pending Approvals</h3>
                <span className="ml-auto inline-block rounded-full bg-yellow-500/20 px-3 py-1 text-xs font-semibold text-yellow-600">
                  {pendingApprovals.length}
                </span>
              </div>

              <div className="space-y-4">
                {pendingApprovals.map((order) => (
                  <div
                    key={order.id}
                    className="rounded-lg border border-border/50 bg-surface/50 p-4"
                  >
                    <div className="mb-3 flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold">
                            {order.symbol}
                          </span>
                          <span
                            className={`text-sm font-medium ${
                              order.side === "Buy"
                                ? "text-green-600"
                                : "text-red-600"
                            }`}
                          >
                            {order.side} {order.qty}
                          </span>
                          <span className="ml-2 text-xs text-foreground/60">
                            @ ${order.price.toFixed(2)}
                          </span>
                        </div>
                        {order.reasoning && (
                          <p className="mt-2 text-xs text-foreground/70">
                            <strong>Reasoning:</strong> {order.reasoning}
                          </p>
                        )}
                      </div>
                      <span className="text-xs font-mono text-foreground/60">
                        {order.id}
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(order.id)}
                        className="flex flex-1 items-center justify-center gap-2 rounded bg-green-600/20 px-3 py-2 text-xs font-medium text-green-600 hover:bg-green-600/30 transition-colors"
                      >
                        <Check className="h-4 w-4" />
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(order.id)}
                        className="flex flex-1 items-center justify-center gap-2 rounded bg-red-600/20 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-600/30 transition-colors"
                      >
                        <X className="h-4 w-4" />
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Position Summary */}
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-6 py-4">
              <h2 className="text-sm font-semibold">Open Positions</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-surface/50">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold">
                      Symbol
                    </th>
                    <th className="px-6 py-3 text-right font-semibold">Qty</th>
                    <th className="px-6 py-3 text-right font-semibold">
                      Entry
                    </th>
                    <th className="px-6 py-3 text-right font-semibold">
                      Current
                    </th>
                    <th className="px-6 py-3 text-right font-semibold">P&L</th>
                    <th className="px-6 py-3 text-right font-semibold">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {mockPositions.map((pos) => {
                    const pnlPercent = ((pos.pnl) / (pos.qty * pos.entryPrice)) * 100;
                    return (
                      <tr
                        key={pos.symbol}
                        className="hover:bg-surface/50 transition-colors"
                      >
                        <td className="px-6 py-4 font-semibold">
                          {pos.symbol}
                        </td>
                        <td className="px-6 py-4 text-right">{pos.qty}</td>
                        <td className="px-6 py-4 text-right font-mono">
                          ${pos.entryPrice.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 text-right font-mono">
                          ${pos.currentPrice.toFixed(2)}
                        </td>
                        <td
                          className={`px-6 py-4 text-right font-mono font-semibold ${
                            pos.pnl > 0
                              ? "text-green-600"
                              : pos.pnl < 0
                                ? "text-red-600"
                                : ""
                          }`}
                        >
                          ${pos.pnl.toLocaleString()}
                        </td>
                        <td
                          className={`px-6 py-4 text-right font-mono font-semibold ${
                            pnlPercent > 0
                              ? "text-green-600"
                              : pnlPercent < 0
                                ? "text-red-600"
                                : ""
                          }`}
                        >
                          {pnlPercent > 0 ? "+" : ""}
                          {pnlPercent.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t border-border bg-surface/50">
                  <tr>
                    <td className="px-6 py-4 font-semibold">Total</td>
                    <td className="px-6 py-4 text-right font-semibold">
                      {mockPositions.reduce((sum, p) => sum + p.qty, 0)}
                    </td>
                    <td></td>
                    <td></td>
                    <td
                      className={`px-6 py-4 text-right font-mono font-semibold ${
                        totalPnL > 0
                          ? "text-green-600"
                          : totalPnL < 0
                            ? "text-red-600"
                            : ""
                      }`}
                    >
                      ${totalPnL.toLocaleString()}
                    </td>
                    <td
                      className={`px-6 py-4 text-right font-mono font-semibold ${
                        totalPnL > 0
                          ? "text-green-600"
                          : totalPnL < 0
                            ? "text-red-600"
                            : ""
                      }`}
                    >
                      {((totalPnL / mockPositions.reduce((sum, p) => sum + p.qty * p.entryPrice, 0)) * 100).toFixed(2)}%
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* Sidebar Stats */}
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-6 py-4">
              <h3 className="text-sm font-semibold">Quick Stats</h3>
            </div>
            <div className="divide-y divide-border">
              <div className="px-6 py-4">
                <p className="text-xs font-medium text-foreground/60">
                  Orders Today
                </p>
                <p className="mt-1 text-2xl font-bold">{stats.ordersToday}</p>
              </div>
              <div className="px-6 py-4">
                <p className="text-xs font-medium text-foreground/60">
                  Fill Rate
                </p>
                <p className="mt-1 flex items-baseline gap-1">
                  <span className="text-2xl font-bold">
                    {stats.fillRate.toFixed(1)}
                  </span>
                  <span className="text-xs text-foreground/60">%</span>
                </p>
              </div>
              <div className="px-6 py-4">
                <p className="text-xs font-medium text-foreground/60">
                  Avg Slippage
                </p>
                <p className="mt-1 flex items-baseline gap-1">
                  <span className="text-2xl font-bold">
                    {stats.avgSlippage.toFixed(2)}
                  </span>
                  <span className="text-xs text-foreground/60">%</span>
                </p>
              </div>
              <div className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-foreground/60">
                    Win Rate
                  </p>
                  <TrendingUp className="h-4 w-4 text-green-600" />
                </div>
                <p className="mt-1 flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-green-600">
                    {stats.winRate.toFixed(1)}
                  </span>
                  <span className="text-xs text-foreground/60">%</span>
                </p>
              </div>
            </div>
          </div>

          {/* Exposure Summary */}
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-6 py-4">
              <h3 className="text-sm font-semibold">Exposure</h3>
            </div>
            <div className="space-y-4 px-6 py-4">
              <div>
                <p className="text-xs font-medium text-foreground/60">
                  Total Exposure
                </p>
                <p className="mt-1 text-lg font-bold">
                  ${(totalExposure / 1000000).toFixed(2)}M
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-foreground/60">
                  Daily P&L
                </p>
                <p
                  className={`mt-1 flex items-baseline gap-1 text-lg font-bold ${
                    totalPnL > 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {totalPnL > 0 ? "+" : ""}${totalPnL.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
