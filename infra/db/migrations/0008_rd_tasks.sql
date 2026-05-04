-- =============================================================================
-- 0008_rd_tasks.sql
-- R&D project / task management.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- r_and_d_projects — the umbrella under which tasks live.
-- ---------------------------------------------------------------------------
CREATE TABLE r_and_d_projects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  description         TEXT,

  status              TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning','active','on_hold','completed','cancelled','archived')),
  priority            TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low','medium','high','critical')),

  -- Schedule
  start_date          DATE,
  due_date            DATE,
  closed_at           TIMESTAMPTZ,

  -- People
  owner_id            UUID REFERENCES users(id),
  sponsor_id          UUID REFERENCES users(id),

  -- Budget & resource
  budget              NUMERIC(14,2),
  budget_currency     CHAR(3) DEFAULT 'USD',

  -- Linkage
  related_product_ids UUID[] DEFAULT ARRAY[]::UUID[],

  tags                TEXT[] DEFAULT ARRAY[]::TEXT[],
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id),
  updated_by          UUID REFERENCES users(id),
  deleted_at          TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX r_and_d_projects_status_idx  ON r_and_d_projects (status) WHERE deleted_at IS NULL;
CREATE INDEX r_and_d_projects_owner_idx   ON r_and_d_projects (owner_id) WHERE deleted_at IS NULL;
CREATE INDEX r_and_d_projects_due_idx     ON r_and_d_projects (due_date) WHERE deleted_at IS NULL;
CREATE INDEX r_and_d_projects_tags_idx    ON r_and_d_projects USING GIN (tags);
CREATE TRIGGER r_and_d_projects_set_updated_at BEFORE UPDATE ON r_and_d_projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- r_and_d_tasks — work items, hierarchical (parent_task_id) within a project.
-- ---------------------------------------------------------------------------
CREATE TABLE r_and_d_tasks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE,        -- e.g., 'RND-2026-0042'
  project_id          UUID REFERENCES r_and_d_projects(id) ON DELETE SET NULL,
  parent_task_id      UUID REFERENCES r_and_d_tasks(id) ON DELETE SET NULL,

  title               TEXT NOT NULL,
  description         TEXT,

  task_type           TEXT NOT NULL DEFAULT 'research'
    CHECK (task_type IN ('research','experiment','analysis','review','documentation','meeting','other')),

  status              TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','in_progress','blocked','review','done','cancelled')),
  priority            TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low','medium','high','critical')),

  -- People
  assigned_to         UUID REFERENCES users(id),
  reporter_id         UUID REFERENCES users(id),

  -- Schedule
  due_date            DATE,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,

  -- Estimation
  estimated_hours     NUMERIC(6,2),
  actual_hours        NUMERIC(6,2),
  progress_percentage SMALLINT NOT NULL DEFAULT 0
    CHECK (progress_percentage BETWEEN 0 AND 100),

  -- Linkages
  related_formula_id      UUID REFERENCES formulas(id) ON DELETE SET NULL,
  related_formula_version_id UUID REFERENCES formula_versions(id) ON DELETE SET NULL,
  related_product_id      UUID REFERENCES products(id) ON DELETE SET NULL,
  related_experiment_id   UUID REFERENCES experiments(id) ON DELETE SET NULL,

  -- Blockers (free-form)
  blocked_reason          TEXT,

  tags                TEXT[] DEFAULT ARRAY[]::TEXT[],
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id),
  updated_by          UUID REFERENCES users(id),
  deleted_at          TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX r_and_d_tasks_project_idx       ON r_and_d_tasks (project_id) WHERE deleted_at IS NULL;
CREATE INDEX r_and_d_tasks_parent_idx        ON r_and_d_tasks (parent_task_id) WHERE deleted_at IS NULL;
CREATE INDEX r_and_d_tasks_status_idx        ON r_and_d_tasks (status) WHERE deleted_at IS NULL;
CREATE INDEX r_and_d_tasks_priority_idx      ON r_and_d_tasks (priority) WHERE deleted_at IS NULL;
CREATE INDEX r_and_d_tasks_assignee_idx      ON r_and_d_tasks (assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX r_and_d_tasks_due_idx           ON r_and_d_tasks (due_date) WHERE deleted_at IS NULL;
CREATE INDEX r_and_d_tasks_formula_idx       ON r_and_d_tasks (related_formula_id);
CREATE INDEX r_and_d_tasks_experiment_idx    ON r_and_d_tasks (related_experiment_id);
CREATE INDEX r_and_d_tasks_tags_idx          ON r_and_d_tasks USING GIN (tags);
CREATE TRIGGER r_and_d_tasks_set_updated_at BEFORE UPDATE ON r_and_d_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- Now wire experiments.task_id (deferred from migration 0007 to avoid a cycle).
ALTER TABLE experiments
  ADD CONSTRAINT experiments_task_fk
    FOREIGN KEY (task_id) REFERENCES r_and_d_tasks(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- r_and_d_task_comments — discussion thread per task
-- ---------------------------------------------------------------------------
CREATE TABLE r_and_d_task_comments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES r_and_d_tasks(id) ON DELETE CASCADE,
  author_id       UUID REFERENCES users(id),
  body            TEXT NOT NULL,
  body_format     TEXT NOT NULL DEFAULT 'markdown' CHECK (body_format IN ('markdown','plain','html')),
  parent_comment_id UUID REFERENCES r_and_d_task_comments(id) ON DELETE CASCADE,
  attachments     JSONB,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at       TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX r_and_d_task_comments_task_idx   ON r_and_d_task_comments (task_id, created_at DESC);
CREATE INDEX r_and_d_task_comments_author_idx ON r_and_d_task_comments (author_id);

-- ---------------------------------------------------------------------------
-- r_and_d_task_watchers — followers / notification list
-- ---------------------------------------------------------------------------
CREATE TABLE r_and_d_task_watchers (
  task_id     UUID NOT NULL REFERENCES r_and_d_tasks(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX r_and_d_task_watchers_user_idx ON r_and_d_task_watchers (user_id);

INSERT INTO schema_migrations (version, description)
  VALUES ('0008_rd_tasks', 'projects, tasks, comments, watchers')
  ON CONFLICT (version) DO NOTHING;
