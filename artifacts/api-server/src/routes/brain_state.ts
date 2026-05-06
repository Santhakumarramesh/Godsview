/**
 * Brain Console v1 — honest aggregator endpoint.
 *
 *   GET /api/brain-state
 *
 * This is a READ-ONLY façade that gathers values from the production-honest
 * surface that already exists in the repo (Phase 6 health/ready, the Alpaca
 * paper account, the watchlist scanner, the Phase 4–5 paper-trade proof
 * system, system status). It DOES NOT compute, fabricate, or interpolate
 * anything.
 *
 * Each section returns a `Section<T>` with:
 *   { status: "ok" | "not_connected", value: T | null, reason?: string }
 * If any source is unreachable or returns a non-2xx, that section degrades
 * to `not_connected` and the rest of the response is still emitted. The
 * verdict paragraph at the bottom is generated server-side from the values
 * that ARE present; missing values become "unknown" — never invented.
 *
 * Coupling: this route deliberately calls its own existing HTTP endpoints
 * via the local loopback. That keeps the existing route handlers as the
 * single source of truth and means this aggregator never reaches around
 * them into the database directly. The base URL is configurable for tests
 * via GODSVIEW_SELF_BASE_URL.
 */
import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
// Milestone 2: read-only access to the in-memory pipeline snapshot.
import {
  getPipelineSnapshot as getM2Snapshot,
  M2_STRATEGY_NAME,
  M2_STRATEGY_VERSION,
  M2_NOT_CONNECTED_LAYERS,
} from "../lib/m2_pipeline";

const router = Router();

const FETCH_TIMEOUT_MS = 4_000;
function selfBaseUrl(): string {
  // Allow tests / overrides to redirect the loopback fetches.
  const override = process.env.GODSVIEW_SELF_BASE_URL;
  if (override && override.trim().length > 0) return override.trim();
  const port = process.env.PORT ?? "3001";
  return `http://127.0.0.1:${port}`;
}

type Status = "ok" | "not_connected";

interface Section<T> {
  status: Status;
  value: T | null;
  reason?: string;
}

async function fetchJsonSafe<T = unknown>(path: string): Promise<Section<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${selfBaseUrl()}${path}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { status: "not_connected", value: null, reason: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as T;
    if (json === null || json === undefined) {
      return { status: "not_connected", value: null, reason: "empty_response" };
    }
    return { status: "ok", value: json };
  } catch (err: unknown) {
    clearTimeout(timer);
    const reason = err instanceof Error ? err.message : String(err);
    return { status: "not_connected", value: null, reason };
  }
}

// ── Mode (env-derived, no I/O) ───────────────────────────────────────────────
function readMode(): {
  system_mode: string;
  live_writes_enabled: boolean;
  kill_switch_active: boolean;
  starting_equity_usd: number;
} {
  const raw = String(process.env.GODSVIEW_SYSTEM_MODE ?? "paper").trim().toLowerCase();
  return {
    system_mode: raw || "paper",
    live_writes_enabled: String(process.env.GODSVIEW_ENABLE_LIVE_TRADING ?? "false").toLowerCase() === "true",
    kill_switch_active: String(process.env.GODSVIEW_KILL_SWITCH ?? "false").toLowerCase() === "true",
    starting_equity_usd: Number(process.env.GODSVIEW_PAPER_STARTING_EQUITY ?? 10_000),
  };
}

