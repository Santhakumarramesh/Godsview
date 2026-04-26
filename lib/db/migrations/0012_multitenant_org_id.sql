-- 0012_multitenant_org_id.sql
-- Multi-tenant scaffold. Adds nullable org_id to the four core tables. Once
-- every row carries an org_id, a follow-up migration can flip the column to
-- NOT NULL and add per-org indexes.
--
-- Why nullable now: existing single-tenant data has no org_id, and we don't
-- want this migration to reject. Application code MUST start writing org_id
-- on every new row when the X-Org-Id header is present (or the configured
-- default `org_default`).
--
-- Idempotent — safe to re-run.

ALTER TABLE signals        ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE trades         ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE audit_events   ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE brain_entities ADD COLUMN IF NOT EXISTS org_id TEXT;

CREATE INDEX IF NOT EXISTS signals_org_id_idx        ON signals (org_id);
CREATE INDEX IF NOT EXISTS trades_org_id_idx         ON trades (org_id);
CREATE INDEX IF NOT EXISTS audit_events_org_id_idx   ON audit_events (org_id);
CREATE INDEX IF NOT EXISTS brain_entities_org_id_idx ON brain_entities (org_id);
