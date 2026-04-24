import { Router, type IRouter } from "express";
import { auditEventsTable, db, siDecisionsTable, signalsTable, tradesTable } from "@workspace/db";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

const router: IRouter = Router();

function parsePositiveInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function safeJsonParse(input: string | null): Record<string, unknown> | null {
  if (!input) return null;
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function parseDbNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toMs(dateLike: Date | string | null | undefined): number {
  if (!dateLike) return 0;
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q)));
  return sorted[pos];
}

async function buildDecisionReplay(tradeId: number) {
  const tradeRows = await db
    .select()
    .from(tradesTable)
    .where(eq(tradesTable.id, tradeId))
    .limit(1);

  if (tradeRows.length === 0) {
    return null;
  }

  const trade = tradeRows[0];
  const symbol = String(trade.instrument ?? "").toUpperCase();
  const setupType = String(trade.setup_type ?? "").toLowerCase();

  const tradeCreatedAt = trade.created_at ?? trade.entry_time ?? new Date();
  const windowStart = new Date(toMs(tradeCreatedAt) - 12 * 60 * 60 * 1000);
  const windowEnd = new Date((toMs(trade.exit_time ?? trade.created_at ?? new Date()) || Date.now()) + 12 * 60 * 60 * 1000);

  const signalRow = trade.signal_id
    ? await db
        .select()
        .from(signalsTable)
        .where(eq(signalsTable.id, trade.signal_id))
        .limit(1)
    : [];

  const decisionRows = await db
    .select({
      id: siDecisionsTable.id,
      symbol: siDecisionsTable.symbol,
      setup_type: siDecisionsTable.setup_type,
      direction: siDecisionsTable.direction,
      regime: siDecisionsTable.regime,
      approved: siDecisionsTable.approved,
      win_probability: siDecisionsTable.win_probability,
      final_quality: siDecisionsTable.final_quality,
      edge_score: siDecisionsTable.edge_score,
      confluence_score: siDecisionsTable.confluence_score,
      kelly_fraction: siDecisionsTable.kelly_fraction,
      gate_action: siDecisionsTable.gate_action,
      gate_block_reasons: siDecisionsTable.gate_block_reasons,
      rejection_reason: siDecisionsTable.rejection_reason,
      created_at: siDecisionsTable.created_at,
    })
    .from(siDecisionsTable)
    .where(
      and(
        eq(siDecisionsTable.symbol, symbol),
        lte(siDecisionsTable.created_at, windowEnd),
        gte(siDecisionsTable.created_at, windowStart),
      ),
    )
    .orderBy(desc(siDecisionsTable.created_at))
    .limit(40);

  const linkedDecision = decisionRows.find((row: {
    setup_type: string | null;
  }) =>
    String(row.setup_type ?? "").toLowerCase() === setupType,
  ) ?? decisionRows[0] ?? null;

  const auditRows = await db
    .select({
      id: auditEventsTable.id,
      event_type: auditEventsTable.event_type,
      decision_state: auditEventsTable.decision_state,
      reason: auditEventsTable.reason,
      payload_json: auditEventsTable.payload_json,
      created_at: auditEventsTable.created_at,
      actor: auditEventsTable.actor,
    })
    .from(auditEventsTable)
    .where(
      and(
        eq(auditEventsTable.symbol, symbol),
        gte(auditEventsTable.created_at, windowStart),
        lte(auditEventsTable.created_at, windowEnd),
      ),
    )
    .orderBy(asc(auditEventsTable.created_at))
    .limit(500);

  const timeline = [] as Array<{
    stage: string;
    at: string;
    latency_ms_from_prev: number | null;
    source: string;
    details: Record<string, unknown>;
  }>;

  const signal = signalRow[0] ?? null;
  if (signal?.created_at) {
    timeline.push({
      stage: "signal_generated",
      at: signal.created_at.toISOString(),
      latency_ms_from_prev: null,
      source: "signals",
      details: {
        setup_type: signal.setup_type,
        status: signal.status,
        final_quality: parseDbNum(signal.final_quality),
        regime: signal.regime,
      },
    });
  }

  if (linkedDecision?.created_at) {
    const prevMs = timeline.length > 0 ? toMs(timeline[timeline.length - 1].at) : 0;
    const nowMs = toMs(linkedDecision.created_at);
    timeline.push({
      stage: linkedDecision.approved ? "si_approved" : "si_rejected",
      at: new Date(linkedDecision.created_at).toISOString(),
      latency_ms_from_prev: prevMs > 0 ? Math.max(0, nowMs - prevMs) : null,
      source: "si_decisions",
      details: {
        setup_type: linkedDecision.setup_type,
        regime: linkedDecision.regime,
        direction: linkedDecision.direction,
        win_probability: parseDbNum(linkedDecision.win_probability),
        final_quality: parseDbNum(linkedDecision.final_quality),
        edge_score: parseDbNum(linkedDecision.edge_score),
        confluence_score: parseDbNum(linkedDecision.confluence_score),
        kelly_fraction: parseDbNum(linkedDecision.kelly_fraction),
        gate_action: linkedDecision.gate_action,
        gate_block_reasons: linkedDecision.gate_block_reasons,
        rejection_reason: linkedDecision.rejection_reason,
      },
    });
  }

  for (const event of auditRows) {
    const eventType = String(event.event_type ?? "").toLowerCase();
    if (
      eventType !== "execution_request_received" &&
      eventType !== "execution_idempotency" &&
      eventType !== "execution_gate_blocked" &&
      eventType !== "execution_result" &&
      eventType !== "trade_executed" &&
      eventType !== "trade_closed"
    ) {
      continue;
    }

    const prevMs = timeline.length > 0 ? toMs(timeline[timeline.length - 1].at) : 0;
    const nowMs = toMs(event.created_at);

    timeline.push({
      stage: eventType,
      at: new Date(event.created_at ?? new Date()).toISOString(),
      latency_ms_from_prev: prevMs > 0 ? Math.max(0, nowMs - prevMs) : null,
      source: "audit_events",
      details: {
        decision_state: event.decision_state,
        reason: event.reason,
        actor: event.actor,
        payload: safeJsonParse(event.payload_json),
      },
    });
  }

  if (trade.created_at) {
    const prevMs = timeline.length > 0 ? toMs(timeline[timeline.length - 1].at) : 0;
    const nowMs = toMs(trade.created_at);
    timeline.push({
      stage: "trade_opened",
      at: trade.created_at.toISOString(),
      latency_ms_from_prev: prevMs > 0 ? Math.max(0, nowMs - prevMs) : null,
      source: "trades",
      details: {
        direction: trade.direction,
        entry_price: parseDbNum(trade.entry_price),
        stop_loss: parseDbNum(trade.stop_loss),
        take_profit: parseDbNum(trade.take_profit),
        quantity: parseDbNum(trade.quantity),
        outcome: trade.outcome,
      },
    });
  }

  if (trade.exit_time) {
    const prevMs = timeline.length > 0 ? toMs(timeline[timeline.length - 1].at) : 0;
    const nowMs = toMs(trade.exit_time);
    timeline.push({
      stage: "trade_closed",
      at: trade.exit_time.toISOString(),
      latency_ms_from_prev: prevMs > 0 ? Math.max(0, nowMs - prevMs) : null,
      source: "trades",
      details: {
        exit_price: parseDbNum(trade.exit_price),
        pnl: parseDbNum(trade.pnl),
        pnl_pct: parseDbNum(trade.pnl_pct),
        outcome: trade.outcome,
      },
    });
  }

  timeline.sort((a, b) => toMs(a.at) - toMs(b.at));

  return {
    trade: {
      id: trade.id,
      symbol,
      setup_type: trade.setup_type,
      direction: trade.direction,
      entry_price: parseDbNum(trade.entry_price),
      exit_price: parseDbNum(trade.exit_price),
      stop_loss: parseDbNum(trade.stop_loss),
      take_profit: parseDbNum(trade.take_profit),
      quantity: parseDbNum(trade.quantity),
      pnl: parseDbNum(trade.pnl),
      pnl_pct: parseDbNum(trade.pnl_pct),
      outcome: trade.outcome,
      created_at: trade.created_at?.toISOString() ?? null,
      exit_time: trade.exit_time?.toISOString() ?? null,
      regime: trade.regime,
    },
    signal: signal
      ? {
          id: signal.id,
          status: signal.status,
          final_quality: parseDbNum(signal.final_quality),
          structure_score: parseDbNum(signal.structure_score),
          order_flow_score: parseDbNum(signal.order_flow_score),
          recall_score: parseDbNum(signal.recall_score),
          ml_probability: parseDbNum(signal.ml_probability),
          claude_score: parseDbNum(signal.claude_score),
          created_at: signal.created_at?.toISOString() ?? null,
        }
      : null,
    decision: linkedDecision
      ? {
          id: linkedDecision.id,
          approved: linkedDecision.approved,
          setup_type: linkedDecision.setup_type,
          direction: linkedDecision.direction,
          regime: linkedDecision.regime,
          win_probability: parseDbNum(linkedDecision.win_probability),
          final_quality: parseDbNum(linkedDecision.final_quality),
          edge_score: parseDbNum(linkedDecision.edge_score),
          confluence_score: parseDbNum(linkedDecision.confluence_score),
          kelly_fraction: parseDbNum(linkedDecision.kelly_fraction),
          gate_action: linkedDecision.gate_action,
          gate_block_reasons: linkedDecision.gate_block_reasons,
          rejection_reason: linkedDecision.rejection_reason,
          created_at: linkedDecision.created_at?.toISOString() ?? null,
        }
      : null,
    timeline,
  };
}

