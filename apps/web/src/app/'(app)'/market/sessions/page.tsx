"use client";

import { useState, useEffect } from "react";
import { Clock, AlertCircle, ToggleRight, ToggleLeft, Volume2 } from "lucide-react";
import { api } from "@/lib/api";

interface Session {
  id: string;
  name: string;
  status: "open" | "closed";
  startTime: string;
  endTime: string;
  volume: number;
  activeSymbols: number;
  tradingAllowed: boolean;
}

const mockSessions: Session[] = [
  {
    id: "1",
    name: "Pre-market",
    status: "open",
    startTime: "04:00 AM",
    endTime: "09:30 AM",
    volume: 2850000,
    activeSymbols: 324,
    tradingAllowed: true,
  },
  {
    id: "2",
    name: "Regular",
    status: "open",
    startTime: "09:30 AM",
    endTime: "04:00 PM",
    volume: 45200000,
    activeSymbols: 2987,
    tradingAllowed: true,
  },
  {
    id: "3",
    name: "After-hours",
    status: "closed",
    startTime: "04:00 PM",
    endTime: "08:00 PM",
    volume: 5120000,
    activeSymbols: 587,
    tradingAllowed: false,
  },
  {
    id: "4",
    name: "Overnight",
    status: "closed",
    startTime: "08:00 PM",
    endTime: "04:00 AM",
    volume: 1240000,
    activeSymbols: 156,
    tradingAllowed: false,
  },
];

export default function MarketSessionsPage() {
  const [sessions, setSessions] = useState<Session[]>(mockSessions);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.market.getSessions?.();
        if (result) {
          setSessions(result);
        }
      } catch (err) {
        console.error("Error fetching sessions:", err);
        setError("Failed to fetch market sessions");
      } finally {
        setLoading(false);
      }
    };

    fetchSessions();
  }, []);

  const toggleTrading = (sessionId: string) => {
    setSessions(
      sessions.map((s) =>
        s.id === sessionId ? { ...s, tradingAllowed: !s.tradingAllowed } : s
      )
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <Clock className="w-8 h-8 text-purple-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Trading Sessions</h1>
              <p className="text-slate-400 text-sm">Market session status and control</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 flex items-center gap-2 text-red-300">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <p className="text-slate-400">Loading sessions...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`rounded-lg p-6 border transition-all ${
                  session.status === "open"
                    ? "bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-600"
                    : "bg-slate-900/30 border-slate-700"
                }`}
              >
                {/* Session Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-xl font-semibold text-white mb-1">{session.name}</h3>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block w-3 h-3 rounded-full ${
                          session.status === "open"
                            ? "bg-green-400 animate-pulse"
                            : "bg-slate-500"
                        }`}
                      />
                      <span
                        className={`text-sm font-medium ${
                          session.status === "open"
                            ? "text-green-300"
                            : "text-slate-400"
                        }`}
                      >
                        {session.status === "open" ? "Open" : "Closed"}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleTrading(session.id)}
                    className="p-2 rounded-lg hover:bg-slate-700/50 transition-colors"
                    title={session.tradingAllowed ? "Disable trading" : "Enable trading"}
                  >
                    {session.tradingAllowed ? (
                      <ToggleRight className="w-6 h-6 text-green-400" />
                    ) : (
                      <ToggleLeft className="w-6 h-6 text-slate-500" />
                    )}
                  </button>
                </div>

                {/* Session Details */}
                <div className="space-y-3 mb-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Time Range</span>
                    <span className="text-white font-medium">
                      {session.startTime} - {session.endTime}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Status</span>
                    <span
                      className={`font-medium ${
                        session.tradingAllowed
                          ? "text-green-400"
                          : "text-red-400"
                      }`}
                    >
                      Trading {session.tradingAllowed ? "Allowed" : "Disabled"}
                    </span>
                  </div>
                </div>

                {/* Volume Card */}
                <div className="bg-slate-800/50 rounded-lg p-4 mb-4 border border-slate-700">
                  <div className="flex items-center gap-2 mb-2">
                    <Volume2 className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-semibold text-slate-400 uppercase">Session Volume</span>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {(session.volume / 1000000).toFixed(1)}M
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Shares traded in this session
                  </p>
                </div>

                {/* Active Symbols */}
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase mb-1">
                        Active Symbols
                      </p>
                      <p className="text-2xl font-bold text-white">{session.activeSymbols.toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-400">Trading</p>
                      <p className="text-lg font-semibold text-cyan-400">
                        {Math.round((session.activeSymbols / 3500) * 100)}%
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
