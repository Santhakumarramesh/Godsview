"use client";

import { useState, useEffect } from "react";
import { Shield, CheckCircle, AlertTriangle, X, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";

interface RiskCheck {
  id: string;
  name: string;
  status: "pass" | "warning" | "fail";
  message: string;
  limit?: string;
  current?: string;
}

interface PreTradeData {
  checks: RiskCheck[];
  canTrade: boolean;
  overallStatus: "pass" | "warning" | "fail";
}

const mockPreTradeData: PreTradeData = {
  overallStatus: "warning",
  canTrade: true,
  checks: [
    {
      id: "1",
      name: "Account Balance",
      status: "pass",
      message: "Account balance sufficient for order",
      current: "$487,230",
      limit: "Min $10,000",
    },
    {
      id: "2",
      name: "Daily Loss Limit",
      status: "warning",
      message: "Daily P&L approaching limit",
      current: "-$18,450",
      limit: "-$25,000",
    },
    {
      id: "3",
      name: "Sector Concentration",
      status: "pass",
      message: "Sector exposure within limits",
      current: "15.2% Technology",
      limit: "Max 25%",
    },
    {
      id: "4",
      name: "Position Size",
      status: "pass",
      message: "Proposed position size acceptable",
      current: "2.3% of portfolio",
      limit: "Max 5%",
    },
    {
      id: "5",
      name: "Leverage Ratio",
      status: "pass",
      message: "Leverage within acceptable range",
      current: "1.8x",
      limit: "Max 3.0x",
    },
    {
      id: "6",
      name: "Correlation Check",
      status: "warning",
      message: "High correlation with existing position",
      current: "0.78 correlation",
      limit: "Max 0.7",
    },
    {
      id: "7",
      name: "Volatility Filter",
      status: "pass",
      message: "Asset volatility acceptable",
      current: "32.4% IV",
      limit: "Max 45%",
    },
    {
      id: "8",
      name: "Liquidity Check",
      status: "pass",
      message: "Asset has sufficient liquidity",
      current: "45.2M avg daily volume",
      limit: "Min 1M",
    },
  ],
};

export default function RiskPreTradePage() {
  const [preTradeData, setPreTradeData] = useState<PreTradeData>(mockPreTradeData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [formData, setFormData] = useState({
    symbol: "AAPL",
    side: "BUY",
    quantity: 100,
    price: 182.45,
  });

  useEffect(() => {
    const fetchPreTradeChecks = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.risk.getPreTradeChecks?.();
        if (result) {
          setPreTradeData(result);
        }
      } catch (err) {
        console.error("Error fetching pre-trade checks:", err);
        setError("Failed to fetch pre-trade checks");
      } finally {
        setLoading(false);
      }
    };

    fetchPreTradeChecks();
  }, []);

  const handleSubmitOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (preTradeData.canTrade) {
      alert(`Order submitted: ${formData.side} ${formData.quantity} ${formData.symbol} @ $${formData.price}`);
      setShowOrderForm(false);
    }
  };

  const passCount = preTradeData.checks.filter((c) => c.status === "pass").length;
  const warningCount = preTradeData.checks.filter(
    (c) => c.status === "warning"
  ).length;
  const failCount = preTradeData.checks.filter((c) => c.status === "fail").length;

  const getCheckIcon = (status: string) => {
    switch (status) {
      case "pass":
        return <CheckCircle className="w-5 h-5 text-green-400" />;
      case "warning":
        return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
      case "fail":
        return <X className="w-5 h-5 text-red-400" />;
      default:
        return null;
    }
  };

  const getCheckColor = (status: string) => {
    switch (status) {
      case "pass":
        return "bg-green-500/20 border-green-500/30";
      case "warning":
        return "bg-yellow-500/20 border-yellow-500/30";
      case "fail":
        return "bg-red-500/20 border-red-500/30";
      default:
        return "bg-slate-500/20 border-slate-500/30";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-blue-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Pre-Trade Risk Gate</h1>
              <p className="text-slate-400 text-sm">Automated risk checks before order submission</p>
            </div>
          </div>
          <button
            onClick={() => setShowOrderForm(!showOrderForm)}
            disabled={!preTradeData.canTrade}
            className={`px-4 py-2 rounded-lg font-semibold transition-all ${
              preTradeData.canTrade
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-slate-700 text-slate-400 cursor-not-allowed"
            }`}
          >
            Submit Order
          </button>
        </div>

        {/* Status Banner */}
        <div
          className={`rounded-lg p-4 border ${
            preTradeData.overallStatus === "pass"
              ? "bg-green-500/20 border-green-500/30"
              : preTradeData.overallStatus === "warning"
                ? "bg-yellow-500/20 border-yellow-500/30"
                : "bg-red-500/20 border-red-500/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {preTradeData.overallStatus === "pass" ? (
                <CheckCircle className="w-6 h-6 text-green-400" />
              ) : preTradeData.overallStatus === "warning" ? (
                <AlertTriangle className="w-6 h-6 text-yellow-400" />
              ) : (
                <X className="w-6 h-6 text-red-400" />
              )}
              <div>
                <p className="font-semibold text-white">
                  {preTradeData.overallStatus === "pass"
                    ? "All checks passed"
                    : preTradeData.overallStatus === "warning"
                      ? "Some warnings detected"
                      : "Critical failures detected"}
                </p>
                <p className="text-sm text-slate-300">
                  Trading {preTradeData.canTrade ? "enabled" : "blocked"}
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="flex gap-4 text-sm font-semibold">
                <div className="flex items-center gap-1 text-green-400">
                  <CheckCircle className="w-4 h-4" />
                  {passCount}
                </div>
                <div className="flex items-center gap-1 text-yellow-400">
                  <AlertTriangle className="w-4 h-4" />
                  {warningCount}
                </div>
                <div className="flex items-center gap-1 text-red-400">
                  <X className="w-4 h-4" />
                  {failCount}
                </div>
              </div>
            </div>
          </div>
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
                    value={formData.symbol}
                    onChange={(e) =>
                      setFormData({ ...formData, symbol: e.target.value.toUpperCase() })
                    }
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Side
                  </label>
                  <select
                    value={formData.side}
                    onChange={(e) =>
                      setFormData({ ...formData, side: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-400"
                  >
                    <option value="BUY">Buy</option>
                    <option value="SELL">Sell</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Quantity
                  </label>
                  <input
                    type="number"
                    value={formData.quantity}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        quantity: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Price
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.price}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        price: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-400"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded transition-colors"
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
            <p className="text-slate-400">Loading pre-trade checks...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {preTradeData.checks.map((check) => (
              <div
                key={check.id}
                className={`rounded-lg border p-4 ${getCheckColor(check.status)}`}
              >
                <div className="flex items-start gap-3 mb-2">
                  {getCheckIcon(check.status)}
                  <div className="flex-1">
                    <h3 className="font-semibold text-white">{check.name}</h3>
                    <p className="text-sm text-slate-300 mt-1">{check.message}</p>
                  </div>
                </div>

                {(check.current || check.limit) && (
                  <div className="ml-8 mt-3 pt-3 border-t border-current border-opacity-20 space-y-1 text-xs">
                    {check.current && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Current:</span>
                        <span className="text-white font-semibold">
                          {check.current}
                        </span>
                      </div>
                    )}
                    {check.limit && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Limit:</span>
                        <span className="text-white font-semibold">{check.limit}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Risk Summary */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Risk Assessment Summary</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-800/50 rounded-lg p-4">
              <p className="text-slate-400 text-xs font-semibold uppercase mb-2">
                Checks Passed
              </p>
              <p className="text-3xl font-bold text-green-400">{passCount}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4">
              <p className="text-slate-400 text-xs font-semibold uppercase mb-2">
                Warnings
              </p>
              <p className="text-3xl font-bold text-yellow-400">{warningCount}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4">
              <p className="text-slate-400 text-xs font-semibold uppercase mb-2">
                Failures
              </p>
              <p className="text-3xl font-bold text-red-400">{failCount}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
