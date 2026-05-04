-- =============================================================================
-- 0012_integration.sql
-- Data Integration & Sync Foundation:
--   integration_sources    — registry of connected upstream systems
--   integration_jobs       — every sync invocation (full / incremental / retry)
--   integration_job_logs   — append-only event stream within a job
--   sync_snapshots         — cursor / watermark per (source, entity) pair
--   integration_schedules  — declarative cron-like schedule registry
-- =============================================================================

-- ---------------------------------------------------------------------------
-- integration_sources — what upstream systems we sync from.
-- `source_type` decides which adapter handles the source. `config` stores
-- non-secret connection info (URLs, paths, db names); secrets should live
-- in a real secret store and be referenced by name in `config`.
-- ---------------------------------------------------------------------------
CREATE TABLE integration_sources (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     TEXT NOT NULL UNIQUE,         -- 'sap_prod', 'lims_us_lab'
  name                     TEXT NOT NULL,
  source_type              TEXT NOT NULL                 -- 'sap' | 'lims' | 'file' | (extensible)
    CHECK (source_type IN ('sap','lims','file')),
  description              TEXT,

  -- Connection (URLs, hostnames, bucket names — NOT secrets)
  config                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_ref               TEXT,                          -- reference to secret manager entry, NOT the secret itself

  -- Capabilities discovered or configured per source
  supported_entities       TEXT[] DEFAULT ARRAY[]::TEXT[],
  default_retry_max        INTEGER NOT NULL DEFAULT 3,
  default_retry_backoff_ms INTEGER NOT NULL DEFAULT 30000,

  -- State
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at             TIMESTAMPTZ,
  last_successful_job_id   UUID,                          -- self-FK added later
  last_failed_job_id       UUID,
  consecutive_failures     INTEGER NOT NULL DEFAULT 0,

  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags                     TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               UUID REFERENCES users(id),
  updated_by               UUID REFERENCES users(id),
  deleted_at               TIMESTAMPTZ,
  version                  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX integration_sources_type_idx   ON integration_sources (source_type) WHERE deleted_at IS NULL;
CREATE INDEX integration_sources_active_idx ON integration_sources (is_active) WHERE deleted_at IS NULL;
CREATE INDEX integration_sources_tags_idx   ON integration_sources USING GIN (tags);
CREATE TRIGGER integration_sources_set_updated_at BEFORE UPDATE ON integration_sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- integration_jobs — every concrete sync attempt.
-- Each retry creates a NEW row pointing at the previous via parent_job_id.
-- ---------------------------------------------------------------------------
CREATE TABLE integration_jobs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id                UUID NOT NULL REFERENCES integration_sources(id) ON DELETE CASCADE,
  source_type              TEXT NOT NULL,                  -- denormalized for filtering
  entity_type              TEXT NOT NULL,                  -- 'raw_materials','test_results','documents',...

  job_type                 TEXT NOT NULL                   -- the kind of run requested
    CHECK (job_type IN ('full_sync','incremental_sync','manual','test')),
  trigger_type             TEXT NOT NULL DEFAULT 'manual'  -- how it was started
    CHECK (trigger_type IN ('manual','scheduled','event','retry','api')),
  triggered_by             UUID REFERENCES users(id),

  -- Retry chain
  parent_job_id            UUID REFERENCES integration_jobs(id) ON DELETE SET NULL,
  attempt_number           INTEGER NOT NULL DEFAULT 1,
  max_attempts             INTEGER NOT NULL DEFAULT 3,
  next_retry_at            TIMESTAMPTZ,                    -- populated when status = 'failed' and attempts remain

  -- Status & lifecycle
  status                   TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed','partial','cancelled','timeout')),
  trace_id                 TEXT NOT NULL,                  -- mandatory; correlates with backend logs
  span_id                  TEXT,

  -- Cursor window (incremental sync uses these)
  cursor_from              JSONB,                          -- where this run started reading from
  cursor_to                JSONB,                          -- watermark advanced to (set on success)

  -- Counters
  records_extracted        INTEGER NOT NULL DEFAULT 0,
  records_transformed      INTEGER NOT NULL DEFAULT 0,
  records_loaded           INTEGER NOT NULL DEFAULT 0,
  records_failed           INTEGER NOT NULL DEFAULT 0,
  records_skipped          INTEGER NOT NULL DEFAULT 0,

  -- Timing
  queued_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at               TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  duration_ms              INTEGER,

  -- Error capture
  error_class              TEXT,
  error_message            TEXT,
  error_stack              TEXT,

  -- Audit
  config_snapshot          JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,
  version                  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX integration_jobs_source_idx       ON integration_jobs (source_id, queued_at DESC);
CREATE INDEX integration_jobs_status_idx       ON integration_jobs (status, queued_at DESC);
CREATE INDEX integration_jobs_entity_idx       ON integration_jobs (entity_type, status, queued_at DESC);
CREATE INDEX integration_jobs_parent_idx       ON integration_jobs (parent_job_id) WHERE parent_job_id IS NOT NULL;
CREATE INDEX integration_jobs_retry_due_idx    ON integration_jobs (next_retry_at)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL;
CREATE INDEX integration_jobs_trace_idx        ON integration_jobs (trace_id);
CREATE TRIGGER integration_jobs_set_updated_at BEFORE UPDATE ON integration_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

ALTER TABLE integration_sources
  ADD CONSTRAINT integration_sources_last_success_fk
    FOREIGN KEY (last_successful_job_id) REFERENCES integration_jobs(id) ON DELETE SET NULL,
  ADD CONSTRAINT integration_sources_last_failed_fk
    FOREIGN KEY (last_failed_job_id) REFERENCES integration_jobs(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- integration_job_logs — append-only stream of phase events for a job.
-- Used to power the UI "tail" view and to debug failures.
-- ---------------------------------------------------------------------------
CREATE TABLE integration_job_logs (
  id            BIGSERIAL PRIMARY KEY,
  job_id        UUID NOT NULL REFERENCES integration_jobs(id) ON DELETE CASCADE,
  level         TEXT NOT NULL DEFAULT 'info'
    CHECK (level IN ('debug','info','warn','error','fatal')),
  phase         TEXT                                -- 'extract','transform','load','retry','finalize'
    CHECK (phase IS NULL OR phase IN ('init','extract','transform','load','retry','finalize')),
  message       TEXT NOT NULL,
  context       JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_id      TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX integration_job_logs_job_idx     ON integration_job_logs (job_id, occurred_at DESC);
CREATE INDEX integration_job_logs_level_idx   ON integration_job_logs (level, occurred_at DESC);
CREATE INDEX integration_job_logs_trace_idx   ON integration_job_logs (trace_id) WHERE trace_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- sync_snapshots — the "watermark" / cursor state for resumable incremental
-- sync. One row per (source, entity_type) pair.
-- `cursor_value` is opaque JSONB; each adapter defines its own shape.
-- ---------------------------------------------------------------------------
CREATE TABLE sync_snapshots (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id                   UUID NOT NULL REFERENCES integration_sources(id) ON DELETE CASCADE,
  entity_type                 TEXT NOT NULL,

  cursor_value                JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_full_sync_at           TIMESTAMPTZ,
  last_full_sync_job_id       UUID REFERENCES integration_jobs(id) ON DELETE SET NULL,
  last_incremental_sync_at    TIMESTAMPTZ,
  last_incremental_sync_job_id UUID REFERENCES integration_jobs(id) ON DELETE SET NULL,
  total_records_synced        BIGINT NOT NULL DEFAULT 0,

  last_payload_hash           TEXT,                       -- sha256 of the last batch
  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version                     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (source_id, entity_type)
);
CREATE INDEX sync_snapshots_source_idx ON sync_snapshots (source_id);
CREATE TRIGGER sync_snapshots_set_updated_at BEFORE UPDATE ON sync_snapshots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- integration_schedules — declarative cron-like schedule registry.
-- The scheduler ticks periodically and runs every schedule whose
-- next_run_at has passed.
-- ---------------------------------------------------------------------------
CREATE TABLE integration_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       UUID NOT NULL REFERENCES integration_sources(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL,
  job_type        TEXT NOT NULL DEFAULT 'incremental_sync'
    CHECK (job_type IN ('full_sync','incremental_sync')),

  -- Schedule expression — supports both cron syntax and an `every` interval.
  cron_expr       TEXT,                                  -- e.g., '*/15 * * * *'
  interval_minutes INTEGER,                               -- alternative simple form

  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  next_run_at     TIMESTAMPTZ,
  last_run_at     TIMESTAMPTZ,
  last_job_id     UUID REFERENCES integration_jobs(id) ON DELETE SET NULL,

  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES users(id),
  updated_by      UUID REFERENCES users(id),
  deleted_at      TIMESTAMPTZ,
  version         INTEGER NOT NULL DEFAULT 1,

  UNIQUE (source_id, entity_type, job_type),
  CHECK (cron_expr IS NOT NULL OR interval_minutes IS NOT NULL)
);
CREATE INDEX integration_schedules_due_idx
  ON integration_schedules (next_run_at)
  WHERE is_active = TRUE AND deleted_at IS NULL;
CREATE TRIGGER integration_schedules_set_updated_at BEFORE UPDATE ON integration_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

INSERT INTO schema_migrations (version, description)
  VALUES ('0012_integration', 'integration_sources, jobs, job_logs, sync_snapshots, schedules')
  ON CONFLICT (version) DO NOTHING;
