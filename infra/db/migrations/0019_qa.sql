-- =============================================================================
-- 0019_qa.sql
--
-- Enterprise AI Knowledge QA Assistant — sessions, messages, and feedback.
--
--   qa_sessions      — one per conversation; new on first /ask without session_id
--   qa_messages      — both user questions and assistant answers; threaded by parent_message_id
--   qa_feedback      — user ratings & comments on assistant messages
--
-- Hard rule (enforced in service layer): every assistant message MUST carry at
-- least one citation OR be the explicit "no_match" fallback message — answers
-- without sources are not allowed by the product.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- qa_sessions
-- -----------------------------------------------------------------------------
CREATE TABLE qa_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT NOT NULL UNIQUE,                    -- QA-YYYY-NNNNNN
  title             TEXT NOT NULL DEFAULT '(未命名会话)',
  product_category  TEXT,
  status            TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  message_count     INTEGER NOT NULL DEFAULT 0,
  last_message_at   TIMESTAMPTZ,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_id          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID REFERENCES users(id),
  version           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX qa_sessions_status_idx     ON qa_sessions (status, updated_at DESC);
CREATE INDEX qa_sessions_user_idx       ON qa_sessions (created_by, updated_at DESC) WHERE created_by IS NOT NULL;
CREATE INDEX qa_sessions_category_idx   ON qa_sessions (product_category);
CREATE TRIGGER qa_sessions_set_updated_at BEFORE UPDATE ON qa_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- -----------------------------------------------------------------------------
-- qa_messages — both 'user' and 'assistant' messages live here.
-- -----------------------------------------------------------------------------
CREATE TABLE qa_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID NOT NULL REFERENCES qa_sessions(id) ON DELETE CASCADE,
  role                TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  parent_message_id   UUID REFERENCES qa_messages(id) ON DELETE SET NULL,

  -- ── content ─────────────────────────────────────────────────────
  question            TEXT,                                  -- when role='user'
  answer              TEXT,                                  -- when role='assistant'
  intent              TEXT,                                  -- classifier output
  intent_confidence   NUMERIC,                               -- 0..1
  confidence          NUMERIC,                               -- composer aggregate, 0..1

  -- ── citations / retrieval (assistant rows only) ─────────────────
  citations           JSONB NOT NULL DEFAULT '[]'::jsonb,    -- Citation[]
  retrieval_summary   JSONB NOT NULL DEFAULT '{}'::jsonb,    -- {hits, sources_searched, …}

  -- ── LLM identity (assistant rows only) ──────────────────────────
  llm_adapter         TEXT,                                  -- 'mock-rules','openai',…
  llm_version         TEXT,
  llm_request         JSONB,                                 -- prompt (when applicable)
  llm_response_meta   JSONB,                                 -- {usage, latency_ms,…}

  -- ── auditing ────────────────────────────────────────────────────
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_id            TEXT,
  duration_ms         INTEGER NOT NULL DEFAULT 0,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id)
);
CREATE INDEX qa_messages_session_idx  ON qa_messages (session_id, created_at);
CREATE INDEX qa_messages_role_idx     ON qa_messages (session_id, role, created_at);
CREATE INDEX qa_messages_intent_idx   ON qa_messages (intent) WHERE intent IS NOT NULL;
CREATE INDEX qa_messages_parent_idx   ON qa_messages (parent_message_id) WHERE parent_message_id IS NOT NULL;

COMMENT ON TABLE  qa_messages IS 'User questions + assistant answers. assistant rows MUST carry at least one citation (or be the no_match fallback).';
COMMENT ON COLUMN qa_messages.intent IS 'Classifier output, e.g. raw_material_lookup, formula_history, regulation, process, general, no_match.';

-- -----------------------------------------------------------------------------
-- qa_feedback — user ratings on assistant messages.
-- -----------------------------------------------------------------------------
CREATE TABLE qa_feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    UUID NOT NULL REFERENCES qa_messages(id)  ON DELETE CASCADE,
  session_id    UUID NOT NULL REFERENCES qa_sessions(id)  ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id),

  rating        SMALLINT NOT NULL CHECK (rating IN (-1, 0, 1)),
  category      TEXT,                                       -- 'inaccurate','incomplete','off_topic','great', …
  comment       TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_id      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX qa_feedback_message_idx   ON qa_feedback (message_id);
CREATE INDEX qa_feedback_rating_idx    ON qa_feedback (rating);
CREATE INDEX qa_feedback_session_idx   ON qa_feedback (session_id, created_at DESC);

COMMENT ON TABLE qa_feedback IS 'Per-message user feedback (-1/0/+1) plus optional category and free-text comment.';
