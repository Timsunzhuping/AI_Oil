-- =============================================================================
-- 0007_experiments_tests.sql
-- Experiments (R&D trials) and test_results (individual measurements).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- test_methods — catalog of standardized test procedures (decoupled from results)
-- ---------------------------------------------------------------------------
CREATE TABLE test_methods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL UNIQUE,             -- e.g., 'PH', 'VISCOSITY_40C', 'GC_MS_PESTICIDES'
  name            TEXT NOT NULL,
  standard        TEXT,                              -- e.g., 'ASTM D445', 'ISO 3104'
  description     TEXT,
  unit_of_measure TEXT,
  data_type       TEXT NOT NULL DEFAULT 'numeric'
    CHECK (data_type IN ('numeric','text','boolean','spectrum','image','attachment')),
  category        TEXT,                              -- 'physical','chemical','microbiological','sensory'
  expected_min    NUMERIC(14,6),                     -- generic acceptable range
  expected_max    NUMERIC(14,6),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES users(id),
  updated_by      UUID REFERENCES users(id),
  deleted_at      TIMESTAMPTZ,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX test_methods_category_idx ON test_methods (category) WHERE deleted_at IS NULL;
CREATE TRIGGER test_methods_set_updated_at BEFORE UPDATE ON test_methods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- experiments — a single R&D trial (one batch / one optimization run / etc).
-- ---------------------------------------------------------------------------
CREATE TABLE experiments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT NOT NULL UNIQUE,
  title                 TEXT NOT NULL,
  description           TEXT,
  hypothesis            TEXT,

  -- What is being tested
  formula_version_id    UUID REFERENCES formula_versions(id) ON DELETE SET NULL,
  product_id            UUID REFERENCES products(id)         ON DELETE SET NULL,
  task_id               UUID,                                -- FK added in 0008 (R&D tasks)

  experiment_type       TEXT NOT NULL DEFAULT 'trial'
    CHECK (experiment_type IN ('trial','optimization','validation','stability','pilot','calibration')),

  status                TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','running','completed','failed','cancelled','on_hold')),

  -- Trial details
  procedure             TEXT,
  conditions            JSONB,                               -- {temp_c, humidity_pct, mixing_rpm, ...}
  batch_size            NUMERIC(14,4),
  batch_unit            TEXT NOT NULL DEFAULT 'kg',

  -- Scheduling
  scheduled_at          TIMESTAMPTZ,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  duration_minutes      INTEGER GENERATED ALWAYS AS (
    CASE WHEN started_at IS NOT NULL AND completed_at IS NOT NULL
         THEN EXTRACT(EPOCH FROM (completed_at - started_at))::INTEGER / 60
    END
  ) STORED,

  -- People & places
  conducted_by          UUID REFERENCES users(id),
  reviewer_id           UUID REFERENCES users(id),
  laboratory            TEXT,

  -- Outcome
  outcome               TEXT CHECK (outcome IN ('success','partial','failure','inconclusive')),
  conclusion            TEXT,
  follow_up_actions     TEXT,
  attachments           JSONB,                               -- file refs

  -- Cost / resource
  cost                  NUMERIC(14,4),
  cost_currency         CHAR(3) DEFAULT 'USD',

  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags                  TEXT[] DEFAULT ARRAY[]::TEXT[],

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID REFERENCES users(id),
  updated_by            UUID REFERENCES users(id),
  deleted_at            TIMESTAMPTZ,
  version               INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX experiments_formula_version_idx ON experiments (formula_version_id) WHERE deleted_at IS NULL;
CREATE INDEX experiments_product_idx         ON experiments (product_id) WHERE deleted_at IS NULL;
CREATE INDEX experiments_task_idx            ON experiments (task_id);
CREATE INDEX experiments_status_idx          ON experiments (status) WHERE deleted_at IS NULL;
CREATE INDEX experiments_type_idx            ON experiments (experiment_type) WHERE deleted_at IS NULL;
CREATE INDEX experiments_scheduled_idx       ON experiments (scheduled_at) WHERE deleted_at IS NULL;
CREATE INDEX experiments_conducted_by_idx    ON experiments (conducted_by) WHERE deleted_at IS NULL;
CREATE INDEX experiments_tags_idx            ON experiments USING GIN (tags);
CREATE INDEX experiments_conditions_idx      ON experiments USING GIN (conditions);

