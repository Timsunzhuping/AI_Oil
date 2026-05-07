-- =============================================================================
-- 0017_recommendation_engine.sql
--
-- Reverse Recommendation Service tables:
--   • recommendation_tasks  — one row per /recommend/generate call
--   • candidate_results     — one row per produced or recalculated candidate
--
-- Design notes:
--   - Inputs (target_metrics, material_pool, …) and constraints are persisted
--     as JSONB so the algorithm layer can evolve without migrations.
--   - random_seed is required so every task is REPLAYABLE end-to-end.
--   - candidate_results.parent_candidate_id captures the lineage of a
--     `recalculate` / `replace-material` modification.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- recommendation_tasks
-- -----------------------------------------------------------------------------
CREATE TABLE recommendation_tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT NOT NULL UNIQUE,                      -- REC-YYYY-NNNN

  -- ── inputs ────────────────────────────────────────────────────
  product_category      TEXT NOT NULL,
  application_scene     TEXT,
  strategy              TEXT NOT NULL
    CHECK (strategy IN ('cost_priority','material_replacement','new_product')),
  target_metrics        JSONB NOT NULL,                            -- TargetMetric[]
  cost_limit            NUMERIC,
  carbon_limit          NUMERIC,                                   -- reserved
  inventory_constraints JSONB NOT NULL DEFAULT '[]'::jsonb,
  material_pool         JSONB NOT NULL DEFAULT '[]'::jsonb,
  replacement_pool      JSONB NOT NULL DEFAULT '[]'::jsonb,
  locked_materials      JSONB NOT NULL DEFAULT '[]'::jsonb,
  process_constraints   JSONB NOT NULL DEFAULT '{}'::jsonb,
  n_candidates          INTEGER NOT NULL DEFAULT 5
                        CHECK (n_candidates BETWEEN 1 AND 10),

  -- ── reproducibility / model identity ──────────────────────────
  random_seed           BIGINT NOT NULL,
  model_code            TEXT NOT NULL,                             -- 'forward-predictor'
  model_version         TEXT NOT NULL,
  predictor_mode        TEXT NOT NULL CHECK (predictor_mode IN ('mock','real')),

  -- ── lifecycle ─────────────────────────────────────────────────
  status                TEXT NOT NULL
    CHECK (status IN ('processing','succeeded','partial','failed')),
  error_class           TEXT,
  error_message         TEXT,
  duration_ms           INTEGER NOT NULL DEFAULT 0,

  -- ── audit ─────────────────────────────────────────────────────
  summary               JSONB NOT NULL DEFAULT '{}'::jsonb,        -- { generated, filtered_out, evaluated, ranked }
  trace_id              TEXT NOT NULL,
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version               INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX recommendation_tasks_status_idx     ON recommendation_tasks (status, created_at DESC);
CREATE INDEX recommendation_tasks_created_at_idx ON recommendation_tasks (created_at DESC);
CREATE INDEX recommendation_tasks_strategy_idx   ON recommendation_tasks (strategy, created_at DESC);
CREATE INDEX recommendation_tasks_trace_idx      ON recommendation_tasks (trace_id);
CREATE INDEX recommendation_tasks_category_idx   ON recommendation_tasks (product_category);
CREATE TRIGGER recommendation_tasks_set_updated_at BEFORE UPDATE ON recommendation_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

COMMENT ON TABLE  recommendation_tasks IS 'Each /recommend/generate call writes one row that fully specifies the run (inputs, seed, model identity, summary).';
COMMENT ON COLUMN recommendation_tasks.random_seed IS 'Seed for the deterministic RNG; same seed + same inputs ⇒ same candidate set.';

-- -----------------------------------------------------------------------------
-- candidate_results
-- -----------------------------------------------------------------------------
CREATE TABLE candidate_results (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               UUID NOT NULL REFERENCES recommendation_tasks(id) ON DELETE CASCADE,

  rank                  INTEGER NOT NULL,                          -- 1-based
  name                  TEXT NOT NULL,
  headline              TEXT,
  origin                TEXT NOT NULL
    CHECK (origin IN ('generated','recalculated','replaced')),
  parent_candidate_id   UUID REFERENCES candidate_results(id) ON DELETE SET NULL,

  bom                   JSONB NOT NULL,                            -- BomItem[]
  predicted_metrics     JSONB NOT NULL DEFAULT '[]'::jsonb,        -- PredictedMetric[]
  estimated_cost        NUMERIC,
  cost_unit             TEXT NOT NULL DEFAULT 'CNY/kg',
  carbon_estimate       NUMERIC,                                   -- reserved

  risk_warnings         JSONB NOT NULL DEFAULT '[]'::jsonb,        -- RiskWarning[]
  constraint_match      JSONB NOT NULL DEFAULT '{}'::jsonb,        -- { passed[], failed[], score }
  composite_score       NUMERIC,
  score_breakdown       JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence            NUMERIC,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX candidate_results_task_idx    ON candidate_results (task_id, rank);
CREATE INDEX candidate_results_score_idx   ON candidate_results (task_id, composite_score DESC);
CREATE INDEX candidate_results_origin_idx  ON candidate_results (origin);
CREATE INDEX candidate_results_parent_idx  ON candidate_results (parent_candidate_id) WHERE parent_candidate_id IS NOT NULL;

COMMENT ON TABLE  candidate_results IS 'One row per generated or user-modified candidate formula; lineage tracked via parent_candidate_id.';
COMMENT ON COLUMN candidate_results.origin IS '"generated" by the engine, "recalculated" after user edits, "replaced" after a material swap.';
