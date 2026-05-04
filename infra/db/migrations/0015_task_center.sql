-- =============================================================================
-- 0015_task_center.sql
-- R&D Task Center — extends r_and_d_tasks (from migration 0008) and adds
-- inputs / outputs / events / templates tables.
--
-- Two co-existing semantics on r_and_d_tasks:
--   task_kind = 'project_task'   (legacy / Jira-style — todo/in_progress/done)
--   task_kind = 'ai_workflow'    (this module — draft/submitted/processing/completed/failed/archived)
--
-- The state machine for ai_workflow lives in the application layer; the
-- DB only enforces the allowed value set via CHECK constraint.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend r_and_d_tasks with task-center columns and relaxed CHECKs.
-- ---------------------------------------------------------------------------
ALTER TABLE r_and_d_tasks
  ADD COLUMN IF NOT EXISTS task_kind TEXT NOT NULL DEFAULT 'project_task',
  ADD COLUMN IF NOT EXISTS input_mode TEXT,
  ADD COLUMN IF NOT EXISTS template_id UUID,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_class TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS handler_version TEXT,
  ADD COLUMN IF NOT EXISTS trace_id TEXT,
  ADD COLUMN IF NOT EXISTS summary TEXT;

-- task_kind discriminator
ALTER TABLE r_and_d_tasks DROP CONSTRAINT IF EXISTS r_and_d_tasks_task_kind_check;
ALTER TABLE r_and_d_tasks ADD CONSTRAINT r_and_d_tasks_task_kind_check
  CHECK (task_kind IN ('project_task', 'ai_workflow'));

-- input_mode (only meaningful for ai_workflow)
ALTER TABLE r_and_d_tasks DROP CONSTRAINT IF EXISTS r_and_d_tasks_input_mode_check;
ALTER TABLE r_and_d_tasks ADD CONSTRAINT r_and_d_tasks_input_mode_check
  CHECK (input_mode IS NULL OR input_mode IN ('structured','natural_language','template'));

-- task_type — extend allowed values to cover both project + AI workflow kinds
ALTER TABLE r_and_d_tasks DROP CONSTRAINT IF EXISTS r_and_d_tasks_task_type_check;
ALTER TABLE r_and_d_tasks ADD CONSTRAINT r_and_d_tasks_task_type_check
  CHECK (task_type IN (
    -- legacy project task types
    'research','experiment','analysis','review','documentation','meeting','other',
    -- AI workflow task types (the focus of this module)
    'forward_prediction','batch_prediction','cost_optimization',
    'material_replacement','new_product_generation','knowledge_qa'
  ));

-- status — union of legacy + AI workflow values
ALTER TABLE r_and_d_tasks DROP CONSTRAINT IF EXISTS r_and_d_tasks_status_check;
ALTER TABLE r_and_d_tasks ADD CONSTRAINT r_and_d_tasks_status_check
  CHECK (status IN (
    -- legacy project task statuses
    'todo','in_progress','blocked','review','done','cancelled',
    -- AI workflow statuses
    'draft','submitted','processing','completed','failed','archived'
  ));

-- ---------------------------------------------------------------------------
-- 2. r_and_d_task_templates — input schema templates per task type.
-- ---------------------------------------------------------------------------
CREATE TABLE r_and_d_task_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  task_type       TEXT NOT NULL                       -- which AI workflow this template feeds
    CHECK (task_type IN (
      'forward_prediction','batch_prediction','cost_optimization',
      'material_replacement','new_product_generation','knowledge_qa'
    )),
  input_schema    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- JSON-Schema shape for `inputs.payload`
  default_payload JSONB NOT NULL DEFAULT '{}'::jsonb,  -- pre-filled values
  example_payload JSONB,                                -- reference example
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  display_order   INTEGER NOT NULL DEFAULT 0,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES users(id),
  updated_by      UUID REFERENCES users(id),
  deleted_at      TIMESTAMPTZ,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX r_and_d_task_templates_type_idx ON r_and_d_task_templates (task_type) WHERE deleted_at IS NULL;
