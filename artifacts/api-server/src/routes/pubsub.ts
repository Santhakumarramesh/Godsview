/**
 * routes/pubsub.ts — Phase 79 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  topicManager,
  subscriberRegistry,
  messageBroker,
  backpressureMonitor,
  type DeliveryMode,
} from "../lib/pubsub";

const router = Router();

// ── Topics ────────────────────────────────────────────────────────────────

router.post("/api/pubsub/topics", (req: Request, res: Response) => {
  const { name, partitions, retentionMs } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "Missing name" });
  return res.status(201).json(topicManager.create({
    name: String(name), partitions, retentionMs,
  }));
});

router.get("/api/pubsub/topics", (_req: Request, res: Response) => {
  res.json({ topics: topicManager.list() });
});

router.delete("/api/pubsub/topics/:name", (req: Request, res: Response) => {
  const ok = topicManager.delete(String(req.params.name));
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});

// ── Publish / Consume ─────────────────────────────────────────────────────

router.post("/api/pubsub/publish", (req: Request, res: Response) => {
  const { topic, payload, partitionKey, headers } = req.body ?? {};
  if (!topic) return res.status(400).json({ error: "Missing topic" });
  const message = messageBroker.publish({
    topic: String(topic),
    payload, partitionKey, headers,
  });
  if (!message) return res.status(404).json({ error: "Topic not found" });
  return res.status(201).json(message);
});

router.get("/api/pubsub/consume", (req: Request, res: Response) => {
  const topic = String(req.query.topic ?? "");
  if (!topic) return res.status(400).json({ error: "Missing topic" });
  const fromSequence = Number(req.query.fromSequence ?? 0);
  const limit = Number(req.query.limit ?? 100);
  return res.json({
    messages: messageBroker.consume(topic, fromSequence, limit),
    head: messageBroker.head(topic),
  });
});

router.get("/api/pubsub/recent", (req: Request, res: Response) => {
  const topic = String(req.query.topic ?? "");
  if (!topic) return res.status(400).json({ error: "Missing topic" });
  return res.json({ messages: messageBroker.recent(topic, Number(req.query.limit ?? 50)) });
});

// ── Subscribers ───────────────────────────────────────────────────────────

router.post("/api/pubsub/subscribe", (req: Request, res: Response) => {
  const { topic, groupId, mode } = req.body ?? {};
  if (!topic || !groupId) return res.status(400).json({ error: "Missing topic or groupId" });
  return res.status(201).json(subscriberRegistry.subscribe({
    topic: String(topic),
    groupId: String(groupId),
    mode: mode as DeliveryMode | undefined,
  }));
});

router.delete("/api/pubsub/subscribers/:id", (req: Request, res: Response) => {
  const ok = subscriberRegistry.unsubscribe(String(req.params.id));
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});

router.post("/api/pubsub/subscribers/:id/advance", (req: Request, res: Response) => {
  const { sequence } = req.body ?? {};
  if (sequence === undefined) return res.status(400).json({ error: "Missing sequence" });
  const sub = subscriberRegistry.get(String(req.params.id));
  if (!sub) return res.status(404).json({ error: "Not found" });
  const head = messageBroker.head(sub.topic);
  return res.json(subscriberRegistry.advance(sub.id, Number(sequence), head));
});

router.get("/api/pubsub/subscribers", (req: Request, res: Response) => {
  res.json({
    subscribers: subscriberRegistry.list(req.query.topic ? String(req.query.topic) : undefined),
  });
});

// ── Backpressure ──────────────────────────────────────────────────────────

router.get("/api/pubsub/backpressure", (_req: Request, res: Response) => {
  res.json({ report: backpressureMonitor.report() });
});

export default router;
