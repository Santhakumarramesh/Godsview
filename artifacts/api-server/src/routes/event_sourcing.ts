/**
 * routes/event_sourcing.ts — Phase 77 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  eventStore,
  projectionEngine,
  snapshotStore,
  timeTravelEngine,
} from "../lib/event_sourcing";

const router = Router();

// ── Events ─────────────────────────────────────────────────────────────────

router.post("/api/events", (req: Request, res: Response) => {
  const { aggregateId, aggregateType, eventType, payload, metadata } = req.body ?? {};
  if (!aggregateId || !aggregateType || !eventType) {
    return res.status(400).json({ error: "Missing aggregateId, aggregateType, or eventType" });
  }
  return res.status(201).json(eventStore.append({
    aggregateId: String(aggregateId),
    aggregateType: String(aggregateType),
    eventType: String(eventType),
    payload: payload ?? {},
    metadata: metadata ?? {},
  }));
});

router.get("/api/events", (req: Request, res: Response) => {
  res.json({
    events: eventStore.query({
      aggregateType: req.query.aggregateType ? String(req.query.aggregateType) : undefined,
      eventType: req.query.eventType ? String(req.query.eventType) : undefined,
      since: req.query.since ? Number(req.query.since) : undefined,
      until: req.query.until ? Number(req.query.until) : undefined,
    }),
    size: eventStore.size(),
  });
});

router.get("/api/events/aggregate/:id", (req: Request, res: Response) => {
  const atOrBefore = req.query.atOrBefore ? Number(req.query.atOrBefore) : undefined;
  res.json({ events: eventStore.forAggregate(String(req.params.id), atOrBefore) });
});

// ── Projections ───────────────────────────────────────────────────────────

router.get("/api/projections", (_req: Request, res: Response) => {
  res.json({ projections: projectionEngine.list() });
});

router.post("/api/projections/:name/fold", (req: Request, res: Response) => {
  const { aggregateId } = req.body ?? {};
  if (!aggregateId) return res.status(400).json({ error: "Missing aggregateId" });
  try {
    const events = eventStore.forAggregate(String(aggregateId));
    return res.json({ state: projectionEngine.fold(String(req.params.name), events) });
  } catch (err) {
    return res.status(404).json({ error: (err as Error).message });
  }
});

// ── Snapshots ─────────────────────────────────────────────────────────────

router.post("/api/events/snapshots", (req: Request, res: Response) => {
  const { aggregateId, projection, asOfSequence, state } = req.body ?? {};
  if (!aggregateId || !projection || asOfSequence === undefined || !state) {
    return res.status(400).json({ error: "Missing snapshot fields" });
  }
  return res.status(201).json(snapshotStore.save({
    aggregateId: String(aggregateId),
    projection: String(projection),
    asOfSequence: Number(asOfSequence),
    state,
  }));
});

router.get("/api/events/snapshots/:aggregateId", (req: Request, res: Response) => {
  res.json({ snapshots: snapshotStore.list(String(req.params.aggregateId)) });
});

// ── Time Travel ───────────────────────────────────────────────────────────

router.get("/api/events/state/:aggregateId/:projection", (req: Request, res: Response) => {
  try {
    const at = req.query.at ? Number(req.query.at) : Date.now();
    const state = timeTravelEngine.stateAt(
      String(req.params.aggregateId),
      String(req.params.projection),
      at,
    );
    return res.json({ state, at });
  } catch (err) {
    return res.status(404).json({ error: (err as Error).message });
  }
});

router.get("/api/events/diff/:aggregateId/:projection", (req: Request, res: Response) => {
  const fromTime = Number(req.query.from ?? 0);
  const toTime = Number(req.query.to ?? Date.now());
  try {
    return res.json(timeTravelEngine.diff(
      String(req.params.aggregateId),
      String(req.params.projection),
      fromTime, toTime,
    ));
  } catch (err) {
    return res.status(404).json({ error: (err as Error).message });
  }
});

export default router;
