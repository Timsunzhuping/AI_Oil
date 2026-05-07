-- =============================================================================
-- 0023_evaluation.sql
--
-- Test & acceptance support module — three tables:
--
--   acceptance_test_sets    — independent, versioned test datasets
--                             (forward / inverse / stability)
--   acceptance_runs         — one row per acceptance run; carries summary
--                             metrics + report payload + model identity
--   acceptance_results      — per-case (per-test-row) outcome
--
-- Designed to be the substrate for both automated CI gates and human-driven
-- UAT — the same row schema works whichever way you trigger a run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- acceptance_test_sets
-- -----------------------------------------------------------------------------
CREATE TABLE acceptance_test_sets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT NOT NULL UNIQUE,                  -- TS-YYYY-NNNN
  name                  TEXT NOT NULL,
  description           TEXT,
  test_type             TEXT NOT NULL
    CHECK (test_type IN ('forward','inverse','stability')),

  product_category      TEXT,                                  -- optional grouping

  /* Each entry has a stable shape per `test_type`. The runner validates
   * required keys at run time. Forward example:
   *   { id, category?, bom: [...], expected_metrics: { KV_100C: 11.4, ... } }
   * Inverse example:
   *   { id, category?, request: { product_category, target_metrics, ... },
   *     expectations: { min_passed_candidates, max_cost, must_include } }
   * Stability example:
   *   { id, category?, mode: 'predict' | 'recommend',
   *     payload: { ... }, runs: 5 } */
  cases                 JSONB NOT NULL DEFAULT '[]'::jsonb,

  /* Tolerance defaults applied when a case omits its own. */
  default_tolerance     JSONB NOT NULL DEFAULT '{}'::jsonb,

  /* Optional link to ml_datasets if the cases were materialised from one. */
  source_dataset_id     UUID REFERENCES ml_datasets(id) ON DELETE SET NULL,

  status                TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),

  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags                  TEXT[] DEFAULT ARRAY[]::TEXT[],

  trace_id              TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID REFERENCES users(id),
  updated_by            UUID REFERENCES users(id),
  deleted_at            TIMESTAMPTZ,
  version               INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX acceptance_test_sets_type_idx     ON acceptance_test_sets (test_type, status) WHERE deleted_at IS NULL;
CREATE INDEX acceptance_test_sets_category_idx ON acceptance_test_sets (product_category) WHERE deleted_at IS NULL;
CREATE INDEX acceptance_test_sets_tags_idx     ON acceptance_test_sets USING GIN (tags);
CREATE TRIGGER acceptance_test_sets_set_updated_at BEFORE UPDATE ON acceptance_test_sets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- -----------------------------------------------------------------------------
-- acceptance_runs
-- -----------------------------------------------------------------------------
CREATE TABLE acceptance_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT NOT NULL UNIQUE,                  -- AR-YYYY-NNNNNN
  test_set_id           UUID NOT NULL REFERENCES acceptance_test_sets(id) ON DELETE CASCADE,
  test_type             TEXT NOT NULL
    CHECK (test_type IN ('forward','inverse','stability')),

  status                TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','partial','failed','cancelled')),

  /* Model identity captured at run time (mirrors prediction's adapter info). */
  model_code            TEXT NOT NULL,
  model_version         TEXT NOT NULL,
  predictor_mode        TEXT NOT NULL CHECK (predictor_mode IN ('mock','real')),

  /* Run configuration: tolerance overrides, case filter, repeat count, etc. */
  config                JSONB NOT NULL DEFAULT '{}'::jsonb,

  /* Aggregate report — a JSON-typed structure shaped per `test_type`. The
   * frontend reads this directly to render dashboards. */
  summary               JSONB NOT NULL DEFAULT '{}'::jsonb,

  /* Counters surfaced for fast filtering. */
  cases_total           INTEGER NOT NULL DEFAULT 0,
  cases_passed          INTEGER NOT NULL DEFAULT 0,
  cases_failed          INTEGER NOT NULL DEFAULT 0,

  /* Lifecycle. */
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  duration_ms           INTEGER NOT NULL DEFAULT 0,

  trigger_type          TEXT NOT NULL DEFAULT 'manual'
    CHECK (trigger_type IN ('manual','api','scheduled','ci','uat')),
  triggered_by          UUID REFERENCES users(id),

  trace_id              TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,

  error_class           TEXT,
  error_message         TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version               INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX acceptance_runs_test_set_idx ON acceptance_runs (test_set_id, created_at DESC);
CREATE INDEX acceptance_runs_status_idx   ON acceptance_runs (status, created_at DESC);
CREATE INDEX acceptance_runs_type_idx     ON acceptance_runs (test_type, created_at DESC);
CREATE INDEX acceptance_runs_model_idx    ON acceptance_runs (model_code, model_version);
CREATE INDEX acceptance_runs_trace_idx    ON acceptance_runs (trace_id) WHERE trace_id IS NOT NULL;
CREATE TRIGGER acceptance_runs_set_updated_at BEFORE UPDATE ON acceptance_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

COMMENT ON TABLE acceptance_runs IS 'One row per acceptance run. summary holds the report payload; the frontend renders directly from it.';

-- -----------------------------------------------------------------------------
-- acceptance_results — per-case outcome
-- -----------------------------------------------------------------------------
CREATE TABLE acceptance_results (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                UUID NOT NULL REFERENCES acceptance_runs(id) ON DELETE CASCADE,
  case_id               TEXT NOT NULL,
  case_index            INTEGER NOT NULL,
  category              TEXT,
  passed                BOOLEAN NOT NULL,

  /* Numeric metrics: shape depends on test_type. Examples:
   *   forward    → { mape, mae, hit_rate, n_metrics }
   *   inverse    → { passed_candidates, top1_feasible, top1_cost, ... }
   *   stability  → { pairwise_cosine_avg, cv_avg, max_cv } */
  metrics               JSONB NOT NULL DEFAULT '{}'::jsonb,

  /* Forensics. */
  expected              JSONB,
  predicted             JSONB,
  raw_payload           JSONB,
  failure_reason        TEXT,
  duration_ms           INTEGER NOT NULL DEFAULT 0,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX acceptance_results_run_idx       ON acceptance_results (run_id, case_index);
CREATE INDEX acceptance_results_passed_idx    ON acceptance_results (run_id, passed);
CREATE INDEX acceptance_results_category_idx  ON acceptance_results (run_id, category) WHERE category IS NOT NULL;

COMMENT ON TABLE acceptance_results IS 'One row per (run × test case). Carries the per-case metrics, predicted vs expected snapshot, and failure reason for forensics.';
