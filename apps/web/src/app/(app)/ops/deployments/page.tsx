"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";

const MOCK = [
  { version: "v2.1.3", env: "production", status: "success", deployedBy: "CI/CD", timestamp: "2026-04-20T12:30:00Z", duration: "3m 42s", sha: "98e7ec9" },
  { version: "v2.1.2", env: "staging", status: "success", deployedBy: "CI/CD", timestamp: "2026-04-19T18:15:00Z", duration: "2m 58s", sha: "a1b2c3d" },
  { version: "v2.1.1", env: "production", status: "rolled_back", deployedBy: "ops-team", timestamp: "2026-04-18T09:00:00Z", duration: "4m 12s", sha: "f4e5d6c" },
  { version: "v2.1.0", env: "production", status: "success", deployedBy: "CI/CD", timestamp: "2026-04-17T14:00:00Z", duration: "3m 20s", sha: "21be4ad" },
];

export default function OpsDeploymentsPage() {
  const [deploys, setDeploys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { const r = await api.ops.getDeployments(); setDeploys(Array.isArray(r) ? r : r?.deployments ?? MOCK); }
      catch { setDeploys(MOCK); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="p-6"><div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" /><div className="animate-pulse h-64 bg-white/5 rounded" /></div>;

  const sc = (s: string) => ({ success: "text-emerald-400 bg-emerald-400/10", rolled_back: "text-amber-400 bg-amber-400/10", failed: "text-red-400 bg-red-400/10" }[s] ?? "text-zinc-400 bg-zinc-400/10");

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Deployments</h1>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-zinc-500 border-b border-white/10">
            <th className="pb-2 pr-3">Version</th><th className="pb-2 pr-3">SHA</th><th className="pb-2 pr-3">Env</th><th className="pb-2 pr-3">Status</th>
            <th className="pb-2 pr-3">By</th><th className="pb-2 pr-3">Duration</th><th className="pb-2 pr-3">Time</th><th className="pb-2">Action</th>
          </tr></thead>
          <tbody>
            {deploys.map((d, i) => (
              <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                <td className="py-2 pr-3 font-mono font-medium">{d.version}</td>
                <td className="py-2 pr-3 font-mono text-xs text-zinc-400">{d.sha}</td>
                <td className="py-2 pr-3"><span className={`text-xs px-2 py-0.5 rounded ${d.env === "production" ? "bg-purple-500/20 text-purple-300" : "bg-blue-500/20 text-blue-300"}`}>{d.env}</span></td>
                <td className="py-2 pr-3"><span className={`text-xs px-2 py-0.5 rounded font-mono ${sc(d.status)}`}>{d.status}</span></td>
                <td className="py-2 pr-3 text-zinc-400">{d.deployedBy}</td>
                <td className="py-2 pr-3 font-mono">{d.duration}</td>
                <td className="py-2 pr-3 text-zinc-400 text-xs">{new Date(d.timestamp).toLocaleString()}</td>
                <td className="py-2">{d.status === "success" && <button className="text-xs text-amber-400 hover:text-amber-300">Rollback</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
