/**
 * Brain entity detail endpoint — backs the click-through from the hologram.
 *
 *   GET /api/brain/entity/:symbol
 *
 * Returns:
 *   - the entity row (state_json parsed)
 *   - latest signal for that symbol
 *   - latest paper trade for that symbol
 *   - latest audit event (so we can show the decision reason)
 *   - count of related memories
 */

import { Router, type Request, type Response } from "express";
import {
  brainEntitiesTable,
  brainMemoriesTable,
  signalsTable,
  tradesTable,
  auditEventsTable,
  db,
} from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";

const router = Router();

router.get("/entity/:symbol", async (req: Request, res: Response) => {
  const symbol = String(req.params.symbol).toUpperCase();
  if (!symbol || symbol.length > 16) {
    res.status(400).json({ ok: false, error: "invalid symbol" });
    return;
  }

  try {
    const entityRows = await db
      .select()
      .from(brainEntitiesTable)
      .where(eq(brainEntitiesTable.symbol, symbol))
      .limit(1);
    const entity = entityRows?.[0] ?? null;

    let stateJson: Record<string, unknown> = {};
    if (entity?.state_json) {
      try {
        stateJson = JSON.parse(entity.state_json as any);
      } catch {
        /* ignore */
      }
    }

    const memoryCountPromise = entity?.id
      ? db
          .select({ c: sql<number>`count(*)::int` })
          .from(brainMemoriesTable)
          .where(eq(brainMemoriesTable.entity_id, entity.id))
          .catch(() => [{ c: 0 }])
      : Promise.resolve([{ c: 0 }]);

    const [latestSignalRows, latestTradeRows, latestAuditRows, memoryCountRows] = await Promise.all([
      db
        .select()
        .from(signalsTable)
        .where(eq(signalsTable.instrument, symbol))
        .orderBy(desc(signalsTable.created_at))
        .limit(1),
      db
        .select()
        .from(tradesTable)
        .where(eq(tradesTable.instrument, symbol))
        .orderBy(desc(tradesTable.created_at))
        .limit(1),
      db
        .select()
        .from(auditEventsTable)
        .where(eq(auditEventsTable.symbol, symbol))
        .orderBy(desc(auditEventsTable.created_at))
        .limit(1),
      memoryCountPromise,
    ]);

    res.json({
      ok: true,
      symbol,
      entity: entity
        ? {
            id: entity.id,
            entityType: entity.entity_type,
            name: entity.name,
            sector: entity.sector,
            regime: entity.regime,
            updatedAt: entity.updated_at,
            state: stateJson,
            // surface the headline fields the dashboard expects
            assetClass: stateJson.assetClass ?? null,
            confidence: stateJson.confidence ?? null,
            riskStatus: stateJson.lastRiskDecision ?? null,
            riskReason: stateJson.lastRiskReason ?? null,
            lastSignalType: stateJson.lastSignal ?? null,
            lastUpdated: entity.updated_at,
          }
        : null,
      latestSignal: latestSignalRows?.[0]
        ? {
            id: latestSignalRows[0].id,
            setup: latestSignalRows[0].setup_type,
            status: latestSignalRows[0].status,
            quality: latestSignalRows[0].final_quality,
            entryPrice: latestSignalRows[0].entry_price,
            createdAt: latestSignalRows[0].created_at,
          }
        : null,
      latestPaperTrade: latestTradeRows?.[0]
        ? {
            id: latestTradeRows[0].id,
            direction: latestTradeRows[0].direction,
            entryPrice: latestTradeRows[0].entry_price,
            quantity: latestTradeRows[0].quantity,
            outcome: latestTradeRows[0].outcome,
            createdAt: latestTradeRows[0].created_at,
          }
        : null,
      latestAudit: latestAuditRows?.[0]
        ? {
            id: latestAuditRows[0].id,
            eventType: latestAuditRows[0].event_type,
            decisionState: latestAuditRows[0].decision_state,
            reason: latestAuditRows[0].reason,
            createdAt: latestAuditRows[0].created_at,
          }
        : null,
      memoryCount: (memoryCountRows?.[0] as any)?.c ?? 0,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

export default router;
