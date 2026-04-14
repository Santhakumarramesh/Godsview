/**
 * routes/cache_layer.ts — Phase 81 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  cacheRegistry,
  cacheStampede,
  LRUCache,
  TieredCache,
} from "../lib/cache_layer";

const router = Router();

router.post("/api/cache", (req: Request, res: Response) => {
  const { name, kind, maxEntries, defaultTTLMs } = req.body ?? {};
  if (!name || !kind) return res.status(400).json({ error: "Missing name or kind" });
  const cache = kind === "tiered"
    ? cacheRegistry.registerTiered(String(name))
    : cacheRegistry.registerLRU(String(name), maxEntries, defaultTTLMs);
  return res.status(201).json({ name, kind, stats: cache.stats() });
});

router.get("/api/cache", (_req: Request, res: Response) => {
  res.json({ caches: cacheRegistry.list(), stats: cacheRegistry.allStats() });
});

router.delete("/api/cache/:name", (req: Request, res: Response) => {
  const ok = cacheRegistry.delete(String(req.params.name));
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});

router.post("/api/cache/:name/set", (req: Request, res: Response) => {
  const cache = cacheRegistry.get(String(req.params.name));
  if (!cache) return res.status(404).json({ error: "Not found" });
  const { key, value, ttlMs } = req.body ?? {};
  if (key === undefined || value === undefined) return res.status(400).json({ error: "Missing key or value" });
  cache.set(String(key), value, ttlMs);
  return res.json({ ok: true });
});

router.get("/api/cache/:name/get", (req: Request, res: Response) => {
  const cache = cacheRegistry.get(String(req.params.name));
  if (!cache) return res.status(404).json({ error: "Not found" });
  const key = String(req.query.key ?? "");
  if (!key) return res.status(400).json({ error: "Missing key" });
  const value = cache.get(key);
  return res.json({ key, value });
});

router.delete("/api/cache/:name/key/:key", (req: Request, res: Response) => {
  const cache = cacheRegistry.get(String(req.params.name));
  if (!cache) return res.status(404).json({ error: "Not found" });
  if (cache instanceof LRUCache) {
    cache.delete(String(req.params.key));
  } else if (cache instanceof TieredCache) {
    cache.delete(String(req.params.key));
  }
  return res.json({ ok: true });
});

router.post("/api/cache/:name/clear", (req: Request, res: Response) => {
  const cache = cacheRegistry.get(String(req.params.name));
  if (!cache) return res.status(404).json({ error: "Not found" });
  cache.clear();
  return res.json({ ok: true });
});

router.get("/api/cache/:name/stats", (req: Request, res: Response) => {
  const cache = cacheRegistry.get(String(req.params.name));
  if (!cache) return res.status(404).json({ error: "Not found" });
  return res.json(cache.stats());
});

router.get("/api/cache/:name/top", (req: Request, res: Response) => {
  const cache = cacheRegistry.get(String(req.params.name));
  if (!cache) return res.status(404).json({ error: "Not found" });
  if (!(cache instanceof LRUCache)) return res.status(400).json({ error: "Top supported only on LRU" });
  return res.json({ top: cache.topKeys(Number(req.query.n ?? 10)) });
});

router.get("/api/cache/stampede/inflight", (_req: Request, res: Response) => {
  res.json({ count: cacheStampede.inflightCount(), keys: cacheStampede.inflightKeys() });
});

export default router;
