/**
 * search/index.ts — Phase 78: Search & Indexing
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. InvertedIndex     — token → document posting lists.
 *   2. SearchEngine      — TF-IDF scoring + filters + facets.
 *   3. SuggestionEngine  — prefix-trie autocomplete.
 *   4. RelevanceTuner    — boost/bury config + recency boost.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Document ──────────────────────────────────────────────────────────────

export interface SearchDoc {
  id: string;
  type: string;            // e.g. "strategy", "trade", "incident"
  title: string;
  body: string;
  tags: string[];
  attributes: Record<string, string | number | boolean>;
  indexedAt: number;
}

// ── Tokenizer ──────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "is", "are", "was", "were", "be", "by", "with",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// ── Inverted Index ────────────────────────────────────────────────────────

export class InvertedIndex {
  private readonly postings = new Map<string, Map<string, number>>(); // token → docId → tf
  private readonly docs = new Map<string, SearchDoc>();

  add(doc: SearchDoc): void {
    if (this.docs.has(doc.id)) this.remove(doc.id);
    this.docs.set(doc.id, { ...doc, indexedAt: Date.now() });
    const text = `${doc.title} ${doc.body} ${doc.tags.join(" ")}`;
    const tokens = tokenize(text);
    for (const t of tokens) {
      let map = this.postings.get(t);
      if (!map) { map = new Map<string, number>(); this.postings.set(t, map); }
      map.set(doc.id, (map.get(doc.id) ?? 0) + 1);
    }
  }

  remove(docId: string): void {
    if (!this.docs.has(docId)) return;
    this.docs.delete(docId);
    for (const map of this.postings.values()) map.delete(docId);
  }

  size(): { docs: number; tokens: number } {
    return { docs: this.docs.size, tokens: this.postings.size };
  }

  postingsFor(token: string): Map<string, number> | undefined {
    return this.postings.get(token);
  }

  doc(id: string): SearchDoc | null {
    return this.docs.get(id) ?? null;
  }

  allDocs(): SearchDoc[] {
    return Array.from(this.docs.values());
  }
}

// ── Search Engine ─────────────────────────────────────────────────────────

export interface SearchResult {
  docId: string;
  doc: SearchDoc;
  score: number;
  highlights: string[];
}

export interface SearchFilter {
  type?: string;
  tags?: string[];
  attributes?: Record<string, string | number | boolean>;
}

export class SearchEngine {
  constructor(private readonly index: InvertedIndex) {}

  search(query: string, opts?: { filter?: SearchFilter; limit?: number; recencyBoost?: number }): SearchResult[] {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    const totalDocs = this.index.size().docs || 1;
    const scores = new Map<string, number>();
    for (const token of tokens) {
      const postings = this.index.postingsFor(token);
      if (!postings) continue;
      const idf = Math.log(1 + totalDocs / postings.size);
      for (const [docId, tf] of postings) {
        scores.set(docId, (scores.get(docId) ?? 0) + tf * idf);
      }
    }

    const filter = opts?.filter;
    let results: SearchResult[] = [];
    for (const [docId, score] of scores) {
      const doc = this.index.doc(docId);
      if (!doc) continue;
      if (filter?.type && doc.type !== filter.type) continue;
      if (filter?.tags && !filter.tags.every((t) => doc.tags.includes(t))) continue;
      if (filter?.attributes) {
        let ok = true;
        for (const [k, v] of Object.entries(filter.attributes)) {
          if (doc.attributes[k] !== v) { ok = false; break; }
        }
        if (!ok) continue;
      }
      let final = score;
      if (opts?.recencyBoost) {
        const ageMs = Date.now() - doc.indexedAt;
        const recencyFactor = Math.exp(-ageMs / (24 * 60 * 60 * 1000)); // decay per day
        final += score * opts.recencyBoost * recencyFactor;
      }
      results.push({ docId, doc, score: final, highlights: this._highlight(doc, tokens) });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, opts?.limit ?? 20);
  }

  facets(query: string, field: "type" | "tags"): Record<string, number> {
    const results = this.search(query, { limit: 1000 });
    const counts: Record<string, number> = {};
    for (const r of results) {
      if (field === "type") {
        counts[r.doc.type] = (counts[r.doc.type] ?? 0) + 1;
      } else {
        for (const t of r.doc.tags) counts[t] = (counts[t] ?? 0) + 1;
      }
    }
    return counts;
  }

  private _highlight(doc: SearchDoc, tokens: string[]): string[] {
    const out: string[] = [];
    const corpus = `${doc.title}\n${doc.body}`;
    const sentences = corpus.split(/[.\n]/).map((s) => s.trim()).filter(Boolean);
    for (const sent of sentences) {
      const lower = sent.toLowerCase();
      if (tokens.some((t) => lower.includes(t))) {
        out.push(sent.length > 200 ? sent.slice(0, 200) + "..." : sent);
        if (out.length >= 3) break;
      }
    }
    return out;
  }
}

// ── Suggestion Engine (trie) ──────────────────────────────────────────────

interface TrieNode {
  children: Map<string, TrieNode>;
  terminal: boolean;
  count: number;
}

export class SuggestionEngine {
  private root: TrieNode = { children: new Map(), terminal: false, count: 0 };

  add(term: string): void {
    let node = this.root;
    const lower = term.toLowerCase();
    for (const ch of lower) {
      let next = node.children.get(ch);
      if (!next) { next = { children: new Map(), terminal: false, count: 0 }; node.children.set(ch, next); }
      node = next;
    }
    node.terminal = true;
    node.count++;
  }

  suggest(prefix: string, limit = 10): string[] {
    let node = this.root;
    const lower = prefix.toLowerCase();
    for (const ch of lower) {
      const next = node.children.get(ch);
      if (!next) return [];
      node = next;
    }
    const out: Array<{ term: string; count: number }> = [];
    const walk = (n: TrieNode, acc: string): void => {
      if (n.terminal) out.push({ term: acc, count: n.count });
      for (const [ch, child] of n.children) walk(child, acc + ch);
    };
    walk(node, lower);
    out.sort((a, b) => b.count - a.count);
    return out.slice(0, limit).map((x) => x.term);
  }
}

// ── Relevance Tuner ───────────────────────────────────────────────────────

export interface RelevanceConfig {
  boostTags: string[];
  buryTags: string[];
  boostFactor: number; // multiplier
  buryFactor: number;  // multiplier (<1)
}

export class RelevanceTuner {
  private config: RelevanceConfig = { boostTags: [], buryTags: [], boostFactor: 1.5, buryFactor: 0.5 };

  set(config: Partial<RelevanceConfig>): RelevanceConfig {
    this.config = { ...this.config, ...config };
    return this.config;
  }

  get(): RelevanceConfig {
    return this.config;
  }

  apply(results: SearchResult[]): SearchResult[] {
    return results.map((r) => {
      let score = r.score;
      if (this.config.boostTags.some((t) => r.doc.tags.includes(t))) score *= this.config.boostFactor;
      if (this.config.buryTags.some((t) => r.doc.tags.includes(t))) score *= this.config.buryFactor;
      return { ...r, score };
    }).sort((a, b) => b.score - a.score);
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const invertedIndex = new InvertedIndex();
export const searchEngine = new SearchEngine(invertedIndex);
export const suggestionEngine = new SuggestionEngine();
export const relevanceTuner = new RelevanceTuner();

logger.info("[Search] Module initialized");
