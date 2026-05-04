-- =============================================================================
-- 0001_init_extensions.sql
-- Bootstrap PostgreSQL extensions and shared utilities used by every domain.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";      -- alternate UUID generators
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- trigram fuzzy text search
CREATE EXTENSION IF NOT EXISTS "btree_gin";      -- composite indexes on JSONB / arrays
CREATE EXTENSION IF NOT EXISTS "vector";         -- pgvector for embeddings (knowledge & ML)

-- ---------------------------------------------------------------------------
-- Migration ledger — records which files have been applied.
-- The runner (scripts/migrate.sh) inserts here after each successful file.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version       TEXT PRIMARY KEY,
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum      TEXT,
  description   TEXT
);

-- ---------------------------------------------------------------------------
-- Trigger function: maintain updated_at and bump version on every UPDATE.
-- All entity tables attach this trigger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at_and_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  IF TG_OP = 'UPDATE' THEN
    -- Optimistic-locking version bump unless the caller provided one explicitly
    IF NEW.version = OLD.version THEN
      NEW.version := OLD.version + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Reusable enum-like CHECK helpers (avoid native ENUM types — easier to extend)
-- Encoded as comments here for documentation. CHECK constraints are inlined
-- per table for compile-time guarantees.
--
--   record_status : draft | active | inactive | archived | deleted
--   workflow_state: draft | reviewing | approved | rejected | retired
--   priority      : low | medium | high | critical
--   severity      : info | warning | error | critical
-- ---------------------------------------------------------------------------

INSERT INTO schema_migrations (version, description)
  VALUES ('0001_init_extensions', 'extensions, migration ledger, shared trigger')
  ON CONFLICT (version) DO NOTHING;
