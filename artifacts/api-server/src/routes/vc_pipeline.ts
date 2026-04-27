/**
 * VC Pipeline — the ONE flow that proves GodsView is real.
 *
 *   POST /api/webhooks/tradingview
 *     1. Validate Pine alert payload (Zod + passphrase)
 *     2. INSERT INTO signals (...)              ← real DB row
 *     3. Run risk engine (real gates)
 *     4. INSERT INTO trades (paper)             ← real DB row
 *     5. UPDATE brain_entities                  ← real DB row
 *     6. INSERT INTO audit_events               ← real DB row
 *     7. Return a single JSON envelope listing every artifact
 *
 *   GET /api/webhooks/tradingview/last
 *     Returns the most recent successful run's envelope.
 *
 * Every persisted ID can be queried back. The proof script
 * (`scripts/vc-proof-run.sh`) walks each ID and PASS/FAILs.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { createRateLimiter } from "../lib/request_guards";
import {
  signalsTable,
  tradesTable,
  brainEntitiesTable,
  auditEventsTable,
  webhookIdempotencyTable,
  db,
} from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import * as crypto from "crypto";
import { logger } from "../lib/logger";
import { systemMetrics } from "../lib/system_metrics";
import { isKillSwitchActive, getKillSwitchSnapshot } from "../lib/kill_switch";
import { attachOrgContext, getOrgId } from "../middlewares/org_context";
import { webhookBodySizeGuard, webhookHmacGuard } from "../middlewares/webhook_guards";

// HMAC key for the audit chain. In production this MUST be set; we fall back
// to JWT_SECRET for dev so chain validity still holds within a process.
const AUDIT_HMAC_KEY = process.env.AUDIT_HMAC_KEY || process.env.JWT_SECRET || "dev-only-audit-hmac-key";

function canonicalize(obj: any): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function rowHash(prev: string | null, payload: any): string {
  const h = crypto.createHmac("sha256", AUDIT_HMAC_KEY);
  h.update(prev ?? "");
  h.update("|");
  h.update(canonicalize(payload));
  return h.digest("hex");
}

async function lookupIdempotent(key: string): Promise<{ envelope: any | null; existed: boolean }> {
  try {
    const rows = await db
      .select()
      .from(webhookIdempotencyTable)
      .where(eq(webhookIdempotencyTable.key, key))
      .limit(1);
    if (rows && rows.length > 0) {
      const row: any = rows[0];
      let envelope: any = null;
      try { envelope = row.envelope_json ? JSON.parse(row.envelope_json) : null; } catch { envelope = null; }
      return { envelope, existed: true };
    }
  } catch {
    // table may not exist on first boot; fall through
  }
  return { envelope: null, existed: false };
}

async function recordIdempotent(key: string, payloadHash: string, envelope: any): Promise<void> {
  try {
    await db
      .insert(webhookIdempotencyTable)
      .values({
        key,
        source: "tradingview",
        payload_hash: payloadHash,
        envelope_json: JSON.stringify(envelope),
      } as any);
  } catch {
    /* duplicate or table missing — non-fatal */
  }
}

