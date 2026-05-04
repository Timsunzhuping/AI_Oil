-- =============================================================================
-- 0014_features.sql
-- Sample base tables and feature foundation for forward prediction and
-- inverse recommendation models.
--
--   feature_definitions               — the "feature dictionary" catalog
--   feature_generation_runs           — every generation invocation
--   formula_version_features          — per-formula-version feature cache
--   material_batch_features           — per-(material, batch) feature snapshot
--   mart_forward_training_sample      — wide table for FORWARD model (X, y)
--   mart_inverse_generation_base      — anchor catalog for INVERSE recommender
-- =============================================================================

-- ---------------------------------------------------------------------------
-- feature_definitions — the dictionary of every feature this platform ships.
-- ---------------------------------------------------------------------------
CREATE TABLE feature_definitions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_set_version TEXT NOT NULL,                    -- 'v1.0','v2.0'
  feature_name        TEXT NOT NULL,                    -- 'weighted_density'
  feature_group       TEXT NOT NULL                     -- one of the engineered families
    CHECK (feature_group IN ('structure','weighted_property','log_mix','complexity','cost','functional','target')),
  data_type           TEXT NOT NULL DEFAULT 'numeric'
    CHECK (data_type IN ('numeric','categorical','boolean','array')),
  scope               TEXT NOT NULL DEFAULT 'formula_version'
    CHECK (scope IN ('formula_version','material_batch','sample')),

  description         TEXT NOT NULL,
  formula_text        TEXT,                              -- math / pseudocode
  unit                TEXT,
  inputs              JSONB,                             -- {table, columns}

  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  display_order       INTEGER NOT NULL DEFAULT 0,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1,

  UNIQUE (feature_set_version, feature_name)
);
CREATE INDEX feature_definitions_set_idx   ON feature_definitions (feature_set_version) WHERE deleted_at IS NULL;
CREATE INDEX feature_definitions_group_idx ON feature_definitions (feature_group);
CREATE TRIGGER feature_definitions_set_updated_at BEFORE UPDATE ON feature_definitions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- feature_generation_runs — ledger of every generation job.
-- ---------------------------------------------------------------------------
CREATE TABLE feature_generation_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_set_version TEXT NOT NULL,
  trigger_type        TEXT NOT NULL DEFAULT 'manual'
    CHECK (trigger_type IN ('manual','scheduled','api','cleaning_run')),
  triggered_by        UUID REFERENCES users(id),
  source_cleaning_run_id UUID REFERENCES cleaning_runs(id) ON DELETE SET NULL,
  trace_id            TEXT NOT NULL,

  scope_filter        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { product_category, since, formula_ids }

  records_processed   INTEGER NOT NULL DEFAULT 0,
  records_generated   INTEGER NOT NULL DEFAULT 0,
  records_failed      INTEGER NOT NULL DEFAULT 0,
  records_skipped     INTEGER NOT NULL DEFAULT 0,

  status              TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','partial','failed','cancelled')),
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  duration_ms         INTEGER,
  error_message       TEXT,

  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX feature_generation_runs_status_idx  ON feature_generation_runs (status, created_at DESC);
CREATE INDEX feature_generation_runs_set_idx     ON feature_generation_runs (feature_set_version, created_at DESC);
CREATE INDEX feature_generation_runs_trace_idx   ON feature_generation_runs (trace_id);