CREATE TRIGGER experiments_set_updated_at BEFORE UPDATE ON experiments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- test_results — the heart of "did the formula meet spec?"
-- A result MUST attach to at least one of: experiment, formula_version,
-- product, or raw_material. (For QA on incoming raw materials, the
-- experiment column is null and raw_material_id is set.)
-- ---------------------------------------------------------------------------
CREATE TABLE test_results (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What was tested
  experiment_id        UUID REFERENCES experiments(id) ON DELETE CASCADE,
  formula_version_id   UUID REFERENCES formula_versions(id) ON DELETE SET NULL,
  product_id           UUID REFERENCES products(id) ON DELETE SET NULL,
  raw_material_id      UUID REFERENCES raw_materials(id) ON DELETE SET NULL,
  sample_code          TEXT,                                -- physical sample identifier
  batch_code           TEXT,                                -- batch / lot reference

  -- Which test
  test_method_id       UUID REFERENCES test_methods(id) ON DELETE SET NULL,
  test_code            TEXT NOT NULL,                       -- denormalized snapshot
  test_name            TEXT NOT NULL,
  test_standard        TEXT,

  -- Measurement
  measured_value       NUMERIC(14,6),
  measured_text        TEXT,
  measured_boolean     BOOLEAN,
  measured_json        JSONB,                               -- spectra, time series, multi-dim
  unit_of_measure      TEXT,

  -- Spec & verdict
  expected_min         NUMERIC(14,6),
  expected_max         NUMERIC(14,6),
  expected_text        TEXT,
  pass                 BOOLEAN,                             -- pass/fail decision
  deviation_pct        NUMERIC(8,4),                        -- (measured - target) / target * 100

  -- Provenance
  measured_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  measured_by          UUID REFERENCES users(id),
  reviewer_id          UUID REFERENCES users(id),
  instrument_id        TEXT,                                -- equipment serial / inventory ID
  instrument_calibrated_at TIMESTAMPTZ,
  laboratory           TEXT,

  -- Attachments / raw data
  raw_data_url         TEXT,                                -- raw spectrum / dataset blob
  attachments          JSONB,                               -- list of file refs
  notes                TEXT,

  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags                 TEXT[] DEFAULT ARRAY[]::TEXT[],

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by           UUID REFERENCES users(id),
  updated_by           UUID REFERENCES users(id),
  deleted_at           TIMESTAMPTZ,
  version              INTEGER NOT NULL DEFAULT 1,

  -- At least one subject must be referenced
  CONSTRAINT test_results_subject_chk CHECK (
    experiment_id IS NOT NULL OR
    formula_version_id IS NOT NULL OR
    product_id IS NOT NULL OR
    raw_material_id IS NOT NULL
  )
);
CREATE INDEX test_results_experiment_idx      ON test_results (experiment_id) WHERE experiment_id IS NOT NULL;
CREATE INDEX test_results_formula_version_idx ON test_results (formula_version_id) WHERE formula_version_id IS NOT NULL;
CREATE INDEX test_results_product_idx         ON test_results (product_id) WHERE product_id IS NOT NULL;
CREATE INDEX test_results_raw_material_idx    ON test_results (raw_material_id) WHERE raw_material_id IS NOT NULL;
CREATE INDEX test_results_test_method_idx     ON test_results (test_method_id);
CREATE INDEX test_results_pass_idx            ON test_results (pass) WHERE pass IS NOT NULL;
CREATE INDEX test_results_measured_at_idx     ON test_results (measured_at DESC);
CREATE INDEX test_results_test_code_idx       ON test_results (test_code);
CREATE INDEX test_results_sample_idx          ON test_results (sample_code) WHERE sample_code IS NOT NULL;
CREATE INDEX test_results_tags_idx            ON test_results USING GIN (tags);

CREATE TRIGGER test_results_set_updated_at BEFORE UPDATE ON test_results
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

INSERT INTO schema_migrations (version, description)
  VALUES ('0007_experiments_tests', 'test_methods, experiments, test_results')
  ON CONFLICT (version) DO NOTHING;
