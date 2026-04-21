"use client";

import { useState } from "react";
import { AlertTriangle, Power, Pause, Lock, Zap, History, AlertCircle } from "lucide-react";

interface ActivationRecord {
  timestamp: string;
  type: "FULL_FLATTEN" | "PAUSE_STRATEGY" | "PAUSE_SYMBOL" | "PAUSE_SYSTEM";
  reason: string;
  positions: number;
  pnl: number;
}

interface ActivePosition {
  symbol: string;
  side: "LONG" | "SHORT";
  qty: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
}

interface PendingOrder {
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  type: string;
}

const mockActivePositions: ActivePosition[] = [
  {
    symbol: "AAPL",
    side: "LONG",
    qty: 500,
    entryPrice: 182.45,
    currentPrice: 184.20,
    pnl: 875,
  },
  {
    symbol: "MSFT",
    side: "SHORT",
    qty: 300,
    entryPrice: 418.20,
    currentPrice: 416.80,
    pnl: 420,
  },
  {
    symbol: "TSLA",
    side: "LONG",
    qty: 200,
    entryPrice: 242.18,
    currentPrice: 241.50,
    pnl: -136,
  },
];

const mockPendingOrders: PendingOrder[] = [
  { symbol: "NVDA", side: "BUY", qty: 150, price: 895.50, type: "Limit" },
  { symbol: "GOOG", side: "SELL", qty: 400, price: 175.82, type: "Market" },
];

const mockHistory: ActivationRecord[] = [
  {
    timestamp: "2024-04-18 09:15:00",
    type: "PAUSE_SYMBOL",
    reason: "Max position size exceeded - AAPL",
    positions: 1,
    pnl: 0,
  },
  {
    timestamp: "2024-04-15 14:32:00",
    type: "PAUSE_STRATEGY",
    reason: "Daily loss limit approached",
    positions: 0,
    pnl: 0,
  },
  {
    timestamp: "2024-04-12 11:45:00",
    type: "FULL_FLATTEN",
    reason: "Manual operator action - System maintenance",
    positions: 5,
    pnl: 1240,
  },
];

