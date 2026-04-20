"use client";

/**
 * Strategies · Promotions — Phase 5 surface.
 *
 * Immutable audit log of the promotion FSM, served by
 * services/control_plane/app/routes/quant_lab.py:
 *
 *   GET  /v1/quant/strategies/:id/promotion          → PromotionEventsListOut
 *   POST /v1/quant/strategies/:id/promote  (admin)   → Strategy
 *   POST /v1/quant/strategies/:id/demote   (admin)   → Strategy
 *
 * FSM (enforced server-side):
 *
 *   experimental → paper → assisted_live → autonomous
 *                                       ╲
 *                                        ↘ retired (terminal from any state)
 *
 *   auto-demote drops to `experimental` on SLO breach (drawdown,
 *   calibration, data-truth). A manual demote can pick any earlier state.
 *
 * The page:
 *   1. loads the Strategy row so we know the current state
 *   2. offers admin controls for legal transitions only
 *   3. renders the event log in reverse-chronological order
 *
 * Deep-link: ?id=<strategyId> preselects the strategy so links from the
 * Active catalog land straight here.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, PageHeader } from "@gv/ui";
import { api } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { formatDate, formatRelative, pickErrorMessage } from "@/lib/format";
import type { PromotionEvent, PromotionState } from "@gv/types";

const STATE_TONE: Record<
  PromotionState,
  "neutral" | "info" | "success" | "warn" | "danger"
> = {
  experimental: "neutral",
  paper: "info",
  assisted_live: "success",
  autonomous: "success",
  retired: "warn",
};

/**
 * Legal transitions from each state, mirroring the server FSM.
 *
 *   experimental → paper, retired
 *   paper        → assisted_live, experimental, retired
 *   assisted_live→ autonomous, paper, experimental, retired
 *   autonomous   → assisted_live, paper, experimental, retired
 *   retired      → experimental (re-open)
 */
const LEGAL_FORWARD: Record<PromotionState, PromotionState[]> = {
  experimental: ["paper"],
  paper: ["assisted_live"],
  assisted_live: ["autonomous"],
  autonomous: [],
  retired: ["experimental"],
};

const LEGAL_BACKWARD: Record<PromotionState, PromotionState[]> = {
  experimental: [],
  paper: ["experimental"],
  assisted_live: ["paper", "experimental"],
  autonomous: ["assisted_live", "paper", "experimental"],
  retired: [],
};

const RETIRABLE: ReadonlyArray<PromotionState> = [
  "experimental",
  "paper",
  "assisted_live",
  "autonomous",
];

function eventTone(from: PromotionState, to: PromotionState): {
  tone: "neutral" | "info" | "success" | "warn" | "danger";
  label: string;
} {
  if (to === "retired") return { tone: "warn", label: "retire" };
  const fromIdx = ["experimental", "paper", "assisted_live", "autonomous"].indexOf(from);
  const toIdx = ["experimental", "paper", "assisted_live", "autonomous"].indexOf(to);
  if (fromIdx === -1 || toIdx === -1) {
    return { tone: "info", label: "transition" };
  }
  if (toIdx > fromIdx) return { tone: "success", label: "promote" };
  if (toIdx < fromIdx) return { tone: "danger", label: "demote" };
  return { tone: "neutral", label: "hold" };
}

