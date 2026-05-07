-- =============================================================================
-- 0021_ml_platform.sql
--
-- Model Factory / MLOps platform — extends the foundational ml_* tables
-- (created in 0010) with three new tables that the platform module needs:
--
--   ml_feature_templates       — reusable named feature configurations
--   ml_model_releases          — release / rollback audit log
--   ml_auto_finetune_triggers  — rules that auto-kick retraining
--
-- Existing tables we already use as-is:
--   ml_datasets / ml_model_registry / ml_model_versions /
--   ml_training_jobs / ml_inference_endpoints
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ml_feature_templates — reusable named feature spec
-- -----------------------------------------------------------------------------
CREATE TABLE ml_feature_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE,                  -- FT-YYYY-NNNN
  name                TEXT NOT NULL,
  description         TEXT,
  task_type           TEXT NOT NULL                            -- mirrors ml_model_registry.task_type
    CHECK (task_type IN (
      'classification','regression','embedding','llm','vision','clustering',
      'recommendation','time_series','reinforcement','formula_optimization'
    )),

  /* Spec is opaque JSON; the trainer adapter validates internally. Common shape:
   *   { "features": [{ "name": "kv_100c", "type": "numeric", "transform": "standardise" }, …],
   *     "label":     { "name": "noack", "type": "numeric" },
   *     "splits":    { "train": 0.8, "val": 0.1, "test": 0.1 } } */
  spec                JSONB NOT NULL DEFAULT '{}'::jsonb,

  /* Where the materialised feature table lives (parquet on s3://, snowflake table, …). */
  feature_set_version TEXT,
  storage_url         TEXT,

  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),

  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags                TEXT[] DEFAULT ARRAY[]::TEXT[],

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id),
  updated_by          UUID REFERENCES users(id),
  deleted_at          TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ml_feature_templates_status_idx    ON ml_feature_templates (status) WHERE deleted_at IS NULL;
CREATE INDEX ml_feature_templates_task_type_idx ON ml_feature_templates (task_type) WHERE deleted_at IS NULL;
CREATE INDEX ml_feature_templates_tags_idx      ON ml_feature_templates USING GIN (tags);
CREATE TRIGGER ml_feature_templates_set_updated_at BEFORE UPDATE ON ml_feature_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- -----------------------------------------------------------------------------
-- ml_model_releases — every release / rollback / shadow action
-- -----------------------------------------------------------------------------
CREATE TABLE ml_model_releases (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     TEXT NOT NULL UNIQUE,                    -- REL-YYYY-NNNNNN
  model_id                 UUID NOT NULL REFERENCES ml_model_registry(id) ON DELETE CASCADE,
  to_version_id            UUID REFERENCES ml_model_versions(id) ON DELETE SET NULL,
  /* Previous active version (filled at release time so rollback can target it). */
  from_version_id          UUID REFERENCES ml_model_versions(id) ON DELETE SET NULL,

  action                   TEXT NOT NULL
    CHECK (action IN ('release','rollback','shadow_promote','shadow_demote','retire')),
  /* Target environment / channel; production plays the canonical role. */
  environment              TEXT NOT NULL DEFAULT 'production'
    CHECK (environment IN ('production','staging','shadow')),

  status                   TEXT NOT NULL DEFAULT 'succeeded'
    CHECK (status IN ('queued','running','succeeded','failed','rolled_back')),

  /* Audit */
  reason                   TEXT,
  notes                    TEXT,
  approved_by              UUID REFERENCES users(id),
  released_by              UUID REFERENCES users(id),
  released_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  /* Optional gate: only allow if these regression checks pass. */
  guardrails               JSONB NOT NULL DEFAULT '{}'::jsonb,
  guardrails_passed        BOOLEAN,

  /* Snapshot of the version the operation produced — preserved even if the
   * version row is later mutated. */
  released_artifact_url    TEXT,
  metrics_snapshot         JSONB NOT NULL DEFAULT '{}'::jsonb,

  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_id                 TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ml_model_releases_model_idx       ON ml_model_releases (model_id, released_at DESC);
CREATE INDEX ml_model_releases_action_idx      ON ml_model_releases (action, released_at DESC);
CREATE INDEX ml_model_releases_status_idx      ON ml_model_releases (status);
CREATE INDEX ml_model_releases_to_version_idx  ON ml_model_releases (to_version_id);

COMMENT ON TABLE  ml_model_releases IS 'Audit log for model release/rollback/shadow actions. One row per /models/:id/release or /rollback call.';

-- -----------------------------------------------------------------------------
-- ml_auto_finetune_triggers — declarative auto-retrain rules
-- -----------------------------------------------------------------------------
CREATE TABLE ml_auto_finetune_triggers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     TEXT NOT NULL UNIQUE,                  -- FTR-YYYY-NNNN
  model_id                 UUID NOT NULL REFERENCES ml_model_registry(id) ON DELETE CASCADE,
  feature_template_id      UUID REFERENCES ml_feature_templates(id) ON DELETE SET NULL,
  /* Default dataset to retrain on; overrideable per-trigger fire. */
  default_dataset_id       UUID REFERENCES ml_datasets(id) ON DELETE SET NULL,

  /* Trigger condition. Common shapes:
   *   { "type": "drift",       "metric": "psi",  "threshold": 0.2 }
   *   { "type": "metric_drop", "metric": "rmse", "threshold": 0.1 }
   *   { "type": "schedule",    "cron": "0 3 * * 1" }
   *   { "type": "data_volume", "rows_delta": 10000 } */
  condition                JSONB NOT NULL DEFAULT '{}'::jsonb,

  /* Default config overrides (hyperparameters, max_epochs, …) for fired runs. */
  config                   JSONB NOT NULL DEFAULT '{}'::jsonb,

  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  last_fired_at            TIMESTAMPTZ,
  last_fired_job_id        UUID REFERENCES ml_training_jobs(id) ON DELETE SET NULL,
  fire_count               INTEGER NOT NULL DEFAULT 0,

  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               UUID REFERENCES users(id),
  updated_by               UUID REFERENCES users(id),
  deleted_at               TIMESTAMPTZ,
  version                  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ml_auto_finetune_triggers_model_idx  ON ml_auto_finetune_triggers (model_id) WHERE deleted_at IS NULL;
CREATE INDEX ml_auto_finetune_triggers_active_idx ON ml_auto_finetune_triggers (is_active) WHERE deleted_at IS NULL;
CREATE TRIGGER ml_auto_finetune_triggers_set_updated_at BEFORE UPDATE ON ml_auto_finetune_triggers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

COMMENT ON TABLE ml_auto_finetune_triggers IS 'Declarative rules that fire ml_training_jobs automatically (drift detection, scheduled, threshold-based).';
