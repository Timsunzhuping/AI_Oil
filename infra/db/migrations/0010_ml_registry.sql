-- =============================================================================
-- 0010_ml_registry.sql
-- ML model registry, versions, datasets, training jobs and inference endpoints.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ml_datasets — referenced inputs to training runs.
-- ---------------------------------------------------------------------------
CREATE TABLE ml_datasets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  description         TEXT,
  dataset_version     TEXT,
  storage_url         TEXT NOT NULL,                  -- s3://, gs://, file://
  format              TEXT,                            -- 'parquet','csv','jsonl','tfrecord'
  schema_definition   JSONB,                           -- column schema
  size_bytes          BIGINT,
  row_count           BIGINT,
  source_query        TEXT,                            -- if derived from a SQL query
  source_at           TIMESTAMPTZ,
  checksum            TEXT,
  splits              JSONB,                           -- {"train": 0.8, "val": 0.1, "test": 0.1}
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags                TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id),
  updated_by          UUID REFERENCES users(id),
  deleted_at          TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ml_datasets_tags_idx ON ml_datasets USING GIN (tags);
CREATE TRIGGER ml_datasets_set_updated_at BEFORE UPDATE ON ml_datasets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- ml_model_registry — the logical model identity.
-- ---------------------------------------------------------------------------
CREATE TABLE ml_model_registry (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  description         TEXT,
  task_type           TEXT NOT NULL
    CHECK (task_type IN (
      'classification','regression','embedding','llm','vision','clustering',
      'recommendation','time_series','reinforcement','formula_optimization'
    )),
  framework           TEXT,                            -- 'pytorch','tensorflow','sklearn','huggingface','xgboost','onnx'
  algorithm           TEXT,
  use_case            TEXT,                            -- 'property_prediction','formula_recommendation','anomaly_detection'

  current_version_id  UUID,                            -- FK added below
  total_versions      INTEGER NOT NULL DEFAULT 0,

  status              TEXT NOT NULL DEFAULT 'development'
    CHECK (status IN ('development','staged','production','retired','deprecated')),

  owner_id            UUID REFERENCES users(id),
  team                TEXT,

  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags                TEXT[] DEFAULT ARRAY[]::TEXT[],

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id),
  updated_by          UUID REFERENCES users(id),
  deleted_at          TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ml_model_registry_status_idx     ON ml_model_registry (status) WHERE deleted_at IS NULL;
CREATE INDEX ml_model_registry_task_type_idx  ON ml_model_registry (task_type) WHERE deleted_at IS NULL;
CREATE INDEX ml_model_registry_owner_idx      ON ml_model_registry (owner_id) WHERE deleted_at IS NULL;
CREATE INDEX ml_model_registry_tags_idx       ON ml_model_registry USING GIN (tags);
CREATE TRIGGER ml_model_registry_set_updated_at BEFORE UPDATE ON ml_model_registry
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- ml_model_versions — immutable artifact versions of a registered model.
-- ---------------------------------------------------------------------------
CREATE TABLE ml_model_versions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id            UUID NOT NULL REFERENCES ml_model_registry(id) ON DELETE CASCADE,
  version_number      INTEGER NOT NULL,
  version_label       TEXT,                            -- 'v1.2.0', '2026-04-prod'

  -- Artifact
  artifact_url        TEXT NOT NULL,
  artifact_hash       TEXT,                            -- sha256 of the model file
  artifact_size_bytes BIGINT,
  framework_version   TEXT,                            -- e.g. 'pytorch==2.2.0'

  -- Provenance
  training_job_id     UUID,                            -- FK added below to avoid cycle
  training_dataset_id UUID REFERENCES ml_datasets(id) ON DELETE SET NULL,
  source_code_repo    TEXT,
  source_code_commit  TEXT,
  base_model_version_id UUID REFERENCES ml_model_versions(id) ON DELETE SET NULL,  -- for fine-tunes

  -- Configuration
  hyperparameters     JSONB NOT NULL DEFAULT '{}'::jsonb,
  features            JSONB,                            -- input feature definitions
  output_schema       JSONB,

  -- Evaluation metrics
  metrics             JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"accuracy": 0.94, "rmse": 0.12}
  evaluation_dataset_id UUID REFERENCES ml_datasets(id) ON DELETE SET NULL,

  -- Deployment
  deployment_status   TEXT NOT NULL DEFAULT 'staged'
    CHECK (deployment_status IN ('staged','active','shadow','retired','rolled_back')),
  promoted_at         TIMESTAMPTZ,
  promoted_by         UUID REFERENCES users(id),
  retired_at          TIMESTAMPTZ,
  retired_by          UUID REFERENCES users(id),

  -- Approval
  approved_at         TIMESTAMPTZ,
  approved_by         UUID REFERENCES users(id),

  -- Documentation
  release_notes       TEXT,
  model_card_url      TEXT,                             -- link to a model card document

  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id),
  updated_by          UUID REFERENCES users(id),
  deleted_at          TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1,

  UNIQUE (model_id, version_number)
);
CREATE INDEX ml_model_versions_model_idx       ON ml_model_versions (model_id);
CREATE INDEX ml_model_versions_status_idx      ON ml_model_versions (deployment_status);
CREATE INDEX ml_model_versions_promoted_idx    ON ml_model_versions (promoted_at DESC) WHERE promoted_at IS NOT NULL;
CREATE INDEX ml_model_versions_metrics_idx     ON ml_model_versions USING GIN (metrics);
CREATE TRIGGER ml_model_versions_set_updated_at BEFORE UPDATE ON ml_model_versions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

