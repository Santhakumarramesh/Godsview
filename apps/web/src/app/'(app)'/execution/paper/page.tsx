"use client";

import { useState, useEffect } from "react";
import { BookOpen, Plus, AlertCircle, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";

interface PaperPosition {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
}

interface PaperData {
  totalBalance: number;
  buyingPower: number;
  positions: PaperPosition[];
  totalPnL: number;
}

const mockPaperData: PaperData = {
  totalBalance: 100000,
  buyingPower: 54230,
  positions: [
    {
      id: "1",
      symbol: "AAPL",
      side: "LONG",
      quantity: 50,
      entryPrice: 180.50,
      currentPrice: 182.45,
      pnl: 97.50,
      pnlPct: 1.08,
    },
    {
      id: "2",
      symbol: "MSFT",
      side: "SHORT",
      quantity: 30,
      entryPrice: 425.50,
      currentPrice: 423.20,
      pnl: 69.00,
      pnlPct: 0.54,
    },
    {
      id: "3",
      symbol: "TSLA",
      side: "LONG",
      quantity: 25,
      entryPrice: 242.00,
      currentPrice: 240.80,
      pnl: -30.00,
      pnlPct: -0.50,
    },
  ],
  totalPnL: 136.50,
};

export default function ExecutionPaperPage() {
  const [paperData, setPaperData] = useState<PaperData>(mockPaperData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [orderForm, setOrderForm] = useState({
    symbol: "AAPL",
    side: "LONG" as "LONG" | "SHORT",
    quantity: 10,
    price: 182.45,
  });

  useEffect(() => {
    const fetchPaperTrades = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.execution.getPaperTrades?.();
        if (result) {
          setPaperData(result);
        }
      } catch (err) {
        console.error("Error fetching paper trades:", err);
        setError("Failed to fetch paper trading data");
      } finally {
        setLoading(false);
      }
    };

    fetchPaperTrades();
  }, []);

  const handleSubmitOrder = (e: React.FormEvent) => {
    e.preventDefault();

    // Add new position
    const newPosition: PaperPosition = {
      id: String(paperData.positions.length + 1),
      symbol: orderForm.symbol,
      side: orderForm.side,
      quantity: orderForm.quantity,
      entryPrice: orderForm.price,
      currentPrice: orderForm.price,
      pnl: 0,
      pnlPct: 0,
    };

    const cost = orderForm.quantity * orderForm.price;
    setPaperData({
      ...paperData,
      buyingPower: Math.max(0, paperData.buyingPower - cost),
      positions: [...paperData.positions, newPosition],
    });

    setOrderForm({ symbol: "AAPL", side: "LONG", quantity: 10, price: 182.45 });
    setShowOrderForm(false);
  };

  const handleClosePosition = (id: string) => {
    const position = paperData.positions.find((p) => p.id === id);
    if (position) {
      const proceeds = position.quantity * position.currentPrice;
      setPaperData({
        ...paperData,
        buyingPower: paperData.buyingPower + proceeds,
        positions: paperData.positions.filter((p) => p.id !== id),
      });
    }
  };

  const getPnLColor = (pnl: number) => {
    return pnl > 0 ? "text-green-400" : pnl < 0 ? "text-red-400" : "text-slate-400";
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-sky-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Paper Trading Arena</h1>
              <p className="text-slate-400 text-sm">Risk-free strategy testing with virtual capital</p>
            </div>
          </div>
          <button
            onClick={() => setShowOrderForm(!showOrderForm)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-sky-600 to-sky-700 hover:from-sky-700 hover:to-sky-800 text-white font-semibold rounded-lg transition-all"
          >
            <Plus className="w-4 h-4" />
            New Order
          </button>
        </div>

        {/* Order Form */}
        {showOrderForm && (
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
            <form onSubmit={handleSubmitOrder} className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Symbol
                  </label>
                  <input
                    type="text"
                    value={orderForm.symbol}
                    onChange={(e) =>
                      setOrderForm({ ...orderForm, symbol: e.target.value.toUpperCase() })
                    }
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white focus:outline-none focus:border-sky-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Side
                  </label>
                  <select
                    value={orderForm.side}
                    onChange={(e) =>
                      setOrderForm({
                        ...orderForm,
                        side: e.target.value as "LONG" | "SHORT",
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white focus:outline-none focus:border-sky-400"
                  >
                    <option value="LONG">Long</option>
                    <option value="SHORT">Short</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Quantity
                  </label>
                  <input
                    type="number"
                    value={orderForm.quantity}
                    onChange={(e) =>
                      setOrderForm({
                        ...orderForm,
                        quantity: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white focus:outline-none focus:border-sky-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Price
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={orderForm.price}
                    onChange={(e) =>
                      setOrderForm({
                        ...orderForm,
                        price: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white focus:outline-none focus:border-sky-400"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded transition-colors"
                >
                  Submit Order
                </button>
                <button
                  type="button"
                  onClick={() => setShowOrderForm(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 flex items-center gap-2 text-red-300">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <p className="text-slate-400">Loading paper trading data...</p>
          </div>
        ) : (
          <>
            {/* Account Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
                <p className="text-slate-400 text-xs font-semibold uppercase mb-2">
                  Account Balance
                </p>
                <p className="text-3xl font-bold text-white">
                  ${paperData.totalBalance.toLocaleString()}
                </p>
              </div>
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
                <p className="text-slate-400 text-xs font-semibold uppercase mb-2">
                  Buying Power
                </p>
                <p className="text-3xl font-bold text-blue-400">
                  ${paperData.buyingPower.toLocaleString()}
                </p>
              </div>
              <div
                className={`rounded-lg p-6 border ${
                  paperData.totalPnL > 0
                    ? "bg-green-500/20 border-green-500/30"
                    : "bg-red-500/20 border-red-500/30"
                }`}
              >
                <p className="text-slate-400 text-xs font-semibold uppercase mb-2">
                  Paper P&L
                </p>
                <p
                  className={`text-3xl font-bold ${
                    paperData.totalPnL > 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {paperData.totalPnL > 0 ? "+" : ""}${paperData.totalPnL.toFixed(2)}
                </p>
              </div>
            </div>

            {/* Positions Table */}
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-sky-400" />
                Open Positions
              </h2>

              {paperData.positions.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-700">
                      <tr className="text-slate-400 text-xs uppercase font-semibold">
                        <th className="text-left py-3 px-4">Symbol</th>
                        <th className="text-left py-3 px-4">Side</th>
                        <th className="text-right py-3 px-4">Qty</th>
                        <th className="text-right py-3 px-4">Entry Price</th>
                        <th className="text-right py-3 px-4">Current Price</th>
                        <th className="text-right py-3 px-4">P&L</th>
                        <th className="text-center py-3 px-4">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paperData.positions.map((position) => (
                        <tr
                          key={position.id}
                          className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors"
                        >
                          <td className="py-3 px-4 font-semibold text-white">
                            {position.symbol}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-1 rounded text-xs font-semibold ${
                                position.side === "LONG"
                                  ? "bg-green-500/20 text-green-300"
                                  : "bg-red-500/20 text-red-300"
                              }`}
                            >
                              {position.side}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-white">
                            {position.quantity}
                          </td>
                          <td className="py-3 px-4 text-right text-slate-300">
                            ${position.entryPrice.toFixed(2)}
                          </td>
                          <td className="py-3 px-4 text-right text-slate-300">
                            ${position.currentPrice.toFixed(2)}
                          </td>
                          <td
                            className={`py-3 px-4 text-right font-semibold ${getPnLColor(
                              position.pnl
                            )}`}
                          >
                            {position.pnl > 0 ? "+" : ""}${position.pnl.toFixed(2)} ({position.pnlPct > 0 ? "+" : ""}
                            {position.pnlPct.toFixed(2)}%)
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              onClick={() => handleClosePosition(position.id)}
                              className="px-3 py-1 rounded text-xs font-semibold bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors"
                            >
                              Close
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400">
                  <p>No open positions. Click "New Order" to start trading.</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