// ── Verdict generator (pure function, real values only) ──────────────────────
//
// Every sentence is gated on the underlying section being `ok`. If a value is
// missing the verdict says so explicitly. There is no Math.random anywhere.
function buildVerdict(s: BrainStateResponse): string {
  const out: string[] = [];

  out.push(`Mode: ${s.mode.system_mode}.`);

  // Health
  if (s.health.status === "ok" && s.ready.status === "ok") {
    const ready = s.ready.value as { ready?: boolean; reasons?: string[] } | null;
    if (ready && ready.ready) {
      out.push("System is healthy and ready.");
    } else {
      const reasons = ready?.reasons?.length ? ready.reasons.join(", ") : "no reason given";
      out.push(`System is healthy but not ready (${reasons}).`);
    }
  } else {
    out.push("System health is unknown — health endpoint not reachable.");
  }

  // Broker
  if (s.account.status === "ok") {
    const a = s.account.value as Record<string, unknown> | null;
    const status = String(a?.["status"] ?? "unknown");
    const equity = String(a?.["equity"] ?? "unknown");
    const currency = String(a?.["currency"] ?? "");
    out.push(`Broker ${status} (paper), equity ${equity} ${currency}`.trim() + ".");
  } else {
    out.push("Broker not connected.");
  }

  // Scanner
  if (s.scanner.status.status === "ok") {
    const sc = s.scanner.status.value as Record<string, unknown> | null;
    const running = sc?.["running"] === true ? "running" : "stopped";
    const watchSize = Number(sc?.["watchlistSize"] ?? 0);
    const scanCount = Number(sc?.["scanCount"] ?? 0);
    out.push(`Scanner ${running} (${scanCount} scans, watchlist size ${watchSize}).`);
  } else {
    out.push("Scanner status unknown.");
  }

  // Latest scan history
  if (s.scanner.history.status === "ok") {
    const h = s.scanner.history.value as { history?: Array<Record<string, unknown>>; count?: number } | null;
    const list = Array.isArray(h?.history) ? h!.history! : [];
    if (list.length > 0) {
      const totalSignals = list.reduce((acc, r) => acc + Number(r["signalsFound"] ?? 0), 0);
      const totalBlocked = list.reduce((acc, r) => acc + Number(r["blocked"] ?? 0), 0);
      out.push(`Last ${list.length} scans: ${totalSignals} signals found, ${totalBlocked} setups blocked.`);
    } else {
      out.push("No scan history yet.");
    }
  }

  // Active signals (today)
  if (s.signals.active.status === "ok") {
    const a = s.signals.active.value as Record<string, unknown> | null;
    const today = Number(a?.["signals_today"] ?? 0);
    out.push(today === 0 ? "No valid signal today." : `${today} signal(s) today.`);
  }

  // Rejected signals
  if (s.signals.rejected.status === "ok") {
    const r = s.signals.rejected.value as { count?: number } | null;
    const c = Number(r?.count ?? 0);
    if (c > 0) out.push(`${c} rejected signal(s) on record.`);
  }

  // Paper proof metrics
  if (s.proof.metrics.status === "ok") {
    const m = s.proof.metrics.value as { metrics?: Record<string, unknown> } | null;
    const mm = m?.metrics ?? {};
    const total = Number(mm["total_executed"] ?? 0);
    if (total === 0) {
      out.push("No paper trades have executed yet.");
    } else {
      const wins = Number(mm["total_wins"] ?? 0);
      const losses = Number(mm["total_losses"] ?? 0);
      const winRateRaw = mm["win_rate"];
      const winRate =
        typeof winRateRaw === "number" && Number.isFinite(winRateRaw)
          ? `${(winRateRaw * 100).toFixed(1)}%`
          : "n/a";
      const pnl = Number(mm["total_pnl"] ?? 0);
      out.push(`Paper trades: ${total} executed (${wins}W / ${losses}L), win rate ${winRate}, PnL ${pnl}.`);
    }
  }

  // Integrity
  if (s.proof.integrity.status === "ok") {
    const i = s.proof.integrity.value as { total_violations?: number } | null;
    const v = Number(i?.total_violations ?? 0);
    out.push(v === 0 ? "Trade integrity: clean." : `Trade integrity: ${v} violation(s).`);
  }

  // Reconciliation
  if (s.proof.reconciliation.status === "ok") {
    const r = s.proof.reconciliation.value as
      | { reconciler?: { enabled?: boolean }; data_health?: { enabled?: boolean } }
      | null;
    const recOn = r?.reconciler?.enabled === true;
    const dhOn = r?.data_health?.enabled === true;
    if (recOn && dhOn) out.push("Background jobs running.");
    else if (!recOn && !dhOn) out.push("Background jobs (reconciler, data-health) are not running.");
    else out.push(`Background jobs: reconciler=${recOn ? "on" : "off"}, data-health=${dhOn ? "on" : "off"}.`);
  }

  // Risk defense
  out.push(s.mode.kill_switch_active ? "Kill switch ACTIVE." : "Kill switch off.");

  // M2 pipeline
  if (s.pipeline.status === "ok" && s.pipeline.value) {
    const t = s.pipeline.value.totals;
    if (t.evaluated === 0) {
      out.push(`Milestone 2 pipeline: ${s.pipeline.value.strategy_name} ready, no evaluations yet.`);
    } else {
      out.push(
        `Milestone 2 pipeline (${s.pipeline.value.strategy_name}): ` +
          `${t.evaluated} evaluated, ${t.accepted} accepted, ${t.no_trade} no-trade, ` +
          `${t.executed} executed, ${t.execution_blocked} blocked by risk.`,
      );
    }
  } else {
    out.push("Milestone 2 pipeline: not connected.");
  }

  // MCP
  out.push("MCP layer: not connected yet.");

  return out.join(" ");
}

