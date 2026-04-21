"use client";

import { useState } from "react";
import { Star, Plus, X, Search, AlertCircle } from "lucide-react";

interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
  priority: "high" | "medium" | "low";
  createdAt: string;
}

const mockWatchlists: Watchlist[] = [
  {
    id: "1",
    name: "Core Tech",
    symbols: ["AAPL", "NVDA", "MSFT", "TSLA"],
    priority: "high",
    createdAt: "2024-01-15",
  },
  {
    id: "2",
    name: "Crypto",
    symbols: ["BTC", "ETH", "SOL"],
    priority: "medium",
    createdAt: "2024-02-01",
  },
  {
    id: "3",
    name: "Futures",
    symbols: ["ES", "NQ", "YM"],
    priority: "low",
    createdAt: "2024-03-10",
  },
];

const allSymbols = ["AAPL", "NVDA", "MSFT", "TSLA", "GOOGL", "AMZN", "BTC", "ETH", "SOL", "ES", "NQ", "YM", "GLD", "SPY"];

export default function WatchlistPage() {
  const [watchlists, setWatchlists] = useState<Watchlist[]>(mockWatchlists);
  const [searchQuery, setSearchQuery] = useState("");
  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedWatchlist, setSelectedWatchlist] = useState<string | null>(null);

  const filteredSymbols = allSymbols.filter((s) =>
    s.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateWatchlist = () => {
    if (newWatchlistName.trim()) {
      const newList: Watchlist = {
        id: Math.random().toString(),
        name: newWatchlistName,
        symbols: [],
        priority: "medium",
        createdAt: new Date().toISOString().split("T")[0],
      };
      setWatchlists([...watchlists, newList]);
      setNewWatchlistName("");
      setShowCreateForm(false);
    }
  };

  const handleAddSymbol = (watchlistId: string, symbol: string) => {
    setWatchlists(
      watchlists.map((wl) =>
        wl.id === watchlistId && !wl.symbols.includes(symbol)
          ? { ...wl, symbols: [...wl.symbols, symbol] }
          : wl
      )
    );
  };

  const handleRemoveSymbol = (watchlistId: string, symbol: string) => {
    setWatchlists(
      watchlists.map((wl) =>
        wl.id === watchlistId
          ? { ...wl, symbols: wl.symbols.filter((s) => s !== symbol) }
          : wl
      )
    );
  };

  const handleDeleteWatchlist = (id: string) => {
    setWatchlists(watchlists.filter((wl) => wl.id !== id));
  };

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      high: "bg-red-500/20 text-red-300 border-red-500/30",
      medium: "bg-amber-500/20 text-amber-300 border-amber-500/30",
      low: "bg-slate-500/20 text-slate-300 border-slate-500/30",
    };
    return colors[priority] || colors.medium;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <Star className="w-8 h-8 text-amber-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Watchlist Manager</h1>
              <p className="text-slate-400 text-sm">Organize and track your favorite symbols</p>
            </div>
          </div>
          <button onClick={() => setShowCreateForm(true)} className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-semibold rounded flex items-center gap-2 transition-all">
            <Plus className="w-4 h-4" />
            Create Watchlist
          </button>
        </div>

        {showCreateForm && (
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
            <div className="flex gap-3">
              <input type="text" placeholder="Watchlist name..." value={newWatchlistName} onChange={(e) => setNewWatchlistName(e.target.value)} className="flex-1 px-4 py-2 bg-slate-800 border border-slate-600 rounded text-white placeholder-slate-500 focus:outline-none focus:border-amber-400" />
              <button onClick={handleCreateWatchlist} className="px-6 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-300 border border-green-500/30 rounded font-semibold transition-all">Create</button>
              <button onClick={() => setShowCreateForm(false)} className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 rounded font-semibold transition-all">Cancel</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {watchlists.map((watchlist) => (
            <div key={watchlist.id} className="bg-slate-900/50 border border-slate-700 rounded-lg p-6 hover:border-slate-600 transition-all">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h2 className="text-lg font-bold text-white mb-2">{watchlist.name}</h2>
                  <div className="flex gap-2">
                    <span className={`px-3 py-1 rounded text-xs font-semibold border ${getPriorityColor(watchlist.priority)}`}>{watchlist.priority.toUpperCase()} PRIORITY</span>
                    <span className="px-3 py-1 rounded text-xs font-semibold bg-slate-700/30 text-slate-400 border border-slate-600">{watchlist.symbols.length} symbols</span>
                  </div>
                </div>
                <button onClick={() => handleDeleteWatchlist(watchlist.id)} className="p-2 hover:bg-red-500/20 text-red-400 rounded transition-all"><X className="w-5 h-5" /></button>
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                {watchlist.symbols.map((symbol) => (
                  <div key={symbol} className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-full text-sm text-white hover:border-amber-400 transition-all">
                    <span className="font-semibold">{symbol}</span>
                    <button onClick={() => handleRemoveSymbol(watchlist.id, symbol)} className="hover:text-red-400 transition-colors"><X className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>

              {selectedWatchlist === watchlist.id ? (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input type="text" placeholder="Search symbols..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-600 rounded text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 text-sm" />
                  </div>
                  {filteredSymbols.length > 0 && (
                    <div className="bg-slate-800 border border-slate-600 rounded max-h-40 overflow-y-auto">
                      {filteredSymbols.map((symbol) => (
                        !watchlist.symbols.includes(symbol) && (
                          <button key={symbol} onClick={() => handleAddSymbol(watchlist.id, symbol)} className="w-full text-left px-4 py-2 hover:bg-slate-700 text-slate-300 text-sm border-b border-slate-700 last:border-0">{symbol}</button>
                        )
                      ))}
                    </div>
                  )}
                  <button onClick={() => setSelectedWatchlist(null)} className="w-full py-1 text-slate-400 text-xs hover:text-slate-300">Close</button>
                </div>
              ) : (
                <button onClick={() => setSelectedWatchlist(watchlist.id)} className="w-full px-4 py-2 bg-slate-800/50 hover:bg-slate-700/50 text-slate-300 border border-slate-600 rounded text-sm font-semibold flex items-center justify-center gap-2 transition-all"><Plus className="w-4 h-4" />Add Symbol</button>
              )}
            </div>
          ))}
        </div>

        {watchlists.length === 0 && (
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-12 text-center">
            <AlertCircle className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">No watchlists yet. Create one to get started!</p>
          </div>
        )}
      </div>
    </div>
  );
}
