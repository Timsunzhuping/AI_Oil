-- =============================================================================
-- 0009_knowledge_rules.sql
-- Knowledge documents (RAG-ready, with pgvector embeddings) + expert rules.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- knowledge_documents — SOPs, papers, patents, memos, training material.
-- The `embedding` column powers semantic / RAG retrieval.
-- ---------------------------------------------------------------------------
CREATE TABLE knowledge_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT UNIQUE,                    -- internal reference
  title               TEXT NOT NULL,
  doc_type            TEXT NOT NULL DEFAULT 'memo'
    CHECK (doc_type IN ('sop','paper','patent','memo','manual','training','specification','report','other')),

  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','reviewing','published','archived','obsolete')),

  -- Content
  summary             TEXT,
  content             TEXT,                           -- canonical body
  content_format      TEXT NOT NULL DEFAULT 'markdown'
    CHECK (content_format IN ('markdown','plain','html','pdf','docx')),
  content_hash        TEXT,                           -- sha256 for change detection
  language            TEXT NOT NULL DEFAULT 'en',

  -- Source / file
  source_url          TEXT,
  file_url            TEXT,
  file_size_bytes     BIGINT,
  file_mime_type      TEXT,

  -- Classification
  category            TEXT,
  domain              TEXT,                           -- e.g. 'lubricants','cosmetics','adhesives'
  tags                TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Authorship / review
  author_id           UUID REFERENCES users(id),
  reviewed_by         UUID REFERENCES users(id),
  approved_by         UUID REFERENCES users(id),
  published_at        TIMESTAMPTZ,
  effective_from      TIMESTAMPTZ,
  effective_until     TIMESTAMPTZ,

  -- Versioning
  doc_version         INTEGER NOT NULL DEFAULT 1,     -- editorial version (independent of optimistic-locking version)
  parent_doc_id       UUID REFERENCES knowledge_documents(id) ON DELETE SET NULL,

  -- Citations
  references          JSONB,                          -- bibliography entries

  -- RAG / embedding
  embedding           vector(1536),                   -- OpenAI text-embedding-3-small dimension
  embedding_model     TEXT,
  embedding_updated_at TIMESTAMPTZ,

  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id),
  updated_by          UUID REFERENCES users(id),
  deleted_at          TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX knowledge_documents_status_idx     ON knowledge_documents (status) WHERE deleted_at IS NULL;
CREATE INDEX knowledge_documents_doc_type_idx   ON knowledge_documents (doc_type) WHERE deleted_at IS NULL;
CREATE INDEX knowledge_documents_domain_idx     ON knowledge_documents (domain) WHERE deleted_at IS NULL;
CREATE INDEX knowledge_documents_tags_idx       ON knowledge_documents USING GIN (tags);
CREATE INDEX knowledge_documents_title_trgm_idx ON knowledge_documents USING GIN (title gin_trgm_ops);
CREATE INDEX knowledge_documents_published_idx  ON knowledge_documents (published_at DESC) WHERE published_at IS NOT NULL;
-- ANN index on the embedding for cosine similarity search
CREATE INDEX knowledge_documents_embedding_idx
  ON knowledge_documents
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE TRIGGER knowledge_documents_set_updated_at BEFORE UPDATE ON knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- knowledge_chunks — sentence/paragraph-level chunks for RAG.
-- A document is chunked once on publish; chunks own their own embedding.
-- ---------------------------------------------------------------------------
CREATE TABLE knowledge_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index     INTEGER NOT NULL,
  content         TEXT NOT NULL,
  token_count     INTEGER,
  embedding       vector(1536),
  embedding_model TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX knowledge_chunks_document_idx  ON knowledge_chunks (document_id);
CREATE INDEX knowledge_chunks_embedding_idx
  ON knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 200);

-- ---------------------------------------------------------------------------
-- expert_rules — formal heuristics & constraints used during formulation.
-- The `condition_expr` is a structured DSL the rules engine evaluates;
-- `natural_language_description` is a humane rendering for the UI.
-- ---------------------------------------------------------------------------
CREATE TABLE expert_rules (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  description            TEXT,
  natural_language_description TEXT,                 -- "Do not combine X with Y above 60°C"

  rule_type              TEXT NOT NULL
    CHECK (rule_type IN ('compatibility','constraint','recommendation','safety','quality','regulatory')),
  domain                 TEXT,                       -- 'lubricants', 'cosmetics', etc.
  severity               TEXT NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info','warning','error','critical')),

  -- Structured DSL the rule engine evaluates
  condition_expr         JSONB NOT NULL,             -- e.g., { "all": [{ "fact": "ingredient.cas", "op": "eq", "value": "..."}, ...] }
  action_expr            JSONB,                      -- e.g., { "block": true, "message": "..." }

  -- Provenance / source-of-truth
  source_doc_id          UUID REFERENCES knowledge_documents(id) ON DELETE SET NULL,
  source_section         TEXT,                       -- which section of the doc

  -- State
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from         TIMESTAMPTZ,
  effective_until        TIMESTAMPTZ,

  -- Approval
  authored_by            UUID REFERENCES users(id),
  approved_by            UUID REFERENCES users(id),
  approved_at            TIMESTAMPTZ,

  -- Stats (updated by the engine)
  fired_count            BIGINT NOT NULL DEFAULT 0,
  last_fired_at          TIMESTAMPTZ,

  tags                   TEXT[] DEFAULT ARRAY[]::TEXT[],
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by             UUID REFERENCES users(id),
  updated_by             UUID REFERENCES users(id),
  deleted_at             TIMESTAMPTZ,
  version                INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX expert_rules_type_idx     ON expert_rules (rule_type) WHERE deleted_at IS NULL;
CREATE INDEX expert_rules_domain_idx   ON expert_rules (domain) WHERE deleted_at IS NULL;
CREATE INDEX expert_rules_active_idx   ON expert_rules (is_active) WHERE deleted_at IS NULL;
CREATE INDEX expert_rules_severity_idx ON expert_rules (severity) WHERE deleted_at IS NULL;
CREATE INDEX expert_rules_source_idx   ON expert_rules (source_doc_id);
CREATE INDEX expert_rules_tags_idx     ON expert_rules USING GIN (tags);
CREATE INDEX expert_rules_condition_idx ON expert_rules USING GIN (condition_expr);
CREATE TRIGGER expert_rules_set_updated_at BEFORE UPDATE ON expert_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- expert_rule_violations — every time a rule fires against a formula version.
-- ---------------------------------------------------------------------------
CREATE TABLE expert_rule_violations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id             UUID NOT NULL REFERENCES expert_rules(id) ON DELETE CASCADE,
  formula_version_id  UUID REFERENCES formula_versions(id) ON DELETE CASCADE,
  experiment_id       UUID REFERENCES experiments(id) ON DELETE SET NULL,
  context             JSONB,                          -- the inputs that triggered the rule
  severity            TEXT NOT NULL,
  message             TEXT NOT NULL,
  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID REFERENCES users(id),
  resolution_notes    TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX expert_rule_violations_rule_idx     ON expert_rule_violations (rule_id);
CREATE INDEX expert_rule_violations_formula_idx  ON expert_rule_violations (formula_version_id);
CREATE INDEX expert_rule_violations_unresolved   ON expert_rule_violations (created_at DESC) WHERE resolved_at IS NULL;

INSERT INTO schema_migrations (version, description)
  VALUES ('0009_knowledge_rules', 'knowledge_documents, knowledge_chunks, expert_rules, expert_rule_violations')
  ON CONFLICT (version) DO NOTHING;