CREATE TRIGGER r_and_d_task_templates_set_updated_at BEFORE UPDATE ON r_and_d_task_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- Wire the template_id FK now that the table exists
ALTER TABLE r_and_d_tasks
  ADD CONSTRAINT r_and_d_tasks_template_fk
    FOREIGN KEY (template_id) REFERENCES r_and_d_task_templates(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 3. r_and_d_task_inputs — append-only.
-- One input row per "submission" — can include attachments, raw NL, structured.
-- ---------------------------------------------------------------------------
CREATE TABLE r_and_d_task_inputs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES r_and_d_tasks(id) ON DELETE CASCADE,
  input_type      TEXT NOT NULL
    CHECK (input_type IN ('structured','natural_language','template_filled','attachment','reference')),
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,    -- structured form / template values
  raw_text        TEXT,                                   -- natural-language prompt
  attachment_url  TEXT,
  attachment_mime TEXT,
  attachment_size INTEGER,
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,        -- THE input the handler executed against
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES users(id)
);
CREATE INDEX r_and_d_task_inputs_task_idx     ON r_and_d_task_inputs (task_id, created_at DESC);
CREATE INDEX r_and_d_task_inputs_primary_idx  ON r_and_d_task_inputs (task_id) WHERE is_primary = TRUE;

-- ---------------------------------------------------------------------------
-- 4. r_and_d_task_outputs — append-only.
-- Handlers / users attach result payloads here.
-- ---------------------------------------------------------------------------
CREATE TABLE r_and_d_task_outputs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             UUID NOT NULL REFERENCES r_and_d_tasks(id) ON DELETE CASCADE,
  output_type         TEXT NOT NULL
    CHECK (output_type IN ('prediction','recommendation','report','attachment','error','partial','citation')),
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,    -- handler-defined shape
  summary             TEXT,                                   -- short human description
  attachment_url      TEXT,
  attachment_mime     TEXT,

  -- ML provenance
  model_version_id    UUID REFERENCES ml_model_versions(id) ON DELETE SET NULL,
  feature_set_version TEXT,
  confidence          NUMERIC(5,4),

  is_primary          BOOLEAN NOT NULL DEFAULT FALSE,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id)
);
CREATE INDEX r_and_d_task_outputs_task_idx     ON r_and_d_task_outputs (task_id, generated_at DESC);
CREATE INDEX r_and_d_task_outputs_type_idx     ON r_and_d_task_outputs (output_type);
CREATE INDEX r_and_d_task_outputs_primary_idx  ON r_and_d_task_outputs (task_id) WHERE is_primary = TRUE;

-- ---------------------------------------------------------------------------
-- 5. r_and_d_task_events — APPEND-ONLY state-transition + activity log.
-- Every state machine transition writes here; never UPDATE/DELETE.
-- ---------------------------------------------------------------------------
CREATE TABLE r_and_d_task_events (
  id              BIGSERIAL PRIMARY KEY,
  task_id         UUID NOT NULL REFERENCES r_and_d_tasks(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL
    CHECK (event_type IN (
      'created','draft_saved','input_attached','submitted',
      'processing_started','progress_update','output_attached',
      'completed','failed','cancelled','archived','restored',
      'comment','manual_override','retry'
    )),
  from_status     TEXT,
  to_status       TEXT,
  actor_id        UUID REFERENCES users(id),
  trace_id        TEXT,
  message         TEXT,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX r_and_d_task_events_task_idx       ON r_and_d_task_events (task_id, occurred_at DESC);
CREATE INDEX r_and_d_task_events_type_idx       ON r_and_d_task_events (event_type, occurred_at DESC);
CREATE INDEX r_and_d_task_events_trace_idx      ON r_and_d_task_events (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX r_and_d_task_events_state_idx      ON r_and_d_task_events (task_id, to_status, occurred_at DESC) WHERE to_status IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. New indexes on r_and_d_tasks for the task-center workload
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS r_and_d_tasks_kind_status_idx
  ON r_and_d_tasks (task_kind, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS r_and_d_tasks_workflow_pending_idx
  ON r_and_d_tasks (created_at DESC)
  WHERE task_kind = 'ai_workflow' AND status IN ('submitted','processing') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS r_and_d_tasks_trace_idx
  ON r_and_d_tasks (trace_id) WHERE trace_id IS NOT NULL;

INSERT INTO schema_migrations (version, description)
  VALUES ('0015_task_center', 'extend r_and_d_tasks; add inputs/outputs/events/templates')
  ON CONFLICT (version) DO NOTHING;
