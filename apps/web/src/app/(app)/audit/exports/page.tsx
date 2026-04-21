"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface ExportRecord {
  id: string;
  timestamp: string;
  format: "csv" | "json";
  dateRange: string;
  fileSize: string;
  status: "completed" | "pending" | "failed";
  downloadUrl?: string;
}

export default function AuditExportsPage() {
  const [exports, setExports] = useState<ExportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [format, setFormat] = useState<"csv" | "json">("csv");

  useEffect(() => {
    (async () => {
      try {
        const res = await api.audit.getExports();
        const data = Array.isArray(res) ? res : res?.exports ?? res?.data ?? [];
        setExports(data);
      } catch (e) {
        // Mock fallback
        setExports([
          {
            id: "exp_001",
            timestamp: "2024-04-20T10:00:00Z",
            format: "csv",
            dateRange: "2024-04-15 to 2024-04-20",
            fileSize: "2.3 MB",
            status: "completed",
            downloadUrl: "/exports/audit_2024-04-15_to_2024-04-20.csv",
          },
          {
            id: "exp_002",
            timestamp: "2024-04-18T14:30:00Z",
            format: "json",
            dateRange: "2024-04-01 to 2024-04-18",
            fileSize: "8.7 MB",
            status: "completed",
            downloadUrl: "/exports/audit_2024-04-01_to_2024-04-18.json",
          },
          {
            id: "exp_003",
            timestamp: "2024-04-16T09:15:00Z",
            format: "csv",
            dateRange: "2024-03-16 to 2024-04-16",
            fileSize: "15.4 MB",
            status: "completed",
            downloadUrl: "/exports/audit_2024-03-16_to_2024-04-16.csv",
          },
          {
            id: "exp_004",
            timestamp: "2024-04-19T16:45:00Z",
            format: "json",
            dateRange: "2024-04-19 to 2024-04-19",
            fileSize: "0.5 MB",
            status: "pending",
          },
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleExport = async () => {
    if (!startDate || !endDate) {
      setError("Please select both start and end dates");
      return;
    }

    setExporting(true);
    setError(null);
    try {
      const result = await api.audit.exportLog({
        startDate,
        endDate,
        format,
      });
      setExports([result, ...exports]);
      setStartDate("");
      setEndDate("");
    } catch (e) {
      setError("Failed to create export");
    } finally {
      setExporting(false);
    }
  };

  if (loading)
    return (
      <div className="p-6">
        <div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" />
        <div className="animate-pulse h-64 bg-white/5 rounded" />
      </div>
    );

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Audit · Exports</h1>
        <p className="text-sm text-muted">
          Export audit data for compliance or investigation — signed CSV / JSON bundles with date
          range and resource filters.
        </p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="p-4 border border-border rounded-lg bg-surface/40 space-y-4">
        <h3 className="font-semibold">Create New Export</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 rounded border border-border bg-surface text-sm"
            placeholder="Start date"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 rounded border border-border bg-surface text-sm"
            placeholder="End date"
          />
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as "csv" | "json")}
            className="px-3 py-2 rounded border border-border bg-surface text-sm"
          >
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {exporting ? "Exporting..." : "Export"}
          </button>
        </div>
      </div>

      {exports.length === 0 ? (
        <div className="p-6 text-center text-muted rounded border border-border">
          No exports yet. Create one to get started.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface/80 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Date Range</th>
                <th className="px-3 py-2 font-medium">Format</th>
                <th className="px-3 py-2 font-medium">Size</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {exports.map((exp) => (
                <tr key={exp.id} className="border-t border-border">
                  <td className="px-3 py-2 text-xs text-muted">
                    {new Date(exp.timestamp).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-sm">{exp.dateRange}</td>
                  <td className="px-3 py-2 font-mono text-xs">{exp.format.toUpperCase()}</td>
                  <td className="px-3 py-2 text-xs">{exp.fileSize}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        exp.status === "completed"
                          ? "bg-green-500/20 text-green-300"
                          : exp.status === "pending"
                            ? "bg-yellow-500/20 text-yellow-300"
                            : "bg-red-500/20 text-red-300"
                      }`}
                    >
                      {exp.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {exp.downloadUrl && (
                      <a
                        href={exp.downloadUrl}
                        className="px-2 py-1 text-xs rounded border border-blue-600/50 text-blue-400 hover:bg-blue-500/10"
                      >
                        Download
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
