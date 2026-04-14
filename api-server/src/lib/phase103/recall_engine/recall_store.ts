/**
 * Phase 103 — Recall Engine: in-memory similarity store
 * ======================================================
 * Append-only store of historical setups + outcomes with
 * cosine-similarity retrieval. Persistable to JSON on disk so
 * recall survives restarts. All operations O(N*D) which is fine
 * up to ~200K records given EMBED_DIM=128.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { embedFeatures, cosineSim, EMBED_DIM, SetupFeatures } from "./embedding.js";

export type Outcome = "win" | "loss" | "scratch" | "missed";

export interface RecallRecord {
  id: string;
  timestamp: number;
  features: SetupFeatures;
  embedding: number[];
  outcome: Outcome;
  pnl?: number;
  rr_realized?: number;
  notes?: string;
  context?: Record<string, unknown>;
}

export interface SimilarMatch {
  record: RecallRecord;
  similarity: number;
}

export interface RecallSummary {
  matches: number;
  win_rate: number;
  avg_pnl: number;
  avg_rr: number;
  failure_modes: string[];
}

export interface RecallStoreOptions {
  persist_path?: string;
  max_records?: number;
}

export class RecallStore {
  private records: RecallRecord[] = [];
  private readonly opts: Required<Omit<RecallStoreOptions, "persist_path">> &
    Pick<RecallStoreOptions, "persist_path">;

  constructor(opts: RecallStoreOptions = {}) {
    this.opts = {
      max_records: opts.max_records ?? 200_000,
      persist_path: opts.persist_path,
    };
  }

  async load(): Promise<void> {
    if (!this.opts.persist_path) return;
    try {
      const buf = await fs.readFile(this.opts.persist_path, "utf-8");
      const data = JSON.parse(buf);
      if (Array.isArray(data)) this.records = data as RecallRecord[];
    } catch (err) {
      // First-run / missing file is fine; structural errors should not crash boot.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        // eslint-disable-next-line no-console
        console.warn("[recall_store] load failed:", err);
      }
    }
  }

  async persist(): Promise<void> {
    if (!this.opts.persist_path) return;
    const dir = path.dirname(this.opts.persist_path);
    await fs.mkdir(dir, { recursive: true }).catch(() => undefined);
    await fs.writeFile(
      this.opts.persist_path,
      JSON.stringify(this.records),
      "utf-8",
    );
  }

  size(): number {
    return this.records.length;
  }

  add(input: Omit<RecallRecord, "embedding" | "id" | "timestamp"> & {
    id?: string;
    timestamp?: number;
  }): RecallRecord {
    const rec: RecallRecord = {
      id: input.id ?? `r-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: input.timestamp ?? Date.now(),
      features: input.features,
      embedding: embedFeatures(input.features, EMBED_DIM),
      outcome: input.outcome,
      pnl: input.pnl,
      rr_realized: input.rr_realized,
      notes: input.notes,
      context: input.context,
    };
    this.records.push(rec);
    if (this.records.length > this.opts.max_records) {
      this.records.splice(0, this.records.length - this.opts.max_records);
    }
    return rec;
  }

  /** Retrieve top-K most similar past setups. */
  findSimilar(
    query: SetupFeatures,
    k = 10,
    threshold = 0.55,
  ): SimilarMatch[] {
    const q = embedFeatures(query, EMBED_DIM);
    const scored: SimilarMatch[] = [];
    for (const r of this.records) {
      const sim = cosineSim(q, r.embedding);
      if (sim >= threshold) scored.push({ record: r, similarity: sim });
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, k);
  }

  /** Aggregate summary across the most similar matches. */
  summarize(query: SetupFeatures, k = 25, threshold = 0.55): RecallSummary {
    const matches = this.findSimilar(query, k, threshold);
    if (matches.length === 0) {
      return { matches: 0, win_rate: 0, avg_pnl: 0, avg_rr: 0, failure_modes: [] };
    }
    const wins = matches.filter((m) => m.record.outcome === "win").length;
    const pnl = matches.reduce((a, m) => a + (m.record.pnl ?? 0), 0);
    const rr = matches
      .filter((m) => m.record.rr_realized !== undefined)
      .reduce((a, m) => a + (m.record.rr_realized ?? 0), 0);
    const rrCount = matches.filter((m) => m.record.rr_realized !== undefined).length || 1;
    const failures = matches
      .filter((m) => m.record.outcome === "loss" && m.record.notes)
      .map((m) => String(m.record.notes));
    const failureCounts = new Map<string, number>();
    for (const f of failures) failureCounts.set(f, (failureCounts.get(f) ?? 0) + 1);
    const sortedFailures = Array.from(failureCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([msg]) => msg);
    return {
      matches: matches.length,
      win_rate: wins / matches.length,
      avg_pnl: pnl / matches.length,
      avg_rr: rr / rrCount,
      failure_modes: sortedFailures,
    };
  }

  /** Confidence multiplier in [0.5, 1.5] derived from recall outcome stats. */
  recallConfidenceMultiplier(query: SetupFeatures): number {
    const s = this.summarize(query, 25);
    if (s.matches === 0) return 1;
    // Linear interp around 0.5 win rate
    const skill = (s.win_rate - 0.5) * 2; // -1 .. +1
    return Math.max(0.5, Math.min(1.5, 1 + skill * 0.5));
  }

  reset(): void {
    this.records = [];
  }
}

let SINGLETON: RecallStore | undefined;
export function getRecallStore(): RecallStore {
  if (!SINGLETON) {
    const dir = process.env.GODSVIEW_DATA_DIR ?? ".runtime";
    SINGLETON = new RecallStore({
      persist_path: path.join(dir, "recall_store.json"),
    });
  }
  return SINGLETON;
}
