-- 0014_accuracy_results_pricing_columns.sql
-- The Drizzle schema (lib/db/src/schema/market_cache.ts) added pricing columns
-- to accuracy_results (source/entry_price/stop_loss/take_profit/realized_pnl)
-- but the production Postgres table predates that schema. The historical_seeder
-- INSERTs reference these columns and crash with "column does not exist".
--
-- Idempotent: ADD COLUMN IF NOT EXISTS lets this re-run safely on any DB,
-- whether or not earlier ad-hoc patches already added some of these columns.

ALTER TABLE accuracy_results ADD COLUMN IF NOT EXISTS source        TEXT DEFAULT 'live';
ALTER TABLE accuracy_results ADD COLUMN IF NOT EXISTS entry_price   NUMERIC(14,6);
ALTER TABLE accuracy_results ADD COLUMN IF NOT EXISTS stop_loss     NUMERIC(14,6);
ALTER TABLE accuracy_results ADD COLUMN IF NOT EXISTS take_profit   NUMERIC(14,6);
ALTER TABLE accuracy_results ADD COLUMN IF NOT EXISTS realized_pnl  NUMERIC(14,4);
