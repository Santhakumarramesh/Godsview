"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardBody, CardHeader, CardTitle, PageHeader } from "@gv/ui";
import { useState } from "react";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type { LatencyBucket } from "@gv/types";

const DEFAULT_SERVICE = "control_plane";
const DEFAULT_OPERATION = "POST:/v1/auth/login";

export default function OpsLatencyPage() {
  const [service, setService] = useState(DEFAULT_SERVICE);
  const [operation, setOperation] = useState(DEFAULT_OPERATION);
  const [windowSeconds, setWindowSeconds] = useState(3600);
  const [buckets, setBuckets] = useState(30);

  const latencyQuery = useQuery({
    queryKey: ["ops", "latency", service, operation, windowSeconds, buckets],
    queryFn: () =>
      api.ops.getLatency({ service, operation, windowSeconds, buckets }),
  });

  const max = latencyQuery.data?.buckets.reduce((acc, b) => Math.max(acc, b.p99Ms), 1) ?? 1;

  const columns: ReadonlyArray<DataTableColumn<LatencyBucket>> = [
    { key: "bucket", header: "Bucket start", render: (b) => formatDate(b.bucketStart) },
    { key: "p50", header: "p50", render: (b) => `${b.p50Ms.toFixed(1)} ms` },
    { key: "p95", header: "p95", render: (b) => `${b.p95Ms.toFixed(1)} ms` },
    { key: "p99", header: "p99", render: (b) => `${b.p99Ms.toFixed(1)} ms` },
    { key: "n", header: "Samples", render: (b) => b.sampleCount.toString() },
    {
      key: "bar",
      header: "p99 shape",
      render: (b) => (
        <div className="h-2 w-40 rounded bg-slate-100">
          <div
            className="h-2 rounded bg-sky-500"
            style={{ width: `${Math.min(100, (b.p99Ms / max) * 100)}%` }}
          />
        </div>
      ),
    },
  ];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Operations · Latency"
        description="Synthetic p50/p95/p99 histograms for any service+operation. Buckets are deterministic for regression tests."
      />

      <Card>
        <CardHeader>
          <CardTitle>Query</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-xs font-medium text-slate-700">
              Service
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={service}
                onChange={(e) => setService(e.target.value)}
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Operation
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={operation}
                onChange={(e) => setOperation(e.target.value)}
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Window (sec)
              <input
                type="number"
                min={60}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={windowSeconds}
                onChange={(e) => setWindowSeconds(Number(e.target.value))}
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Buckets
              <input
                type="number"
                min={1}
                max={120}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={buckets}
                onChange={(e) => setBuckets(Number(e.target.value))}
              />
            </label>
          </div>
        </CardBody>
      </Card>

      <DataTable
        rows={latencyQuery.data?.buckets ?? []}
        columns={columns}
        loading={latencyQuery.isLoading}
        error={latencyQuery.error ? pickErrorMessage(latencyQuery.error) : null}
        emptyMessage="No latency samples"
        rowKey={(b) => b.bucketStart}
      />
    </section>
  );
}
