-- =============================================================================
-- 0006_formulas.sql
-- Formulas: a logical recipe identity, with immutable versions and line items.
--
-- Design:
--   formulas             — the long-lived recipe identity, has many versions
--   formula_versions     — immutable snapshot; a new edit creates a new version
--   formula_items        — line items belonging to ONE formula_version
--   formula_approvals    — explicit approval trail per version
--   formula_change_log   — high-level reasons / change summaries per version
-- =============================================================================

-- ---------------------------------------------------------------------------
-- formulas — the recipe identity (acts like a project for its versions).
-- ---------------------------------------------------------------------------
CREATE TABLE formulas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  product_id          UUID REFERENCES products(id) ON DELETE SET NULL,
  description         TEXT,
  purpose             TEXT,                       -- short statement of intent
  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','frozen','retired')),
  current_version_id  UUID,                       -- FK added below; the “head” version
  total_versions      INTEGER NOT NULL DEFAULT 0,
  tags                TEXT[] DEFAULT ARRAY[]::TEXT[],
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id),
  updated_by          UUID REFERENCES users(id),
  deleted_at          TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX formulas_product_idx     ON formulas (product_id) WHERE deleted_at IS NULL;
CREATE INDEX formulas_status_idx      ON formulas (status) WHERE deleted_at IS NULL;
CREATE INDEX formulas_name_trgm_idx   ON formulas USING GIN (name gin_trgm_ops);
CREATE INDEX formulas_tags_idx        ON formulas USING GIN (tags);
CREATE TRIGGER formulas_set_updated_at BEFORE UPDATE ON formulas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- formula_versions — immutable snapshots.
-- A new edit forks a new version_number; the original is retained for audit.
-- ---------------------------------------------------------------------------
CREATE TABLE formula_versions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_id          UUID NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
  version_number      INTEGER NOT NULL,           -- monotonically increasing per formula
  version_label       TEXT,                       -- e.g., 'v1.2.0', 'q3-2026-trial-A'
  parent_version_id   UUID REFERENCES formula_versions(id) ON DELETE SET NULL,
  branch              TEXT NOT NULL DEFAULT 'main',  -- supports parallel exploration

  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','reviewing','approved','rejected','retired')),

  -- Process / batch parameters
  batch_size          NUMERIC(14,4),
  batch_unit          TEXT NOT NULL DEFAULT 'kg',
  expected_yield_pct  NUMERIC(5,2),
  process_steps       JSONB,                      -- ordered array of step instructions
  equipment_required  JSONB,
  process_conditions  JSONB,                      -- temp, mixing speed, time, pressure...

  -- Cost roll-up (denormalized for fast UI; recompute via job)
  total_cost          NUMERIC(14,4),
  cost_currency       CHAR(3) DEFAULT 'USD',
  cost_calculated_at  TIMESTAMPTZ,

  -- Documentation
  notes               TEXT,
  change_summary      TEXT,                       -- why this version was created

  -- Approval workflow
  submitted_at        TIMESTAMPTZ,
  submitted_by        UUID REFERENCES users(id),
  approved_at         TIMESTAMPTZ,
  approved_by         UUID REFERENCES users(id),
  rejected_at         TIMESTAMPTZ,
  rejected_by         UUID REFERENCES users(id),
  rejection_reason    TEXT,

  -- Lock — once approved, the items / process_steps must not change
  is_locked           BOOLEAN NOT NULL DEFAULT FALSE,
  locked_at           TIMESTAMPTZ,

  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id),
  updated_by          UUID REFERENCES users(id),
  deleted_at          TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1,

  UNIQUE (formula_id, version_number),
  UNIQUE (formula_id, branch, version_number)
);
CREATE INDEX formula_versions_formula_idx       ON formula_versions (formula_id);
CREATE INDEX formula_versions_status_idx        ON formula_versions (status) WHERE deleted_at IS NULL;
CREATE INDEX formula_versions_parent_idx        ON formula_versions (parent_version_id);
CREATE INDEX formula_versions_approved_idx      ON formula_versions (approved_at DESC) WHERE approved_at IS NOT NULL;
CREATE INDEX formula_versions_branch_idx        ON formula_versions (formula_id, branch);

