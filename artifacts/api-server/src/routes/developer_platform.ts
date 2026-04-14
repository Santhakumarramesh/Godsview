/**
 * routes/developer_platform.ts — Phase 70 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  apiKeyManager,
  rateLimiter,
  webhookRegistry,
  sdkRegistry,
  type Scope,
  type WebhookEvent,
  type SDKSurface,
} from "../lib/developer_platform";

const router = Router();

// ── API Keys ───────────────────────────────────────────────────────────────

router.post("/api/dev/keys", (req: Request, res: Response) => {
  const { name, ownerUserId, orgId, scopes, expiresInMs } = req.body ?? {};
  if (!name || !ownerUserId || !Array.isArray(scopes)) {
    return res.status(400).json({ error: "Missing name, ownerUserId, or scopes[]" });
  }
  const { key, secret } = apiKeyManager.issue({
    name: String(name),
    ownerUserId: String(ownerUserId),
    orgId,
    scopes: scopes as Scope[],
    expiresInMs,
  });
  // secret is returned ONCE on creation.
  return res.status(201).json({ key: { ...key, hash: "REDACTED" }, secret });
});

router.get("/api/dev/keys", (req: Request, res: Response) => {
  const ownerUserId = req.query.ownerUserId ? String(req.query.ownerUserId) : undefined;
  res.json({ keys: apiKeyManager.list(ownerUserId) });
});

router.delete("/api/dev/keys/:id", (req: Request, res: Response) => {
  const ok = apiKeyManager.revoke(String(req.params.id));
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});

router.post("/api/dev/keys/verify", (req: Request, res: Response) => {
  const { secret } = req.body ?? {};
  if (!secret) return res.status(400).json({ error: "Missing secret" });
  const k = apiKeyManager.verify(String(secret));
  if (!k) return res.status(401).json({ valid: false });
  return res.json({ valid: true, keyId: k.id, scopes: k.scopes });
});

// ── Rate Limiter ───────────────────────────────────────────────────────────

router.post("/api/dev/rate-limit/take", (req: Request, res: Response) => {
  const { keyId, cost } = req.body ?? {};
  if (!keyId) return res.status(400).json({ error: "Missing keyId" });
  const result = rateLimiter.take(String(keyId), Number(cost ?? 1));
  if (!result.allowed) res.set("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
  return res.status(result.allowed ? 200 : 429).json(result);
});

router.get("/api/dev/rate-limit/:keyId", (req: Request, res: Response) => {
  res.json(rateLimiter.snapshot(String(req.params.keyId)));
});

// ── Webhooks ───────────────────────────────────────────────────────────────

router.post("/api/dev/webhooks", (req: Request, res: Response) => {
  const { url, events } = req.body ?? {};
  if (!url || !Array.isArray(events)) return res.status(400).json({ error: "Missing url or events[]" });
  return res.status(201).json(webhookRegistry.subscribe({
    url: String(url),
    events: events as WebhookEvent[],
  }));
});

router.get("/api/dev/webhooks", (_req: Request, res: Response) => {
  res.json({ subscriptions: webhookRegistry.list() });
});

router.delete("/api/dev/webhooks/:id", (req: Request, res: Response) => {
  const ok = webhookRegistry.unsubscribe(String(req.params.id));
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});

router.post("/api/dev/webhooks/fire", (req: Request, res: Response) => {
  const { event, payload } = req.body ?? {};
  if (!event) return res.status(400).json({ error: "Missing event" });
  const deliveries = webhookRegistry.fire(event as WebhookEvent, payload ?? {});
  return res.status(201).json({ deliveries });
});

router.post("/api/dev/webhooks/deliveries/:id/ack", (req: Request, res: Response) => {
  const { responseStatus } = req.body ?? {};
  if (responseStatus === undefined) return res.status(400).json({ error: "Missing responseStatus" });
  webhookRegistry.markDelivered(String(req.params.id), Number(responseStatus));
  return res.json({ ok: true });
});

router.get("/api/dev/webhooks/deliveries", (_req: Request, res: Response) => {
  res.json({ deliveries: webhookRegistry.recent() });
});

// ── SDKs ───────────────────────────────────────────────────────────────────

router.post("/api/dev/sdks", (req: Request, res: Response) => {
  const { language, version, notes } = req.body ?? {};
  if (!language || !version) return res.status(400).json({ error: "Missing language or version" });
  return res.status(201).json(sdkRegistry.publish({
    language: language as SDKSurface["language"],
    version: String(version),
    notes: String(notes ?? ""),
  }));
});

router.post("/api/dev/sdks/:id/deprecate", (req: Request, res: Response) => {
  const { sunsetAt } = req.body ?? {};
  if (!sunsetAt) return res.status(400).json({ error: "Missing sunsetAt" });
  const s = sdkRegistry.deprecate(String(req.params.id), Number(sunsetAt));
  if (!s) return res.status(404).json({ error: "Not found" });
  return res.json(s);
});

router.get("/api/dev/sdks", (req: Request, res: Response) => {
  const language = req.query.language ? (String(req.query.language) as SDKSurface["language"]) : undefined;
  res.json({ surfaces: sdkRegistry.list(language) });
});

export default router;
