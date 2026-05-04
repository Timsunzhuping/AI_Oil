-- =============================================================================
-- 0013_cleaning.sql
-- Data Cleaning & Standardization layer:
--   normalized_materials       — clean material refs with raw + standard side-by-side
--   normalized_metrics         — clean metric refs
--   normalized_test_results    — the central clean fact table for ML / analytics
--   data_quality_issues        — granular per-issue records (one issue = one row)
--   cleaning_rules             — declarative JSON-DSL rule registry
--   cleaning_runs              — ledger of every pipeline execution
--
-- Convention: NEVER mutate the raw source. Every normalized row carries
-- BOTH `raw_value` and `normalized_value` so a human can audit the
-- transformation. Outliers are FLAGGED, never dropped.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- cleaning_runs — every pipeline execution, with summary counters.
-- ---------------------------------------------------------------------------
CREATE TABLE cleaning_runs (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type                TEXT NOT NULL DEFAULT 'manual'
    CHECK (trigger_type IN ('manual','scheduled','integration_job','api')),
  triggered_by                UUID REFERENCES users(id),
  source_integration_job_id   UUID REFERENCES integration_jobs(id) ON DELETE SET NULL,
  trace_id                    TEXT NOT NULL,

  -- Scope filter applied to this run
  entity_type                 TEXT NOT NULL DEFAULT 'test_results'
    CHECK (entity_type IN ('test_results','materials','metrics','formula_items','all')),
  scope_filter                JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Counters (populated as the run progresses)
  records_processed           INTEGER NOT NULL DEFAULT 0,
  records_normalized          INTEGER NOT NULL DEFAULT 0,
  records_skipped             INTEGER NOT NULL DEFAULT 0,
  issues_found                INTEGER NOT NULL DEFAULT 0,
  outliers_found              INTEGER NOT NULL DEFAULT 0,
  unresolved_found            INTEGER NOT NULL DEFAULT 0,
  missing_found               INTEGER NOT NULL DEFAULT 0,

  status                      TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','partial','failed','cancelled')),
  started_at                  TIMESTAMPTZ,
  completed_at                TIMESTAMPTZ,
  duration_ms                 INTEGER,
  error_message               TEXT,

  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX cleaning_runs_status_idx     ON cleaning_runs (status, created_at DESC);
CREATE INDEX cleaning_runs_trace_idx      ON cleaning_runs (trace_id);
CREATE INDEX cleaning_runs_integration_idx ON cleaning_runs (source_integration_job_id);

-- ---------------------------------------------------------------------------
-- cleaning_rules — declarative rules used by the pipeline.
-- ---------------------------------------------------------------------------
CREATE TABLE cleaning_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,

  rule_type       TEXT NOT NULL
    CHECK (rule_type IN ('standardization','validation','outlier','linkage','enrichment')),
  scope           TEXT NOT NULL
    CHECK (scope IN ('material','metric','unit','test_result','formula_item','global')),
  severity        TEXT NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info','warning','error','critical')),

  -- DSL trees: { all: [...] } / { any: [...] } / { fact, op, value }
  condition_expr  JSONB NOT NULL,
  action_expr     JSONB NOT NULL,                 -- { flag: 'outlier', issue_code: 'PH_OOR' }

  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  priority        INTEGER NOT NULL DEFAULT 0,
  fired_count     BIGINT NOT NULL DEFAULT 0,
  last_fired_at   TIMESTAMPTZ,

  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES users(id),
  updated_by      UUID REFERENCES users(id),
  deleted_at      TIMESTAMPTZ,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX cleaning_rules_active_idx ON cleaning_rules (is_active, scope) WHERE deleted_at IS NULL;
CREATE INDEX cleaning_rules_type_idx   ON cleaning_rules (rule_type, scope) WHERE deleted_at IS NULL;
CREATE TRIGGER cleaning_rules_set_updated_at BEFORE UPDATE ON cleaning_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- normalized_materials — raw material reference cleaned to a canonical record.
-- ---------------------------------------------------------------------------
CREATE TABLE normalized_materials (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaning_run_id      UUID REFERENCES cleaning_runs(id) ON DELETE SET NULL,

  -- Canonical FK (NULL when unresolved)
  raw_material_id      UUID REFERENCES raw_materials(id) ON DELETE SET NULL,

  -- Raw side
  raw_value            JSONB NOT NULL,             -- the entire incoming payload
  raw_name             TEXT,
  raw_code             TEXT,
  source_system        TEXT,                        -- 'sap','lims','file','manual'
  source_record_id     TEXT,                        -- external_id

  -- Normalized side
  normalized_name      TEXT,
  normalized_code      TEXT,
  resolution_method    TEXT
    CHECK (resolution_method IS NULL OR resolution_method IN ('code','alias','fuzzy','manual','unresolved')),
  resolution_confidence NUMERIC(4,3),

  -- Quality flags
  is_unresolved        BOOLEAN NOT NULL DEFAULT FALSE,
  has_quality_issues   BOOLEAN NOT NULL DEFAULT FALSE,

  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ,
  version              INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX normalized_materials_raw_idx       ON normalized_materials (raw_material_id);
CREATE INDEX normalized_materials_run_idx       ON normalized_materials (cleaning_run_id);
CREATE INDEX normalized_materials_unresolved_idx ON normalized_materials (is_unresolved) WHERE is_unresolved = TRUE;
CREATE INDEX normalized_materials_source_idx    ON normalized_materials (source_system, source_record_id);
CREATE TRIGGER normalized_materials_set_updated_at BEFORE UPDATE ON normalized_materials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- normalized_metrics — raw metric reference cleaned to a canonical record.
-- ---------------------------------------------------------------------------
CREATE TABLE normalized_metrics (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaning_run_id      UUID REFERENCES cleaning_runs(id) ON DELETE SET NULL,

  metric_id            UUID REFERENCES metrics(id) ON DELETE SET NULL,

  raw_value            JSONB NOT NULL,
  raw_name             TEXT,
  raw_unit             TEXT,
  source_system        TEXT,
  source_record_id     TEXT,

  normalized_name      TEXT,
  normalized_code      TEXT,
  normalized_unit      TEXT,
  unit_id              UUID REFERENCES units(id) ON DELETE SET NULL,

  resolution_method    TEXT
    CHECK (resolution_method IS NULL OR resolution_method IN ('code','alias','fuzzy','manual','unresolved')),
  resolution_confidence NUMERIC(4,3),

  is_unresolved        BOOLEAN NOT NULL DEFAULT FALSE,
  has_quality_issues   BOOLEAN NOT NULL DEFAULT FALSE,

  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ,
  version              INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX normalized_metrics_metric_idx      ON normalized_metrics (metric_id);
CREATE INDEX normalized_metrics_unit_idx        ON normalized_metrics (unit_id);
CREATE INDEX normalized_metrics_run_idx         ON normalized_metrics (cleaning_run_id);
CREATE INDEX normalized_metrics_unresolved_idx  ON normalized_metrics (is_unresolved) WHERE is_unresolved = TRUE;
CREATE TRIGGER normalized_metrics_set_updated_at BEFORE UPDATE ON normalized_metrics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- normalized_test_results — THE central clean fact table.
-- One row per measurement; raw + normalized values side-by-side; outliers
-- flagged not dropped; full lineage to source row.
-- ---------------------------------------------------------------------------
CREATE TABLE normalized_test_results (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaning_run_id          UUID REFERENCES cleaning_runs(id) ON DELETE SET NULL,

  -- Source lineage
  source_test_result_id    UUID REFERENCES test_results(id) ON DELETE CASCADE,
  source_external_id       TEXT,
  source_system            TEXT,

  -- Subject linkage (the joins the BOM/batch/version question requires)
  raw_material_id          UUID REFERENCES raw_materials(id) ON DELETE SET NULL,
  product_id               UUID REFERENCES products(id) ON DELETE SET NULL,
  formula_id               UUID REFERENCES formulas(id) ON DELETE SET NULL,
  formula_version_id       UUID REFERENCES formula_versions(id) ON DELETE SET NULL,
  experiment_id            UUID REFERENCES experiments(id) ON DELETE SET NULL,
  sample_code              TEXT,
  batch_code               TEXT,

  -- Standardized metric
  metric_id                UUID REFERENCES metrics(id) ON DELETE SET NULL,
  metric_code              TEXT,                      -- denormalized for fast filter

  -- Values — raw + normalized side by side
  raw_value                JSONB NOT NULL,            -- complete original payload
  raw_measured_value       NUMERIC(20,6),
  raw_unit                 TEXT,
  normalized_value         NUMERIC(20,6),
  normalized_unit          TEXT,
  unit_id                  UUID REFERENCES units(id) ON DELETE SET NULL,
  conversion_applied       BOOLEAN NOT NULL DEFAULT FALSE,
  conversion_factor        NUMERIC(20,10),
  conversion_offset        NUMERIC(20,10),

  -- Quality flags
  is_missing               BOOLEAN NOT NULL DEFAULT FALSE,
  is_unresolved            BOOLEAN NOT NULL DEFAULT FALSE,   -- couldn't resolve metric/unit
  is_outlier               BOOLEAN NOT NULL DEFAULT FALSE,
  outlier_methods          TEXT[] DEFAULT ARRAY[]::TEXT[],   -- e.g. ['spec','iqr']
  outlier_score            NUMERIC,

  -- Spec compliance
  pass                     BOOLEAN,
  expected_min             NUMERIC(20,6),
  expected_max             NUMERIC(20,6),

  has_quality_issues       BOOLEAN NOT NULL DEFAULT FALSE,
  issue_count              INTEGER NOT NULL DEFAULT 0,

  -- Provenance
  measured_at              TIMESTAMPTZ,
  measured_by              UUID REFERENCES users(id),

  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,
  version                  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX normalized_test_results_source_idx       ON normalized_test_results (source_test_result_id);
CREATE INDEX normalized_test_results_metric_idx       ON normalized_test_results (metric_id) WHERE metric_id IS NOT NULL;
CREATE INDEX normalized_test_results_metric_code_idx  ON normalized_test_results (metric_code);
CREATE INDEX normalized_test_results_formula_ver_idx  ON normalized_test_results (formula_version_id) WHERE formula_version_id IS NOT NULL;
CREATE INDEX normalized_test_results_product_idx      ON normalized_test_results (product_id) WHERE product_id IS NOT NULL;
CREATE INDEX normalized_test_results_batch_idx        ON normalized_test_results (batch_code);
CREATE INDEX normalized_test_results_outlier_idx      ON normalized_test_results (is_outlier) WHERE is_outlier = TRUE;
CREATE INDEX normalized_test_results_unresolved_idx   ON normalized_test_results (is_unresolved) WHERE is_unresolved = TRUE;
CREATE INDEX normalized_test_results_missing_idx      ON normalized_test_results (is_missing) WHERE is_missing = TRUE;
CREATE INDEX normalized_test_results_run_idx          ON normalized_test_results (cleaning_run_id);
CREATE INDEX normalized_test_results_measured_at_idx  ON normalized_test_results (measured_at DESC);
CREATE INDEX normalized_test_results_quality_idx      ON normalized_test_results (has_quality_issues) WHERE has_quality_issues = TRUE;

-- One normalized row per source row (idempotent re-runs UPSERT)
CREATE UNIQUE INDEX normalized_test_results_source_uniq
  ON normalized_test_results (source_test_result_id)
  WHERE source_test_result_id IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER normalized_test_results_set_updated_at BEFORE UPDATE ON normalized_test_results
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- data_quality_issues — granular issue records (one problem per row).
-- A single normalized_test_results row may have many issues.
-- ---------------------------------------------------------------------------
CREATE TABLE data_quality_issues (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Where the issue lives
  entity_type           TEXT NOT NULL
    CHECK (entity_type IN ('test_result','material','metric','unit','formula_item','document')),
  entity_id             UUID,                           -- normalized_*.id
  source_entity_type    TEXT,                           -- 'test_results','raw_materials',...
  source_entity_id      UUID,                           -- the raw row id

  -- The issue itself
  issue_type            TEXT NOT NULL
    CHECK (issue_type IN (
      'missing_value','unresolved_material','unresolved_metric','unresolved_unit',
      'outlier','spec_violation','unit_mismatch','duplicate','invalid_format',
      'missing_required_field','linkage_failed','rule_violation'
    )),
  severity              TEXT NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info','warning','error','critical')),
  field                 TEXT,                           -- which field triggered it
  rule_code             TEXT,                           -- rule that fired (if any)

  raw_value             JSONB,
  expected_value        JSONB,
  message               TEXT NOT NULL,

  -- Resolution
  status                TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','acknowledged','fixed','wont_fix','duplicate')),
  resolved_at           TIMESTAMPTZ,
  resolved_by           UUID REFERENCES users(id),
  resolution_notes      TEXT,

  -- Provenance
  cleaning_run_id       UUID REFERENCES cleaning_runs(id) ON DELETE SET NULL,
  trace_id              TEXT,

  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);
CREATE INDEX data_quality_issues_entity_idx       ON data_quality_issues (entity_type, entity_id);
CREATE INDEX data_quality_issues_source_idx       ON data_quality_issues (source_entity_type, source_entity_id);
CREATE INDEX data_quality_issues_type_idx         ON data_quality_issues (issue_type, severity);
CREATE INDEX data_quality_issues_open_idx         ON data_quality_issues (status, created_at DESC) WHERE status = 'open';
CREATE INDEX data_quality_issues_run_idx          ON data_quality_issues (cleaning_run_id);
CREATE INDEX data_quality_issues_trace_idx        ON data_quality_issues (trace_id);

INSERT INTO schema_migrations (version, description)
  VALUES ('0013_cleaning', 'normalized_*, data_quality_issues, cleaning_rules, cleaning_runs')
  ON CONFLICT (version) DO NOTHING;
