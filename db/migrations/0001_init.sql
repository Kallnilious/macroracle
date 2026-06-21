-- Migration ledger. Every migration file is recorded here when applied.
-- The runner uses IF NOT EXISTS so this file is safe to reference before the table exists.
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          TEXT PRIMARY KEY,        -- filename, e.g. '0001_init.sql'
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
