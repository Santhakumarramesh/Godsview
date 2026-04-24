import { createHash } from "node:crypto";
import { logger as _logger } from "./logger";
import { loadGuardState, persistGuardState } from "./guard_state_persistence";

export type ExecutionIdempotencyState = "IN_FLIGHT" | "DONE";

export interface ExecutionIdempotencyPolicy {
  ttl_ms: number;
  max_entries: number;
  require_key_in_live_mode: boolean;
  cache_5xx_responses: boolean;
}

export interface ExecutionIdempotencyRecord {
  key: string;
  fingerprint: string;
  state: ExecutionIdempotencyState;
  first_seen_at: string;
  updated_at: string;
  expires_at: string;
  response_status: number | null;
  response_body: unknown;
  replay_count: number;
  last_replay_at: string | null;
}

export interface ExecutionIdempotencySnapshot {
  policy: ExecutionIdempotencyPolicy;
  entries: number;
  hits: number;
  misses: number;
  conflicts: number;
  replays: number;
  last_updated_at: string | null;
  records: Array<{
    key: string;
    state: ExecutionIdempotencyState;
    response_status: number | null;
    replay_count: number;
    first_seen_at: string;
    updated_at: string;
    expires_at: string;
  }>;
}

export type BeginExecutionIdempotencyResult =
  | { action: "PROCEED"; key: string | null }
  | { action: "REPLAY"; key: string; status: number; body: unknown }
  | { action: "CONFLICT"; key: string; status: number; error: string; message: string };

interface PersistedExecutionIdempotencyState {
  records: ExecutionIdempotencyRecord[];
  counters: {
    hits: number;
    misses: number;
    conflicts: number;
    replays: number;
  };
  last_updated_at: string | null;
  persisted_at: string;
}

const logger = _logger.child({ module: "execution_idempotency" });
const STATE_FILE = "execution_idempotency_state.json";
const MAX_BODY_CHARS = 64_000;

const DEFAULT_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_ENTRIES = 2_000;

const _records = new Map<string, ExecutionIdempotencyRecord>();
let _hits = 0;
let _misses = 0;
let _conflicts = 0;
let _replays = 0;
let _lastUpdatedAt: string | null = null;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function parseIntEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return clampInt(parsed, min, max);
}

function boolEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase();
  if (!value) return fallback;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function policy(): ExecutionIdempotencyPolicy {
  return {
    ttl_ms: parseIntEnv(process.env.EXEC_IDEMPOTENCY_TTL_MS, DEFAULT_TTL_MS, 10_000, 24 * 60 * 60_000),
    max_entries: parseIntEnv(process.env.EXEC_IDEMPOTENCY_MAX_ENTRIES, DEFAULT_MAX_ENTRIES, 100, 20_000),
    require_key_in_live_mode: boolEnv(process.env.EXEC_IDEMPOTENCY_REQUIRE_KEY_LIVE, true),
    cache_5xx_responses: boolEnv(process.env.EXEC_IDEMPOTENCY_CACHE_5XX, false),
  };
}

function normalizeKey(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (value.length < 8 || value.length > 256) return null;
  return value;
}

