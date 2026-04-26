-- 0011_webhook_idempotency_audit_chain.sql
-- Two production-grade safety nets:
--
-- 1. webhook_idempotency: persistent idempotency-key store. The webhook route
--    insert here BEFORE doing any work; an existing row → 409 + cached envelope.
--
-- 2. audit_events.prev_hash + row_hash: tamper-evident chain. Every new audit
--    row's hash incorporates the previous row's hash (HMAC), so an attacker
--    cannot delete or rewrite a row in the middle without invalidating every
--    row that follows.
--
-- Both additions are idempotent and safe to re-run.

CREATE TABLE IF NOT EXISTS webhook_idempotency (
  id            SERIAL PRIMARY KEY,
  key           TEXT UNIQUE NOT NULL,
  source        TEXT NOT NULL DEFAULT 'tradingview',
  payload_hash  TEXT,
  envelope_json TEXT,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhook_idempotency_key_idx
  ON webhook_idempotency (key);

CREATE INDEX IF NOT EXISTS webhook_idempotency_created_idx
  ON webhook_idempotency (created_at);

-- Audit chain
ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS prev_hash TEXT;

ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS row_hash TEXT;

CREATE INDEX IF NOT EXISTS audit_events_row_hash_idx
  ON audit_events (row_hash);
