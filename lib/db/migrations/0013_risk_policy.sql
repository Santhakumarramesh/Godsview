-- 0013_risk_policy.sql
-- Persist the operator-editable risk policy. There is exactly ONE active
-- policy per org; old versions stay in the table for audit. The vc_pipeline
-- and assisted-live execute paths can read the active policy and apply it.
--
-- Schema is intentionally narrow: capture the values that actually change
-- behaviour today. New fields can be added with future migrations without
-- breaking row-level reads.

CREATE TABLE IF NOT EXISTS risk_policy (
  id                 SERIAL PRIMARY KEY,
  org_id             TEXT NOT NULL DEFAULT 'org_default',
  active             BOOLEAN NOT NULL DEFAULT FALSE,
  max_signal_age_sec INTEGER NOT NULL DEFAULT 300,
  min_rr             NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  max_exposure_usd   NUMERIC(12,2) NOT NULL DEFAULT 50000,
  dollar_risk        NUMERIC(10,2) NOT NULL DEFAULT 100,
  daily_loss_cap     NUMERIC(12,2) NOT NULL DEFAULT 500,
  max_daily_trades   INTEGER NOT NULL DEFAULT 10,
  max_open_positions INTEGER NOT NULL DEFAULT 5,
  set_by             TEXT NOT NULL DEFAULT 'system',
  reason             TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one active policy per org
CREATE UNIQUE INDEX IF NOT EXISTS risk_policy_active_uniq
  ON risk_policy (org_id) WHERE active = TRUE;

-- Seed a default policy if none exists
INSERT INTO risk_policy (org_id, active, set_by, reason)
SELECT 'org_default', TRUE, 'migration', 'initial default policy'
WHERE NOT EXISTS (SELECT 1 FROM risk_policy WHERE org_id = 'org_default' AND active = TRUE);