CREATE TRIGGER formula_versions_set_updated_at BEFORE UPDATE ON formula_versions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- Now wire formulas.current_version_id and products.current_formula_version_id
ALTER TABLE formulas
  ADD CONSTRAINT formulas_current_version_fk
    FOREIGN KEY (current_version_id) REFERENCES formula_versions(id) ON DELETE SET NULL;

ALTER TABLE products
  ADD CONSTRAINT products_current_formula_version_fk
    FOREIGN KEY (current_formula_version_id) REFERENCES formula_versions(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- formula_items — line items composing a formula version.
-- An item references EITHER a raw_material OR another product (intermediate).
-- ---------------------------------------------------------------------------
CREATE TABLE formula_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_version_id  UUID NOT NULL REFERENCES formula_versions(id) ON DELETE CASCADE,

  -- Composition target (exactly one of the two must be set)
  raw_material_id     UUID REFERENCES raw_materials(id) ON DELETE RESTRICT,
  product_id          UUID REFERENCES products(id)      ON DELETE RESTRICT,

  -- Sequencing
  sequence_no         INTEGER NOT NULL,           -- order within the formula
  step_no             INTEGER,                    -- which process step this belongs to
  phase               TEXT,                       -- 'A' | 'B' | 'C' (industry convention for phases)

  -- Quantities
  amount              NUMERIC(14,6) NOT NULL CHECK (amount >= 0),
  unit_of_measure     TEXT NOT NULL,
  percentage          NUMERIC(7,4),               -- of total batch (computed; can be authoritative)
  min_amount          NUMERIC(14,6),              -- tolerated minimum
  max_amount          NUMERIC(14,6),              -- tolerated maximum

  -- Role / function in the formula
  role                TEXT,                       -- 'active','solvent','preservative','binder','colorant',...
  function_notes      TEXT,
  is_optional         BOOLEAN NOT NULL DEFAULT FALSE,
  is_critical         BOOLEAN NOT NULL DEFAULT FALSE,

  -- Cost roll-up (for analytics on the line item)
  unit_cost           NUMERIC(14,4),
  total_cost          NUMERIC(14,4),
  cost_currency       CHAR(3) DEFAULT 'USD',

  notes               TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id),
  updated_by          UUID REFERENCES users(id),
  deleted_at          TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1,

  -- Exactly one of (raw_material_id, product_id) must be set
  CONSTRAINT formula_items_target_chk CHECK (
    (raw_material_id IS NOT NULL AND product_id IS NULL) OR
    (raw_material_id IS NULL AND product_id IS NOT NULL)
  ),
  -- An ingredient cannot appear twice in the same version with the same sequence
  UNIQUE (formula_version_id, sequence_no)
);
CREATE INDEX formula_items_version_idx          ON formula_items (formula_version_id);
CREATE INDEX formula_items_raw_material_idx     ON formula_items (raw_material_id) WHERE raw_material_id IS NOT NULL;
CREATE INDEX formula_items_product_idx          ON formula_items (product_id) WHERE product_id IS NOT NULL;
CREATE INDEX formula_items_role_idx             ON formula_items (role);
CREATE TRIGGER formula_items_set_updated_at BEFORE UPDATE ON formula_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- formula_approvals — multi-stage approval trail (independent of status flag)
-- ---------------------------------------------------------------------------
CREATE TABLE formula_approvals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_version_id  UUID NOT NULL REFERENCES formula_versions(id) ON DELETE CASCADE,
  stage               TEXT NOT NULL,              -- 'lab_review','qa','regulatory','final'
  decision            TEXT NOT NULL CHECK (decision IN ('pending','approved','rejected','waived')),
  approver_id         UUID REFERENCES users(id),
  decided_at          TIMESTAMPTZ,
  comments            TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (formula_version_id, stage)
);
CREATE INDEX formula_approvals_version_idx   ON formula_approvals (formula_version_id);
CREATE INDEX formula_approvals_decision_idx  ON formula_approvals (decision, decided_at DESC);

INSERT INTO schema_migrations (version, description)
  VALUES ('0006_formulas', 'formulas, formula_versions, formula_items, formula_approvals')
  ON CONFLICT (version) DO NOTHING;
