/**
 * knowledge_base/index.ts — Phase 82: Knowledge Base + Embeddings Store
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. KBStore           — knowledge documents with metadata.
 *   2. EmbeddingStore    — vector storage with cosine similarity search.
 *   3. ChunkingEngine    — split docs into searchable chunks.
 *   4. RAGRetriever      — k-NN retrieval + context assembly.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── KB Documents ───────────────────────────────────────────────────────────

export type DocSource = "trade_journal" | "strategy" | "incident" | "postmortem" | "playbook" | "external" | "model_card";

export interface KBDocument {
  id: string;
  source: DocSource;
  title: string;
  content: string;
  authorId?: string;
  tags: string[];
  metadata: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export class KBStore {
  private readonly docs = new Map<string, KBDocument>();

  put(params: {
    source: DocSource;
    title: string;
    content: string;
    authorId?: string;
    tags?: string[];
    metadata?: Record<string, string>;
  }): KBDocument {
    const id = `kb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const doc: KBDocument = {
      id,
      source: params.source,
      title: params.title,
      content: params.content,
      authorId: params.authorId,
      tags: params.tags ?? [],
      metadata: params.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.docs.set(id, doc);
    return doc;
  }

  update(id: string, patch: Partial<KBDocument>): KBDocument | null {
    const d = this.docs.get(id);
    if (!d) return null;
    Object.assign(d, patch, { updatedAt: Date.now() });
    return d;
  }

  list(filter?: { source?: DocSource; tag?: string }): KBDocument[] {
    let out = Array.from(this.docs.values());
    if (filter?.source) out = out.filter((d) => d.source === filter.source);
    if (filter?.tag) out = out.filter((d) => d.tags.includes(filter.tag!));
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): KBDocument | null {
    return this.docs.get(id) ?? null;
  }

  delete(id: string): boolean {
    return this.docs.delete(id);
  }

  size(): number {
    return this.docs.size;
  }
}

// ── Chunking ───────────────────────────────────────────────────────────────

export interface Chunk {
  id: string;
  docId: string;
  index: number;
  text: string;
  charStart: number;
  charEnd: number;
}

export class ChunkingEngine {
  chunk(docId: string, content: string, opts?: { chunkSize?: number; overlap?: number }): Chunk[] {
    const chunkSize = opts?.chunkSize ?? 800;
    const overlap = opts?.overlap ?? 100;
    const out: Chunk[] = [];
    let cursor = 0;
    let idx = 0;
    while (cursor < content.length) {
      const end = Math.min(content.length, cursor + chunkSize);
      // try to break on sentence boundary
      let breakAt = end;
      if (end < content.length) {
        const lastPeriod = content.lastIndexOf(".", end);
        if (lastPeriod > cursor + chunkSize / 2) breakAt = lastPeriod + 1;
      }
      const text = content.slice(cursor, breakAt).trim();
      if (text.length > 0) {
        out.push({
          id: `chk_${docId}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
          docId,
          index: idx,
          text,
          charStart: cursor,
          charEnd: breakAt,
        });
        idx++;
      }
      cursor = Math.max(breakAt - overlap, breakAt);
      if (breakAt >= content.length) break;
    }
    return out;
  }
}

// ── Embedding Store ───────────────────────────────────────────────────────

export interface Embedding {
  id: string;
  docId: string;
  chunkId: string;
  vector: number[];
  text: string;
  createdAt: number;
}

export class EmbeddingStore {
  private readonly embeddings: Embedding[] = [];

  insert(params: { docId: string; chunkId: string; vector: number[]; text: string }): Embedding {
    const e: Embedding = {
      id: `emb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      ...params,
      createdAt: Date.now(),
    };
    this.embeddings.push(e);
    if (this.embeddings.length > 200_000) this.embeddings.shift();
    return e;
  }

  search(query: number[], k = 5, filter?: { docId?: string }): Array<{ embedding: Embedding; similarity: number }> {
    let pool = this.embeddings;
    if (filter?.docId) pool = pool.filter((e) => e.docId === filter.docId);
    const out = pool.map((e) => ({ embedding: e, similarity: this._cosine(query, e.vector) }));
    out.sort((a, b) => b.similarity - a.similarity);
    return out.slice(0, k);
  }

  byDoc(docId: string): Embedding[] {
    return this.embeddings.filter((e) => e.docId === docId);
  }

  removeByDoc(docId: string): number {
    let removed = 0;
    for (let i = this.embeddings.length - 1; i >= 0; i--) {
      if (this.embeddings[i]!.docId === docId) {
        this.embeddings.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    return this.embeddings.length;
  }

  private _cosine(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      na += a[i]! * a[i]!;
      nb += b[i]! * b[i]!;
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  }
}

// ── RAG Retriever ─────────────────────────────────────────────────────────

export interface RAGContext {
  query: string;
  hits: Array<{ docId: string; chunkId: string; text: string; similarity: number; doc?: KBDocument }>;
  assembledContext: string;
  totalChars: number;
}

export class RAGRetriever {
  constructor(
    private readonly kb: KBStore,
    private readonly embeddings: EmbeddingStore,
  ) {}

  retrieve(params: { query: string; queryVector: number[]; k?: number; maxChars?: number }): RAGContext {
    const k = params.k ?? 5;
    const maxChars = params.maxChars ?? 4000;
    const hits = this.embeddings.search(params.queryVector, k);
    const context: string[] = [];
    let totalChars = 0;
    const enriched: RAGContext["hits"] = [];
    for (const h of hits) {
      const doc = this.kb.get(h.embedding.docId) ?? undefined;
      enriched.push({
        docId: h.embedding.docId,
        chunkId: h.embedding.chunkId,
        text: h.embedding.text,
        similarity: h.similarity,
        doc,
      });
      const piece = `[${doc?.title ?? h.embedding.docId} | sim=${h.similarity.toFixed(3)}]\n${h.embedding.text}\n`;
      if (totalChars + piece.length > maxChars) break;
      context.push(piece);
      totalChars += piece.length;
    }
    return {
      query: params.query,
      hits: enriched,
      assembledContext: context.join("\n---\n"),
      totalChars,
    };
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const kbStore = new KBStore();
export const chunkingEngine = new ChunkingEngine();
export const embeddingStore = new EmbeddingStore();
export const ragRetriever = new RAGRetriever(kbStore, embeddingStore);

logger.info("[KnowledgeBase] Module initialized");
