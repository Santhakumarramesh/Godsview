/**
 * routes/knowledge_base.ts — Phase 82 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  kbStore,
  chunkingEngine,
  embeddingStore,
  ragRetriever,
  type DocSource,
} from "../lib/knowledge_base";

const router = Router();

// ── Documents ──────────────────────────────────────────────────────────────

router.post("/api/kb/docs", (req: Request, res: Response) => {
  const { source, title, content, authorId, tags, metadata } = req.body ?? {};
  if (!source || !title || !content) {
    return res.status(400).json({ error: "Missing source, title, or content" });
  }
  return res.status(201).json(kbStore.put({
    source: source as DocSource,
    title: String(title),
    content: String(content),
    authorId,
    tags,
    metadata,
  }));
});

router.get("/api/kb/docs", (req: Request, res: Response) => {
  res.json({
    docs: kbStore.list({
      source: req.query.source ? (String(req.query.source) as DocSource) : undefined,
      tag: req.query.tag ? String(req.query.tag) : undefined,
    }),
    size: kbStore.size(),
  });
});

router.get("/api/kb/docs/:id", (req: Request, res: Response) => {
  const d = kbStore.get(String(req.params.id));
  if (!d) return res.status(404).json({ error: "Not found" });
  return res.json({ doc: d, embeddings: embeddingStore.byDoc(d.id).length });
});

router.delete("/api/kb/docs/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  embeddingStore.removeByDoc(id);
  const ok = kbStore.delete(id);
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});

// ── Chunking ───────────────────────────────────────────────────────────────

router.post("/api/kb/docs/:id/chunk", (req: Request, res: Response) => {
  const d = kbStore.get(String(req.params.id));
  if (!d) return res.status(404).json({ error: "Not found" });
  const { chunkSize, overlap } = req.body ?? {};
  return res.json({ chunks: chunkingEngine.chunk(d.id, d.content, { chunkSize, overlap }) });
});

// ── Embeddings ─────────────────────────────────────────────────────────────

router.post("/api/kb/embeddings", (req: Request, res: Response) => {
  const { docId, chunkId, vector, text } = req.body ?? {};
  if (!docId || !chunkId || !Array.isArray(vector) || !text) {
    return res.status(400).json({ error: "Missing docId, chunkId, vector, or text" });
  }
  return res.status(201).json(embeddingStore.insert({
    docId: String(docId),
    chunkId: String(chunkId),
    vector: vector.map(Number),
    text: String(text),
  }));
});

router.get("/api/kb/embeddings/stats", (_req: Request, res: Response) => {
  res.json({ size: embeddingStore.size() });
});

// ── Search & RAG ──────────────────────────────────────────────────────────

router.post("/api/kb/search", (req: Request, res: Response) => {
  const { vector, k, docId } = req.body ?? {};
  if (!Array.isArray(vector)) return res.status(400).json({ error: "Missing vector" });
  return res.json({
    hits: embeddingStore.search(vector.map(Number), k ?? 5, docId ? { docId } : undefined),
  });
});

router.post("/api/kb/rag", (req: Request, res: Response) => {
  const { query, queryVector, k, maxChars } = req.body ?? {};
  if (!query || !Array.isArray(queryVector)) {
    return res.status(400).json({ error: "Missing query or queryVector" });
  }
  return res.json(ragRetriever.retrieve({
    query: String(query),
    queryVector: queryVector.map(Number),
    k, maxChars,
  }));
});

export default router;
