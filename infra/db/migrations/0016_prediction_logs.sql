-- =============================================================================
-- 0016_prediction_logs.sql
-- Forward Prediction Service — request/response audit log.
--
-- Every call to /api/v1/predict/* (single / batch / explain) is appended here
-- so the team can audit model behaviour, replay inputs, debug regressions and
-- compute downstream metrics (e.g. predict-vs-actual deltas after lab tests).
-- =============================================================================

CREATE TABLE prediction_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- High-level routing
  request_type          TEXT NOT NULL
    CHECK (request_type IN ('single','batch','explain')),

  -- Predictor metadata
  model_code            TEXT NOT NULL,                         -- 'forward-predictor'
  model_version         TEXT NOT NULL,                         -- 'mock-v1' | 'pytorch-1.4.2' …
  predictor_mode        TEXT NOT NULL                          -- 'mock' | 'real'
    CHECK (predictor_mode IN ('mock','real')),

  -- Inputs
  product_category      TEXT,
  formula_version_id    UUID,                                  -- nullable: BOM-only requests are valid
  target_metrics        TEXT[]    DEFAULT ARRAY[]::TEXT[],
  bom_items             JSONB     NOT NULL DEFAULT '[]'::jsonb,
  request_payload       JSONB     NOT NULL DEFAULT '{}'::jsonb,

  -- Outputs
  response_payload      JSONB,
  status                TEXT      NOT NULL
    CHECK (status IN ('success','partial','failed')),
  error_class           TEXT,
  error_message         TEXT,

  -- Performance
  duration_ms           INTEGER   NOT NULL DEFAULT 0,

  -- Batch grouping (when request_type='batch')
  batch_id              UUID,
  batch_index           INTEGER,

  -- Correlation
  trace_id              TEXT      NOT NULL,
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX prediction_logs_created_at_idx     ON prediction_logs (created_at DESC);
CREATE INDEX prediction_logs_request_type_idx   ON prediction_logs (request_type, created_at DESC);
CREATE INDEX prediction_logs_status_idx         ON prediction_logs (status) WHERE status <> 'success';
CREATE INDEX prediction_logs_trace_idx          ON prediction_logs (trace_id);
CREATE INDEX prediction_logs_batch_idx          ON prediction_logs (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX prediction_logs_formula_idx        ON prediction_logs (formula_version_id) WHERE formula_version_id IS NOT NULL;
CREATE INDEX prediction_logs_model_idx          ON prediction_logs (model_code, model_version, created_at DESC);

COMMENT ON TABLE  prediction_logs IS 'Audit log for all forward-prediction requests; every API call writes one (single/explain) or many (batch) rows.';
COMMENT ON COLUMN prediction_logs.predictor_mode IS '"mock" when serving from MockPredictor, "real" when hitting an actual model adapter.';
COMMENT ON COLUMN prediction_logs.bom_items      IS 'Verbatim BOM items submitted by the caller, kept for replay even if formula_versions table changes.';
COMMENT ON COLUMN prediction_logs.batch_id       IS 'Shared across all rows produced by one batch request, so grouping queries are cheap.';
