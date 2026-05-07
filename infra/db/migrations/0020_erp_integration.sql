-- =============================================================================
-- 0020_erp_integration.sql
--
-- Enterprise integration (SAP / LIMS / Carbon) — purpose-built tables for
-- the business-domain integration layer in `apps/backend/src/modules/erp`.
--
--   erp_jobs           — one row per business sync / push / pull / lookup
--   erp_job_logs       — append-only event log (debug / info / warn / error)
--   lims_task_links    — internal experiment ↔ external LIMS task mapping
--
-- Why we don't reuse `integration_jobs`:
--   • The existing `integration_sources` CHECK constraint only allows
--     ('sap','lims','file') — this module needs 'carbon' too.
--   • Business semantics differ (push semantics for LIMS create_task, etc.)
--     and we don't want to require a seeded `integration_sources` row to
--     run mock-only smoke tests.
--   The README explains how the two layers complement each other.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- erp_jobs
-- -----------------------------------------------------------------------------
CREATE TABLE erp_jobs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     TEXT NOT NULL UNIQUE,                  -- ERP-YYYY-NNNNNN

  source_system            TEXT NOT NULL                          -- which upstream system
    CHECK (source_system IN ('sap','lims','carbon')),
  operation                TEXT NOT NULL                          -- the business action
    CHECK (operation IN (
      'sap_bom_sync','sap_cost_sync','sap_inventory_sync',
      'lims_create_task','lims_pull_result','lims_list_tasks',
      'carbon_material_lookup','carbon_formula_estimate'
    )),
  mode                     TEXT NOT NULL DEFAULT 'manual'
    CHECK (mode IN ('full','incremental','manual')),
  trigger_type             TEXT NOT NULL DEFAULT 'manual'
    CHECK (trigger_type IN ('manual','scheduled','event','retry','api')),

  adapter_name             TEXT NOT NULL,                          -- 'mock-sap','mock-lims','mock-carbon',…
  adapter_version          TEXT NOT NULL,
  adapter_mode             TEXT NOT NULL                            -- 'mock' | 'real'
    CHECK (adapter_mode IN ('mock','real')),

  -- Lifecycle
  status                   TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','partial','failed','cancelled','timeout')),
  attempt_number           INTEGER NOT NULL DEFAULT 1,
  max_attempts             INTEGER NOT NULL DEFAULT 3,
  parent_job_id            UUID REFERENCES erp_jobs(id) ON DELETE SET NULL,

  started_at               TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  duration_ms              INTEGER NOT NULL DEFAULT 0,

  -- Cursor (for SAP incremental syncs); JSONB so each adapter chooses shape
  cursor_from              JSONB,
  cursor_to                JSONB,

  -- Counters
  records_extracted        INTEGER NOT NULL DEFAULT 0,
  records_loaded           INTEGER NOT NULL DEFAULT 0,
  records_failed           INTEGER NOT NULL DEFAULT 0,
  records_skipped          INTEGER NOT NULL DEFAULT 0,

  -- Optional business reference (e.g. lims_task_links.id when operation='lims_create_task')
  reference_id             UUID,
  request_payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload         JSONB,

  -- Failure forensics
  error_class              TEXT,
  error_message            TEXT,

  -- Audit
  trace_id                 TEXT NOT NULL,
  triggered_by             UUID REFERENCES users(id),
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version                  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX erp_jobs_status_idx     ON erp_jobs (status, created_at DESC);
CREATE INDEX erp_jobs_source_idx     ON erp_jobs (source_system, operation, created_at DESC);
CREATE INDEX erp_jobs_trace_idx      ON erp_jobs (trace_id);
CREATE INDEX erp_jobs_reference_idx  ON erp_jobs (reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX erp_jobs_parent_idx     ON erp_jobs (parent_job_id) WHERE parent_job_id IS NOT NULL;
CREATE TRIGGER erp_jobs_set_updated_at BEFORE UPDATE ON erp_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

COMMENT ON TABLE erp_jobs IS 'One row per ERP integration call (SAP sync / LIMS push / LIMS pull / Carbon lookup). Captures full request/response, retry chain, and trace_id.';
COMMENT ON COLUMN erp_jobs.parent_job_id IS 'Set on retry rows to point at the original failed job.';

-- -----------------------------------------------------------------------------
-- erp_job_logs
-- -----------------------------------------------------------------------------
CREATE TABLE erp_job_logs (
  id            BIGSERIAL PRIMARY KEY,
  job_id        UUID NOT NULL REFERENCES erp_jobs(id) ON DELETE CASCADE,
  level         TEXT NOT NULL DEFAULT 'info'
    CHECK (level IN ('debug','info','warn','error','fatal')),
  phase         TEXT
    CHECK (phase IS NULL OR phase IN ('init','request','response','transform','retry','finalize')),
  message       TEXT NOT NULL,
  context       JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_id      TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX erp_job_logs_job_idx     ON erp_job_logs (job_id, occurred_at DESC);
CREATE INDEX erp_job_logs_level_idx   ON erp_job_logs (level, occurred_at DESC);
CREATE INDEX erp_job_logs_trace_idx   ON erp_job_logs (trace_id) WHERE trace_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- lims_task_links — maps internal experiment / formula version to external LIMS task
-- -----------------------------------------------------------------------------
CREATE TABLE lims_task_links (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_lims_task_id       TEXT NOT NULL,
  internal_experiment_id      UUID REFERENCES experiments(id) ON DELETE SET NULL,
  related_formula_id          UUID REFERENCES formulas(id) ON DELETE SET NULL,
  related_formula_version_id  UUID REFERENCES formula_versions(id) ON DELETE SET NULL,

  test_method                 TEXT,                                  -- 'KV_100C', 'NOACK', etc
  sample_count                INTEGER NOT NULL DEFAULT 1,

  status                      TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','submitted','in_progress','completed','failed','cancelled')),

  created_via                 TEXT NOT NULL DEFAULT 'api'
    CHECK (created_via IN ('api','manual','batch','event')),

  external_url                TEXT,
  external_status_raw         TEXT,                                  -- vendor-specific status string
  request_payload             JSONB NOT NULL DEFAULT '{}'::jsonb,    -- what we sent on create
  result_payload              JSONB,                                 -- what we received on pull
  result_pulled_at            TIMESTAMPTZ,

  last_create_job_id          UUID REFERENCES erp_jobs(id) ON DELETE SET NULL,
  last_pull_job_id            UUID REFERENCES erp_jobs(id) ON DELETE SET NULL,
  last_sync_at                TIMESTAMPTZ,

  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_id                    TEXT,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  UUID REFERENCES users(id),
  updated_by                  UUID REFERENCES users(id),
  version                     INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT lims_task_links_external_uk UNIQUE (external_lims_task_id)
);
CREATE INDEX lims_task_links_status_idx        ON lims_task_links (status, updated_at DESC);
CREATE INDEX lims_task_links_experiment_idx    ON lims_task_links (internal_experiment_id) WHERE internal_experiment_id IS NOT NULL;
CREATE INDEX lims_task_links_formula_idx       ON lims_task_links (related_formula_version_id) WHERE related_formula_version_id IS NOT NULL;
CREATE INDEX lims_task_links_method_idx        ON lims_task_links (test_method) WHERE test_method IS NOT NULL;
CREATE TRIGGER lims_task_links_set_updated_at BEFORE UPDATE ON lims_task_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

COMMENT ON TABLE  lims_task_links IS 'One row per LIMS task we created via /erp/lims/tasks; tracks status + result lineage from creation through result pull.';
COMMENT ON COLUMN lims_task_links.last_create_job_id IS 'erp_jobs.id of the most recent create call.';
COMMENT ON COLUMN lims_task_links.last_pull_job_id   IS 'erp_jobs.id of the most recent pull call.';
