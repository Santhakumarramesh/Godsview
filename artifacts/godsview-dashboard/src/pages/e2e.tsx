/**
 * P2-14: Live E2E agent trace.
 *
 * Subscribes to /api/phase103/agents/stream (SSE) and renders each event as
 * it arrives. On load, the route also backfills ~50 recent events so the
 * panel isn't empty.
 */

import { useEffect, useRef, useState } from "react";

interface AgentEvent {
  type: string;
  source?: string;
  decision_id?: string;
  ts?: number;
  payload?: unknown;
}

const MAX_EVENTS = 500;

function fmtTime(ms?: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toISOString().replace("T", " ").replace("Z", "");
}

function eventTone(type: string): string {
  if (type.startsWith("execution.fill")) return "text-emerald-400";
  if (type.startsWith("execution.failed")) return "text-rose-400";
  if (type.startsWith("governance.vetoed")) return "text-amber-400";
  if (type.startsWith("validation.rejected")) return "text-amber-300";
  if (type.startsWith("risk.decided")) return "text-sky-400";
  if (type.startsWith("signal.emitted")) return "text-indigo-300";
  return "text-slate-300";
}

export default function E2EPage() {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // P2-14: live SSE from the Phase 103 agent bus.
    const es = new EventSource("/api/phase103/agents/stream?limit=50");
    esRef.current = es;

    es.addEventListener("open", () => {
      setConnected(true);
      setError(null);
    });

    es.addEventListener("agent", (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data) as AgentEvent;
        setEvents((prev) => {
          const next = [parsed, ...prev];
          return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next;
        });
      } catch {
        /* skip malformed */
      }
    });

    es.addEventListener("error", () => {
      setConnected(false);
      setError("Stream disconnected — the browser will auto-retry.");
    });

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  return (
    <div className="p-6 space-y-4 bg-slate-950 text-slate-100 min-h-screen">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">GodsView E2E Agent Trace</h1>
          <p className="text-sm text-slate-400">
            Live feed from /api/phase103/agents/stream — most recent first.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span
            className={
              "inline-block h-2 w-2 rounded-full " +
              (connected ? "bg-emerald-400" : "bg-rose-500")
            }
          />
          <span>{connected ? "streaming" : "disconnected"}</span>
          <span className="text-slate-500">{events.length} events</span>
        </div>
      </header>

      {error && <div className="text-sm text-amber-300">{error}</div>}

      <div className="rounded border border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-slate-400 text-left">
            <tr>
              <th className="px-3 py-2 w-48">time</th>
              <th className="px-3 py-2 w-56">type</th>
              <th className="px-3 py-2 w-40">source</th>
              <th className="px-3 py-2 w-60">decision_id</th>
              <th className="px-3 py-2">payload</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-slate-500 text-center">
                  Waiting for agent events…
                </td>
              </tr>
            )}
            {events.map((evt, idx) => (
              <tr
                key={`${evt.ts ?? idx}-${idx}`}
                className="border-t border-slate-900 hover:bg-slate-900/40"
              >
                <td className="px-3 py-1 font-mono text-xs text-slate-400">
                  {fmtTime(evt.ts)}
                </td>
                <td className={"px-3 py-1 font-mono text-xs " + eventTone(evt.type)}>
                  {evt.type}
                </td>
                <td className="px-3 py-1 font-mono text-xs text-slate-400">
                  {evt.source ?? ""}
                </td>
                <td className="px-3 py-1 font-mono text-xs text-slate-400">
                  {evt.decision_id ?? ""}
                </td>
                <td className="px-3 py-1 font-mono text-xs text-slate-300 whitespace-pre-wrap">
                  {JSON.stringify(evt.payload ?? {}, null, 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