ALTER TABLE ml_model_registry
  ADD CONSTRAINT ml_model_registry_current_version_fk
    FOREIGN KEY (current_version_id) REFERENCES ml_model_versions(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- ml_training_jobs — every training/fine-tuning run.
-- ---------------------------------------------------------------------------
CREATE TABLE ml_training_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE,             -- 'job-2026-05-04-abc123'
  model_id            UUID REFERENCES ml_model_registry(id) ON DELETE SET NULL,
  produced_version_id UUID REFERENCES ml_model_versions(id) ON DELETE SET NULL,

  -- Triggering
  trigger_type        TEXT NOT NULL DEFAULT 'manual'
    CHECK (trigger_type IN ('manual','scheduled','auto_retrain','api','webhook')),
  triggered_by        UUID REFERENCES users(id),

  -- Inputs
  dataset_id          UUID REFERENCES ml_datasets(id) ON DELETE SET NULL,
  config              JSONB NOT NULL DEFAULT '{}'::jsonb,    -- hyperparams, splits, runtime opts
  source_code_commit  TEXT,

  -- Status
  status              TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','provisioning','running','succeeded','failed','cancelled','timeout')),
  progress_percentage SMALLINT NOT NULL DEFAULT 0
    CHECK (progress_percentage BETWEEN 0 AND 100),

  -- Timing
  queued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  duration_seconds    INTEGER,

  -- Resources & cost
  compute_provider    TEXT,                              -- 'k8s','aws-batch','databricks','local'
  cluster             TEXT,
  cpu_cores           NUMERIC,
  gpu_count           INTEGER,
  gpu_type            TEXT,
  memory_peak_mb      INTEGER,
  cost                NUMERIC(14,4),
  cost_currency       CHAR(3) DEFAULT 'USD',

  -- Outcome
  metrics             JSONB NOT NULL DEFAULT '{}'::jsonb,
  artifact_url        TEXT,
  logs_url            TEXT,
  error_message       TEXT,
  error_trace         TEXT,

  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ml_training_jobs_model_idx     ON ml_training_jobs (model_id);
CREATE INDEX ml_training_jobs_status_idx    ON ml_training_jobs (status, queued_at DESC);
CREATE INDEX ml_training_jobs_started_idx   ON ml_training_jobs (started_at DESC);
CREATE INDEX ml_training_jobs_metrics_idx   ON ml_training_jobs USING GIN (metrics);
CREATE TRIGGER ml_training_jobs_set_updated_at BEFORE UPDATE ON ml_training_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

ALTER TABLE ml_model_versions
  ADD CONSTRAINT ml_model_versions_training_job_fk
    FOREIGN KEY (training_job_id) REFERENCES ml_training_jobs(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- ml_inference_endpoints — deployed serving endpoints (REST/gRPC) per version.
-- ---------------------------------------------------------------------------
CREATE TABLE ml_inference_endpoints (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE,
  model_version_id    UUID NOT NULL REFERENCES ml_model_versions(id) ON DELETE CASCADE,
  endpoint_url        TEXT NOT NULL,
  protocol            TEXT NOT NULL DEFAULT 'http' CHECK (protocol IN ('http','grpc','websocket')),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','degraded','offline','rolling')),
  region              TEXT,
  scaling_min         INTEGER NOT NULL DEFAULT 1,
  scaling_max         INTEGER NOT NULL DEFAULT 1,
  qps_limit           INTEGER,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ml_inference_endpoints_version_idx ON ml_inference_endpoints (model_version_id);
CREATE INDEX ml_inference_endpoints_status_idx  ON ml_inference_endpoints (status);
CREATE TRIGGER ml_inference_endpoints_set_updated_at BEFORE UPDATE ON ml_inference_endpoints
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

INSERT INTO schema_migrations (version, description)
  VALUES ('0010_ml_registry', 'datasets, model registry, versions, training jobs, endpoints')
  ON CONFLICT (version) DO NOTHING;