export default function KillSwitchPage() {
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationType, setConfirmationType] = useState<
    "FULL_FLATTEN" | "PAUSE_STRATEGY" | "PAUSE_SYMBOL" | "PAUSE_SYSTEM" | null
  >(null);

  const handleEmergencyFlatten = () => {
    setConfirmationType("FULL_FLATTEN");
    setShowConfirmation(true);
  };

  const handlePauseStrategy = () => {
    setConfirmationType("PAUSE_STRATEGY");
    setShowConfirmation(true);
  };

  const handlePauseSymbol = () => {
    setConfirmationType("PAUSE_SYMBOL");
    setShowConfirmation(true);
  };

  const handlePauseSystem = () => {
    setConfirmationType("PAUSE_SYSTEM");
    setShowConfirmation(true);
  };

  const handleConfirm = () => {
    setShowConfirmation(false);
    setConfirmationType(null);
    // Execute action
  };

  const handleCancel = () => {
    setShowConfirmation(false);
    setConfirmationType(null);
  };

  const totalPnL = mockActivePositions.reduce((sum, p) => sum + p.pnl, 0);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header with Warning */}
        <div className="flex items-center justify-between border-b border-red-700/50 pb-6">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-10 h-10 text-red-500 animate-pulse" />
            <div>
              <h1 className="text-3xl font-bold text-white">Emergency Controls</h1>
              <p className="text-red-400 text-sm font-semibold">
                Critical execution halt system - use only in emergencies
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-slate-400 text-xs uppercase mb-1">System Status</p>
            <p className="text-green-400 font-bold text-lg">ACTIVE & READY</p>
          </div>
        </div>

        {/* EMERGENCY BUTTON */}
        <div className="bg-gradient-to-b from-red-950/80 to-red-900/40 border-2 border-red-500 rounded-lg p-8 text-center">
          <p className="text-red-300 font-semibold mb-6 text-sm uppercase tracking-widest">
            Immediate Action Required
          </p>
          <button
            onClick={handleEmergencyFlatten}
            className="w-full px-12 py-8 rounded-xl bg-gradient-to-b from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-black text-4xl uppercase tracking-widest shadow-2xl hover:shadow-red-500/50 transition-all active:scale-95 border-2 border-red-400"
          >
            <div className="flex items-center justify-center gap-4">
              <Power className="w-12 h-12" />
              EMERGENCY FLATTEN ALL
            </div>
          </button>
          <p className="text-red-300 text-xs mt-6 max-w-2xl mx-auto">
            Closes all positions immediately at market price and cancels all pending orders. This action cannot be
            undone. Use only in true emergencies.
          </p>
        </div>

        {/* Individual Controls */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={handlePauseStrategy}
            className="px-6 py-4 rounded-lg bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white font-semibold flex items-center justify-center gap-2 transition-all"
          >
            <Pause className="w-5 h-5" />
            Pause Strategy
          </button>
          <button
            onClick={handlePauseSymbol}
            className="px-6 py-4 rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-semibold flex items-center justify-center gap-2 transition-all"
          >
            <Lock className="w-5 h-5" />
            Pause Symbol
          </button>
          <button
            onClick={handlePauseSystem}
            className="px-6 py-4 rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white font-semibold flex items-center justify-center gap-2 transition-all"
          >
            <Zap className="w-5 h-5" />
            Pause System
          </button>
        </div>

        {/* Current Status */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Active Positions */}
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <p className="text-slate-400 text-xs font-medium uppercase mb-3">Active Positions</p>
            <p className="text-3xl font-bold text-white mb-2">{mockActivePositions.length}</p>
            <div className="space-y-1">
              {mockActivePositions.map((pos, idx) => (
                <div key={idx} className="flex justify-between text-xs text-slate-400">
                  <span>{pos.symbol}</span>
                  <span className={pos.pnl >= 0 ? "text-green-400" : "text-red-400"}>
                    ${pos.pnl >= 0 ? "+" : ""}{pos.pnl}
                  </span>
                </div>
              ))}
            </div>
            <p className={`text-sm font-bold mt-3 pt-2 border-t border-slate-700 ${totalPnL >= 0 ? "text-green-400" : "text-red-400"}`}>
              Total: ${totalPnL >= 0 ? "+" : ""}{totalPnL}
            </p>
          </div>

          {/* Pending Orders */}
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <p className="text-slate-400 text-xs font-medium uppercase mb-3">Pending Orders</p>
            <p className="text-3xl font-bold text-white mb-2">{mockPendingOrders.length}</p>
            <div className="space-y-1">
              {mockPendingOrders.map((order, idx) => (
                <div key={idx} className="flex justify-between text-xs text-slate-400">
                  <span>
                    {order.symbol} {order.side === "BUY" ? "B" : "S"} {order.qty}
                  </span>
                  <span>${order.price.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-amber-400 mt-3 pt-2 border-t border-slate-700">
              Will be cancelled on emergency flatten
            </p>
          </div>

          {/* System Ready */}
          <div className="bg-slate-900/50 border border-green-500/50 rounded-lg p-4">
            <p className="text-slate-400 text-xs font-medium uppercase mb-3">System Status</p>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
              <p className="text-lg font-bold text-green-400">Ready</p>
            </div>
            <div className="text-xs text-slate-400 space-y-1">
              <p>Kill switch armed and operational</p>
              <p>Response time: &lt;50ms</p>
              <p>Last tested: Apr 20, 14:32</p>
            </div>
          </div>
        </div>

        {/* Detailed Position Table */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Active Positions (Would Be Closed)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-700">
                <tr className="text-slate-400 text-xs uppercase font-semibold">
                  <th className="text-left py-3 px-4">Symbol</th>
                  <th className="text-left py-3 px-4">Side</th>
                  <th className="text-right py-3 px-4">Qty</th>
                  <th className="text-right py-3 px-4">Entry</th>
                  <th className="text-right py-3 px-4">Current</th>
                  <th className="text-right py-3 px-4">P&L</th>
                </tr>
              </thead>
              <tbody>
                {mockActivePositions.map((pos, idx) => (
                  <tr key={idx} className="border-b border-slate-800 hover:bg-slate-800/30">
                    <td className="py-3 px-4 font-semibold text-white">{pos.symbol}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          pos.side === "LONG"
                            ? "bg-green-500/20 text-green-300"
                            : "bg-red-500/20 text-red-300"
                        }`}
                      >
                        {pos.side}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-slate-300">{pos.qty}</td>
                    <td className="py-3 px-4 text-right text-slate-300">${pos.entryPrice.toFixed(2)}</td>
                    <td className="py-3 px-4 text-right text-slate-300">${pos.currentPrice.toFixed(2)}</td>
                    <td
                      className={`py-3 px-4 text-right font-semibold ${
                        pos.pnl >= 0 ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      ${pos.pnl >= 0 ? "+" : ""}{pos.pnl}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Activation History */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <History className="w-5 h-5 text-slate-400" />
            Kill Switch History
          </h2>
          <div className="space-y-2">
            {mockHistory.map((record, idx) => (
              <div key={idx} className="bg-slate-800/30 border border-slate-700 rounded p-3 text-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-white">{record.timestamp}</p>
                    <p className="text-slate-400 text-xs mt-1">{record.reason}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span
                      className={`px-2 py-1 rounded text-xs font-semibold ${
                        record.type === "FULL_FLATTEN"
                          ? "bg-red-500/20 text-red-300"
                          : record.type === "PAUSE_STRATEGY"
                            ? "bg-amber-500/20 text-amber-300"
                            : "bg-blue-500/20 text-blue-300"
                      }`}
                    >
                      {record.type}
                    </span>
                    <p className="text-slate-400 text-xs mt-1">
                      {record.positions > 0 ? `Closed ${record.positions} pos` : "No positions"}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Warning Banner */}
        <div className="bg-gradient-to-r from-red-500/10 to-orange-500/10 border border-red-500/30 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-slate-300">
            <p className="font-semibold text-white mb-1">Emergency Flatten Consequences:</p>
            <ul className="text-xs space-y-1 text-slate-400">
              <li>All positions will be closed at market price immediately</li>
              <li>No limit orders will be used - may incur slippage</li>
              <li>All pending orders will be cancelled</li>
              <li>Strategy will pause and require manual restart</li>
              <li>This action is irreversible</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      {showConfirmation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border-2 border-red-500 rounded-lg p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-red-500" />
              <h3 className="text-lg font-bold text-white">Confirm Emergency Action</h3>
            </div>
            <p className="text-slate-300 mb-6">
              {confirmationType === "FULL_FLATTEN"
                ? "This will immediately close all positions and cancel all orders. This action cannot be undone."
                : confirmationType === "PAUSE_STRATEGY"
                  ? "This will pause the current strategy while keeping positions open."
                  : confirmationType === "PAUSE_SYMBOL"
                    ? "This will pause trading for the selected symbol."
                    : "This will pause the entire system."}
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleCancel}
                className="flex-1 px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-white font-semibold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="flex-1 px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white font-semibold transition-all"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
