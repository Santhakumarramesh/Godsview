/**
 * routes/notifications.ts — Phase 71 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  channelRegistry,
  templateEngine,
  notificationQueue,
  preferenceManager,
  type ChannelKind,
  type Priority,
} from "../lib/notifications";

const router = Router();

// ── Channels ───────────────────────────────────────────────────────────────

router.post("/api/notifications/channels", (req: Request, res: Response) => {
  const { kind, name, config } = req.body ?? {};
  if (!kind || !name || !config) return res.status(400).json({ error: "Missing kind, name, or config" });
  return res.status(201).json(channelRegistry.register({
    kind: kind as ChannelKind,
    name: String(name),
    config,
  }));
});

router.get("/api/notifications/channels", (req: Request, res: Response) => {
  const kind = req.query.kind ? (String(req.query.kind) as ChannelKind) : undefined;
  res.json({ channels: channelRegistry.list(kind) });
});

router.patch("/api/notifications/channels/:id/status", (req: Request, res: Response) => {
  const { status } = req.body ?? {};
  if (!status) return res.status(400).json({ error: "Missing status" });
  const c = channelRegistry.setStatus(String(req.params.id), status);
  if (!c) return res.status(404).json({ error: "Not found" });
  return res.json(c);
});

// ── Templates ──────────────────────────────────────────────────────────────

router.post("/api/notifications/templates", (req: Request, res: Response) => {
  const { key, subject, body, variables } = req.body ?? {};
  if (!key || !subject || !body) return res.status(400).json({ error: "Missing key, subject, or body" });
  return res.json(templateEngine.upsert({
    key: String(key),
    subject: String(subject),
    body: String(body),
    variables,
  }));
});

router.get("/api/notifications/templates", (_req: Request, res: Response) => {
  res.json({ templates: templateEngine.list() });
});

router.post("/api/notifications/templates/:key/render", (req: Request, res: Response) => {
  const rendered = templateEngine.render(String(req.params.key), req.body ?? {});
  if (!rendered) return res.status(404).json({ error: "Not found" });
  return res.json(rendered);
});

// ── Queue ──────────────────────────────────────────────────────────────────

router.post("/api/notifications/enqueue", (req: Request, res: Response) => {
  const { channelId, recipient, subject, body, priority, templateKey, dedupeKey, renderVars } = req.body ?? {};
  if (!channelId || !recipient) return res.status(400).json({ error: "Missing channelId or recipient" });
  let finalSubject = subject ?? "";
  let finalBody = body ?? "";
  if (templateKey) {
    const rendered = templateEngine.render(String(templateKey), renderVars ?? {});
    if (rendered) { finalSubject = rendered.subject; finalBody = rendered.body; }
  }
  return res.status(201).json(notificationQueue.enqueue({
    channelId: String(channelId),
    recipient: String(recipient),
    subject: String(finalSubject),
    body: String(finalBody),
    priority: priority as Priority | undefined,
    templateKey,
    dedupeKey,
  }));
});

router.post("/api/notifications/dequeue", (_req: Request, res: Response) => {
  const n = notificationQueue.dequeue();
  if (!n) return res.status(204).send();
  return res.json(n);
});

router.post("/api/notifications/:id/delivered", (req: Request, res: Response) => {
  const n = notificationQueue.markDelivered(String(req.params.id));
  if (!n) return res.status(404).json({ error: "Not found" });
  return res.json(n);
});

router.post("/api/notifications/:id/failed", (req: Request, res: Response) => {
  const { error } = req.body ?? {};
  const n = notificationQueue.markFailed(String(req.params.id), String(error ?? "unknown"));
  if (!n) return res.status(404).json({ error: "Not found" });
  return res.json(n);
});

router.get("/api/notifications/stats", (_req: Request, res: Response) => {
  res.json(notificationQueue.stats());
});

router.get("/api/notifications/recent", (_req: Request, res: Response) => {
  res.json({ notifications: notificationQueue.recent() });
});

// ── Preferences ────────────────────────────────────────────────────────────

router.post("/api/notifications/preferences/:userId", (req: Request, res: Response) => {
  const { channelId, eventTypes, dndWindows } = req.body ?? {};
  if (!channelId || !Array.isArray(eventTypes)) {
    return res.status(400).json({ error: "Missing channelId or eventTypes[]" });
  }
  return res.json(preferenceManager.set(String(req.params.userId), {
    channelId: String(channelId),
    eventTypes,
    dndWindows: Array.isArray(dndWindows) ? dndWindows : [],
  }));
});

router.get("/api/notifications/preferences/:userId", (req: Request, res: Response) => {
  res.json({ preferences: preferenceManager.get(String(req.params.userId)) });
});

router.post("/api/notifications/preferences/:userId/check", (req: Request, res: Response) => {
  const { channelId, eventType, atHour } = req.body ?? {};
  if (!channelId || !eventType) return res.status(400).json({ error: "Missing channelId or eventType" });
  return res.json({
    allowed: preferenceManager.allow(
      String(req.params.userId),
      String(channelId),
      String(eventType),
      typeof atHour === "number" ? atHour : undefined,
    ),
  });
});

export default router;