export default function StrategiesPromotionsPage() {
  const searchParams = useSearchParams();
  const initial = searchParams.get("id") ?? "";
  const qc = useQueryClient();

  const [strategyId, setStrategyId] = useState(initial);
  const [targetState, setTargetState] = useState<PromotionState | "">("");
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (initial && initial !== strategyId) setStrategyId(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const strategiesQuery = useQuery({
    queryKey: ["strategies", "list", { limit: 200 }],
    queryFn: () => api.strategies.list({ limit: 200 }),
    staleTime: 30_000,
  });

  const strategyQuery = useQuery({
    queryKey: ["strategy", "get", strategyId],
    enabled: !!strategyId,
    queryFn: () =>
      strategyId ? api.strategies.get(strategyId) : Promise.resolve(null),
    refetchInterval: strategyId ? 30_000 : false,
  });

  const historyQuery = useQuery({
    queryKey: ["promotion", "history", strategyId],
    enabled: !!strategyId,
    queryFn: () =>
      strategyId ? api.promotion.history(strategyId) : Promise.resolve(null),
    refetchInterval: strategyId ? 30_000 : false,
  });

  const promoteMutation = useMutation({
    mutationFn: ({
      id,
      target,
      why,
    }: {
      id: string;
      target: PromotionState;
      why: string;
    }) => api.promotion.promote(id, { targetState: target, reason: why }),
    onSuccess: () => {
      setActionError(null);
      setReason("");
      setTargetState("");
      void qc.invalidateQueries({ queryKey: ["strategy"] });
      void qc.invalidateQueries({ queryKey: ["strategies"] });
      void qc.invalidateQueries({ queryKey: ["promotion"] });
    },
    onError: (err) => setActionError(pickErrorMessage(err)),
  });

  const demoteMutation = useMutation({
    mutationFn: ({
      id,
      target,
      why,
    }: {
      id: string;
      target: PromotionState;
      why: string;
    }) => api.promotion.demote(id, { targetState: target, reason: why }),
    onSuccess: () => {
      setActionError(null);
      setReason("");
      setTargetState("");
      void qc.invalidateQueries({ queryKey: ["strategy"] });
      void qc.invalidateQueries({ queryKey: ["strategies"] });
      void qc.invalidateQueries({ queryKey: ["promotion"] });
    },
    onError: (err) => setActionError(pickErrorMessage(err)),
  });

  const strategyOptions = strategiesQuery.data?.strategies ?? [];
  const strategy = strategyQuery.data ?? null;

  const currentState: PromotionState | null = strategy?.promotionState ?? null;

  const forwardOptions = useMemo(
    () => (currentState ? LEGAL_FORWARD[currentState] : []),
    [currentState],
  );
  const backwardOptions = useMemo(
    () => (currentState ? LEGAL_BACKWARD[currentState] : []),
    [currentState],
  );
  const canRetire = currentState ? RETIRABLE.includes(currentState) : false;

  const events = historyQuery.data?.events ?? [];
  const sortedEvents = useMemo(
    () =>
      [...events].sort(
        (a, b) =>
          new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
      ),
    [events],
  );
  const busy = promoteMutation.isPending || demoteMutation.isPending;

  const columns: ReadonlyArray<DataTableColumn<PromotionEvent>> = [
    {
      key: "occurredAt",
      header: "When",
      render: (e) => (
        <div className="flex flex-col text-[11px]">
          <span>{formatDate(e.occurredAt)}</span>
          <span className="text-[10px] text-slate-500">
            {formatRelative(e.occurredAt)}
          </span>
        </div>
      ),
    },
    {
      key: "transition",
      header: "Transition",
      render: (e) => {
        const tone = eventTone(e.fromState, e.toState);
        return (
          <div className="flex flex-col gap-1">
            <Badge tone={tone.tone}>{tone.label}</Badge>
            <span className="font-mono text-[10px] text-slate-600">
              {e.fromState.replaceAll("_", " ")} →{" "}
              {e.toState.replaceAll("_", " ")}
            </span>
          </div>
        );
      },
    },
    {
      key: "source",
      header: "Source",
      render: (e) =>
        e.automated ? (
          <Badge tone="warn">automated</Badge>
        ) : (
          <div className="flex flex-col">
            <Badge tone="info">manual</Badge>
            {e.triggeredByUserId ? (
              <code className="mt-1 font-mono text-[10px] text-slate-500">
                {e.triggeredByUserId.slice(0, 14)}…
              </code>
            ) : null}
          </div>
        ),
    },
    {
      key: "reason",
      header: "Reason",
      render: (e) => (
        <span className="text-[11px] text-slate-700">
          {e.reason ? e.reason.slice(0, 200) : "—"}
          {e.reason && e.reason.length > 200 ? "…" : ""}
        </span>
      ),
    },
  ];

  function runPromote() {
    if (!strategyId || !targetState || !reason.trim()) {
      setActionError("Target state and reason are required");
      return;
    }
    promoteMutation.mutate({
      id: strategyId,
      target: targetState as PromotionState,
      why: reason.trim(),
    });
  }

  function runDemote() {
    if (!strategyId || !targetState || !reason.trim()) {
      setActionError("Target state and reason are required");
      return;
    }
    demoteMutation.mutate({
      id: strategyId,
      target: targetState as PromotionState,
      why: reason.trim(),
    });
  }

  function runRetire() {
    if (!strategyId || !reason.trim()) {
      setActionError("Reason is required to retire");
      return;
    }
    demoteMutation.mutate({
      id: strategyId,
      target: "retired",
      why: reason.trim(),
    });
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Strategies · Promotions"
        description="Quant Lab → Paper → Assisted Live → Autonomous pipeline with auto-demotion on SLO breach. Pick a strategy to see the audit log and issue admin-only FSM transitions."
      />

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="text-xs font-medium text-slate-700">
          Strategy
          <select
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm md:w-96"
            value={strategyId}
            onChange={(e) => {
              setStrategyId(e.target.value);
              setTargetState("");
              setReason("");
              setActionError(null);
            }}
            disabled={strategiesQuery.isLoading}
          >
            <option value="">
              {strategiesQuery.isLoading ? "loading…" : "(choose a strategy)"}
            </option>
            {strategyOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.tier} · {s.promotionState}
              </option>
            ))}
          </select>
        </label>

        {strategy ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-slate-500">Current state:</span>
            <Badge tone={STATE_TONE[strategy.promotionState]}>
              {strategy.promotionState.replaceAll("_", " ")}
            </Badge>
            <span className="text-slate-500">Tier:</span>
            <Badge tone={strategy.tier === "A" ? "success" : strategy.tier === "B" ? "info" : "warn"}>
              {strategy.tier}
            </Badge>
            <span className="ml-2 font-mono text-[10px] text-slate-500">
              {strategy.id.slice(0, 14)}…
            </span>
          </div>
        ) : null}
      </div>

      {strategyId && strategy ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Transition · admin
          </h2>
          <p className="mt-1 text-[11px] text-slate-500">
            The server enforces FSM legality. Tier A unlocks{" "}
            <code>assisted_live</code> and <code>autonomous</code>; Tier B is
            capped at <code>paper</code>. Every transition is audited with the
            reason you enter below.
          </p>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-700">
              Target state
              <select
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={targetState}
                onChange={(e) =>
                  setTargetState(e.target.value as PromotionState | "")
                }
              >
                <option value="">(choose…)</option>
                {forwardOptions.length > 0 ? (
                  <optgroup label="promote">
                    {forwardOptions.map((s) => (
                      <option key={`fwd-${s}`} value={s}>
                        → {s.replaceAll("_", " ")}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {backwardOptions.length > 0 ? (
                  <optgroup label="demote">
                    {backwardOptions.map((s) => (
                      <option key={`bwd-${s}`} value={s}>
                        ← {s.replaceAll("_", " ")}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {canRetire ? (
                  <optgroup label="terminal">
                    <option value="retired">retire</option>
                  </optgroup>
                ) : null}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">
              Reason
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Short audit note — required"
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
          </div>

          {actionError ? (
            <div className="mt-3 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
              {actionError}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              loading={promoteMutation.isPending}
              disabled={
                busy ||
                !targetState ||
                targetState === "retired" ||
                !forwardOptions.includes(targetState as PromotionState)
              }
              onClick={runPromote}
            >
              Promote
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={demoteMutation.isPending && targetState !== "retired"}
              disabled={
                busy ||
                !targetState ||
                targetState === "retired" ||
                !backwardOptions.includes(targetState as PromotionState)
              }
              onClick={runDemote}
            >
              Demote
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={demoteMutation.isPending && targetState === "retired"}
              disabled={busy || !canRetire || targetState !== "retired"}
              onClick={runRetire}
            >
              Retire
            </Button>
          </div>
          <p className="mt-2 text-[10px] text-slate-500">
            Picking a promote target enables <em>Promote</em>; a demote target
            enables <em>Demote</em>; selecting <code>retired</code> arms{" "}
            <em>Retire</em>.
          </p>
        </section>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Promotion history
          </h2>
          <span className="text-[11px] text-slate-500">
            {strategyId
              ? `${sortedEvents.length} event${sortedEvents.length === 1 ? "" : "s"} · polls every 30s`
              : "Pick a strategy to load"}
          </span>
        </header>
        <div className="mt-3">
          <DataTable
            rows={sortedEvents}
            columns={columns}
            loading={historyQuery.isLoading}
            error={
              historyQuery.error ? pickErrorMessage(historyQuery.error) : null
            }
            emptyMessage={
              strategyId
                ? "No promotion events yet — the strategy has stayed in its current state since creation."
                : "Select a strategy above to load its audit log."
            }
            rowKey={(e) => e.id}
          />
        </div>
      </section>

      <p className="text-xs text-slate-500">
        Related:{" "}
        <Link href="/strategies/active" className="text-sky-700 hover:underline">
          Strategies · Active
        </Link>{" "}
        for the catalog and tier view;{" "}
        <Link href="/quant/ranking" className="text-sky-700 hover:underline">
          Quant Lab · Ranking
        </Link>{" "}
        for the tier snapshot that gates legal promotions;{" "}
        <Link href="/governance/trust" className="text-sky-700 hover:underline">
          Governance · Trust tiers
        </Link>{" "}
        for auto-demotion rules.
      </p>
    </section>
  );
}
