/**
 * routes/search.ts — Phase 78 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  invertedIndex,
  searchEngine,
  suggestionEngine,
  relevanceTuner,
  type SearchDoc,
  type SearchFilter,
} from "../lib/search";

const router = Router();

// ── Indexing ──────────────────────────────────────────────────────────────

router.post("/api/search/index", (req: Request, res: Response) => {
  const doc = req.body as Partial<SearchDoc>;
  if (!doc.id || !doc.type || !doc.title) {
    return res.status(400).json({ error: "Missing id, type, or title" });
  }
  invertedIndex.add({
    id: String(doc.id),
    type: String(doc.type),
    title: String(doc.title),
    body: String(doc.body ?? ""),
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    attributes: doc.attributes ?? {},
    indexedAt: Date.now(),
  });
  // Add tokens to autocomplete
  for (const term of `${doc.title} ${(doc.tags ?? []).join(" ")}`.split(/\s+/)) {
    if (term.length >= 2) suggestionEngine.add(term);
  }
  return res.status(201).json({ ok: true, size: invertedIndex.size() });
});

router.delete("/api/search/index/:id", (req: Request, res: Response) => {
  invertedIndex.remove(String(req.params.id));
  res.json({ ok: true, size: invertedIndex.size() });
});

router.get("/api/search/index/stats", (_req: Request, res: Response) => {
  res.json(invertedIndex.size());
});

// ── Search ────────────────────────────────────────────────────────────────

router.post("/api/search/query", (req: Request, res: Response) => {
  const { query, filter, limit, recencyBoost } = req.body ?? {};
  if (!query) return res.status(400).json({ error: "Missing query" });
  const raw = searchEngine.search(String(query), {
    filter: filter as SearchFilter | undefined,
    limit,
    recencyBoost,
  });
  const tuned = relevanceTuner.apply(raw);
  return res.json({ results: tuned, count: tuned.length });
});

router.post("/api/search/facets/:field", (req: Request, res: Response) => {
  const { query } = req.body ?? {};
  if (!query) return res.status(400).json({ error: "Missing query" });
  const field = String(req.params.field) === "type" ? "type" : "tags";
  return res.json({ facets: searchEngine.facets(String(query), field) });
});

// ── Autocomplete ──────────────────────────────────────────────────────────

router.get("/api/search/suggest", (req: Request, res: Response) => {
  const prefix = String(req.query.prefix ?? "");
  if (!prefix) return res.status(400).json({ error: "Missing prefix" });
  return res.json({ suggestions: suggestionEngine.suggest(prefix, Number(req.query.limit ?? 10)) });
});

// ── Tuning ────────────────────────────────────────────────────────────────

router.get("/api/search/tuner", (_req: Request, res: Response) => {
  res.json(relevanceTuner.get());
});

router.post("/api/search/tuner", (req: Request, res: Response) => {
  res.json(relevanceTuner.set(req.body ?? {}));
});

export default router;