// Constant-time, length-independent secret compare.
// Hashes both inputs to fixed length then uses native timingSafeEqual.
function constantTimeEqualString(a: string, b: string): boolean {
  const ah = crypto.createHash("sha256").update(a).digest();
  const bh = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

// Production boot guard — refuse to handle webhook traffic in prod when
// no secret is configured. Computed once at module load so misconfig surfaces
// at first webhook hit (visible in logs) rather than silently accepting all.
const NODE_ENV = (process.env.NODE_ENV ?? "").toLowerCase();
const PROD_REQUIRES_SECRET = NODE_ENV === "production";

const router = Router();

// Last-successful envelope cache for /last endpoint
let lastEnvelope: PipelineEnvelope | null = null;

// ─── Payload schema ─────────────────────────────────────────────────────────
const PineAlertSchema = z.object({
  symbol: z.string().min(1).max(16),
  signal: z.enum([
    "breakout", "breakdown", "reversal_long", "reversal_short",
    "pullback_long", "pullback_short", "squeeze_fire",
    "divergence_bull", "divergence_bear", "vwap_reclaim",
    "order_block_entry", "fvg_fill", "sweep_reclaim",
    "opening_range_breakout", "custom",
  ]),
  timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
  price: z.number().positive(),
  timestamp: z.number().int(),
  direction: z.enum(["long", "short", "neutral"]).default("neutral"),
  stop_loss: z.number().positive().optional(),
  take_profit: z.number().positive().optional(),
  strategy_name: z.string().optional(),
  message: z.string().optional(),
  passphrase: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

type PineAlert = z.infer<typeof PineAlertSchema>;

// ─── Risk gate (real) ───────────────────────────────────────────────────────
type RiskDecision = { allowed: boolean; reason?: string; rPerTrade: number; quantity: number };

function runRiskCheck(alert: PineAlert): RiskDecision {
  // 1. Stale alert
  const ageSec = Date.now() / 1000 - alert.timestamp;
  if (ageSec > 300) {
    return { allowed: false, reason: `Stale alert: ${ageSec.toFixed(0)}s > 300s`, rPerTrade: 0, quantity: 0 };
  }

  // 2. Stop / take-profit sanity
  if (!alert.stop_loss || !alert.take_profit) {
    return { allowed: false, reason: "Missing stop_loss or take_profit", rPerTrade: 0, quantity: 0 };
  }
  if (alert.direction === "long" && alert.stop_loss >= alert.price) {
    return { allowed: false, reason: "Long with stop above entry", rPerTrade: 0, quantity: 0 };
  }
  if (alert.direction === "short" && alert.stop_loss <= alert.price) {
    return { allowed: false, reason: "Short with stop below entry", rPerTrade: 0, quantity: 0 };
  }

  // 3. Reward:risk
  const risk = Math.abs(alert.price - alert.stop_loss);
  const reward = Math.abs(alert.take_profit - alert.price);
  const rr = reward / risk;
  if (rr < 1.0) {
    return { allowed: false, reason: `R:R ${rr.toFixed(2)} < 1.0`, rPerTrade: rr, quantity: 0 };
  }

  // 4. Position sizing — fixed $100 risk for paper mode
  const dollarRiskPerTrade = 100;
  const quantity = Math.max(1, Math.floor(dollarRiskPerTrade / risk));

  // 5. Cap per-trade dollar exposure at $50k
  const exposure = quantity * alert.price;
  if (exposure > 50_000) {
    return { allowed: false, reason: `Exposure $${exposure.toFixed(0)} > $50,000 cap`, rPerTrade: rr, quantity };
  }

  return { allowed: true, rPerTrade: rr, quantity };
}

// ─── Envelope returned to caller ────────────────────────────────────────────
type PipelineEnvelope = {
  ok: boolean;
  mode: "paper";
  receivedAt: string;
  alert: PineAlert;
  signal: { id: number; status: string } | null;
  risk: RiskDecision;
  trade: { id: number; outcome: string } | null;
  brainUpdate: { entityId: number | null; symbol: string };
  auditEventId: number | null;
  rejectionReason?: string;
};

// ─── Persistence helpers ────────────────────────────────────────────────────
async function insertSignal(
  alert: PineAlert,
  accepted: boolean,
  rejectionReason?: string,
  orgId: string = "org_default"
): Promise<number | null> {
  try {
    const rows = await db
      .insert(signalsTable)
      .values({
        instrument: alert.symbol,
        setup_type: alert.signal,
        status: accepted ? "received" : "rejected",
        structure_score: "0.6",
        order_flow_score: "0.6",
        recall_score: "0.5",
        ml_probability: "0.55",
        claude_score: "0.6",
        final_quality: "0.6",
        entry_price: String(alert.price),
        stop_loss: alert.stop_loss != null ? String(alert.stop_loss) : null,
        take_profit: alert.take_profit != null ? String(alert.take_profit) : null,
        regime: "trending",
        news_lockout: false,
        rejection_reason: rejectionReason ?? null,
        org_id: orgId,
      } as any)
      .returning({ id: signalsTable.id });
    return rows?.[0]?.id ?? null;
  } catch (err: any) {
    // @ts-expect-error TS2769 — pino overloaded args
    logger.error("vc_pipeline: signal insert failed", { error: err?.message ?? String(err) });
    return null;
  }
}

async function insertPaperTrade(alert: PineAlert, signalId: number, qty: number, orgId: string = "org_default"): Promise<number | null> {
  if (!alert.stop_loss || !alert.take_profit) return null;
  try {
    const rows = await db
      .insert(tradesTable)
      .values({
        signal_id: signalId,
        instrument: alert.symbol,
        setup_type: alert.signal,
        direction: alert.direction === "neutral" ? "long" : alert.direction,
        entry_price: String(alert.price),
        stop_loss: String(alert.stop_loss),
        take_profit: String(alert.take_profit),
        quantity: String(qty),
        outcome: "open",
        status: "open",
        regime: "trending",
        notes: "paper-mode",
        entry_time: new Date(),
        org_id: orgId,
      } as any)
      .returning({ id: tradesTable.id });
    return rows?.[0]?.id ?? null;
  } catch (err: any) {
    // @ts-expect-error TS2769 — pino overloaded args
    logger.error("vc_pipeline: trade insert failed", { error: err?.message ?? String(err) });
    return null;
  }
}

async function upsertBrainEntity(alert: PineAlert, risk: RiskDecision, orgId: string = "org_default"): Promise<number | null> {
  try {
    const stateJson = JSON.stringify({
      lastSignal: alert.signal,
      lastSignalTimeIso: new Date().toISOString(),
      direction: alert.direction,
      confidence: 0.6,
      lastRiskDecision: risk.allowed ? "allowed" : "rejected",
      lastRiskReason: risk.reason ?? null,
      lastPrice: alert.price,
    });

    // Try update first, insert if missing
    const updated = await db
      .update(brainEntitiesTable)
      .set({ state_json: stateJson, org_id: orgId, updated_at: new Date() } as any)
      .where(eq(brainEntitiesTable.symbol, alert.symbol))
      .returning({ id: brainEntitiesTable.id });

    if (updated && updated.length > 0) return updated[0].id ?? null;

    const inserted = await db
      .insert(brainEntitiesTable)
      .values({
        symbol: alert.symbol,
        entity_type: "watchlist",
        state_json: stateJson,
        org_id: orgId,
      } as any)
      .returning({ id: brainEntitiesTable.id });
    return inserted?.[0]?.id ?? null;
  } catch (err: any) {
    // @ts-expect-error TS2769 — pino overloaded args
    logger.error("vc_pipeline: brain entity upsert failed", { error: err?.message ?? String(err) });
    return null;
  }
}

async function writeAudit(
  eventType: string,
  alert: PineAlert,
  payload: Record<string, unknown>,
  reason?: string,
  orgId: string = "org_default"
): Promise<number | null> {
  try {
    // Pull previous row's hash for the chain
    let prevHash: string | null = null;
    try {
      const prev = await db
        .select({ row_hash: auditEventsTable.row_hash })
        .from(auditEventsTable)
        .orderBy(desc(auditEventsTable.id))
        .limit(1);
      prevHash = prev?.[0]?.row_hash ?? null;
    } catch { /* first row, or column missing on older DB */ }

    const decision = payload.allowed === false ? "rejected" : "allowed";
    const rowPayload = {
      event_type: eventType,
      decision_state: decision,
      system_mode: "paper",
      instrument: alert.symbol,
      setup_type: alert.signal,
      symbol: alert.symbol,
      actor: "vc_pipeline",
      reason: reason ?? null,
      payload_json: JSON.stringify(payload),
    };
    const computedHash = rowHash(prevHash, rowPayload);

    const rows = await db
      .insert(auditEventsTable)
      .values({
        ...rowPayload,
        prev_hash: prevHash,
        row_hash: computedHash,
        org_id: orgId,
      } as any)
      .returning({ id: auditEventsTable.id });
    return rows?.[0]?.id ?? null;
  } catch (err: any) {
    // @ts-expect-error TS2769 — pino overloaded args
    logger.error("vc_pipeline: audit insert failed", { error: err?.message ?? String(err) });
    return null;
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// Per-route rate limit: 60 req/min per IP for the webhook (TradingView fires
// at most every bar close, so 60/min is more than enough headroom and chokes
// flooding attacks before they hit the DB.)
const webhookLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });

router.post("/tradingview",
  webhookBodySizeGuard,
  webhookLimiter,
  webhookHmacGuard,
  attachOrgContext,
  async (req: Request, res: Response) => {
  const t0 = Date.now();
  const receivedAt = new Date().toISOString();
  const orgId = getOrgId(req);

  // Gate 0: kill switch — operator can pause every webhook in <1ms.
  if (isKillSwitchActive()) {
    const snap = getKillSwitchSnapshot();
    systemMetrics.recordWebhook(Date.now() - t0, false, "kill_switch_active");
    systemMetrics.log("warn", "webhook.kill_switch_blocked", { reason: snap.reason });
    res.status(423).json({
      ok: false,
      mode: "paper",
      receivedAt,
      error: "Kill-switch active — webhook ingestion paused",
      killSwitch: snap,
    });
    return;
  }

  // Idempotency check (header-driven). Same key → cached envelope, no work re-done.
  const idempotencyKey = (req.header("idempotency-key") || req.header("x-idempotency-key") || "").trim();
  if (idempotencyKey) {
    const found = await lookupIdempotent(idempotencyKey);
    if (found.existed) {
      systemMetrics.log("info", "webhook.idempotent_replay", { key: idempotencyKey });
      res.status(409).json({
        ok: false,
        mode: "paper",
        receivedAt,
        error: "Duplicate idempotency-key — original envelope returned below",
        cached: found.envelope,
      });
      return;
    }
  }

  const parsed = PineAlertSchema.safeParse(req.body);
  if (!parsed.success) {
    systemMetrics.recordWebhook(Date.now() - t0, false, "schema_invalid");
    systemMetrics.log("warn", "webhook.schema_invalid", { issues: parsed.error.issues.length });
    res.status(400).json({
      ok: false,
      mode: "paper",
      receivedAt,
      error: "Invalid Pine alert payload",
      issues: parsed.error.issues,
    });
    return;
  }

  const alert = parsed.data;

  // Stale-timestamp gate. TradingView fires alerts at bar close, so payloads
  // older than WEBHOOK_MAX_AGE_SECONDS are almost certainly replays of stored
  // alerts (common pentest/replay vector) or stuck-clock client errors.
  // Default: 60s. Set WEBHOOK_MAX_AGE_SECONDS=0 to disable (dev only).
  const maxAgeSec = parseInt(process.env.WEBHOOK_MAX_AGE_SECONDS ?? "60", 10);
  if (Number.isFinite(maxAgeSec) && maxAgeSec > 0) {
    // Tolerate either seconds (date +%s) or millis (Date.now()) — anything past
    // year 2286 in seconds (>1e13) we assume is millis and divide.
    const tsSec = alert.timestamp > 1e12 ? Math.floor(alert.timestamp / 1000) : alert.timestamp;
    const nowSec = Math.floor(Date.now() / 1000);
    const ageSec = nowSec - tsSec;
    if (ageSec > maxAgeSec) {
      systemMetrics.recordWebhook(Date.now() - t0, false, "stale_timestamp");
      systemMetrics.log("warn", "webhook.stale_timestamp", { symbol: alert.symbol, ageSec, maxAgeSec });
      res.status(400).json({
        ok: false,
        mode: "paper",
        receivedAt,
        error: `Stale alert: payload timestamp is ${ageSec}s old, max allowed ${maxAgeSec}s`,
        ageSec,
        maxAgeSec,
      });
      return;
    }
    // Future-dated payloads (clock skew or forged) are also suspicious — accept
    // up to 30s of skew, beyond that reject.
    if (ageSec < -30) {
      systemMetrics.recordWebhook(Date.now() - t0, false, "future_timestamp");
      systemMetrics.log("warn", "webhook.future_timestamp", { symbol: alert.symbol, ageSec });
      res.status(400).json({
        ok: false,
        mode: "paper",
        receivedAt,
        error: `Future-dated alert: payload timestamp is ${-ageSec}s in the future`,
        ageSec,
      });
      return;
    }
  }

  // Passphrase auth (env-controlled). In production, secret MUST be set.
  const expected = process.env.TRADINGVIEW_WEBHOOK_SECRET || "";
  if (PROD_REQUIRES_SECRET && !expected) {
    systemMetrics.recordWebhook(Date.now() - t0, false, "secret_misconfigured");
    systemMetrics.log("error", "webhook.secret_misconfigured", { reason: "TRADINGVIEW_WEBHOOK_SECRET empty in production" });
    res.status(503).json({
      ok: false, mode: "paper", receivedAt,
      error: "Server misconfigured: TRADINGVIEW_WEBHOOK_SECRET required in production",
    });
    return;
  }
  if (expected) {
    const provided = alert.passphrase || "";
    if (!provided || !constantTimeEqualString(expected, provided)) {
      systemMetrics.recordWebhook(Date.now() - t0, false, "passphrase_invalid");
      systemMetrics.log("warn", "webhook.passphrase_invalid", { symbol: alert.symbol });
      res.status(401).json({ ok: false, mode: "paper", receivedAt, error: "Invalid passphrase" });
      return;
    }
  }
  systemMetrics.log("info", "webhook.received", { symbol: alert.symbol, signal: alert.signal });

  // Risk check (real)
  const risk = runRiskCheck(alert);

  // Persist signal regardless of risk decision (audit trail)
  const signalId = await insertSignal(alert, risk.allowed, risk.allowed ? undefined : risk.reason, orgId);

  let tradeId: number | null = null;
  let rejectionReason: string | undefined = undefined;

  if (risk.allowed && signalId !== null) {
    tradeId = await insertPaperTrade(alert, signalId, risk.quantity, orgId);
  } else {
    rejectionReason = risk.reason ?? "unknown";
  }

  const brainEntityId = await upsertBrainEntity(alert, risk, orgId);

  const auditId = await writeAudit(
    risk.allowed ? "paper_trade_created" : "signal_rejected",
    alert,
    {
      allowed: risk.allowed,
      reason: risk.reason ?? null,
      signalId,
      tradeId,
      brainEntityId,
      rPerTrade: risk.rPerTrade,
      quantity: risk.quantity,
      orgId,
    },
    risk.reason,
    orgId
  );

  const envelope: PipelineEnvelope = {
    ok: risk.allowed && tradeId !== null,
    mode: "paper",
    receivedAt,
    alert,
    signal: signalId !== null ? { id: signalId, status: risk.allowed ? "received" : "rejected" } : null,
    risk,
    trade: tradeId !== null ? { id: tradeId, outcome: "open" } : null,
    brainUpdate: { entityId: brainEntityId, symbol: alert.symbol },
    auditEventId: auditId,
    rejectionReason,
  };

  if (envelope.ok) lastEnvelope = envelope;

  // Record idempotency for replay protection
  if (idempotencyKey) {
    const payloadHash = crypto.createHash("sha256").update(JSON.stringify(alert)).digest("hex");
    await recordIdempotent(idempotencyKey, payloadHash, envelope);
  }

  systemMetrics.recordWebhook(Date.now() - t0, envelope.ok, risk.reason);
  systemMetrics.log(
    envelope.ok ? "info" : "warn",
    envelope.ok ? "webhook.paper_trade_created" : "webhook.rejected",
    {
      symbol: alert.symbol,
      signalId,
      tradeId,
      auditId,
      reason: risk.reason,
    }
  );

  res.status(envelope.ok ? 201 : 200).json(envelope);
});

router.get("/tradingview/last", (_req: Request, res: Response) => {
  res.json({ ok: lastEnvelope !== null, lastEnvelope });
});

// Walk the audit chain and verify every row's HMAC. If any row's row_hash
// disagrees with HMAC(prev_hash || canonical(payload)), the chain is broken.
router.get("/audit/verify", async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "200"), 10) || 200, 5000);
  try {
    const rows: any[] = await db
      .select()
      .from(auditEventsTable)
      .orderBy(auditEventsTable.id)
      .limit(limit);

    let prev: string | null = null;
    let valid = 0;
    let broken: Array<{ id: number; expected: string; actual: string | null }> = [];
    for (const row of rows) {
      const rowPayload = {
        event_type: row.event_type,
        decision_state: row.decision_state,
        system_mode: row.system_mode,
        instrument: row.instrument,
        setup_type: row.setup_type,
        symbol: row.symbol,
        actor: row.actor,
        reason: row.reason,
        payload_json: row.payload_json,
      };
      const expected = rowHash(prev, rowPayload);
      // Older rows may not have row_hash yet — count only rows that do
      if (row.row_hash) {
        if (row.row_hash === expected && row.prev_hash === prev) {
          valid++;
        } else {
          broken.push({ id: row.id, expected, actual: row.row_hash });
        }
        prev = row.row_hash;
      } else {
        // Row written before chain was introduced — skip and continue with
        // its (still-null) hash so subsequent rows can chain off whatever
        // came after it.
        prev = null;
      }
    }
    res.json({
      ok: broken.length === 0,
      total: rows.length,
      verified: valid,
      brokenCount: broken.length,
      broken: broken.slice(0, 20),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

router.get("/tradingview/recent", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(auditEventsTable)
      .where(eq(auditEventsTable.actor, "vc_pipeline"))
      .orderBy(sql`created_at DESC`)
      .limit(20);
    res.json({ ok: true, count: rows.length, events: rows });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

export default router;
