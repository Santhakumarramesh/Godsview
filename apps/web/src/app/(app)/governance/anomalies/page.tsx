"use client";

/**
 * Governance · Anomalies — Phase 6 surface.
 *
 * Wires four control-plane routes:
 *
 *   GET  /v1/governance/anomalies             → AnomalyAlertsList
 *   GET  /v1/governance/anomalies/:id         → AnomalyAlert
 *   POST /v1/governance/anomalies/:id/acknowledge → AnomalyAlert
 *   POST /v1/governance/anomalies/:id/resolve  → AnomalyAlert
 *
 * Anomaly alerts come out of Phase 5 detectors (drawdown spikes,
 * win-rate regressions, data-truth fails, broker reject clusters,
 * strategy drift, kill-switch trips, allocation breaches, auth
 * anomalies). An unacknowledged `critical` alert blocks
 * approval-gated mutations until an operator acknowledges it.
 *
 * Acknowledge can optionally suppress re-fires for N seconds; resolve
 * drives the alert to terminal `resolved` state. Both mutations surface
 * inline errors on 403 / conflict.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, formatRelative, pickErrorMessage } from "@/lib/format";
import type {
  AnomalyAlert,
  AnomalyFilter,
  AnomalySeverity,
  AnomalySource,
  AnomalyStatus,
} from "@gv/types";

const STATUS_TONE: Record<
  AnomalyStatus,
  "info" | "warn" | "success" | "neutral"
> = {
  open: "warn",
  acknowledged: "info",
  resolved: "success",
  suppressed: "neutral",
};

const SEVERITY_TONE: Record<
  AnomalySeverity,
  "neutral" | "info" | "warn" | "danger"
> = {
  info: "info",
  warn: "warn",
  error: "danger",
  critical: "danger",
};

const STATUS_OPTIONS: ReadonlyArray<AnomalyStatus> = [
  "open",
  "acknowledged",
  "resolved",
  "suppressed",
];

const SEVERITY_OPTIONS: ReadonlyArray<AnomalySeverity> = [
  "info",
  "warn",
  "error",
  "critical",
];

const SOURCE_OPTIONS: ReadonlyArray<AnomalySource> = [
  "drawdown_spike",
  "win_rate_regression",
  "latency_spike",
  "data_truth_fail",
  "broker_reject_cluster",
  "strategy_drift",
  "kill_switch_tripped",
  "allocation_breach",
  "auth_anomaly",
  "other",
];

function prettySource(s: AnomalySource): string {
  return s.replaceAll("_", " ");
}

export default function GovernanceAnomaliesPage() {
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<AnomalyStatus | "">("open");
  const [severityFilter, setSeverityFilter] = useState<AnomalySeverity | "">(
    "",
  );
  const [sourceFilter, setSourceFilter] = useState<AnomalySource | "">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [ackComment, setAckComment] = useState<string>("");
  const [ackSuppressHours, setAckSuppressHours] = useState<string>("");
  const [ackError, setAckError] = useState<string | null>(null);
  const [resolveComment, setResolveComment] = useState<string>("");
  const [resolveError, setResolveError] = useState<string | null>(null);

  const filter: AnomalyFilter = useMemo(
    () => ({
      status: statusFilter || undefined,
      severity: severityFilter || undefined,
      source: sourceFilter || undefined,
      limit: 200,
    }),
    [statusFilter, severityFilter, sourceFilter],
  );

  const listQuery = useQuery({
    queryKey: ["governance", "anomalies", filter],
    queryFn: () => api.governance.anomalies.list(filter),
    refetchInterval: 10_000,
  });

  const detailQuery = useQuery({
    queryKey: ["governance", "anomalies", "detail", selectedId],
    queryFn: () => api.governance.anomalies.get(selectedId as string),
    enabled: Boolean(selectedId),
    refetchInterval: selectedId ? 10_000 : false,
  });

  const ackMutation = useMutation({
    mutationFn: () => {
      const suppressHrs = Number.parseFloat(ackSuppressHours);
      const suppressForSeconds =
        Number.isFinite(suppressHrs) && suppressHrs > 0
          ? Math.min(30 * 24 * 3600, Math.round(suppressHrs * 3600))
          : undefined;
      return api.governance.anomalies.acknowledge(selectedId as string, {
        comment: ackComment.trim() || undefined,
        suppressForSeconds,
      });
    },
    onSuccess: (updated: AnomalyAlert) => {
      qc.setQueryData(
        ["governance", "anomalies", "detail", updated.id],
        updated,
      );
      qc.invalidateQueries({ queryKey: ["governance", "anomalies"] });
      setAckComment("");
      setAckSuppressHours("");
      setAckError(null);
    },
    onError: (err) => setAckError(pickErrorMessage(err)),
  });

  const resolveMutation = useMutation({
    mutationFn: () =>
      api.governance.anomalies.resolve(selectedId as string, {
        comment: resolveComment.trim() || undefined,
      }),
    onSuccess: (updated: AnomalyAlert) => {
      qc.setQueryData(
        ["governance", "anomalies", "detail", updated.id],
        updated,
      );
      qc.invalidateQueries({ queryKey: ["governance", "anomalies"] });
      setResolveComment("");
      setResolveError(null);
    },
    onError: (err) => setResolveError(pickErrorMessage(err)),
  });

  const rows = listQuery.data?.alerts ?? [];
  const total = listQuery.data?.total ?? 0;
  const detail = detailQuery.data;

  const unresolvedCritical = useMemo(
    () =>
      rows.filter(
        (a) =>
          a.severity === "critical" &&
          (a.status === "open" || a.status === "acknowledged"),
      ).length,
    [rows],
  );

  const columns: ReadonlyArray<DataTableColumn<AnomalyAlert>> = [
    {
      key: "severity",
      header: "Severity",
      render: (a) => (
        <Badge tone={SEVERITY_TONE[a.severity]}>{a.severity}</Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (a) => <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>,
    },
    {
      key: "source",
      header: "Source",
      render: (a) => (
        <span className="text-xs text-slate-900">{prettySource(a.source)}</span>
      ),
    },
    {
      key: "subjectKey",
      header: "Subject",
      render: (a) => (
        <code className="font-mono text-xs text-slate-700">
          {a.subjectKey ?? "—"}
        </code>
      ),
    },
    {
      key: "message",
      header: "Message",
      render: (a) => (
        <span className="line-clamp-2 text-xs text-slate-800">{a.message}</span>
      ),
    },
    {
      key: "detectedAt",
      header: "Detected",
      render: (a) => (
        <span className="text-[11px] text-slate-500">
          {formatRelative(a.detectedAt)}
        </span>
      ),
    },
    {
      key: "_actions",
      header: "",
      render: (a) => (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setSelectedId(a.id);
            setAckComment("");
            setAckSuppressHours("");
            setAckError(null);
            setResolveComment("");
            setResolveError(null);
          }}
        >
          Inspect
        </Button>
      ),
    },
  ];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Governance · Anomalies"
        description="Live anomaly queue from Phase 5 detectors. Unacknowledged critical alerts block approval-gated mutations until an operator signs off."
      />

      {unresolvedCritical > 0 ? (
        <section className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900">
          <strong className="font-semibold">
            {unresolvedCritical} unresolved critical anomal
            {unresolvedCritical === 1 ? "y" : "ies"}.
          </strong>{" "}
          Privileged mutations are gated behind acknowledgement. Drain the
          queue below.
        </section>
      ) : null}

      {/* Filter bar */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-700">
            Status
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as AnomalyStatus | "")
              }
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">All</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700">
            Severity
            <select
              value={severityFilter}
              onChange={(e) =>
                setSeverityFilter(e.target.value as AnomalySeverity | "")
              }
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">All</option>
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700">
            Source
            <select
              value={sourceFilter}
              onChange={(e) =>
                setSourceFilter(e.target.value as AnomalySource | "")
              }
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">All</option>
              {SOURCE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {prettySource(s)}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto text-[11px] text-slate-500">
            {listQuery.isLoading
              ? "Loading…"
              : `${rows.length} / ${total} alerts`}
          </div>
        </div>
      </section>

      {/* List */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Queue</h2>
        </div>
        {listQuery.error ? (
          <div className="p-4 text-xs text-rose-700">
            {pickErrorMessage(listQuery.error)}
          </div>
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(a) => a.id}
            emptyMessage="No anomalies match the current filter."
          />
        )}
      </section>

      {/* Detail */}
      {selectedId ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Anomaly {selectedId}
            </h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedId(null)}
            >
              Close
            </Button>
          </div>
          {detailQuery.isLoading ? (
            <div className="p-4 text-xs text-slate-500">Loading alert…</div>
          ) : detailQuery.error ? (
            <div className="p-4 text-xs text-rose-700">
              {pickErrorMessage(detailQuery.error)}
            </div>
          ) : detail ? (
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Source
                  </div>
                  <div className="mt-1 text-slate-900">
                    {prettySource(detail.source)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Severity
                  </div>
                  <div className="mt-1">
                    <Badge tone={SEVERITY_TONE[detail.severity]}>
                      {detail.severity}
                    </Badge>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Status
                  </div>
                  <div className="mt-1">
                    <Badge tone={STATUS_TONE[detail.status]}>
                      {detail.status}
                    </Badge>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Detected
                  </div>
                  <div className="mt-1 text-slate-900">
                    {formatDate(detail.detectedAt)}
                  </div>
                </div>
                <div className="col-span-2 md:col-span-4">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Subject key
                  </div>
                  <code className="mt-1 block font-mono text-xs text-slate-900">
                    {detail.subjectKey ?? "—"}
                  </code>
                </div>
                <div className="col-span-2 md:col-span-4">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Message
                  </div>
                  <div className="mt-1 text-sm text-slate-900">
                    {detail.message}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">
                  Evidence
                </div>
                <pre className="mt-1 max-h-48 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-800">
                  {JSON.stringify(detail.evidence, null, 2)}
                </pre>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Acknowledged
                  </div>
                  <div className="mt-1 text-slate-900">
                    {detail.acknowledgedAt
                      ? `${formatRelative(detail.acknowledgedAt)} · ${
                          detail.acknowledgedByUserId ?? "?"
                        }`
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Resolved
                  </div>
                  <div className="mt-1 text-slate-900">
                    {detail.resolvedAt
                      ? `${formatRelative(detail.resolvedAt)} · ${
                          detail.resolvedByUserId ?? "?"
                        }`
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Suppressed until
                  </div>
                  <div className="mt-1 text-slate-900">
                    {detail.suppressedUntil
                      ? formatDate(detail.suppressedUntil)
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Related approval
                  </div>
                  <div className="mt-1 text-slate-900">
                    {detail.relatedApprovalId ? (
                      <code className="font-mono text-[11px]">
                        {detail.relatedApprovalId}
                      </code>
                    ) : (
                      "—"
                    )}
                  </div>
                </div>
              </div>

              {/* Action panel */}
              {detail.status === "open" ||
              detail.status === "acknowledged" ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {detail.status === "open" ? (
                    <div className="rounded border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold text-slate-900">
                        Acknowledge
                      </div>
                      <label className="mt-2 block text-[11px] text-slate-700">
                        Comment (optional)
                        <input
                          type="text"
                          value={ackComment}
                          onChange={(e) => setAckComment(e.target.value)}
                          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                          placeholder="what you're seeing"
                        />
                      </label>
                      <label className="mt-2 block text-[11px] text-slate-700">
                        Suppress re-fires for (hours, optional; max 720)
                        <input
                          type="number"
                          min={0}
                          max={720}
                          step={0.25}
                          value={ackSuppressHours}
                          onChange={(e) =>
                            setAckSuppressHours(e.target.value)
                          }
                          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <div className="mt-2">
                        <Button
                          size="sm"
                          variant="primary"
                          loading={ackMutation.isPending}
                          onClick={() => ackMutation.mutate()}
                        >
                          Acknowledge
                        </Button>
                      </div>
                      {ackError ? (
                        <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
                          {ackError}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="rounded border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-semibold text-slate-900">
                      Resolve
                    </div>
                    <label className="mt-2 block text-[11px] text-slate-700">
                      Resolution note (optional)
                      <input
                        type="text"
                        value={resolveComment}
                        onChange={(e) => setResolveComment(e.target.value)}
                        className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                        placeholder="root-cause + fix"
                      />
                    </label>
                    <div className="mt-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={resolveMutation.isPending}
                        onClick={() => resolveMutation.mutate()}
                      >
                        Mark resolved
                      </Button>
                    </div>
                    {resolveError ? (
                      <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
                        {resolveError}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="rounded border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
                  Terminal state. No further action required.
                </div>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
