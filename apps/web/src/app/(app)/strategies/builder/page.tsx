"use client";

/**
 * Strategies · Builder — Phase 5 surface.
 *
 * Admin-only form bound to the strategy CRUD routes served by
 * services/control_plane/app/routes/quant_lab.py:
 *
 *   POST  /v1/quant/strategies                    → Strategy
 *   POST  /v1/quant/strategies/:id/versions       → StrategyVersion
 *
 * Supports two modes:
 *
 *   1. create — builds a brand-new Strategy plus its initial version.
 *      StrategyCreateRequest = { name, description, setupType,
 *                                initialVersion: Omit<StrategyVersion, ...> }
 *
 *   2. version — appends a new StrategyVersion to an existing strategy
 *      chosen from the live list. Monotone version number is assigned
 *      server-side so we only post the config body.
 *
 * Any change to entry / exit / sizing must cut a new version: old rows
 * never mutate, which is what gives backtests + live trades reproducible
 * provenance. The form therefore collects the full envelope every time.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { pickErrorMessage } from "@/lib/format";
import type {
  SetupType,
  Strategy,
  StrategyVersion,
  Timeframe,
} from "@gv/types";

type Mode = "create" | "version";

type StopStyle = StrategyVersion["exit"]["stopStyle"];

type VersionDraft = Omit<
  StrategyVersion,
  "id" | "strategyId" | "version" | "createdAt" | "createdByUserId"
>;

const SETUP_TYPES: ReadonlyArray<SetupType> = [
  "liquidity_sweep_reclaim",
  "ob_retest",
  "breakout_retest",
  "fvg_reaction",
  "momentum_continuation",
  "session_reversal",
];

const ALL_TIMEFRAMES: ReadonlyArray<Timeframe> = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "1d",
  "1w",
];

const STOP_STYLES: ReadonlyArray<StopStyle> = [
  "structure",
  "atr",
  "fixed_r",
];

const DEFAULT_VERSION: VersionDraft = {
  entry: {
    setupType: "liquidity_sweep_reclaim",
    timeframes: ["5m", "15m"],
    minConfidence: 0.6,
    filters: {},
  },
  exit: {
    stopStyle: "structure",
    takeProfitRR: 2,
    trailAfterR: null,
  },
  sizing: {
    perTradeR: 0.005,
    maxConcurrent: 5,
  },
  codeHash: "",
  notes: "",
};

function parseFiltersJson(raw: string): {
  ok: true;
  value: Record<string, unknown>;
} | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return { ok: false, error: "filters must be a JSON object" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "filters must be valid JSON",
    };
  }
}

export default function StrategiesBuilderPage() {
  const qc = useQueryClient();

  const [mode, setMode] = useState<Mode>("create");

  // Create-mode metadata.
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [setupType, setSetupType] = useState<SetupType>(
    DEFAULT_VERSION.entry.setupType,
  );

  // Version-mode selector.
  const [targetStrategyId, setTargetStrategyId] = useState("");

  // Shared version-config state.
  const [entrySetup, setEntrySetup] = useState<SetupType>(
    DEFAULT_VERSION.entry.setupType,
  );
  const [timeframes, setTimeframes] = useState<Timeframe[]>([
    ...DEFAULT_VERSION.entry.timeframes,
  ]);
  const [direction, setDirection] = useState<"" | "long" | "short">("");
  const [minConfidence, setMinConfidence] = useState(0.6);
  const [filtersJson, setFiltersJson] = useState("{}");

  const [stopStyle, setStopStyle] = useState<StopStyle>("structure");
  const [takeProfitRR, setTakeProfitRR] = useState(2);
  const [trailEnabled, setTrailEnabled] = useState(false);
  const [trailAfterR, setTrailAfterR] = useState(1);

  const [perTradeR, setPerTradeR] = useState(0.005);
  const [maxConcurrent, setMaxConcurrent] = useState(5);
  const [codeHash, setCodeHash] = useState("");
  const [notes, setNotes] = useState("");

  const [formError, setFormError] = useState<string | null>(null);

  const strategiesQuery = useQuery({
    queryKey: ["strategies", "list", { limit: 200 }],
    queryFn: () => api.strategies.list({ limit: 200 }),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (req: {
      name: string;
      description: string;
      setupType: SetupType;
      initialVersion: VersionDraft;
    }) =>
      api.strategies.create({
        name: req.name,
        description: req.description,
        setupType: req.setupType,
        initialVersion: req.initialVersion,
      }),
    onSuccess: (created) => {
      setFormError(null);
      setName("");
      setDescription("");
      setCodeHash("");
      setNotes("");
      void qc.invalidateQueries({ queryKey: ["strategies"] });
      setMode("version");
      setTargetStrategyId(created.id);
    },
    onError: (err) => setFormError(pickErrorMessage(err)),
  });

  const addVersionMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: VersionDraft;
    }) => api.strategies.addVersion(id, body),
    onSuccess: () => {
      setFormError(null);
      setCodeHash("");
      setNotes("");
      void qc.invalidateQueries({ queryKey: ["strategies"] });
    },
    onError: (err) => setFormError(pickErrorMessage(err)),
  });

  const submitting = createMutation.isPending || addVersionMutation.isPending;

  const strategyOptions = strategiesQuery.data?.strategies ?? [];
  const selectedStrategy: Strategy | null = useMemo(
    () => strategyOptions.find((s) => s.id === targetStrategyId) ?? null,
    [strategyOptions, targetStrategyId],
  );

  function toggleTimeframe(tf: Timeframe) {
    setTimeframes((prev) => {
      if (prev.includes(tf)) return prev.filter((t) => t !== tf);
      return [...prev, tf];
    });
  }

  function buildDraft(): VersionDraft | { error: string } {
    if (timeframes.length === 0) {
      return { error: "At least one timeframe is required" };
    }
    if (!codeHash.trim()) {
      return { error: "codeHash is required (detector+risk commit)" };
    }
    const filters = parseFiltersJson(filtersJson);
    if (!filters.ok) return { error: `filters JSON: ${filters.error}` };
    if (minConfidence < 0 || minConfidence > 1) {
      return { error: "minConfidence must be in [0,1]" };
    }
    if (takeProfitRR <= 0 || takeProfitRR > 20) {
      return { error: "takeProfitRR must be in (0,20]" };
    }
    if (perTradeR <= 0 || perTradeR > 0.1) {
      return { error: "perTradeR must be in (0,0.1]" };
    }
    if (
      !Number.isInteger(maxConcurrent) ||
      maxConcurrent <= 0 ||
      maxConcurrent > 200
    ) {
      return { error: "maxConcurrent must be an integer in [1,200]" };
    }
    if (trailEnabled && (trailAfterR <= 0 || trailAfterR > 20)) {
      return { error: "trailAfterR must be in (0,20] when enabled" };
    }

    const draft: VersionDraft = {
      entry: {
        setupType: entrySetup,
        timeframes: [...timeframes],
        ...(direction ? { direction } : {}),
        minConfidence,
        filters: filters.value,
      },
      exit: {
        stopStyle,
        takeProfitRR,
        trailAfterR: trailEnabled ? trailAfterR : null,
      },
      sizing: {
        perTradeR,
        maxConcurrent,
      },
      codeHash: codeHash.trim(),
      notes: notes.trim(),
    };
    return draft;
  }

  function submit() {
    const draft = buildDraft();
    if ("error" in draft) {
      setFormError(draft.error);
      return;
    }
    if (mode === "create") {
      if (!name.trim()) {
        setFormError("Name is required");
        return;
      }
      createMutation.mutate({
        name: name.trim(),
        description: description.trim(),
        setupType,
        initialVersion: { ...draft, entry: { ...draft.entry, setupType } },
      });
    } else {
      if (!targetStrategyId) {
        setFormError("Pick an existing strategy");
        return;
      }
      addVersionMutation.mutate({
        id: targetStrategyId,
        body: draft,
      });
    }
  }

  const createdStrategy = createMutation.data ?? null;
  const createdVersion = addVersionMutation.data ?? null;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Strategies · Builder"
        description="Author a new strategy or cut a new version of an existing one. Every versioned row is immutable — backtests and live fills keep reproducible provenance."
      />

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              mode === "create"
                ? "bg-sky-600 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
            onClick={() => setMode("create")}
          >
            Create strategy
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              mode === "version"
                ? "bg-sky-600 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
            onClick={() => setMode("version")}
          >
            Add version to existing
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          {mode === "create"
            ? "Creates a new Strategy row (tier C · experimental) and its first StrategyVersion (v1)."
            : "Appends a new StrategyVersion — the version number is assigned server-side and the new row becomes activatable from the Active page."}
        </p>
      </div>

      {mode === "create" ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Strategy metadata
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-700">
              Name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. OB retest · majors · NY session"
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Canonical setup family
              <select
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={setupType}
                onChange={(e) => {
                  const next = e.target.value as SetupType;
                  setSetupType(next);
                  setEntrySetup(next);
                }}
              >
                {SETUP_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="md:col-span-2 text-xs font-medium text-slate-700">
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="What is this strategy trying to capture? Which regimes and sessions is it meant for?"
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Target strategy
          </h2>
          <div className="mt-3">
            <label className="text-xs font-medium text-slate-700">
              Pick a strategy
              <select
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
                value={targetStrategyId}
                onChange={(e) => {
                  const id = e.target.value;
                  setTargetStrategyId(id);
                  const s = strategyOptions.find((x) => x.id === id);
                  if (s) setEntrySetup(s.setupType);
                }}
                disabled={strategiesQuery.isLoading}
              >
                <option value="">
                  {strategiesQuery.isLoading ? "loading…" : "(choose…)"}
                </option>
                {strategyOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.tier} · {s.promotionState}
                  </option>
                ))}
              </select>
            </label>
            {selectedStrategy ? (
              <p className="mt-2 text-[11px] text-slate-500">
                Setup family:{" "}
                <code className="font-mono">
                  {selectedStrategy.setupType.replaceAll("_", " ")}
                </code>{" "}
                · active version:{" "}
                <code className="font-mono">
                  {selectedStrategy.activeVersionId
                    ? `${selectedStrategy.activeVersionId.slice(0, 12)}…`
                    : "—"}
                </code>
              </p>
            ) : null}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Entry rules</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-medium text-slate-700">
            Entry setup
            <select
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={entrySetup}
              onChange={(e) => setEntrySetup(e.target.value as SetupType)}
            >
              {SETUP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700">
            Direction bias
            <select
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={direction}
              onChange={(e) =>
                setDirection(e.target.value as "" | "long" | "short")
              }
            >
              <option value="">(either)</option>
              <option value="long">long only</option>
              <option value="short">short only</option>
            </select>
          </label>
          <div className="md:col-span-2">
            <span className="text-xs font-medium text-slate-700">
              Timeframes
            </span>
            <div className="mt-1 flex flex-wrap gap-2">
              {ALL_TIMEFRAMES.map((tf) => {
                const on = timeframes.includes(tf);
                return (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => toggleTimeframe(tf)}
                    className={`rounded border px-2 py-1 font-mono text-[11px] transition ${
                      on
                        ? "border-sky-600 bg-sky-50 text-sky-800"
                        : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
                    }`}
                  >
                    {tf}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] text-slate-500">
              At least one is required. Multi-TF selection means signals must
              align across all chosen timeframes.
            </p>
          </div>
          <label className="text-xs font-medium text-slate-700">
            Min confidence
            <div className="mt-1 flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={minConfidence}
                onChange={(e) => setMinConfidence(Number(e.target.value))}
                className="flex-1"
              />
              <span className="font-mono text-xs text-slate-700">
                {(minConfidence * 100).toFixed(0)}%
              </span>
            </div>
          </label>
          <label className="md:col-span-2 text-xs font-medium text-slate-700">
            Filters (JSON)
            <textarea
              value={filtersJson}
              onChange={(e) => setFiltersJson(e.target.value)}
              rows={4}
              placeholder='{ "regime": "trending", "session": ["london", "ny_am"] }'
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-[11px]"
            />
            <span className="mt-1 block text-[10px] text-slate-500">
              Any JSON object. Consumed by the setup detector — common keys:
              regime, session, symbolClass, volatilityBucket.
            </span>
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Exit rules</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="text-xs font-medium text-slate-700">
            Stop style
            <select
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={stopStyle}
              onChange={(e) => setStopStyle(e.target.value as StopStyle)}
            >
              {STOP_STYLES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700">
            Take-profit (R)
            <input
              type="number"
              min={0.1}
              max={20}
              step={0.1}
              value={takeProfitRR}
              onChange={(e) => setTakeProfitRR(Number(e.target.value))}
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
            />
          </label>
          <div className="text-xs font-medium text-slate-700">
            <span>Trail after R</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="checkbox"
                checked={trailEnabled}
                onChange={(e) => setTrailEnabled(e.target.checked)}
              />
              <input
                type="number"
                min={0.1}
                max={20}
                step={0.1}
                value={trailAfterR}
                disabled={!trailEnabled}
                onChange={(e) => setTrailAfterR(Number(e.target.value))}
                className="block w-20 rounded border border-slate-300 px-2 py-1 font-mono text-sm disabled:bg-slate-100"
              />
              <span className="text-[10px] text-slate-500">
                {trailEnabled ? "on" : "off"}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Sizing</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-medium text-slate-700">
            Per-trade R (fraction of equity)
            <div className="mt-1 flex items-center gap-2">
              <input
                type="range"
                min={0.001}
                max={0.05}
                step={0.001}
                value={perTradeR}
                onChange={(e) => setPerTradeR(Number(e.target.value))}
                className="flex-1"
              />
              <span className="font-mono text-xs text-slate-700">
                {(perTradeR * 100).toFixed(2)}%
              </span>
            </div>
          </label>
          <label className="text-xs font-medium text-slate-700">
            Max concurrent positions
            <input
              type="number"
              min={1}
              max={200}
              step={1}
              value={maxConcurrent}
              onChange={(e) =>
                setMaxConcurrent(Math.max(1, Math.floor(Number(e.target.value))))
              }
              className="mt-1 block w-32 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Provenance</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-medium text-slate-700">
            Code hash
            <input
              type="text"
              value={codeHash}
              onChange={(e) => setCodeHash(e.target.value)}
              placeholder="git sha of detector+risk at version time"
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-700">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Short narrative — what changed vs the previous version?"
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
        </div>
      </section>

      {formError ? (
        <div className="rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          {formError}
        </div>
      ) : null}

      {createdStrategy ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          Created strategy{" "}
          <code className="font-mono">{createdStrategy.id.slice(0, 12)}…</code>{" "}
          (tier {createdStrategy.tier}, {createdStrategy.promotionState}).{" "}
          <Link
            href={`/strategies/active?id=${encodeURIComponent(createdStrategy.id)}`}
            className="underline"
          >
            Open on Active
          </Link>
          .
        </div>
      ) : null}

      {createdVersion ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          Appended version v{createdVersion.version} to strategy{" "}
          <code className="font-mono">
            {createdVersion.strategyId.slice(0, 12)}…
          </code>
          .{" "}
          <Link
            href={`/strategies/active?id=${encodeURIComponent(createdVersion.strategyId)}`}
            className="underline"
          >
            Open on Active
          </Link>
          .
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          size="md"
          loading={submitting}
          onClick={submit}
          disabled={submitting}
        >
          {mode === "create" ? "Create strategy + v1" : "Append new version"}
        </Button>
        <Link
          href="/strategies/active"
          className="text-xs text-sky-700 hover:underline"
        >
          Back to Active
        </Link>
      </div>

      <p className="text-xs text-slate-500">
        Related:{" "}
        <Link href="/strategies/active" className="text-sky-700 hover:underline">
          Strategies · Active
        </Link>{" "}
        to activate the new version;{" "}
        <Link href="/quant/backtests" className="text-sky-700 hover:underline">
          Quant Lab · Backtests
        </Link>{" "}
        to simulate it before promotion.
      </p>
    </section>
  );
}
