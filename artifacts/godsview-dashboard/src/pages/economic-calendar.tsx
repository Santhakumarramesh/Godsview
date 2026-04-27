import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

/* ── Types ─────────────────────────────────────────────── */
interface EconEvent {
  id: string;
  name: string;
  country: string;
  datetime: string;          // ISO
  impact: "low" | "medium" | "high" | "critical";
  category: string;
  previous?: string;
  forecast?: string;
  actual?: string;
  description: string;
}

interface EconomicIndicatorsResponse {
  ok?: boolean;
  feedConnected?: boolean;
  indicators?: EconEvent[];
  message?: string;
  lastUpdated?: string | null;
}

const IMPACT_CFG: Record<string, { color: string; bg: string; weight: number; label: string }> = {
  critical: { color: "text-red-400",    bg: "bg-red-500/20",    weight: 4, label: "🔴 Critical" },
  high:     { color: "text-orange-400", bg: "bg-orange-500/20", weight: 3, label: "🟠 High" },
  medium:   { color: "text-yellow-400", bg: "bg-yellow-500/20", weight: 2, label: "🟡 Medium" },
  low:      { color: "text-blue-400",   bg: "bg-blue-500/20",   weight: 1, label: "🔵 Low" },
};

/* ── Real economic-indicators feed ────────────────────────
 * Hits /api/market/economic-indicators which currently returns an empty
 * { feedConnected: false } payload until a macro provider (FRED, Polygon,
 * etc.) is wired server-side. When that's done, the same endpoint will
 * return populated `indicators` and this page renders the events live.
 */