router.get("/decision-replay/:tradeId", async (req, res) => {
  try {
    const tradeId = parsePositiveInt(req.params.tradeId, 0, 1, 2_000_000_000);
    const replay = await buildDecisionReplay(tradeId);
    if (!replay) {
      res.status(404).json({ error: "not_found", message: "Trade not found" });
      return;
    }
    res.json(replay);
  } catch (err) {
    req.log.error({ err }, "Failed to load decision replay");
    res.status(503).json({ error: "decision_replay_failed", message: "Failed to load replay" });
  }
});

router.get("/decision-replay/:tradeId/timeline", async (req, res) => {
  try {
    const tradeId = parsePositiveInt(req.params.tradeId, 0, 1, 2_000_000_000);
    const replay = await buildDecisionReplay(tradeId);
    if (!replay) {
      res.status(404).json({ error: "not_found", message: "Trade not found" });
      return;
    }
    res.json({
      trade_id: replay.trade.id,
      symbol: replay.trade.symbol,
      timeline: replay.timeline,
      count: replay.timeline.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load decision replay timeline");
    res.status(503).json({ error: "decision_replay_timeline_failed", message: "Failed to load timeline" });
  }
});

router.get("/decision-replay/block-reasons", async (req, res) => {
  try {
    const hours = parsePositiveInt(req.query.hours, 24, 1, 24 * 30);
    const limit = parsePositiveInt(req.query.limit, 500, 10, 5_000);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const rows = await db
      .select({
        id: auditEventsTable.id,
        symbol: auditEventsTable.symbol,
        event_type: auditEventsTable.event_type,
        reason: auditEventsTable.reason,
        created_at: auditEventsTable.created_at,
      })
      .from(auditEventsTable)
      .where(
        and(
          gte(auditEventsTable.created_at, since),
          inArray(auditEventsTable.event_type, ["signal_rejected", "execution_gate_blocked"]),
        ),
      )
      .orderBy(desc(auditEventsTable.created_at))
      .limit(limit);

    const grouped = new Map<string, { count: number; latest_at: string; symbols: Set<string> }>();

    for (const row of rows) {
      const reason = String(row.reason ?? "unknown").trim() || "unknown";
      const key = `${row.event_type}:${reason}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.count += 1;
        if (row.symbol) existing.symbols.add(String(row.symbol).toUpperCase());
        const rowTs = toMs(row.created_at);
        const prevTs = toMs(existing.latest_at);
        if (rowTs > prevTs) {
          existing.latest_at = new Date(row.created_at ?? new Date()).toISOString();
        }
      } else {
        grouped.set(key, {
          count: 1,
          latest_at: new Date(row.created_at ?? new Date()).toISOString(),
          symbols: new Set(row.symbol ? [String(row.symbol).toUpperCase()] : []),
        });
      }
    }

    const block_reasons = Array.from(grouped.entries())
      .map(([key, value]) => {
        const [event_type, ...reasonParts] = key.split(":");
        return {
          event_type,
          reason: reasonParts.join(":") || "unknown",
          count: value.count,
          latest_at: value.latest_at,
          symbols: Array.from(value.symbols).slice(0, 20),
        };
      })
      .sort((a, b) => b.count - a.count);

    res.json({
      hours,
      count: block_reasons.length,
      block_reasons,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load block reason analytics");
    res.status(503).json({ error: "block_reason_analytics_failed", message: "Failed to load block reasons" });
  }
});

router.get("/decision-replay/latency", async (req, res) => {
  try {
    const hours = parsePositiveInt(req.query.hours, 24, 1, 24 * 30);
    const limit = parsePositiveInt(req.query.limit, 2_000, 100, 10_000);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const rows = await db
      .select({
        id: auditEventsTable.id,
        symbol: auditEventsTable.symbol,
        event_type: auditEventsTable.event_type,
        created_at: auditEventsTable.created_at,
      })
      .from(auditEventsTable)
      .where(
        and(
          gte(auditEventsTable.created_at, since),
          inArray(auditEventsTable.event_type, ["execution_request_received", "execution_result"]),
        ),
      )
      .orderBy(asc(auditEventsTable.created_at))
      .limit(limit);

    const pendingBySymbol = new Map<string, Date[]>();
    const durations: number[] = [];

    for (const row of rows) {
      const symbol = String(row.symbol ?? "").toUpperCase() || "UNKNOWN";
      const eventType = String(row.event_type ?? "").toLowerCase();
      const timestamp = row.created_at ?? new Date();

      if (eventType === "execution_request_received") {
        const queue = pendingBySymbol.get(symbol) ?? [];
        queue.push(timestamp);
        pendingBySymbol.set(symbol, queue);
        continue;
      }

      if (eventType === "execution_result") {
        const queue = pendingBySymbol.get(symbol);
        if (!queue || queue.length === 0) continue;
        const start = queue.shift() as Date;
        const duration = Math.max(0, toMs(timestamp) - toMs(start));
        if (duration <= 5 * 60 * 1000) {
          durations.push(duration);
        }
      }
    }

    durations.sort((a, b) => a - b);
    const by_bucket = {
      under_1s: durations.filter((d) => d < 1_000).length,
      s1_to_3: durations.filter((d) => d >= 1_000 && d < 3_000).length,
      s3_to_10: durations.filter((d) => d >= 3_000 && d < 10_000).length,
      over_10s: durations.filter((d) => d >= 10_000).length,
    };

    res.json({
      hours,
      pairs: durations.length,
      latency_ms: {
        min: durations.length > 0 ? durations[0] : 0,
        p50: quantile(durations, 0.5),
        p95: quantile(durations, 0.95),
        p99: quantile(durations, 0.99),
        max: durations.length > 0 ? durations[durations.length - 1] : 0,
        avg: durations.length > 0 ? Number((durations.reduce((sum, d) => sum + d, 0) / durations.length).toFixed(2)) : 0,
      },
      by_bucket,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load latency analytics");
    res.status(503).json({ error: "latency_analytics_failed", message: "Failed to load latency analytics" });
  }
});

router.get("/decision-replay/health", async (_req, res) => {
  const [tradesAgg, auditAgg] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(tradesTable),
    db
      .select({ count: sql<number>`count(*)` })
      .from(auditEventsTable)
      .where(inArray(auditEventsTable.event_type, ["execution_request_received", "execution_result"])),
  ]);

  res.json({
    ok: true,
    trades_indexed: Number(tradesAgg[0]?.count ?? 0),
    execution_events: Number(auditAgg[0]?.count ?? 0),
    generated_at: new Date().toISOString(),
  });
});

export default router;
