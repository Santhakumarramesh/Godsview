/**
 * ops-security.tsx — Phase 115: Ops, Security & Failure Testing Dashboard
 *
 * Comprehensive monitoring and control for:
 *  1. Security Score Card     — Real-time security posture (0-100)
 *  2. Chaos Test Lab          — Run failure scenarios, view results
 *  3. Ops Health Monitor      — CPU, memory, event loop, connections
 *  4. Incident Log            — Create and resolve incidents
 *  5. Deployment Gate         — Pre-deploy checklist and history
 *  6. Recovery Metrics        — MTTR by scenario (bar chart)
 */

import React, { useState, useCallback } from "react";
import {
  useSecurityAudit,
  useSecurityScore,
  useSecurityHistory,
  useRunChaosTest,
  useChaosResults,
  useResiliencyMatrix,
  useRecoveryMetrics,
  useOpsSnapshot,
  useIncidentLog,
  useLogIncident,
  useResolveIncident,
  useGetRunbook,
  useDeployGate,
  useDeployHistory,
  useRecordDeployment,
} from "../lib/api";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";

// ─── Utilities ─────────────────────────────────────────────────────────────

const fmt = {
  pct: (v: number | null | undefined, dec = 1) =>
    v == null ? "—" : `${(v * 100).toFixed(dec)}%`,
  num: (v: number | null | undefined, dec = 2) =>
    v == null ? "—" : Number.isFinite(v) ? v.toFixed(dec) : "∞",
  ms: (v: number | null | undefined) =>
    v == null ? "—" : `${v.toFixed(0)}ms`,
  mb: (v: number | null | undefined, dec = 1) =>
    v == null ? "—" : `${(v ?? 0).toFixed(dec)}MB`,
  uptime: (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  },
  severity: (severity: string) => {
    const colors = {
      critical: "text-red-600 bg-red-100 dark:bg-red-900/30",
      high: "text-orange-600 bg-orange-100 dark:bg-orange-900/30",
      medium: "text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30",
      low: "text-blue-600 bg-blue-100 dark:bg-blue-900/30",
    };
    return colors[severity as keyof typeof colors] || colors.low;
  },
};

// ─── Color Utilities ────────────────────────────────────────────────────────

const securityColor = (score: number) => {
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  if (score >= 40) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
};

const securityBg = (score: number) => {
  if (score >= 80)
    return "bg-emerald-100 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700";
  if (score >= 60)
    return "bg-amber-100 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700";
  if (score >= 40)
    return "bg-orange-100 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700";
  return "bg-red-100 dark:bg-red-900/20 border-red-300 dark:border-red-700";
};

// ─── Security Score Card ──────────────────────────────────────────────────

