"use client";

import { useState, useEffect } from "react";
import { ShoppingCart, AlertCircle, Filter } from "lucide-react";
import { api } from "@/lib/api";

interface Order {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "STOP";
  qty: number;
  price: number | null;
  status: "open" | "filled" | "cancelled" | "rejected";
  filled: number;
  timestamp: string;
}

const mockOrders: Order[] = [
  {
    id: "1",
    symbol: "AAPL",
    side: "BUY",
    type: "MARKET",
    qty: 100,
    price: null,
    status: "filled",
    filled: 100,
    timestamp: "14:32:15",
  },
  {
    id: "2",
    symbol: "MSFT",
    side: "SELL",
    type: "LIMIT",
    qty: 50,
    price: 425.50,
    status: "open",
    filled: 0,
    timestamp: "14:28:42",
  },
  {
    id: "3",
    symbol: "TSLA",
    side: "BUY",
    type: "LIMIT",
    qty: 75,
    price: 242.00,
    status: "filled",
    filled: 75,
    timestamp: "14:15:30",
  },
  {
    id: "4",
    symbol: "NVDA",
    side: "BUY",
    type: "MARKET",
    qty: 25,
    price: null,
    status: "cancelled",
    filled: 0,
    timestamp: "14:05:12",
  },
  {
    id: "5",
    symbol: "GOOG",
    side: "SELL",
    type: "STOP",
    qty: 40,
    price: 170.00,
    status: "rejected",
    filled: 0,
    timestamp: "13:58:22",
  },
  {
    id: "6",
    symbol: "QQQ",
    side: "BUY",
    type: "LIMIT",
    qty: 200,
    price: 380.25,
    status: "open",
    filled: 120,
    timestamp: "13:45:08",
  },
];

export default function ExecutionOrdersPage() {
  const [orders, setOrders] = useState<Order[]>(mockOrders);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "open" | "filled" | "cancelled" | "rejected">("all");

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.execution.getOrders?.();
        if (result) {
          setOrders(result);
        }
      } catch (err) {
        console.error("Error fetching orders:", err);
        setError("Failed to fetch orders");
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, []);

  const filteredOrders = filterStatus === "all" ? orders : orders.filter((o) => o.status === filterStatus);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-blue-500/20 text-blue-300";
      case "filled":
        return "bg-green-500/20 text-green-300";
      case "cancelled":
        return "bg-slate-500/20 text-slate-300";
      case "rejected":
        return "bg-red-500/20 text-red-300";
      default:
        return "bg-slate-500/20 text-slate-300";
    }
  };

  const getSideColor = (side: string) => {
    return side === "BUY" ? "text-green-400" : "text-red-400";
  };

  const stats = {
    total: orders.length,
    open: orders.filter((o) => o.status === "open").length,
    filled: orders.filter((o) => o.status === "filled").length,
    cancelled: orders.filter((o) => o.status === "cancelled").length,
    rejected: orders.filter((o) => o.status === "rejected").length,
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <ShoppingCart className="w-8 h-8 text-orange-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Order Book</h1>
              <p className="text-slate-400 text-sm">Execution order history and status</p>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <p className="text-slate-400 text-xs font-semibold uppercase mb-2">Total Orders</p>
            <p className="text-2xl font-bold text-white">{stats.total}</p>
          </div>
          <div className="bg-blue-500/20 border border-blue-500/30 rounded-lg p-4">
            <p className="text-slate-400 text-xs font-semibold uppercase mb-2">Open</p>
            <p className="text-2xl font-bold text-blue-400">{stats.open}</p>
          </div>
          <div className="bg-green-500/20 border border-green-500/30 rounded-lg p-4">
            <p className="text-slate-400 text-xs font-semibold uppercase mb-2">Filled</p>
            <p className="text-2xl font-bold text-green-400">{stats.filled}</p>
          </div>
          <div className="bg-slate-500/20 border border-slate-500/30 rounded-lg p-4">
            <p className="text-slate-400 text-xs font-semibold uppercase mb-2">Cancelled</p>
            <p className="text-2xl font-bold text-slate-300">{stats.cancelled}</p>
          </div>
          <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-4">
            <p className="text-slate-400 text-xs font-semibold uppercase mb-2">Rejected</p>
            <p className="text-2xl font-bold text-red-400">{stats.rejected}</p>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 flex items-center gap-2 text-red-300">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {/* Filter */}
        <div className="flex gap-2">
          <button
            onClick={() => setFilterStatus("all")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filterStatus === "all"
                ? "bg-cyan-500/30 text-cyan-300 border border-cyan-500/50"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilterStatus("open")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filterStatus === "open"
                ? "bg-blue-500/30 text-blue-300 border border-blue-500/50"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            Open
          </button>
          <button
            onClick={() => setFilterStatus("filled")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filterStatus === "filled"
                ? "bg-green-500/30 text-green-300 border border-green-500/50"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            Filled
          </button>
          <button
            onClick={() => setFilterStatus("cancelled")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filterStatus === "cancelled"
                ? "bg-slate-500/30 text-slate-300 border border-slate-500/50"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            Cancelled
          </button>
          <button
            onClick={() => setFilterStatus("rejected")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filterStatus === "rejected"
                ? "bg-red-500/30 text-red-300 border border-red-500/50"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            Rejected
          </button>
        </div>

        {/* Orders Table */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-slate-400">Loading orders...</p>
          </div>
        ) : (
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-700">
                  <tr className="text-slate-400 text-xs uppercase font-semibold">
                    <th className="text-left py-3 px-4">Order ID</th>
                    <th className="text-left py-3 px-4">Symbol</th>
                    <th className="text-left py-3 px-4">Side</th>
                    <th className="text-left py-3 px-4">Type</th>
                    <th className="text-right py-3 px-4">Qty</th>
                    <th className="text-right py-3 px-4">Price</th>
                    <th className="text-left py-3 px-4">Status</th>
                    <th className="text-right py-3 px-4">Filled</th>
                    <th className="text-left py-3 px-4">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => (
                    <tr key={order.id} className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 font-mono text-slate-300">{order.id}</td>
                      <td className="py-3 px-4 font-semibold text-white">{order.symbol}</td>
                      <td className={`py-3 px-4 font-semibold ${getSideColor(order.side)}`}>
                        {order.side}
                      </td>
                      <td className="py-3 px-4 text-slate-300">{order.type}</td>
                      <td className="py-3 px-4 text-right font-semibold text-white">{order.qty}</td>
                      <td className="py-3 px-4 text-right text-slate-300">
                        {order.price ? `$${order.price.toFixed(2)}` : "-"}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${getStatusColor(order.status)}`}>
                          {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-white">
                        {order.filled}/{order.qty}
                        <div className="w-12 h-1 bg-slate-700 rounded mt-1">
                          <div
                            className="bg-cyan-500 h-1 rounded"
                            style={{
                              width: `${(order.filled / order.qty) * 100}%`,
                            }}
                          />
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-400">{order.timestamp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredOrders.length === 0 && (
              <div className="text-center py-8 text-slate-400">
                <p>No orders found with status: {filterStatus}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