// ── Response shape ───────────────────────────────────────────────────────────
interface BrainStateResponse {
  generated_at: string;
  mode: ReturnType<typeof readMode>;
  health: Section<unknown>;
  ready: Section<unknown>;
  account: Section<unknown>;
  scanner: {
    status: Section<unknown>;
    history: Section<unknown>;
  };
  proof: {
    trades: Section<unknown>;
    metrics: Section<unknown>;
    equity: Section<unknown>;
    integrity: Section<unknown>;
    reconciliation: Section<unknown>;
  };
  signals: {
    active: Section<unknown>;
    rejected: Section<unknown>;
  };
  risk: {
    summary: Section<unknown>;
  };
  macro: Section<unknown>;
  mcp: {
    status: "not_connected";
    reason: string;
    servers: string[];
  };
  /** Milestone 2 pipeline snapshot. Always present; values may be null when no
   *  evaluation has run yet (cold start). Honest about layers not connected. */
  pipeline: Section<{
    strategy_name: string;
    strategy_version: string;
    last_evaluation_at: string | null;
    totals: {
      evaluated: number;
      accepted: number;
      no_trade: number;
      error: number;
      executed: number;
      execution_blocked: number;
    };
    last_decision: unknown | null;
    last_accepted: unknown | null;
    last_no_trade: unknown | null;
    by_symbol: Record<string, unknown>;
    not_connected_layers: ReadonlyArray<string>;
  }>;
  verdict: string;
}

