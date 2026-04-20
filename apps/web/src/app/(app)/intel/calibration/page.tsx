"use client";

/**
 * Intelligence · Calibration — Phase 5 surface.
 *
 * Wires the calibration routes from
 * services/control_plane/app/routes/learning.py:
 *
 *   GET  /v1/learning/calibration              → CalibrationCurvesOut
 *   POST /v1/learning/calibration/recompute    → CalibrationCurvesOut
 *
 * The calibration engine fits a per (strategyId | setupType | tf) curve
 * that adjusts the detector's raw confidence based on realised wins.
 * Two kinds:
 *
 *   bucket — 10-bin isotonic default (bit-stable, always available)
 *   platt  — 2-param sigmoid fit, activated once sampleSize ≥ 200
 *
 * Quality metrics on every row: Expected Calibration Error (ECE) and
 * Brier score. Lower is better; we ship with ECE < 0.05 as the tier-A
 * gate.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, formatRelative, pickErrorMessage } from "@/lib/format";
import type {
  CalibrationBin,
  CalibrationKind,
  ConfidenceCalibration,
} from "@gv/types";

const KIND_TONE: Record<CalibrationKind, "info" | "success"> = {
  bucket: "info",
  platt: "success",
};

function fmtScope(c: ConfidenceCalibration): string {
  const parts: string[] = [];
  if (c.strategyId) parts.push(`strategy ${c.strategyId.slice(0, 10)}…`);
  if (c.setupType) parts.push(`setup ${c.setupType}`);
  if (c.tf) parts.push(`tf ${c.tf}`);
  return parts.length ? parts.join(" · ") : "global";
}

function qualityTone(ece: number): "success" | "warn" | "danger" {
  if (ece <= 0.05) return "success";
  if (ece <= 0.12) return "warn";
  return "danger";
}

function BinBar({ bin }: { bin: CalibrationBin }) {
  const raw = (bin.rawLow + bin.rawHigh) / 2;
  const calibrated = bin.calibrated;
  const diff = calibrated - raw;
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 font-mono text-[10px] text-slate-500">
        {(bin.rawLow * 100).toFixed(0)}–{(bin.rawHigh * 100).toFixed(0)}%
      </span>
      <div className="relative h-3 flex-1 overflow-hidden rounded bg-slate-100">
        <div
          className="absolute left-0 top-0 h-full bg-sky-500/40"
          style={{ width: `${raw * 100}%` }}
          aria-label="raw"
        />
        <div
          className="absolute top-0 h-full bg-emerald-500/60"
          style={{
            left: `${Math.min(raw, calibrated) * 100}%`,
            width: `${Math.abs(calibrated - raw) * 100}%`,
          }}
          aria-label="delta"
        />
      </div>
      <span
        className={`w-12 text-right font-mono text-[11px] ${
          diff > 0
            ? "text-emerald-700"
            : diff < 0
              ? "text-rose-700"
              : "text-slate-600"
        }`}
      >
        {diff > 0 ? "+" : ""}
        {(diff * 100).toFixed(1)}
      </span>
      <span className="w-12 text-right font-mono text-[11px] text-slate-500">
        n={bin.count}
      </span>
    </div>
  );
}

function CurveCard({ c }: { c: ConfidenceCalibration }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-slate-900">
            {fmtScope(c)}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <Badge tone={KIND_TONE[c.kind]}>{c.kind}</Badge>
            <Badge tone={qualityTone(c.ece)}>ECE {c.ece.toFixed(3)}</Badge>
            <span className="font-mono">Brier {c.brier.toFixed(3)}</span>
            <span className="font-mono">n={c.sampleSize}</span>
          </div>
        </div>
        <div className="text-[10px] text-slate-500">
          Generated {formatRelative(c.generatedAt)}
        </div>
      </header>

      {c.kind === "bucket" ? (
        <div className="mt-3 space-y-1">
          {c.bins.map((b, i) => (
            <BinBar key={i} bin={b} />
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded bg-slate-50 p-3 font-mono text-[11px] text-slate-700">
          <div>
            <span className="text-slate-500">calibrated(raw) = 1 / (1 + exp(</span>
            <span className="font-semibold">
              {c.plattA?.toFixed(3) ?? "—"}
            </span>
            <span className="text-slate-500"> × raw + </span>
            <span className="font-semibold">
              {c.plattB?.toFixed(3) ?? "—"}
            </span>
            <span className="text-slate-500">))</span>
          </div>
        </div>
      )}
    </article>
  );
}

export default function IntelCalibrationPage() {
  const qc = useQueryClient();
  const [strategyId, setStrategyId] = useState("");
  const [setupType, setSetupType] = useState("");
  const [tf, setTf] = useState("");

  const params = useMemo(() => {
    const p: { strategyId?: string; setupType?: string; tf?: string } = {};
    if (strategyId.trim()) p.strategyId = strategyId.trim();
    if (setupType.trim()) p.setupType = setupType.trim();
    if (tf.trim()) p.tf = tf.trim();
    return p;
  }, [strategyId, setupType, tf]);

  const curvesQuery = useQuery({
    queryKey: ["calibration", "curves", params],
    queryFn: () => api.calibration.curves(params),
    refetchInterval: 60_000,
  });

  const recomputeMutation = useMutation({
    mutationFn: () => api.calibration.recompute(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["calibration"] });
    },
  });

  const curves = curvesQuery.data?.curves ?? [];

  const summary = useMemo(() => {
    if (curves.length === 0) return null;
    const avgEce =
      curves.reduce((s, c) => s + c.ece, 0) / curves.length;
    const avgBrier =
      curves.reduce((s, c) => s + c.brier, 0) / curves.length;
    const totalSamples = curves.reduce((s, c) => s + c.sampleSize, 0);
    const plattCount = curves.filter((c) => c.kind === "platt").length;
    return { avgEce, avgBrier, totalSamples, plattCount };
  }, [curves]);

  const listColumns: ReadonlyArray<DataTableColumn<ConfidenceCalibration>> = [
    {
      key: "scope",
      header: "Scope",
      render: (c) => (
        <span className="text-xs text-slate-900">{fmtScope(c)}</span>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      render: (c) => <Badge tone={KIND_TONE[c.kind]}>{c.kind}</Badge>,
    },
    {
      key: "ece",
      header: "ECE",
      render: (c) => (
        <Badge tone={qualityTone(c.ece)}>{c.ece.toFixed(3)}</Badge>
      ),
    },
    {
      key: "brier",
      header: "Brier",
      render: (c) => (
        <span className="font-mono text-xs text-slate-700">
          {c.brier.toFixed(3)}
        </span>
      ),
    },
    {
      key: "samples",
      header: "Samples",
      render: (c) => (
        <span className="font-mono text-xs text-slate-700">{c.sampleSize}</span>
      ),
    },
    {
      key: "generatedAt",
      header: "Generated",
      render: (c) => formatDate(c.generatedAt),
    },
  ];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Intelligence · Calibration"
        description="Per-scope confidence calibration — bucket and Platt. Lower ECE / Brier is better. The promotion FSM uses ECE < 0.05 as the tier-A gate."
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-700">
            Strategy ID
            <input
              type="text"
              value={strategyId}
              onChange={(e) => setStrategyId(e.target.value)}
              placeholder="(any)"
              className="mt-1 block w-56 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-700">
            Setup type
            <input
              type="text"
              value={setupType}
              onChange={(e) => setSetupType(e.target.value)}
              placeholder="(any)"
              className="mt-1 block w-40 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-700">
            Timeframe
            <input
              type="text"
              value={tf}
              onChange={(e) => setTf(e.target.value)}
              placeholder="(any)"
              className="mt-1 block w-24 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
            />
          </label>
        </div>
        <Button
          size="sm"
          variant="secondary"
          loading={recomputeMutation.isPending}
          onClick={() => recomputeMutation.mutate()}
        >
          Recompute all
        </Button>
      </div>

      {recomputeMutation.error ? (
        <div className="rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
          {pickErrorMessage(recomputeMutation.error)}
        </div>
      ) : null}

      {summary ? (
        <div className="grid gap-3 md:grid-cols-4">
          <article className="rounded border border-slate-200 bg-white p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">
              Curves
            </div>
            <div className="mt-1 font-mono text-lg font-semibold text-slate-900">
              {curves.length}
            </div>
          </article>
          <article className="rounded border border-slate-200 bg-white p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">
              Avg ECE
            </div>
            <Badge tone={qualityTone(summary.avgEce)}>
              {summary.avgEce.toFixed(3)}
            </Badge>
          </article>
          <article className="rounded border border-slate-200 bg-white p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">
              Avg Brier
            </div>
            <div className="mt-1 font-mono text-lg font-semibold text-slate-700">
              {summary.avgBrier.toFixed(3)}
            </div>
          </article>
          <article className="rounded border border-slate-200 bg-white p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">
              Platt / Bucket
            </div>
            <div className="mt-1 font-mono text-sm text-slate-700">
              {summary.plattCount} / {curves.length - summary.plattCount}
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500">
              {summary.totalSamples} samples total
            </div>
          </article>
        </div>
      ) : null}

      {curvesQuery.isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading curves…
        </div>
      ) : curvesQuery.error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {pickErrorMessage(curvesQuery.error)}
        </div>
      ) : curves.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
          No calibration curves match this scope. Try recompute to refresh.
        </div>
      ) : (
        <>
          <section>
            <h2 className="text-sm font-semibold text-slate-900">
              Curves — bucket raw→calibrated, Platt a/b
            </h2>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {curves.map((c) => (
                <CurveCard key={c.id} c={c} />
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-900">
              Snapshot index
            </h2>
            <div className="mt-3">
              <DataTable
                rows={curves}
                columns={listColumns}
                emptyMessage="No calibration snapshots."
                rowKey={(c) => c.id}
              />
            </div>
          </section>
        </>
      )}

      <p className="text-xs text-slate-500">
        Related:{" "}
        <Link href="/learning/drift" className="text-sky-700 hover:underline">
          Learning · Drift
        </Link>{" "}
        for regime + data-truth context that invalidates calibration, and{" "}
        <Link href="/quant/ranking" className="text-sky-700 hover:underline">
          Quant Lab · Ranking
        </Link>{" "}
        which weights ECE into the composite tier score.
      </p>
    </section>
  );
}