function serializeSafe(value: unknown): unknown {
  try {
    const raw = JSON.stringify(value);
    if (!raw) return null;
    if (raw.length <= MAX_BODY_CHARS) {
      return JSON.parse(raw) as unknown;
    }
    return {
      truncated: true,
      max_chars: MAX_BODY_CHARS,
      preview: raw.slice(0, MAX_BODY_CHARS),
    };
  } catch {
    return { truncated: true, reason: "non_serializable" };
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function prune(nowMs: number, p: ExecutionIdempotencyPolicy): void {
  for (const [key, record] of _records.entries()) {
    const expiresAtMs = Date.parse(record.expires_at);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
      _records.delete(key);
    }
  }

  if (_records.size <= p.max_entries) return;
  const rows = Array.from(_records.values())
    .map((row) => ({ row, updatedMs: Date.parse(row.updated_at) || 0 }))
    .sort((a, b) => a.updatedMs - b.updatedMs);
  const removeCount = Math.max(0, rows.length - p.max_entries);
  for (let i = 0; i < removeCount; i++) {
    const key = rows[i]?.row.key;
    if (key) _records.delete(key);
  }
}

function persistState(): void {
  const payload: PersistedExecutionIdempotencyState = {
    records: Array.from(_records.values()),
    counters: {
      hits: _hits,
      misses: _misses,
      conflicts: _conflicts,
      replays: _replays,
    },
    last_updated_at: _lastUpdatedAt,
    persisted_at: new Date().toISOString(),
  };
  persistGuardState(STATE_FILE, payload);
}

function touchUpdatedAt(): void {
  _lastUpdatedAt = new Date().toISOString();
}

export function requireExecutionIdempotencyKeyInLiveMode(): boolean {
  return policy().require_key_in_live_mode;
}

export function buildExecutionFingerprint(input: {
  symbol: unknown;
  direction: unknown;
  setup_type: unknown;
  regime: unknown;
  entry_price: unknown;
  stop_loss: unknown;
  take_profit: unknown;
}): string {
  const normalized = {
    symbol: String(input.symbol ?? "").trim().toUpperCase(),
    direction: String(input.direction ?? "").trim().toLowerCase(),
    setup_type: String(input.setup_type ?? "auto").trim().toLowerCase(),
    regime: String(input.regime ?? "normal").trim().toLowerCase(),
    entry_price: Number(input.entry_price ?? Number.NaN),
    stop_loss: Number(input.stop_loss ?? Number.NaN),
    take_profit: Number(input.take_profit ?? Number.NaN),
  };
  return sha256(JSON.stringify(normalized));
}

export function beginExecutionIdempotency(input: {
  key: unknown;
  fingerprint: string;
}): BeginExecutionIdempotencyResult {
  const p = policy();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const key = normalizeKey(input.key);

  prune(nowMs, p);

  if (!key) {
    _misses += 1;
    touchUpdatedAt();
    return { action: "PROCEED", key: null };
  }

  const existing = _records.get(key);
  if (!existing) {
    _misses += 1;
    const created: ExecutionIdempotencyRecord = {
      key,
      fingerprint: input.fingerprint,
      state: "IN_FLIGHT",
      first_seen_at: nowIso,
      updated_at: nowIso,
      expires_at: new Date(nowMs + p.ttl_ms).toISOString(),
      response_status: null,
      response_body: null,
      replay_count: 0,
      last_replay_at: null,
    };
    _records.set(key, created);
    touchUpdatedAt();
    persistState();
    return { action: "PROCEED", key };
  }

  if (existing.fingerprint !== input.fingerprint) {
    _conflicts += 1;
    existing.updated_at = nowIso;
    existing.expires_at = new Date(nowMs + p.ttl_ms).toISOString();
    _records.set(key, existing);
    touchUpdatedAt();
    persistState();
    return {
      action: "CONFLICT",
      key,
      status: 409,
      error: "idempotency_key_payload_mismatch",
      message: "Idempotency key reused with a different execution payload.",
    };
  }

  existing.updated_at = nowIso;
  existing.expires_at = new Date(nowMs + p.ttl_ms).toISOString();

  if (existing.state === "IN_FLIGHT") {
    _conflicts += 1;
    _records.set(key, existing);
    touchUpdatedAt();
    persistState();
    return {
      action: "CONFLICT",
      key,
      status: 409,
      error: "idempotency_request_in_flight",
      message: "Execution request with this idempotency key is already in flight.",
    };
  }

  _hits += 1;
  _replays += 1;
  existing.replay_count += 1;
  existing.last_replay_at = nowIso;
  _records.set(key, existing);
  touchUpdatedAt();
  persistState();

  return {
    action: "REPLAY",
    key,
    status: existing.response_status ?? 200,
    body: existing.response_body,
  };
}

export function finalizeExecutionIdempotency(input: {
  key: unknown;
  fingerprint: string;
  status: number;
  body: unknown;
}): void {
  const p = policy();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const key = normalizeKey(input.key);
  if (!key) return;

  const existing = _records.get(key);
  if (existing && existing.fingerprint !== input.fingerprint) {
    logger.warn({ key }, "Idempotency finalize ignored due to fingerprint mismatch");
    return;
  }

  if (input.status >= 500 && !p.cache_5xx_responses) {
    _records.delete(key);
    touchUpdatedAt();
    persistState();
    return;
  }

  const base: ExecutionIdempotencyRecord = existing ?? {
    key,
    fingerprint: input.fingerprint,
    state: "IN_FLIGHT",
    first_seen_at: nowIso,
    updated_at: nowIso,
    expires_at: new Date(nowMs + p.ttl_ms).toISOString(),
    response_status: null,
    response_body: null,
    replay_count: 0,
    last_replay_at: null,
  };

  base.state = "DONE";
  base.updated_at = nowIso;
  base.expires_at = new Date(nowMs + p.ttl_ms).toISOString();
  base.response_status = clampInt(Number(input.status), 100, 599);
  base.response_body = serializeSafe(input.body);

  _records.set(key, base);
  prune(nowMs, p);
  touchUpdatedAt();
  persistState();
}

export function getExecutionIdempotencySnapshot(): ExecutionIdempotencySnapshot {
  const p = policy();
  prune(Date.now(), p);

  const records = Array.from(_records.values())
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, 50)
    .map((row) => ({
      key: row.key,
      state: row.state,
      response_status: row.response_status,
      replay_count: row.replay_count,
      first_seen_at: row.first_seen_at,
      updated_at: row.updated_at,
      expires_at: row.expires_at,
    }));

  return {
    policy: p,
    entries: _records.size,
    hits: _hits,
    misses: _misses,
    conflicts: _conflicts,
    replays: _replays,
    last_updated_at: _lastUpdatedAt,
    records,
  };
}