function useEconomicEvents() {
  return useQuery<EconomicIndicatorsResponse>({
    queryKey: ["market", "economic-indicators"],
    queryFn: () => apiFetch<EconomicIndicatorsResponse>("/market/economic-indicators"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/* ── Countdown hook ─────────────────────────────────────── */
function useCountdown(targetIso: string) {
  const [remaining, setRemaining] = useState("");
  useEffect(() => {
    const tick = () => {
      const diff = new Date(targetIso).getTime() - Date.now();
      if (diff <= 0) { setRemaining("RELEASED"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  return remaining;
}

function CountdownCell({ iso }: { iso: string }) {
  const cd = useCountdown(iso);
  const isReleased = cd === "RELEASED";
  return (
    <span className={`font-mono text-xs ${isReleased ? "text-green-400" : "text-cyan-300"}`}>
      {cd}
    </span>
  );
}

/* ── Impact weight bar ──────────────────────────────────── */
function ImpactBar({ events }: { events: EconEvent[] }) {
  const totals = useMemo(() => {
    const t = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
    events.forEach((e) => { t[e.impact]++; t.total += IMPACT_CFG[e.impact].weight; });
    return t;
  }, [events]);
  return (
    <div className="grid grid-cols-4 gap-3 mb-6">
      {(["critical","high","medium","low"] as const).map((k) => (
        <div key={k} className={`${IMPACT_CFG[k].bg} rounded-lg p-3 text-center`}>
          <div className={`text-2xl font-bold ${IMPACT_CFG[k].color}`}>{totals[k]}</div>
          <div className="text-xs text-gray-400">{IMPACT_CFG[k].label}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Main component ─────────────────────────────────────── */
export default function EconomicCalendarPage() {
  const eventsQuery = useEconomicEvents();
  const events: EconEvent[] = useMemo(
    () => (eventsQuery.data?.indicators ?? []).slice().sort(
      (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime(),
    ),
    [eventsQuery.data?.indicators],
  );
  const feedConnected = eventsQuery.data?.feedConnected !== false; // default to true if undefined
  const noFeedMessage = eventsQuery.data?.message ?? "Macro data provider not configured.";
  const [filterImpact, setFilterImpact] = useState<string>("all");
  const [filterCountry, setFilterCountry] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (filterImpact !== "all" && e.impact !== filterImpact) return false;
      if (filterCountry !== "all" && e.country !== filterCountry) return false;
      return true;
    });
  }, [events, filterImpact, filterCountry]);

  const countries = useMemo(() => [...new Set(events.map((e) => e.country))].sort(), [events]);
  const nextEvent = useMemo(() => {
    const now = Date.now();
    return events.find((e) => new Date(e.datetime).getTime() > now);
  }, [events]);

  const weightedScore = useMemo(() => {
    const upcoming = events.filter((e) => {
      const diff = new Date(e.datetime).getTime() - Date.now();
      return diff > 0 && diff < 24 * 3600_000;
    });
    return upcoming.reduce((s, e) => s + IMPACT_CFG[e.impact].weight, 0);
  }, [events]);

  return (
    <div className="p-6 space-y-6 bg-[#0a0a1a] min-h-screen text-white">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Economic Calendar</h1>
          <p className="text-sm text-gray-400">Live event tracking with impact weighting</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-[#1a1a2e] rounded-lg px-4 py-2 text-center">
            <div className="text-xs text-gray-400">24h Impact Score</div>
            <div className={`text-xl font-bold ${weightedScore > 10 ? "text-red-400" : weightedScore > 5 ? "text-yellow-400" : "text-green-400"}`}>
              {weightedScore}
            </div>
          </div>
          {nextEvent && (
            <div className="bg-[#1a1a2e] rounded-lg px-4 py-2 text-center">
              <div className="text-xs text-gray-400">Next Event</div>
              <CountdownCell iso={nextEvent.datetime} />
            </div>
          )}
        </div>
      </div>

      {!feedConnected && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 text-sm text-yellow-300">
          <div className="font-medium mb-1">Macro feed not connected</div>
          <div className="text-yellow-300/70 text-xs">{noFeedMessage}</div>
        </div>
      )}

      {eventsQuery.isLoading && (
        <div className="bg-[#1a1a2e] rounded-lg px-4 py-6 text-center text-gray-400 text-sm">
          Loading economic indicators…
        </div>
      )}

      <ImpactBar events={filtered} />

      {/* Filters */}
      <div className="flex gap-3">
        <select value={filterImpact} onChange={(e) => setFilterImpact(e.target.value)}
          className="bg-[#1a1a2e] text-white border border-gray-700 rounded px-3 py-1.5 text-sm">
          <option value="all">All Impact</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={filterCountry} onChange={(e) => setFilterCountry(e.target.value)}
          className="bg-[#1a1a2e] text-white border border-gray-700 rounded px-3 py-1.5 text-sm">
          <option value="all">All Countries</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="ml-auto text-sm text-gray-400">{filtered.length} events</div>
      </div>

      {/* Events Table */}
      <div className="bg-[#12121e] rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-xs">
              <th className="px-4 py-2 text-left">Countdown</th>
              <th className="px-4 py-2 text-left">Event</th>
              <th className="px-4 py-2 text-center">Impact</th>
              <th className="px-4 py-2 text-center">Previous</th>
              <th className="px-4 py-2 text-center">Forecast</th>
              <th className="px-4 py-2 text-center">Actual</th>
              <th className="px-4 py-2 text-left">Category</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ev) => {
              const cfg = IMPACT_CFG[ev.impact];
              const isPast = new Date(ev.datetime).getTime() < Date.now();
              const isExpanded = expandedId === ev.id;
              return (
                <tr key={ev.id}
                  onClick={() => setExpandedId(isExpanded ? null : ev.id)}
                  className={`border-b border-gray-800/50 cursor-pointer transition-colors
                    ${isPast ? "opacity-60" : "hover:bg-white/5"}
                    ${isExpanded ? "bg-white/5" : ""}`}>
                  <td className="px-4 py-2.5 w-28">
                    {isPast
                      ? <span className="text-xs text-green-400/70">Released</span>
                      : <CountdownCell iso={ev.datetime} />}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-white">{ev.name}</div>
                    {isExpanded && (
                      <div className="text-xs text-gray-400 mt-1">{ev.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`${cfg.bg} ${cfg.color} px-2 py-0.5 rounded text-xs font-medium`}>
                      {ev.impact.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center font-mono text-gray-300">{ev.previous ?? "—"}</td>
                  <td className="px-4 py-2.5 text-center font-mono text-gray-300">{ev.forecast ?? "—"}</td>
                  <td className="px-4 py-2.5 text-center font-mono">
                    {ev.actual
                      ? <span className={Number(ev.actual.replace("%","")) > Number(ev.forecast?.replace("%","") ?? 0) ? "text-green-400" : "text-red-400"}>{ev.actual}</span>
                      : <span className="text-gray-500">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{ev.category}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-500">No events match filters</div>
        )}
      </div>
    </div>
  );
}
