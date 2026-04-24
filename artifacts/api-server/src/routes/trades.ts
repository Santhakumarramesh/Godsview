import { Router, type IRouter } from "express";
import { db, tradesTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { CreateTradeBody, UpdateTradeBody, GetTradesQueryParams, UpdateTradeParams } from "@workspace/api-zod";
import { withDegradation } from "../lib/degradation";

const router: IRouter = Router();

const NUMERIC_FIELDS = [
  "entry_price",
  "exit_price",
  "stop_loss",
  "take_profit",
  "quantity",
  "pnl",
  "pnl_pct",
  "mfe",
  "mae",
  "slippage",
] as const;

function toDbNumeric(value: unknown): unknown {
  return typeof value === "number" ? String(value) : value;
}

function coerceNumericFields<T extends Record<string, unknown>>(payload: T): T {
  const next: Record<string, unknown> = { ...payload };
  for (const field of NUMERIC_FIELDS) {
    if (field in next) next[field] = toDbNumeric(next[field]);
  }
  return next as T;
}

router.get("/trades", async (req, res) => {
  try {
    const query = GetTradesQueryParams.parse(req.query);
    const conditions = [];
    if (query.instrument) conditions.push(eq(tradesTable.instrument, query.instrument));
    if (query.setup_type) conditions.push(eq(tradesTable.setup_type, query.setup_type));

    const limit = query.limit ?? 50;

    const { result, degraded } = await withDegradation(
      "database",
      async () => {
        const trades = await db
          .select()
          .from(tradesTable)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(tradesTable.created_at))
          .limit(limit);

        const [{ count }] = await db
          .select({ count: sql<number>`count(*)` })
          .from(tradesTable)
          .where(conditions.length > 0 ? and(...conditions) : undefined);

        return { trades, total: Number(count) };
      },
      { trades: [], total: 0 },
    );

    if (degraded) {
      res.status(503).json({ ...result, source: "unavailable", message: "Database unavailable — returning empty results" });
      return;
    }
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get trades");
    res.status(503).json({ error: "internal_error", message: "Failed to fetch trades" });
  }
});

router.post("/trades", async (req, res) => {
  try {
    const body = CreateTradeBody.parse(req.body);
    const insertPayload = coerceNumericFields({ ...body, outcome: "open" });

    const { result, degraded } = await withDegradation(
      "database",
      async () => {
        const [trade] = await db
          .insert(tradesTable)
          .values(insertPayload as any)
          .returning();
        return trade;
      },
      null,
    );

    if (degraded || !result) {
      res.status(503).json({ error: "service_unavailable", message: "Database unavailable — cannot create trade" });
      return;
    }
    res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to create trade");
    res.status(503).json({ error: "internal_error", message: "Failed to create trade" });
  }
});

router.put("/trades/:id", async (req, res) => {
  try {
    const { id } = UpdateTradeParams.parse(req.params);
    const body = UpdateTradeBody.parse(req.body);
    const updatePayload = coerceNumericFields(body);

    const { result, degraded } = await withDegradation(
      "database",
      async () => {
        const [trade] = await db
          .update(tradesTable)
          .set(updatePayload as any)
          .where(eq(tradesTable.id, id))
          .returning();
        return trade;
      },
      null,
    );

    if (degraded) {
      res.status(503).json({ error: "service_unavailable", message: "Database unavailable — cannot update trade" });
      return;
    }
    if (!result) {
      res.status(404).json({ error: "not_found", message: "Trade not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to update trade");
    res.status(503).json({ error: "internal_error", message: "Failed to update trade" });
  }
});

export default router;
