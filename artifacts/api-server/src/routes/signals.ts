import { Router, type IRouter } from "express";
import { db, signalsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { CreateSignalBody, GetSignalsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/signals", async (req, res) => {
  try {
    const query = GetSignalsQueryParams.parse(req.query);
    const conditions = [];
    if (query.setup_type) conditions.push(eq(signalsTable.setup_type, query.setup_type));
    if (query.instrument) conditions.push(eq(signalsTable.instrument, query.instrument));
    if (query.status) conditions.push(eq(signalsTable.status, query.status));

    const limit = query.limit ?? 50;
    const signals = await db
      .select()
      .from(signalsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(signalsTable.created_at))
      .limit(limit);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(signalsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    res.json({ signals, total: Number(count) });
  } catch (err) {
    req.log.error({ err }, "Failed to get signals");
    res.status(500).json({ error: "internal_error", message: "Failed to fetch signals" });
  }
});

router.post("/signals", async (req, res) => {
  try {
    const body = CreateSignalBody.parse(req.body);
    const structure = Number(body.structure_score);
    const orderFlow = Number(body.order_flow_score);
    const recall = Number(body.recall_score);
    const ml = Number(body.ml_probability);
    const claude = Number(body.claude_score);
    const finalQuality = 0.30 * structure + 0.25 * orderFlow + 0.20 * recall + 0.15 * ml + 0.10 * claude;

    const [signal] = await db
      .insert(signalsTable)
      .values({
        ...body,
        final_quality: String(finalQuality.toFixed(4)),
        status: "pending",
      })
      .returning();

    res.status(201).json(signal);
  } catch (err) {
    req.log.error({ err }, "Failed to create signal");
    res.status(500).json({ error: "internal_error", message: "Failed to create signal" });
  }
});

router.get("/signals/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [signal] = await db.select().from(signalsTable).where(eq(signalsTable.id, id));
    if (!signal) {
      res.status(404).json({ error: "not_found", message: "Signal not found" });
      return;
    }
    res.json(signal);
  } catch (err) {
    req.log.error({ err }, "Failed to get signal");
    res.status(500).json({ error: "internal_error", message: "Failed to fetch signal" });
  }
});

export default router;