function SecurityScoreCard() {
  const { data: scoreData, isLoading } = useSecurityScore();
  const { data: auditData } = useSecurityAudit();

  if (isLoading) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-900 animate-pulse h-64" />
    );
  }

  const score = scoreData?.score ?? 75;
  const breakdown = scoreData?.breakdown ?? {};

  return (
    <div
      className={`rounded-xl border p-6 bg-white dark:bg-zinc-900 ${securityBg(score)}`}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
          Security Score
        </h2>
        {auditData?.audit?.timestamp && (
          <p className="text-xs text-zinc-500">
            Last audit: {new Date(auditData.audit.timestamp).toLocaleTimeString()}
          </p>
        )}
      </div>

      <div className="flex items-center gap-8">
        <div className="flex-1">
          <div className={`text-5xl font-bold ${securityColor(score)}`}>
            {score}
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
            out of 100
          </p>
        </div>

        <div className="flex-1 space-y-3">
          {Object.entries(breakdown).map(([category, value]) => (
            <div key={category}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-zinc-600 dark:text-zinc-400 capitalize">
                  {category.replace("_", " ")}
                </span>
                <span className="font-semibold text-zinc-900 dark:text-white">
                  {value}
                </span>
              </div>
              <div className="h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className={`h-full ${
                    (value as number) >= 80
                      ? "bg-emerald-500"
                      : (value as number) >= 60
                        ? "bg-amber-500"
                        : "bg-red-500"
                  }`}
                  style={{ width: `${value}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {auditData?.audit?.findings && auditData.audit.findings.length > 0 && (
        <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
          <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-2">
            {auditData.audit.findings.length} Finding(s):
          </p>
          <ul className="space-y-1">
            {auditData.audit.findings.slice(0, 3).map((f: any, i: number) => (
              <li key={i} className="text-xs text-zinc-600 dark:text-zinc-400">
                • {f.title}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Chaos Test Lab ───────────────────────────────────────────────────────

function ChaosTestLab() {
  const [selectedScenario, setSelectedScenario] = useState("api_timeout");
  const [testOutput, setTestOutput] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);

  const { data: resultsData } = useChaosResults();
  const { data: resiliencyData } = useResiliencyMatrix();
  const runTest = useRunChaosTest();

  const scenarios = [
    "api_timeout",
    "db_disconnect",
    "feed_lag",
    "memory_pressure",
    "order_rejection",
    "circuit_breaker_trip",
  ];

  const handleRunTest = useCallback(() => {
    setIsRunning(true);
    runTest.mutate(
      { scenario: selectedScenario },
      {
        onSuccess: (data: any) => {
          setTestOutput(data.result);
          setIsRunning(false);
        },
        onError: () => {
          setIsRunning(false);
        },
      }
    );
  }, [selectedScenario, runTest]);

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-900 space-y-4">
      <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
        Chaos Test Lab
      </h2>

      <div className="space-y-3">
        <p className="text-xs text-zinc-600 dark:text-zinc-400 font-medium">
          Select Scenario
        </p>
        <div className="grid grid-cols-2 gap-2">
          {scenarios.map((s) => (
            <button
              key={s}
              onClick={() => setSelectedScenario(s)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                selectedScenario === s
                  ? "bg-blue-500 text-white"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              {s.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handleRunTest}
        disabled={isRunning}
        className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-zinc-400 text-white rounded-lg font-medium text-sm transition-colors"
      >
        {isRunning ? "Running..." : "Run Test"}
      </button>

      {testOutput && (
        <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${testOutput.passed ? "bg-emerald-500" : "bg-red-500"}`}
            />
            <span className="font-medium text-sm text-zinc-900 dark:text-white">
              {testOutput.scenario}
            </span>
            <span className={`text-xs ${testOutput.passed ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {testOutput.passed ? "PASSED" : "FAILED"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-zinc-600 dark:text-zinc-400">Latency</p>
              <p className="font-mono text-zinc-900 dark:text-white">
                {fmt.ms(testOutput.metrics.latencyMs)}
              </p>
            </div>
            <div>
              <p className="text-zinc-600 dark:text-zinc-400">Recovery</p>
              <p className="font-mono text-zinc-900 dark:text-white">
                {fmt.ms(testOutput.metrics.recoveryTimeMs)}
              </p>
            </div>
            <div>
              <p className="text-zinc-600 dark:text-zinc-400">Memory</p>
              <p className="font-mono text-zinc-900 dark:text-white">
                {fmt.mb(testOutput.metrics.memoryUsedMb)}
              </p>
            </div>
            <div>
              <p className="text-zinc-600 dark:text-zinc-400">CPU</p>
              <p className="font-mono text-zinc-900 dark:text-white">
                {fmt.pct(testOutput.metrics.cpuPercent / 100)}
              </p>
            </div>
          </div>
        </div>
      )}

      {resultsData?.results && resultsData.results.length > 0 && (
        <div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 font-medium mb-2">
            Recent Results
          </p>
          <div className="space-y-1">
            {resultsData.results.slice(0, 5).map((r: any) => (
              <div
                key={r.id}
                className="flex items-center justify-between text-xs p-2 rounded bg-zinc-50 dark:bg-zinc-800"
              >
                <span className="text-zinc-700 dark:text-zinc-300">
                  {r.scenario}
                </span>
                <span
                  className={
                    r.passed
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }
                >
                  {r.passed ? "✓" : "✗"} {fmt.ms(r.metrics.latencyMs)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {resiliencyData?.matrix?.results && (
        <div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 font-medium mb-2">
            Resiliency Matrix
          </p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {resiliencyData.matrix.results.map((r: any) => (
              <div
                key={r.scenario}
                className="p-2 rounded bg-zinc-50 dark:bg-zinc-800"
              >
                <p className="font-medium text-zinc-900 dark:text-white truncate">
                  {r.scenario.replace(/_/g, " ")}
                </p>
                <p className="text-zinc-600 dark:text-zinc-400">
                  {fmt.pct(r.passRate)} pass
                </p>
                <p className="text-zinc-500 dark:text-zinc-500">
                  {fmt.ms(r.avgLatencyMs)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Ops Health Monitor ────────────────────────────────────────────────────

function OpsHealthMonitor() {
  const { data: snapshotData, isLoading } = useOpsSnapshot();

  if (isLoading) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-900 animate-pulse h-64" />
    );
  }

  const s = snapshotData?.snapshot;
  if (!s) return null;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-900 space-y-4">
      <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
        Ops Health Monitor
      </h2>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-3">
          <p className="text-xs text-zinc-600 dark:text-zinc-400 font-medium">
            Uptime
          </p>
          <p className="text-lg font-bold text-zinc-900 dark:text-white mt-1">
            {fmt.uptime(s.uptime)}
          </p>
        </div>

        <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-3">
          <p className="text-xs text-zinc-600 dark:text-zinc-400 font-medium">
            Memory
          </p>
          <p className="text-lg font-bold text-zinc-900 dark:text-white mt-1">
            {fmt.mb(s.memory.usedMb)} / {fmt.mb(s.memory.totalMb)}
          </p>
          <div className="h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full mt-2 overflow-hidden">
            <div
              className="h-full bg-blue-500"
              style={{ width: `${s.memory.percentUsed}%` }}
            />
          </div>
        </div>

        <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-3">
          <p className="text-xs text-zinc-600 dark:text-zinc-400 font-medium">
            CPU Usage
          </p>
          <p className="text-lg font-bold text-zinc-900 dark:text-white mt-1">
            {fmt.pct(s.cpu.percentUsed / 100)}
          </p>
        </div>

        <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-3">
          <p className="text-xs text-zinc-600 dark:text-zinc-400 font-medium">
            Event Loop Lag
          </p>
          <p className="text-lg font-bold text-zinc-900 dark:text-white mt-1">
            {fmt.ms(s.eventLoop.lagMs)}
          </p>
        </div>

        <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-3">
          <p className="text-xs text-zinc-600 dark:text-zinc-400 font-medium">
            Active Connections
          </p>
          <p className="text-lg font-bold text-zinc-900 dark:text-white mt-1">
            {s.connections.active}
          </p>
        </div>

        <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-3">
          <p className="text-xs text-zinc-600 dark:text-zinc-400 font-medium">
            Queue Depth
          </p>
          <p className="text-lg font-bold text-zinc-900 dark:text-white mt-1">
            {s.queues.orderQueue + s.queues.updateQueue + s.queues.notificationQueue}
          </p>
        </div>
      </div>

      <div className="pt-3 border-t border-zinc-200 dark:border-zinc-700">
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Last Deploy: {new Date(s.lastDeployAt).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

// ─── Incident Log ──────────────────────────────────────────────────────────

function IncidentLog() {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    severity: "medium",
    title: "",
    description: "",
    component: "",
  });

  const { data: incidentsData } = useIncidentLog(50);
  const logIncident = useLogIncident();
  const resolveIncident = useResolveIncident();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    logIncident.mutate(formData, {
      onSuccess: () => {
        setFormData({
          severity: "medium",
          title: "",
          description: "",
          component: "",
        });
        setShowForm(false);
      },
    });
  };

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-900 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
          Incident Log
        </h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
        >
          {showForm ? "Cancel" : "New Incident"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-3 p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg">
          <input
            type="text"
            placeholder="Title"
            value={formData.title}
            onChange={(e) =>
              setFormData({ ...formData, title: e.target.value })
            }
            className="w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white"
            required
          />
          <textarea
            placeholder="Description"
            value={formData.description}
            onChange={(e) =>
              setFormData({ ...formData, description: e.target.value })
            }
            className="w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white"
            rows={2}
            required
          />
          <input
            type="text"
            placeholder="Component"
            value={formData.component}
            onChange={(e) =>
              setFormData({ ...formData, component: e.target.value })
            }
            className="w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white"
            required
          />
          <select
            value={formData.severity}
            onChange={(e) =>
              setFormData({ ...formData, severity: e.target.value })
            }
            className="w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <button
            type="submit"
            disabled={logIncident.isPending}
            className="w-full px-3 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-400 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {logIncident.isPending ? "Logging..." : "Log Incident"}
          </button>
        </form>
      )}

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {incidentsData?.incidents && incidentsData.incidents.length > 0 ? (
          incidentsData.incidents
            .filter((i: any) => i.status === "open")
            .slice(0, 10)
            .map((incident: any) => (
              <div
                key={incident.id}
                className={`p-3 rounded-lg border ${
                  incident.status === "open"
                    ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                    : "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800"
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 text-xs rounded font-semibold ${fmt.severity(incident.severity)}`}
                      >
                        {incident.severity}
                      </span>
                      <p className="font-medium text-sm text-zinc-900 dark:text-white">
                        {incident.title}
                      </p>
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                      {incident.description}
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">
                      {incident.component} •{" "}
                      {new Date(incident.timestamp).toLocaleString()}
                    </p>
                  </div>
                  {incident.status === "open" && (
                    <button
                      onClick={() => resolveIncident.mutate(incident.id)}
                      disabled={resolveIncident.isPending}
                      className="px-2 py-1 text-xs bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-400 text-white rounded transition-colors"
                    >
                      Resolve
                    </button>
                  )}
                </div>
              </div>
            ))
        ) : (
          <p className="text-sm text-zinc-500 text-center py-4">
            No open incidents
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Deployment Gate ───────────────────────────────────────────────────────

function DeploymentGate() {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    version: "",
    commitHash: "",
    deployer: "",
    notes: "",
  });

  const { data: gateData } = useDeployGate();
  const { data: historyData } = useDeployHistory();
  const recordDeploy = useRecordDeployment();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    recordDeploy.mutate(formData, {
      onSuccess: () => {
        setFormData({ version: "", commitHash: "", deployer: "", notes: "" });
        setShowForm(false);
      },
    });
  };

  const checks = gateData?.checks ?? [];
  const allPassed = checks.every((c: any) => c.passed);

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-900 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
          Deployment Gate
        </h2>
        <button
          onClick={() => setShowForm(!showForm)}
          disabled={!allPassed}
          className={`px-3 py-1 text-xs rounded-lg transition-colors ${
            allPassed
              ? "bg-emerald-500 hover:bg-emerald-600 text-white"
              : "bg-zinc-300 dark:bg-zinc-700 text-zinc-500 cursor-not-allowed"
          }`}
        >
          {showForm ? "Cancel" : "Record Deployment"}
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Pre-Deploy Checks
        </p>
        {checks.map((check: any) => (
          <div
            key={check.name}
            className="flex items-center gap-3 p-2 rounded bg-zinc-50 dark:bg-zinc-800"
          >
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                check.passed ? "bg-emerald-500" : "bg-red-500"
              }`}
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-zinc-900 dark:text-white">
                {check.name}
              </p>
              <p className="text-xs text-zinc-500">{check.detail}</p>
            </div>
            <span
              className={`text-xs font-bold ${
                check.passed
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {check.passed ? "✓" : "✗"}
            </span>
          </div>
        ))}
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="space-y-3 p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg"
        >
          <input
            type="text"
            placeholder="Version (e.g., 1.2.3)"
            value={formData.version}
            onChange={(e) =>
              setFormData({ ...formData, version: e.target.value })
            }
            className="w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white"
            required
          />
          <input
            type="text"
            placeholder="Commit Hash"
            value={formData.commitHash}
            onChange={(e) =>
              setFormData({ ...formData, commitHash: e.target.value })
            }
            className="w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white"
            required
          />
          <input
            type="text"
            placeholder="Deployer"
            value={formData.deployer}
            onChange={(e) =>
              setFormData({ ...formData, deployer: e.target.value })
            }
            className="w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white"
            required
          />
          <textarea
            placeholder="Notes (optional)"
            value={formData.notes}
            onChange={(e) =>
              setFormData({ ...formData, notes: e.target.value })
            }
            className="w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white"
            rows={2}
          />
          <button
            type="submit"
            disabled={recordDeploy.isPending}
            className="w-full px-3 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-400 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {recordDeploy.isPending ? "Recording..." : "Record Deployment"}
          </button>
        </form>
      )}

      {historyData?.history && historyData.history.length > 0 && (
        <div>
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
            Deployment History
          </p>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {historyData.history.slice(0, 5).map((d: any) => (
              <div
                key={d.id}
                className="p-2 rounded bg-zinc-50 dark:bg-zinc-800 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-zinc-900 dark:text-white">
                    {d.version}
                  </span>
                  <span className="text-zinc-500">
                    {new Date(d.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-zinc-600 dark:text-zinc-400">
                  By {d.deployer} • {d.commitHash.slice(0, 7)}
                </p>
                {d.allChecksPassed && (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    ✓ All checks passed
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Recovery Metrics Chart ────────────────────────────────────────────────

function RecoveryMetricsChart() {
  const { data: metricsData } = useRecoveryMetrics();

  if (!metricsData?.metrics || metricsData.metrics.length === 0) {
    return null;
  }

  const chartData = metricsData.metrics.map((m: any) => ({
    scenario: m.scenario.replace(/_/g, " "),
    mttr: Math.round(m.mttrMs),
    p95: Math.round(m.p95Ms),
    p99: Math.round(m.p99Ms),
  }));

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-900">
      <h2 className="text-lg font-bold text-zinc-900 dark:text-white mb-4">
        Recovery Metrics (MTTR)
      </h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="scenario"
            tick={{ fontSize: 12 }}
            angle={-45}
            textAnchor="end"
            height={100}
          />
          <YAxis label={{ value: "Time (ms)", angle: -90, position: "insideLeft" }} />
          <Tooltip />
          <Legend />
          <Bar dataKey="mttr" fill="#3b82f6" name="Mean Time" />
          <Bar dataKey="p95" fill="#f59e0b" name="P95" />
          <Bar dataKey="p99" fill="#ef4444" name="P99" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function OpsSecurityDashboard() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">
          Ops, Security & Failure Testing
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
          Real-time operational health, security posture, and chaos testing
        </p>
      </div>

      {/* Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Row */}
        <SecurityScoreCard />
        <OpsHealthMonitor />

        {/* Middle Row */}
        <ChaosTestLab />
        <IncidentLog />

        {/* Bottom Row - Full Width */}
      </div>

      {/* Full width sections */}
      <div className="grid grid-cols-1 gap-6">
        <DeploymentGate />
        <RecoveryMetricsChart />
      </div>
    </div>
  );
}
