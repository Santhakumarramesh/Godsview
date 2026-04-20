"use client";

/**
 * Execution · Risk — Phase 4 live surface.
 *
 * Wires the risk engine routes:
 *   GET   /v1/risk/budget?accountId=…   → RiskBudget
 *   PATCH /v1/risk/budget?accountId=…   → RiskBudget (admin only)
 *   GET   /v1/risk/equity?accountId=…   → AccountEquity
 *
 * The budget defines the *policy* (per-trade / per-day / exposure caps);
 * the equity snapshot is the *state* the live gate checks each policy
 * against. A live-gate rejection is always a breach of one of these caps.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@gv/ui";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { formatDate, pickErrorMessage } from "@/lib/format";
import type { RiskBudget } from "@gv/types";

type DraftBudget = Record<keyof RiskBudget, string>;

const DEFAULT_ACCOUNT = "default";

export default function ExecutionRiskPage() {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState(DEFAULT_ACCOUNT);
  const [activeAccount, setActiveAccount] = useState(DEFAULT_ACCOUNT);
  const [saveError, setSaveError] = useState<string | null>(null);

  const budgetQuery = useQuery({
    queryKey: ["risk", "budget", activeAccount],
    queryFn: () => api.risk.getBudget(activeAccount),
  });
  const equityQuery = useQuery({
    queryKey: ["risk", "equity", activeAccount],
    queryFn: () => api.risk.getEquity(activeAccount),
    refetchInterval: 15_000,
  });

  const [draft, setDraft] = useState<DraftBudget | null>(null);

  useEffect(() => {
    if (budgetQuery.data && draft === null) {
      setDraft({
        maxRiskPerTradeR: String(budgetQuery.data.maxRiskPerTradeR),
        maxDailyDrawdownR: String(budgetQuery.data.maxDailyDrawdownR),
        maxOpenPositions: String(budgetQuery.data.maxOpenPositions),
        maxCorrelatedExposure: String(budgetQuery.data.maxCorrelatedExposure),
        maxGrossExposure: String(budgetQuery.data.maxGrossExposure),
      });
    }
  }, [budgetQuery.data, draft]);

  const patchMutation = useMutation({
    mutationFn: (patch: Partial<RiskBudget>) =>
      api.risk.patchBudget(activeAccount, patch),
    onSuccess: () => {
      setSaveError(null);
      void qc.invalidateQueries({ queryKey: ["risk", "budget", activeAccount] });
    },
    onError: (err) => setSaveError(pickErrorMessage(err)),
  });

  const refreshEquityMutation = useMutation({
    mutationFn: () => api.risk.getEquity(activeAccount, true),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["risk", "equity", activeAccount] }),
  });

  const drawdownUtilisation = useMemo(() => {
    if (!equityQuery.data || !budgetQuery.data) return null;
    const sod = equityQuery.data.startOfDayEquity;
    if (sod <= 0) return null;
    const realizedLoss = Math.max(0, -equityQuery.data.realizedPnL);
    const frac = realizedLoss / sod;
    return frac / budgetQuery.data.maxDailyDrawdownR;
  }, [equityQuery.data, budgetQuery.data]);

  const grossUtilisation = useMemo(() => {
    if (!equityQuery.data || !budgetQuery.data) return null;
    if (equityQuery.data.totalEquity <= 0) return null;
    // Approximation using marginUsed as a proxy for gross exposure on the
    // client side; the canonical number lives inside the live gate.
    return (
      equityQuery.data.marginUsed /
      (equityQuery.data.totalEquity * budgetQuery.data.maxGrossExposure)
    );
  }, [equityQuery.data, budgetQuery.data]);

  function submitAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!accountId.trim()) return;
    setDraft(null);
    setActiveAccount(accountId.trim());
  }

  function submitBudget(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaveError(null);
    if (!draft) return;
    const patch: Partial<RiskBudget> = {};
    const read = (k: keyof RiskBudget): number | null => {
      const n = Number(draft[k]);
      return Number.isFinite(n) ? n : null;
    };
    const keys: (keyof RiskBudget)[] = [
      "maxRiskPerTradeR",
      "maxDailyDrawdownR",
      "maxOpenPositions",
      "maxCorrelatedExposure",
      "maxGrossExposure",
    ];
    for (const k of keys) {
      const v = read(k);
      if (v !== null && v !== budgetQuery.data?.[k]) {
        (patch as Record<string, number>)[k] = v;
      }
    }
    if (Object.keys(patch).length === 0) return;
    patchMutation.mutate(patch);
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Execution · Risk"
        description="Risk engine policy and live equity snapshot. PATCH requires admin. Every edit is audit-logged."
      />

      {/* account picker */}
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardBody>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={submitAccount}
          >
            <label className="text-xs font-medium text-slate-700">
              Account ID
              <input
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="mt-1 block w-64 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
              />
            </label>
            <Button type="submit">Load</Button>
          </form>
        </CardBody>
      </Card>

      {/* equity snapshot */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Equity snapshot</CardTitle>
            <Button
              size="sm"
              variant="secondary"
              loading={refreshEquityMutation.isPending}
              onClick={() => refreshEquityMutation.mutate()}
            >
              Force broker pull
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          {equityQuery.error ? (
            <div className="rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
              {pickErrorMessage(equityQuery.error)}
            </div>
          ) : equityQuery.data ? (
            <div className="grid gap-3 md:grid-cols-3">
              <Stat
                label="Total equity"
                value={`$${equityQuery.data.totalEquity.toFixed(2)}`}
              />
              <Stat
                label="Start-of-day"
                value={`$${equityQuery.data.startOfDayEquity.toFixed(2)}`}
              />
              <Stat
                label="Buying power"
                value={`$${equityQuery.data.buyingPower.toFixed(2)}`}
              />
              <Stat
                label="Realised PnL"
                value={`$${equityQuery.data.realizedPnL.toFixed(2)}`}
                tone={equityQuery.data.realizedPnL >= 0 ? "good" : "bad"}
              />
              <Stat
                label="Unrealised PnL"
                value={`$${equityQuery.data.unrealizedPnL.toFixed(2)}`}
                tone={equityQuery.data.unrealizedPnL >= 0 ? "good" : "bad"}
              />
              <Stat
                label="Margin used"
                value={`$${equityQuery.data.marginUsed.toFixed(2)}`}
              />
              <div className="md:col-span-3 text-xs text-slate-500">
                Observed at {formatDate(equityQuery.data.observedAt)}. Auto-refreshing every 15 s.
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500">Loading…</div>
          )}
        </CardBody>
      </Card>

      {/* utilisation meters */}
      {budgetQuery.data ? (
        <Card>
          <CardHeader>
            <CardTitle>Policy utilisation</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="space-y-3 text-xs">
              <Meter
                label="Daily drawdown"
                value={drawdownUtilisation}
                hint={`cap ${(budgetQuery.data.maxDailyDrawdownR * 100).toFixed(
                  2,
                )}% of SOD equity`}
              />
              <Meter
                label="Gross exposure (margin proxy)"
                value={grossUtilisation}
                hint={`cap ${budgetQuery.data.maxGrossExposure.toFixed(2)}× equity`}
              />
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* budget editor */}
      <Card>
        <CardHeader>
          <CardTitle>Risk budget</CardTitle>
        </CardHeader>
        <CardBody>
          {budgetQuery.error ? (
            <div className="rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
              {pickErrorMessage(budgetQuery.error)}
            </div>
          ) : budgetQuery.isLoading || !draft ? (
            <div className="text-sm text-slate-500">Loading…</div>
          ) : (
            <form className="grid gap-3 md:grid-cols-2" onSubmit={submitBudget}>
              <DraftField
                label="Max per-trade risk (R)"
                hint="0..0.1 (= 0..10% of equity)"
                value={draft.maxRiskPerTradeR}
                onChange={(v) =>
                  setDraft({ ...draft, maxRiskPerTradeR: v })
                }
              />
              <DraftField
                label="Max daily drawdown (R)"
                hint="0..0.25 (= 0..25% of SOD equity)"
                value={draft.maxDailyDrawdownR}
                onChange={(v) =>
                  setDraft({ ...draft, maxDailyDrawdownR: v })
                }
              />
              <DraftField
                label="Max open positions"
                hint="1..200"
                value={draft.maxOpenPositions}
                onChange={(v) =>
                  setDraft({ ...draft, maxOpenPositions: v })
                }
              />
              <DraftField
                label="Max correlated exposure"
                hint="0..5× equity (per correlation class)"
                value={draft.maxCorrelatedExposure}
                onChange={(v) =>
                  setDraft({ ...draft, maxCorrelatedExposure: v })
                }
              />
              <DraftField
                label="Max gross exposure"
                hint="0..10× equity"
                value={draft.maxGrossExposure}
                onChange={(v) =>
                  setDraft({ ...draft, maxGrossExposure: v })
                }
              />
              {saveError ? (
                <div className="md:col-span-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                  {saveError}
                </div>
              ) : null}
              <div className="md:col-span-2 flex items-center gap-3">
                <Button type="submit" loading={patchMutation.isPending}>
                  Save
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    if (budgetQuery.data) {
                      setDraft({
                        maxRiskPerTradeR: String(
                          budgetQuery.data.maxRiskPerTradeR,
                        ),
                        maxDailyDrawdownR: String(
                          budgetQuery.data.maxDailyDrawdownR,
                        ),
                        maxOpenPositions: String(
                          budgetQuery.data.maxOpenPositions,
                        ),
                        maxCorrelatedExposure: String(
                          budgetQuery.data.maxCorrelatedExposure,
                        ),
                        maxGrossExposure: String(
                          budgetQuery.data.maxGrossExposure,
                        ),
                      });
                      setSaveError(null);
                    }
                  }}
                >
                  Reset
                </Button>
                {patchMutation.isSuccess && !saveError ? (
                  <Badge tone="success">Saved</Badge>
                ) : null}
              </div>
            </form>
          )}
        </CardBody>
      </Card>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  const valueClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-rose-700"
        : "text-slate-900";
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`mt-1 font-mono text-lg ${valueClass}`}>{value}</div>
    </div>
  );
}

function Meter({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | null;
  hint: string;
}) {
  if (value === null) {
    return (
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-slate-700">{label}</span>
          <span className="text-xs text-slate-500">—</span>
        </div>
        <div className="mt-1 h-2 rounded bg-slate-100" />
        <div className="mt-1 text-xs text-slate-500">{hint}</div>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(1, value));
  const pctStr = `${Math.round(pct * 100)}%`;
  const fillColor =
    pct < 0.5 ? "bg-emerald-500" : pct < 0.85 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-slate-700">{label}</span>
        <span className="font-mono text-xs text-slate-600">{pctStr}</span>
      </div>
      <div className="mt-1 h-2 rounded bg-slate-100">
        <div
          className={`h-2 rounded ${fillColor}`}
          style={{ width: pctStr }}
        />
      </div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
    </div>
  );
}

function DraftField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="text-xs font-medium text-slate-700">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
      />
      <span className="mt-1 block text-[10px] font-normal text-slate-500">
        {hint}
      </span>
    </label>
  );
}
