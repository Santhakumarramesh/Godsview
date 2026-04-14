/**
 * Phase 103 — Recall Engine: deterministic embeddings
 * ====================================================
 * Pure-TS, dependency-free hashed feature embedding for trade setups.
 * Produces a fixed-length L2-normalized vector. Suitable for cosine-similarity
 * recall over trade memory without external embedding services.
 *
 * The model is intentionally simple (hashing trick + numeric features) so the
 * system stays self-contained, fast, and reproducible across nodes.
 */

export interface SetupFeatures {
  symbol: string;
  trend?: "bullish" | "bearish" | "neutral";
  structure?: string;
  setup_type?: string;
  session?: string;
  regime?: string;
  rr?: number;
  confidence?: number;
  liquidity_swept?: boolean;
  ob_present?: boolean;
  fvg_present?: boolean;
  delta?: number;
  imbalance?: number;
  /** Free-form tags or notes — hashed into the bag-of-words slots. */
  tags?: string[];
  /** Generic numeric metrics keyed by name — folded into separate slots. */
  metrics?: Record<string, number>;
}

export const EMBED_DIM = 128;

const PRIMES = [16777619, 2166136261, 31, 1099511628211];

function hashStr(s: string, seed = 0): number {
  let h = (PRIMES[0]! ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, PRIMES[1]!);
  }
  return h >>> 0;
}

function bucket(s: string, dim: number, seed = 0): number {
  return hashStr(s, seed) % dim;
}

function l2(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

export function embedFeatures(f: SetupFeatures, dim = EMBED_DIM): number[] {
  const v = new Array<number>(dim).fill(0);

  // Structured categorical slots (offset region 0..31)
  const cat = (key: string, value: string | undefined, weight = 1) => {
    if (!value) return;
    const idx = bucket(`${key}=${value}`, 32);
    v[idx]! += weight;
  };
  cat("symbol", f.symbol, 1.5);
  cat("trend", f.trend);
  cat("structure", f.structure);
  cat("setup_type", f.setup_type, 1.5);
  cat("session", f.session);
  cat("regime", f.regime);
  cat("liq_sweep", f.liquidity_swept ? "1" : "0");
  cat("ob", f.ob_present ? "1" : "0");
  cat("fvg", f.fvg_present ? "1" : "0");

  // Numeric slots (offset region 32..63) — bucketed quantization
  const numeric = (idx: number, value?: number) => {
    if (value === undefined || !Number.isFinite(value)) return;
    v[32 + (idx % 32)]! += value;
  };
  numeric(0, f.rr);
  numeric(1, f.confidence);
  numeric(2, f.delta);
  numeric(3, f.imbalance);
  if (f.metrics) {
    let i = 4;
    for (const [k, val] of Object.entries(f.metrics)) {
      const slot = (bucket(k, 32) + i) % 32;
      v[32 + slot]! += val;
      i++;
    }
  }

  // Bag-of-words tags (offset region 64..127)
  if (f.tags) {
    for (const t of f.tags) {
      const idx = 64 + bucket(t.toLowerCase(), 64);
      v[idx]! += 1;
    }
  }

  return l2(v);
}

export function cosineSim(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}
