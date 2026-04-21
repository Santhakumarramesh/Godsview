"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface JournalEntry {
  id: string;
  date: string;
  symbol: string;
  strategy: string;
  entry: number;
  exit: number;
  pnl: number;
  notes: string;
  lesson: string;
}

const mockJournalEntries: JournalEntry[] = [
  {
    id: "1",
    date: "2024-04-20",
    symbol: "AAPL",
    strategy: "Mean Reversion RSI",
    entry: 189.50,
    exit: 191.25,
    pnl: 1.75,
    notes: "Strong volume confirmation on entry, exit at resistance. Nice execution.",
    lesson: "Volume confirmation is crucial for mean reversion entries.",
  },
  {
    id: "2",
    date: "2024-04-20",
    symbol: "MSFT",
    strategy: "Momentum Cross",
    entry: 405.00,
    exit: 408.75,
    pnl: 3.75,
    notes: "MACD setup was textbook perfect. Extended hold to maximize gains.",
    lesson: "Trust setups with high conviction signals - don't exit too early.",
  },
  {
    id: "3",
    date: "2024-04-19",
    symbol: "TSLA",
    strategy: "Mean Reversion RSI",
    entry: 182.50,
    exit: 183.19,
    pnl: -0.69,
    notes: "Stop loss hit quickly. Bad timing on entry - market was too strong.",
    lesson: "Check daily trend before entering mean reversion - don't fight strong trends.",
  },
];

export default function TradeJournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newEntry, setNewEntry] = useState({
    symbol: "",
    strategy: "",
    entry: "",
    exit: "",
    notes: "",
    lesson: "",
  });
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const fetchEntries = async () => {
      try {
        setLoading(true);
        try {
          await api.memory.getRecentSignals?.();
        } catch {
          // Fallback
        }
        setEntries(mockJournalEntries);
      } catch (err) {
        setError((err as Error).message || "Failed to load journal entries");
        setEntries(mockJournalEntries);
      } finally {
        setLoading(false);
      }
    };
    fetchEntries();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-slate-400">Loading journal entries...</p>
      </div>
    );
  }

  const stats = {
    total: entries.length,
    winners: entries.filter((e) => e.pnl > 0).length,
    losers: entries.filter((e) => e.pnl < 0).length,
    winRate: entries.length > 0 ? (entries.filter((e) => e.pnl > 0).length / entries.length) * 100 : 0,
    avgPnL: entries.length > 0 ? entries.reduce((a, e) => a + e.pnl, 0) / entries.length : 0,
  };

  const handleAddEntry = () => {
    if (newEntry.symbol && newEntry.entry && newEntry.exit) {
      const entry: JournalEntry = {
        id: Date.now().toString(),
        date: new Date().toISOString().split("T")[0],
        symbol: newEntry.symbol,
        strategy: newEntry.strategy || "Manual",
        entry: parseFloat(newEntry.entry),
        exit: parseFloat(newEntry.exit),
        pnl: parseFloat(newEntry.exit) - parseFloat(newEntry.entry),
        notes: newEntry.notes,
        lesson: newEntry.lesson,
      };
      setEntries([entry, ...entries]);
      setNewEntry({ symbol: "", strategy: "", entry: "", exit: "", notes: "", lesson: "" });
      setShowForm(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Trade Journal</h1>
        <p className="mt-1 text-sm text-slate-400">
          Document and learn from each trade
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total Entries" value={stats.total.toString()} />
        <StatCard label="Winners" value={stats.winners.toString()} color="green" />
        <StatCard label="Losers" value={stats.losers.toString()} color="red" />
        <StatCard label="Win Rate" value={stats.winRate.toFixed(1) + "%"} color="blue" />
        <StatCard label="Avg P&L" value={(stats.avgPnL >= 0 ? "+" : "") + stats.avgPnL.toFixed(2)} color={stats.avgPnL >= 0 ? "green" : "red"} />
      </div>

      {/* Add Entry Button */}
      <button
        onClick={() => setShowForm(!showForm)}
        className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 transition"
      >
        {showForm ? "Cancel" : "+ Add Journal Entry"}
      </button>

      {/* New Entry Form */}
      {showForm && (
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-100">New Journal Entry</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <input
              type="text"
              placeholder="Symbol (e.g., AAPL)"
              value={newEntry.symbol}
              onChange={(e) => setNewEntry({ ...newEntry, symbol: e.target.value })}
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Strategy"
              value={newEntry.strategy}
              onChange={(e) => setNewEntry({ ...newEntry, strategy: e.target.value })}
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="number"
              placeholder="Entry Price"
              value={newEntry.entry}
              onChange={(e) => setNewEntry({ ...newEntry, entry: e.target.value })}
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="number"
              placeholder="Exit Price"
              value={newEntry.exit}
              onChange={(e) => setNewEntry({ ...newEntry, exit: e.target.value })}
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <textarea
            placeholder="Trade Notes"
            value={newEntry.notes}
            onChange={(e) => setNewEntry({ ...newEntry, notes: e.target.value })}
            rows={3}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <textarea
            placeholder="Key Lesson"
            value={newEntry.lesson}
            onChange={(e) => setNewEntry({ ...newEntry, lesson: e.target.value })}
            rows={2}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={handleAddEntry}
            className="w-full rounded-lg bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-700 transition"
          >
            Save Entry
          </button>
        </div>
      )}

      {/* Journal Entries */}
      <div className="space-y-4">
        {entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-600 bg-slate-800/50 p-8 text-center">
            <p className="text-slate-400">No journal entries yet. Start documenting your trades!</p>
          </div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-slate-700 bg-slate-900 p-6 hover:border-slate-600 transition">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-100">{entry.symbol}</h3>
                  <p className="text-sm text-slate-400">{entry.strategy} • {entry.date}</p>
                </div>
                <span
                  className={`rounded px-3 py-1 font-semibold ${
                    entry.pnl >= 0
                      ? "bg-green-500/20 text-green-400"
                      : "bg-red-500/20 text-red-400"
                  }`}
                >
                  {entry.pnl >= 0 ? "+" : ""}{entry.pnl.toFixed(2)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                <div>
                  <p className="text-slate-400">Entry Price</p>
                  <p className="font-mono text-slate-100">${entry.entry.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-slate-400">Exit Price</p>
                  <p className="font-mono text-slate-100">${entry.exit.toFixed(2)}</p>
                </div>
              </div>

              {entry.notes && (
                <div className="mb-3 border-t border-slate-700 pt-3">
                  <p className="text-xs text-slate-400 mb-1">Notes</p>
                  <p className="text-sm text-slate-300">{entry.notes}</p>
                </div>
              )}

              {entry.lesson && (
                <div className="border-t border-slate-700 pt-3">
                  <p className="text-xs text-slate-400 mb-1">Lesson</p>
                  <p className="text-sm text-yellow-300">{entry.lesson}</p>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color = "slate" }: { label: string; value: string; color?: string }) {
  const colorClasses = {
    slate: "bg-slate-800 border-slate-700 text-slate-300",
    green: "bg-green-500/10 border-green-500/30 text-green-400",
    red: "bg-red-500/10 border-red-500/30 text-red-400",
    blue: "bg-blue-500/10 border-blue-500/30 text-blue-400",
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color as keyof typeof colorClasses]}`}>
      <p className="text-xs font-semibold uppercase tracking-widest">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
