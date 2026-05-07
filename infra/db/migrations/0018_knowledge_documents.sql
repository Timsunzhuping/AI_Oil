-- =============================================================================
-- 0018_knowledge_documents.sql
--
-- Knowledge base + Document parsing module.
--
--   raw_material_kb           — encyclopedic notes about raw materials
--   formula_kb                — encyclopedic notes about formulas / recipes
--   document_records          — uploaded files (PDF / DOCX / XLSX / JPG / PNG)
--   document_parse_tasks      — async OCR / extraction work
--   document_parse_results    — versioned extraction outputs + review state
--
-- Design notes:
--   • Knowledge tables decouple "facts the team has documented" from the
--     master raw_materials / formulas tables (which model production reality).
--     They CAN link back via *_id columns — but rows can also exist standalone
--     (datasheet of a not-yet-master material).
--   • Document parsing is fully async: /docs/parse enqueues a task; a worker
--     drains it; results are written with versioned, reviewable rows.
--   • `embedding_text` + `embedding_vector` are reserved for the future
--     knowledge QA RAG pipeline; we simply persist them now so we don't
--     break compatibility once a model is wired in.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- raw_material_kb
-- -----------------------------------------------------------------------------
CREATE TABLE raw_material_kb (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT NOT NULL UNIQUE,                  -- KB code, e.g. RMK-2026-0001
  name                  TEXT NOT NULL,
  category              TEXT,
  raw_material_id       UUID REFERENCES raw_materials(id) ON DELETE SET NULL,

  -- ── descriptive content ───────────────────────────────────────
  summary               TEXT,
  technical_notes       TEXT,
  usage_guidance        TEXT,
  regulatory_notes      TEXT,
  storage_handling      TEXT,
  /* Free-form structured properties (typical values, supplier notes, …) */
  properties            JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- ── retrieval (reserved for RAG) ──────────────────────────────
  embedding_text        TEXT,
  embedding_vector      NUMERIC[],
  embedding_model       TEXT,
  search_keywords       TEXT[]   DEFAULT ARRAY[]::TEXT[],

  -- ── linkage to source document(s) ────────────────────────────
  source_document_id    UUID,                                  -- FK added below
  source_result_id      UUID,                                  -- FK added below

  -- ── lifecycle ────────────────────────────────────────────────
  status                TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  tags                  TEXT[]   DEFAULT ARRAY[]::TEXT[],
  metadata              JSONB    NOT NULL DEFAULT '{}'::jsonb,

  -- ── audit ────────────────────────────────────────────────────
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID REFERENCES users(id),
  updated_by            UUID REFERENCES users(id),
  deleted_at            TIMESTAMPTZ,
  version               INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX raw_material_kb_status_idx       ON raw_material_kb (status) WHERE deleted_at IS NULL;
CREATE INDEX raw_material_kb_category_idx     ON raw_material_kb (category) WHERE deleted_at IS NULL;
CREATE INDEX raw_material_kb_raw_material_idx ON raw_material_kb (raw_material_id) WHERE raw_material_id IS NOT NULL;
CREATE INDEX raw_material_kb_keywords_idx     ON raw_material_kb USING GIN (search_keywords);
CREATE INDEX raw_material_kb_tags_idx         ON raw_material_kb USING GIN (tags);
CREATE TRIGGER raw_material_kb_set_updated_at BEFORE UPDATE ON raw_material_kb
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- -----------------------------------------------------------------------------
-- formula_kb
-- -----------------------------------------------------------------------------
CREATE TABLE formula_kb (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                        TEXT NOT NULL UNIQUE,            -- FKB-2026-0001
  title                       TEXT NOT NULL,
  product_category            TEXT,
  application_scene           TEXT,
  related_formula_id          UUID REFERENCES formulas(id)         ON DELETE SET NULL,
  related_formula_version_id  UUID REFERENCES formula_versions(id) ON DELETE SET NULL,

  -- ── descriptive content ───────────────────────────────────────
  summary                     TEXT,
  composition_overview        TEXT,
  performance_highlights      TEXT,
  process_notes               TEXT,
  /* Optional sample BOM excerpted from the document. */
  sample_bom                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_metrics              JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- ── retrieval (reserved) ──────────────────────────────────────
  embedding_text              TEXT,
  embedding_vector            NUMERIC[],
  embedding_model             TEXT,
  search_keywords             TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- ── source linkage ────────────────────────────────────────────
  source_document_id          UUID,
  source_result_id            UUID,

  -- ── lifecycle / audit ─────────────────────────────────────────
  status                      TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  tags                        TEXT[] DEFAULT ARRAY[]::TEXT[],
  metadata                    JSONB  NOT NULL DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  UUID REFERENCES users(id),
  updated_by                  UUID REFERENCES users(id),
  deleted_at                  TIMESTAMPTZ,
  version                     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX formula_kb_status_idx           ON formula_kb (status) WHERE deleted_at IS NULL;
CREATE INDEX formula_kb_product_category_idx ON formula_kb (product_category) WHERE deleted_at IS NULL;
CREATE INDEX formula_kb_keywords_idx         ON formula_kb USING GIN (search_keywords);
CREATE INDEX formula_kb_tags_idx             ON formula_kb USING GIN (tags);
CREATE TRIGGER formula_kb_set_updated_at BEFORE UPDATE ON formula_kb
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- -----------------------------------------------------------------------------
-- document_records — uploaded artefacts (PDF / DOCX / XLSX / JPG / PNG / …)
-- -----------------------------------------------------------------------------
CREATE TABLE document_records (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     TEXT NOT NULL UNIQUE,                -- DOC-YYYY-NNNN
  title                    TEXT NOT NULL,
  description              TEXT,

  -- ── classification ────────────────────────────────────────────
  doc_type                 TEXT NOT NULL DEFAULT 'other'
    CHECK (doc_type IN ('datasheet','test_report','formula_card','sop','image','other')),
  category                 TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('raw_material','formula','test','process','regulatory','other')),

  -- ── physical file metadata ────────────────────────────────────
  mime_type                TEXT NOT NULL,
  file_extension           TEXT,
  size_bytes               BIGINT NOT NULL DEFAULT 0,
  checksum_sha256          TEXT,
  storage_provider         TEXT NOT NULL DEFAULT 'local'        -- 'local','s3','memory'
    CHECK (storage_provider IN ('local','s3','memory','external')),
  storage_key              TEXT NOT NULL,
  storage_url              TEXT NOT NULL,                      -- file://, s3://, mem://
  page_count               INTEGER,
  language                 TEXT,                               -- declared by uploader
  language_detected        TEXT,                               -- filled by OCR

  -- ── lifecycle ────────────────────────────────────────────────
  status                   TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN (
      'uploaded',
      'parsing',
      'parsed',
      'review',
      'confirmed',
      'rejected',
      'archived'
    )),

  -- ── linkage to KB / master data ──────────────────────────────
  related_raw_material_id  UUID REFERENCES raw_materials(id) ON DELETE SET NULL,
  related_formula_id       UUID REFERENCES formulas(id)      ON DELETE SET NULL,
  related_supplier_id      UUID REFERENCES suppliers(id)     ON DELETE SET NULL,

  -- ── retrieval (reserved) ──────────────────────────────────────
  search_keywords          TEXT[]  DEFAULT ARRAY[]::TEXT[],
  tags                     TEXT[]  DEFAULT ARRAY[]::TEXT[],
  metadata                 JSONB   NOT NULL DEFAULT '{}'::jsonb,
  visibility               TEXT NOT NULL DEFAULT 'team'
    CHECK (visibility IN ('private','team','public')),

  -- ── audit ────────────────────────────────────────────────────
  trace_id                 TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               UUID REFERENCES users(id),
  updated_by               UUID REFERENCES users(id),
  deleted_at               TIMESTAMPTZ,
  version                  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX document_records_status_idx     ON document_records (status, created_at DESC);
CREATE INDEX document_records_doc_type_idx   ON document_records (doc_type, created_at DESC);
CREATE INDEX document_records_category_idx   ON document_records (category, created_at DESC);
CREATE INDEX document_records_keywords_idx   ON document_records USING GIN (search_keywords);
CREATE INDEX document_records_tags_idx       ON document_records USING GIN (tags);
CREATE TRIGGER document_records_set_updated_at BEFORE UPDATE ON document_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- -----------------------------------------------------------------------------
-- document_parse_tasks — one row per asynchronous parse / OCR / extraction call
-- -----------------------------------------------------------------------------
CREATE TABLE document_parse_tasks (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id              UUID NOT NULL REFERENCES document_records(id) ON DELETE CASCADE,
  task_type                TEXT NOT NULL DEFAULT 'full_parse'
    CHECK (task_type IN ('ocr','extract_structured','full_parse','classify')),

  status                   TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','processing','succeeded','failed','cancelled')),

  parser_name              TEXT,                                 -- 'pdf-parser','tesseract-mock','docx-parser', …
  parser_version           TEXT,
  options                  JSONB NOT NULL DEFAULT '{}'::jsonb,

  attempt_count            INTEGER NOT NULL DEFAULT 0,
  max_attempts             INTEGER NOT NULL DEFAULT 3,
  next_attempt_at          TIMESTAMPTZ,
  started_at               TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  duration_ms              INTEGER NOT NULL DEFAULT 0,

  error_class              TEXT,
  error_message            TEXT,

  trace_id                 TEXT,
  created_by               UUID REFERENCES users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX document_parse_tasks_doc_idx        ON document_parse_tasks (document_id, created_at DESC);
CREATE INDEX document_parse_tasks_status_idx     ON document_parse_tasks (status, next_attempt_at);
CREATE INDEX document_parse_tasks_trace_idx      ON document_parse_tasks (trace_id);

-- -----------------------------------------------------------------------------
-- document_parse_results — versioned extraction output + review state
-- -----------------------------------------------------------------------------
CREATE TABLE document_parse_results (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id              UUID NOT NULL REFERENCES document_records(id)      ON DELETE CASCADE,
  task_id                  UUID REFERENCES document_parse_tasks(id)           ON DELETE SET NULL,

  result_version           INTEGER NOT NULL DEFAULT 1,
  is_current               BOOLEAN NOT NULL DEFAULT TRUE,
  origin                   TEXT NOT NULL
    CHECK (origin IN ('ocr','extractor','manual','merged')),

  confidence               NUMERIC,                                  -- 0..1
  raw_text                 TEXT,                                     -- OCR / parser raw text
  structured_payload       JSONB NOT NULL DEFAULT '{}'::jsonb,       -- normalised facts (per doc_type)
  extracted_fields         JSONB NOT NULL DEFAULT '{}'::jsonb,       -- shallow key-value summary
  /* Each parser may surface page-level snippets (page → text excerpt). */
  page_snippets            JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- ── review workflow ──────────────────────────────────────────
  review_status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending','approved','rejected','edited')),
  reviewer_id              UUID REFERENCES users(id),
  reviewed_at              TIMESTAMPTZ,
  review_comment           TEXT,
  manual_edits             JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- ── linkage to KB rows produced from this result ─────────────
  linked_raw_material_kb_id UUID REFERENCES raw_material_kb(id) ON DELETE SET NULL,
  linked_formula_kb_id      UUID REFERENCES formula_kb(id)      ON DELETE SET NULL,

  -- ── retrieval (reserved) ─────────────────────────────────────
  embedding_text           TEXT,
  embedding_vector         NUMERIC[],
  embedding_model          TEXT,
  search_keywords          TEXT[] DEFAULT ARRAY[]::TEXT[],

  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_id                 TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               UUID REFERENCES users(id),
  updated_by               UUID REFERENCES users(id),
  version                  INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT document_parse_results_doc_version_uk UNIQUE (document_id, result_version)
);
CREATE INDEX document_parse_results_doc_idx     ON document_parse_results (document_id, result_version DESC);
CREATE INDEX document_parse_results_current_idx ON document_parse_results (document_id) WHERE is_current = TRUE;
CREATE INDEX document_parse_results_review_idx  ON document_parse_results (review_status);
CREATE INDEX document_parse_results_keywords_idx ON document_parse_results USING GIN (search_keywords);
CREATE TRIGGER document_parse_results_set_updated_at BEFORE UPDATE ON document_parse_results
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- -----------------------------------------------------------------------------
-- Now that the documents/results tables exist, wire FK from KB tables back.
-- -----------------------------------------------------------------------------
ALTER TABLE raw_material_kb
  ADD CONSTRAINT raw_material_kb_source_doc_fk
    FOREIGN KEY (source_document_id) REFERENCES document_records(id) ON DELETE SET NULL,
  ADD CONSTRAINT raw_material_kb_source_result_fk
    FOREIGN KEY (source_result_id)   REFERENCES document_parse_results(id) ON DELETE SET NULL;

ALTER TABLE formula_kb
  ADD CONSTRAINT formula_kb_source_doc_fk
    FOREIGN KEY (source_document_id) REFERENCES document_records(id) ON DELETE SET NULL,
  ADD CONSTRAINT formula_kb_source_result_fk
    FOREIGN KEY (source_result_id)   REFERENCES document_parse_results(id) ON DELETE SET NULL;

COMMENT ON TABLE  document_records          IS 'Each uploaded file gets one row here; the binary lives in the configured storage adapter.';
COMMENT ON TABLE  document_parse_tasks      IS 'Async OCR / extraction queue. One row per /docs/parse/:id call.';
COMMENT ON TABLE  document_parse_results    IS 'Versioned extraction output. is_current is reset to FALSE on every new revision (re-parse or manual edit).';
COMMENT ON COLUMN document_parse_results.origin IS '"ocr" raw OCR, "extractor" structured pipeline, "manual" produced from human review, "merged" combined source';
