-- =============================================================================
-- 0003_audit_logs.sql
-- audit_logs — append-only change record. Partitioned by month for retention.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Parent table. Append-only. NEVER UPDATE/DELETE rows here.
-- Application writes diffs synchronously; analytics queries hit warm partitions.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id              BIGSERIAL,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trace_id        TEXT,                        -- correlate with backend logs / x-trace-id
  span_id         TEXT,
  user_id         UUID,                        -- principal who triggered the action
  impersonator_id UUID,                        -- non-null if `user_id` is being impersonated
  service_name    TEXT NOT NULL DEFAULT 'fluidmind-backend',
  ip_address      INET,
  user_agent      TEXT,

  -- What happened
  action          TEXT NOT NULL,               -- create | update | delete | approve | login | export | execute
  resource_type   TEXT NOT NULL,               -- 'formula', 'raw_material', 'experiment', ...
  resource_id     UUID,
  resource_code   TEXT,                        -- denormalized human key for forensics
  resource_label  TEXT,                        -- denormalized name for display

  -- Diff
  before_state    JSONB,                       -- entity snapshot before change
  after_state     JSONB,                       -- entity snapshot after change
  changes         JSONB,                       -- {col: {from, to}} computed diff

  -- HTTP context (optional)
  request_method  TEXT,
  request_path    TEXT,
  status_code     INTEGER,
  duration_ms     INTEGER,
  error_code      INTEGER,                     -- maps to backend error envelope code
  error_message   TEXT,

  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,

  PRIMARY KEY (id, occurred_at)                -- composite required for partitioning
) PARTITION BY RANGE (occurred_at);

-- ---------------------------------------------------------------------------
-- Initial monthly partitions covering 2026.
-- A scheduled job (e.g. pg_partman or app cron) should pre-create future months.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs_2026_01 PARTITION OF audit_logs FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE audit_logs_2026_02 PARTITION OF audit_logs FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE audit_logs_2026_03 PARTITION OF audit_logs FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE audit_logs_2026_04 PARTITION OF audit_logs FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE audit_logs_2026_05 PARTITION OF audit_logs FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE audit_logs_2026_06 PARTITION OF audit_logs FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE audit_logs_2026_07 PARTITION OF audit_logs FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE audit_logs_2026_08 PARTITION OF audit_logs FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE audit_logs_2026_09 PARTITION OF audit_logs FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE audit_logs_2026_10 PARTITION OF audit_logs FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE audit_logs_2026_11 PARTITION OF audit_logs FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit_logs_2026_12 PARTITION OF audit_logs FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;

-- ---------------------------------------------------------------------------
-- Indexes — created on the parent (cascade to all partitions)
-- ---------------------------------------------------------------------------
CREATE INDEX audit_logs_user_idx       ON audit_logs (user_id, occurred_at DESC);
CREATE INDEX audit_logs_resource_idx   ON audit_logs (resource_type, resource_id, occurred_at DESC);
CREATE INDEX audit_logs_action_idx     ON audit_logs (action, occurred_at DESC);
CREATE INDEX audit_logs_trace_idx      ON audit_logs (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX audit_logs_occurred_idx   ON audit_logs (occurred_at DESC);

INSERT INTO schema_migrations (version, description)
  VALUES ('0003_audit_logs', 'partitioned audit log with diff tracking')
  ON CONFLICT (version) DO NOTHING;