export function resetExecutionIdempotencyStore(): ExecutionIdempotencySnapshot {
  _records.clear();
  _hits = 0;
  _misses = 0;
  _conflicts = 0;
  _replays = 0;
  touchUpdatedAt();
  persistState();
  return getExecutionIdempotencySnapshot();
}

function loadState(): void {
  const payload = loadGuardState<PersistedExecutionIdempotencyState>(STATE_FILE);
  if (!payload) return;

  _records.clear();
  for (const row of Array.isArray(payload.records) ? payload.records : []) {
    if (!row || typeof row !== "object") continue;
    if (typeof row.key !== "string" || typeof row.fingerprint !== "string") continue;

    const state = row.state === "DONE" ? "DONE" : "IN_FLIGHT";
    _records.set(row.key, {
      key: row.key,
      fingerprint: row.fingerprint,
      state,
      first_seen_at: typeof row.first_seen_at === "string" ? row.first_seen_at : new Date().toISOString(),
      updated_at: typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString(),
      expires_at: typeof row.expires_at === "string" ? row.expires_at : new Date(Date.now() + policy().ttl_ms).toISOString(),
      response_status: Number.isFinite(Number(row.response_status)) ? clampInt(Number(row.response_status), 100, 599) : null,
      response_body: row.response_body ?? null,
      replay_count: clampInt(Number(row.replay_count ?? 0), 0, 1_000_000),
      last_replay_at: typeof row.last_replay_at === "string" ? row.last_replay_at : null,
    });
  }

  _hits = clampInt(Number(payload.counters?.hits ?? 0), 0, 10_000_000);
  _misses = clampInt(Number(payload.counters?.misses ?? 0), 0, 10_000_000);
  _conflicts = clampInt(Number(payload.counters?.conflicts ?? 0), 0, 10_000_000);
  _replays = clampInt(Number(payload.counters?.replays ?? 0), 0, 10_000_000);
  _lastUpdatedAt = typeof payload.last_updated_at === "string" ? payload.last_updated_at : null;

  prune(Date.now(), policy());
  logger.info({ entries: _records.size }, "[idempotency] state restored from disk");
}

loadState();
