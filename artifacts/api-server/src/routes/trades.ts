import { Router, type IRouter } from "express";
import { db, tradesTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { CreateTradeBody, UpdateTradeBody, GetTradesQueryParams, UpdateTradeParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/trades", async (req, res) => {
  try {
    const query = GetTradesQueryParams.parse(req.query);
    const conditions = [];
    if (query.instrument) conditions.push(eq(tradesTable.instrument, query.instrument));
    if (query.setup_type) conditions.push(eq(tradesTable.setup_type, query.setup_type));

    const limit = query.limit ?? 50;
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

    res.json({ trades, total: Number(count) });
  } catch (err) {
    req.log.error({ err }, "Failed to get trades");
    res.status(500).json({ error: "internal_error", message: "Failed to fetch trades" });
  }
});

router.post("/trades", async (req, res) => {
  try {
    const body = CreateTradeBody.parse(req.body);
    const [trade] = await db
      .insert(tradesTable)
      .values({ ...body, outcome: "open" })
      .returning();
    res.status(201).json(trade);
  } catch (err) {
    req.log.error({ err }, "Failed to create trade");
    res.status(500).json({ error: "internal_error", message: "Failed to create trade" });
  }
});

router.put("/trades/:id", async (req, res) => {
  try {
    const { id } = UpdateTradeParams.parse(req.params);
    const body = UpdateTradeBody.parse(req.body);
    const [trade] = await db
      .update(tradesTable)
      .set(body)
      .where(eq(tradesTable.id, id))
      .returning();
    if (!trade) {
      res.status(404).json({ error: "not_found", message: "Trade not found" });
      return;
    }
    res.json(trade);
  } catch (err) {
    req.log.error({ err }, "Failed to update trade");
    res.status(500).json({ error: "internal_error", message: "Failed to update trade" });
  }
});

export default router;
