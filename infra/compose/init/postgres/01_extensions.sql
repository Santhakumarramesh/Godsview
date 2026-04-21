-- GodsView v2 — Postgres extension bootstrap.
--
-- Runs once on the first container start (docker-entrypoint-initdb.d).
-- Extensions are created in the godsview database that POSTGRES_DB seeds.
--
-- Rationale per extension:
--   pgcrypto   — UUID generation + HMAC for audit-log row hashing.
--   citext     — case-insensitive email column on users.
--   pg_trgm    — trigram fuzzy search on audit log / recall text fields.
--   btree_gin  — composite GIN indexes for hybrid JSONB + scalar queries.
--
-- These must be present before Alembic runs its first migration.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Sanity: emit the list so the compose log proves init ran.
DO $$
BEGIN
  RAISE NOTICE 'godsview: extensions ready — pgcrypto, citext, pg_trgm, btree_gin';
END;
$$;