-- ---------------------------------------------------------------------------
-- formula_version_features — per-(formula_version, feature_set_version) row.
-- Hot columns (num_items, weighted_density, etc.) are materialized for fast
-- SQL filtering; the full wide vector lives in `features` JSONB.
-- ---------------------------------------------------------------------------
CREATE TABLE formula_version_features (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_version_id       UUID NOT NULL REFERENCES formula_versions(id) ON DELETE CASCADE,
  feature_set_version      TEXT NOT NULL,
  generation_run_id        UUID REFERENCES feature_generation_runs(id) ON DELETE SET NULL,

  features                 JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Hot columns (denormalized from `features` for query speed)
  num_items                INTEGER,
  num_phases               INTEGER,
  num_active               INTEGER,
  total_active_pct         NUMERIC(8,4),
  weighted_density         NUMERIC(10,4),
  weighted_viscosity_log   NUMERIC(12,6),
  blended_viscosity_cst    NUMERIC(12,4),                -- Refutas-blended viscosity
  total_cost               NUMERIC(14,4),
  cost_currency            CHAR(3) DEFAULT 'USD',
  complexity_entropy       NUMERIC(8,5),

  -- Provenance
  computed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  has_missing_inputs       BOOLEAN NOT NULL DEFAULT FALSE,
  missing_inputs           JSONB NOT NULL DEFAULT '[]'::jsonb,

  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,
  version                  INTEGER NOT NULL DEFAULT 1,

  UNIQUE (formula_version_id, feature_set_version)
);
CREATE INDEX formula_version_features_set_idx     ON formula_version_features (feature_set_version);
CREATE INDEX formula_version_features_run_idx     ON formula_version_features (generation_run_id);
CREATE INDEX formula_version_features_features_idx ON formula_version_features USING GIN (features);
CREATE INDEX formula_version_features_cost_idx    ON formula_version_features (total_cost) WHERE total_cost IS NOT NULL;
CREATE TRIGGER formula_version_features_set_updated_at BEFORE UPDATE ON formula_version_features
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- material_batch_features — per-(material, batch) feature snapshot.
-- Captures lot-specific deviations from the master record (e.g., this batch
-- of PAO came in at 6.2 cSt instead of the spec 6.0).
-- ---------------------------------------------------------------------------
CREATE TABLE material_batch_features (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id          UUID NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  batch_code               TEXT NOT NULL,
  supplier_id              UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  feature_set_version      TEXT NOT NULL,
  generation_run_id        UUID REFERENCES feature_generation_runs(id) ON DELETE SET NULL,

  features                 JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Hot columns
  density                  NUMERIC(10,4),
  viscosity_cst            NUMERIC(12,4),
  flash_point_c            NUMERIC(8,2),
  ph_value                 NUMERIC(4,2),
  measured_at              TIMESTAMPTZ,

  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,
  version                  INTEGER NOT NULL DEFAULT 1,

  UNIQUE (raw_material_id, batch_code, feature_set_version)
);
CREATE INDEX material_batch_features_material_idx ON material_batch_features (raw_material_id);
CREATE INDEX material_batch_features_set_idx      ON material_batch_features (feature_set_version);
CREATE INDEX material_batch_features_run_idx      ON material_batch_features (generation_run_id);
CREATE TRIGGER material_batch_features_set_updated_at BEFORE UPDATE ON material_batch_features
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- mart_forward_training_sample — the wide (X, y) table for FORWARD models.
-- One row per (formula_version, batch_code, feature_set_version).
-- ---------------------------------------------------------------------------
CREATE TABLE mart_forward_training_sample (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_set_version         TEXT NOT NULL,
  generation_run_id           UUID REFERENCES feature_generation_runs(id) ON DELETE SET NULL,

  -- Sample identity / partitioning
  formula_version_id          UUID NOT NULL REFERENCES formula_versions(id) ON DELETE CASCADE,
  formula_id                  UUID REFERENCES formulas(id) ON DELETE SET NULL,
  product_id                  UUID REFERENCES products(id) ON DELETE SET NULL,
  product_category_code       TEXT,                                  -- enables per-category training
  experiment_id               UUID REFERENCES experiments(id) ON DELETE SET NULL,
  batch_code                  TEXT,

  -- Inputs (X) — the feature vector
  features                    JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Targets (y) — the metrics this sample achieved
  target_metrics              JSONB NOT NULL DEFAULT '{}'::jsonb,    -- {"KV_100C": 10.4, "VI": 167}
  target_metric_codes         TEXT[] DEFAULT ARRAY[]::TEXT[],        -- for fast filtering

  -- Sample weighting / inclusion
  is_outlier                  BOOLEAN NOT NULL DEFAULT FALSE,
  is_complete                 BOOLEAN NOT NULL DEFAULT TRUE,
  has_targets                 BOOLEAN NOT NULL DEFAULT TRUE,
  weight                      NUMERIC(8,4) NOT NULL DEFAULT 1.0,

  -- Provenance
  source_normalized_test_result_ids UUID[] DEFAULT ARRAY[]::UUID[],
  measured_at                 TIMESTAMPTZ,

  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                  TIMESTAMPTZ,
  version                     INTEGER NOT NULL DEFAULT 1,

  UNIQUE (formula_version_id, batch_code, feature_set_version)
);
CREATE INDEX mart_forward_set_idx              ON mart_forward_training_sample (feature_set_version);
CREATE INDEX mart_forward_category_idx         ON mart_forward_training_sample (product_category_code);
CREATE INDEX mart_forward_formula_idx          ON mart_forward_training_sample (formula_version_id);
CREATE INDEX mart_forward_targets_idx          ON mart_forward_training_sample USING GIN (target_metric_codes);
CREATE INDEX mart_forward_features_idx         ON mart_forward_training_sample USING GIN (features);
CREATE INDEX mart_forward_complete_idx         ON mart_forward_training_sample (is_complete, has_targets) WHERE is_complete = TRUE AND has_targets = TRUE;
CREATE INDEX mart_forward_run_idx              ON mart_forward_training_sample (generation_run_id);
CREATE TRIGGER mart_forward_training_sample_set_updated_at BEFORE UPDATE ON mart_forward_training_sample
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- mart_inverse_generation_base — anchor catalog for the INVERSE recommender.
-- One row per (formula_version, feature_set_version) with averaged
-- achieved-performance over its batches and constraint summary.
-- ---------------------------------------------------------------------------
CREATE TABLE mart_inverse_generation_base (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_set_version      TEXT NOT NULL,
  generation_run_id        UUID REFERENCES feature_generation_runs(id) ON DELETE SET NULL,

  formula_version_id       UUID NOT NULL REFERENCES formula_versions(id) ON DELETE CASCADE,
  formula_id               UUID REFERENCES formulas(id) ON DELETE SET NULL,
  product_id               UUID REFERENCES products(id) ON DELETE SET NULL,
  product_category_code    TEXT,

  -- Composition (the search space the inverse model varies)
  features                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  composition_vector       JSONB NOT NULL DEFAULT '{}'::jsonb,    -- {raw_material_id: percentage}

  -- Achieved performance (averaged + std over batches)
  achieved_metrics         JSONB NOT NULL DEFAULT '{}'::jsonb,    -- {"KV_100C": {mean: 10.4, std: 0.2}}
  sample_size              INTEGER NOT NULL DEFAULT 0,

  -- Generator guardrails
  ingredient_constraints   JSONB,                                  -- {raw_material_id: {min_pct, max_pct}}
  cost_target              NUMERIC(14,4),
  cost_currency            CHAR(3) DEFAULT 'USD',
  status                   TEXT NOT NULL DEFAULT 'active'          -- 'active' | 'archived'
    CHECK (status IN ('active','archived')),

  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,
  version                  INTEGER NOT NULL DEFAULT 1,

  UNIQUE (formula_version_id, feature_set_version)
);
CREATE INDEX mart_inverse_set_idx          ON mart_inverse_generation_base (feature_set_version);
CREATE INDEX mart_inverse_category_idx     ON mart_inverse_generation_base (product_category_code);
CREATE INDEX mart_inverse_status_idx       ON mart_inverse_generation_base (status) WHERE deleted_at IS NULL;
CREATE INDEX mart_inverse_features_idx     ON mart_inverse_generation_base USING GIN (features);
CREATE INDEX mart_inverse_metrics_idx      ON mart_inverse_generation_base USING GIN (achieved_metrics);
CREATE INDEX mart_inverse_run_idx          ON mart_inverse_generation_base (generation_run_id);
CREATE TRIGGER mart_inverse_generation_base_set_updated_at BEFORE UPDATE ON mart_inverse_generation_base
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

INSERT INTO schema_migrations (version, description)
  VALUES ('0014_features', 'feature_definitions, feature_generation_runs, formula_version_features, material_batch_features, mart_forward_training_sample, mart_inverse_generation_base')
  ON CONFLICT (version) DO NOTHING;