router.get("/brain-state", async (_req: Request, res: Response): Promise<void> => {
  try {
    // Parallel fan-out — each fetch is independent and degrades on its own.
    const [
      health,
      ready,
      account,
      scannerStatus,
      scannerHistory,
      proofTrades,
      proofMetrics,
      proofEquity,
      proofIntegrity,
      proofReconciliation,
      systemStatus,
      proofRejected,
    ] = await Promise.all([
      fetchJsonSafe<unknown>("/api/health/phase6"),
      fetchJsonSafe<unknown>("/api/ready/phase6"),
      fetchJsonSafe<unknown>("/api/alpaca/account"),
      fetchJsonSafe<unknown>("/api/watchlist/scanner/status"),
      fetchJsonSafe<unknown>("/api/watchlist/scanner/history?limit=10"),
      fetchJsonSafe<unknown>("/api/proof/trades"),
      fetchJsonSafe<unknown>("/api/proof/metrics"),
      fetchJsonSafe<unknown>("/api/proof/equity"),
      fetchJsonSafe<unknown>("/api/proof/integrity"),
      fetchJsonSafe<unknown>("/api/proof/reconciliation/status"),
      fetchJsonSafe<unknown>("/api/system/status"),
      fetchJsonSafe<{ count?: number; trades?: unknown[] }>("/api/proof/trades?status=rejected"),
    ]);

    // ── Active signals (today): derived from system/status, no fabrication ──
    const sysVal = systemStatus.status === "ok" ? (systemStatus.value as Record<string, unknown>) : null;
    const active: Section<unknown> = sysVal
      ? {
          status: "ok",
          value: {
            signals_today: Number.isFinite(Number(sysVal["signals_today"])) ? Number(sysVal["signals_today"]) : null,
            trades_today: Number.isFinite(Number(sysVal["trades_today"])) ? Number(sysVal["trades_today"]) : null,
            active_instrument: sysVal["active_instrument"] ?? null,
            active_session: sysVal["active_session"] ?? null,
            session_allowed: !!sysVal["session_allowed"],
            news_lockout_active: !!sysVal["news_lockout_active"],
          },
        }
      : { status: "not_connected", value: null };

    // ── Rejected signals (recent): derived from /api/proof/trades?status=rejected ─
    const rejected: Section<unknown> =
      proofRejected.status === "ok"
        ? {
            status: "ok",
            value: {
              count: Number((proofRejected.value as { count?: number } | null)?.count ?? 0),
              recent: Array.isArray((proofRejected.value as { trades?: unknown[] } | null)?.trades)
                ? ((proofRejected.value as { trades: unknown[] }).trades.slice(0, 5))
                : [],
            },
          }
        : proofRejected;

    // ── Risk summary: derived from system/status layers + env ──
    const risk: Section<unknown> = sysVal
      ? {
          status: "ok",
          value: {
            kill_switch: String(process.env.GODSVIEW_KILL_SWITCH ?? "false").toLowerCase() === "true",
            news_lockout: !!sysVal["news_lockout_active"],
            session_allowed: !!sysVal["session_allowed"],
            active_session: sysVal["active_session"] ?? null,
            equity: Number.isFinite(Number(sysVal["equity"])) ? Number(sysVal["equity"]) : null,
            buying_power: Number.isFinite(Number(sysVal["buying_power"])) ? Number(sysVal["buying_power"]) : null,
            unrealized_pnl: Number.isFinite(Number(sysVal["unrealized_pnl"])) ? Number(sysVal["unrealized_pnl"]) : null,
            live_positions: Number.isFinite(Number(sysVal["live_positions"])) ? Number(sysVal["live_positions"]) : null,
            layers: Array.isArray(sysVal["layers"]) ? sysVal["layers"] : [],
          },
        }
      : { status: "not_connected", value: null };

    // ── Macro/news layer extracted from system/status if present ──
    const layers = (sysVal?.["layers"] as Array<Record<string, unknown>> | undefined) ?? [];
    const macroLayer = layers.find((l) =>
      /macro|news|claude|reasoning/i.test(String(l["name"] ?? "")),
    );
    const macro: Section<unknown> = macroLayer
      ? {
          status: "ok",
          value: {
            name: macroLayer["name"] ?? null,
            status: macroLayer["status"] ?? null,
            message: macroLayer["message"] ?? null,
            last_update: macroLayer["last_update"] ?? null,
          },
        }
      : { status: "not_connected", value: null, reason: "no_macro_layer_in_system_status" };

    const out: BrainStateResponse = {
      generated_at: new Date().toISOString(),
      mode: readMode(),
      health,
      ready,
      account,
      scanner: { status: scannerStatus, history: scannerHistory },
      proof: {
        trades: proofTrades,
        metrics: proofMetrics,
        equity: proofEquity,
        integrity: proofIntegrity,
        reconciliation: proofReconciliation,
      },
      signals: { active, rejected },
      risk: { summary: risk },
      macro,
      pipeline: {
        status: "ok",
        value: {
          strategy_name: M2_STRATEGY_NAME,
          strategy_version: M2_STRATEGY_VERSION,
          last_evaluation_at: null,
          totals: { evaluated: 0, accepted: 0, no_trade: 0, error: 0, executed: 0, execution_blocked: 0 },
          last_decision: null,
          last_accepted: null,
          last_no_trade: null,
          by_symbol: {},
          not_connected_layers: M2_NOT_CONNECTED_LAYERS,
        },
      },
      mcp: {
        status: "not_connected",
        reason:
          "MCP servers exist as scaffolds in mcp-servers/* but have no transport wired (no Server.connect / StdioServerTransport).",
        servers: ["tradingview", "bloomberg", "news-monitor"],
      },
      verdict: "",
    };
    // Read the live snapshot AFTER initial wiring so verdict text can also
    // use it. Failures here are non-fatal — pipeline section degrades to
    // status:"not_connected" with no fabricated values.
    try {
      const snap = getM2Snapshot();
      out.pipeline = {
        status: "ok",
        value: {
          strategy_name: snap.strategy_name,
          strategy_version: snap.strategy_version,
          last_evaluation_at: snap.last_evaluation_at,
          totals: snap.totals,
          last_decision: snap.last_decision,
          last_accepted: snap.last_accepted,
          last_no_trade: snap.last_no_trade,
          by_symbol: snap.by_symbol,
          not_connected_layers: M2_NOT_CONNECTED_LAYERS,
        },
      };
    } catch (snapErr) {
      const reason = snapErr instanceof Error ? snapErr.message : String(snapErr);
      logger.warn({ err: reason }, "[brain-state] m2 snapshot read failed");
      out.pipeline = { status: "not_connected", value: null, reason };
    }
    out.verdict = buildVerdict(out);
    res.json(out);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ err: reason }, "[brain-state] aggregation failed");
    res.status(503).json({ error: "brain_state_unavailable", message: reason });
  }
});

export default router;
