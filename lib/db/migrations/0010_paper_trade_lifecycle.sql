-- 0010_paper_trade_lifecycle.sql
-- Hardens paper-trade and signal lifecycle for production-grade tracking.
--
--  - signals.rejection_reason  : human-readable reason persisted alongside status='rejected'
--  - trades.rejection_reason   : same, for trades that were created in 'rejected' state
--  - trades.status             : explicit lifecycle column with CHECK constraint
--  - trades.updated_at         : maintained by application code (Drizzle / VC pipeline)
--  - signals.status            : CHECK constraint to bound the lifecycle
--
-- All ADD COLUMN / ADD CONSTRAINT statements use IF NOT EXISTS to keep this
-- migration idempotent and safe for re-runs.

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- Bound the trade lifecycle states.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trades_status_check'
  ) THEN
    ALTER TABLE trades
      ADD CONSTRAINT trades_status_check
      CHECK (status IN ('pending', 'open', 'closed', 'rejected', 'cancelled'));
  END IF;
END $$;

-- Bound signal lifecycle.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'signals_status_check'
  ) THEN
    ALTER TABLE signals
      ADD CONSTRAINT signals_status_check
      CHECK (status IN ('pending', 'received', 'validating', 'enriching',
                        'scoring', 'decided', 'approved', 'rejected',
                        'expired', 'executed'));
  END IF;
END $$;

-- Index for "last rejection per symbol" lookups used by /api/system/status
CREATE INDEX IF NOT EXISTS signals_status_idx ON signals (status);
CREATE INDEX IF NOT EXISTS trades_status_idx  ON trades  (status);
CREATE INDEX IF NOT EXISTS audit_decision_idx ON audit_events (decision_state);
