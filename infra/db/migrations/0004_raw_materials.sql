-- =============================================================================
-- 0004_raw_materials.sql
-- Raw material master data: hierarchical categories, suppliers, raw_materials,
-- and per-supplier specs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- material_categories — hierarchical taxonomy (e.g., 'oils' → 'base_oils' → 'mineral')
-- ---------------------------------------------------------------------------
CREATE TABLE material_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  parent_id     UUID REFERENCES material_categories(id) ON DELETE SET NULL,
  level         SMALLINT NOT NULL DEFAULT 1,
  path          TEXT NOT NULL,                   -- materialized path, e.g. '/oils/base_oils/'
  description   TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID REFERENCES users(id),
  updated_by    UUID REFERENCES users(id),
  deleted_at    TIMESTAMPTZ,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX material_categories_parent_idx ON material_categories (parent_id);
CREATE INDEX material_categories_path_idx   ON material_categories (path);
CREATE TRIGGER material_categories_set_updated_at BEFORE UPDATE ON material_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- suppliers
-- ---------------------------------------------------------------------------
CREATE TABLE suppliers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  contact_email   TEXT,
  contact_phone   TEXT,
  contact_person  TEXT,
  country_code    CHAR(2),
  address         TEXT,
  website         TEXT,
  qualification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (qualification_status IN ('pending','qualified','provisional','disqualified')),
  qualified_until DATE,
  rating          NUMERIC(3,2) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES users(id),
  updated_by      UUID REFERENCES users(id),
  deleted_at      TIMESTAMPTZ,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX suppliers_is_active_idx ON suppliers (is_active) WHERE deleted_at IS NULL;
CREATE TRIGGER suppliers_set_updated_at BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- raw_materials — the master record for every input substance
-- ---------------------------------------------------------------------------
CREATE TABLE raw_materials (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE,        -- internal SKU
  name                TEXT NOT NULL,
  alternate_names     TEXT[] DEFAULT ARRAY[]::TEXT[],
  cas_number          TEXT,                        -- CAS Registry Number
  einecs_number       TEXT,
  hs_code             TEXT,                        -- customs / HS classification
  category_id         UUID REFERENCES material_categories(id) ON DELETE SET NULL,
  description         TEXT,

  -- Physical / chemical properties (typed columns for hot-path queries)
  physical_state      TEXT CHECK (physical_state IN ('solid','liquid','gas','paste','powder','granule')),
  density             NUMERIC(10,4),               -- g/cm³
  molecular_weight    NUMERIC(12,4),               -- g/mol
  melting_point_c     NUMERIC(8,2),
  boiling_point_c     NUMERIC(8,2),
  flash_point_c       NUMERIC(8,2),
  viscosity_cst       NUMERIC(12,4),               -- centistokes @ ref temp
  ph_value            NUMERIC(4,2),
  appearance          TEXT,
  odor                TEXT,
  color               TEXT,

  -- Inventory & sourcing
  unit_of_measure     TEXT NOT NULL DEFAULT 'kg',
  default_supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  default_unit_cost   NUMERIC(14,4),
  cost_currency       CHAR(3) DEFAULT 'USD',
  shelf_life_days     INTEGER,
  storage_conditions  TEXT,
  min_stock_level     NUMERIC(14,4),
  max_stock_level     NUMERIC(14,4),

  -- Safety & compliance
  hazard_class        TEXT,                        -- e.g., 'flammable', 'corrosive'
  ghs_codes           TEXT[] DEFAULT ARRAY[]::TEXT[],
  msds_url            TEXT,
  is_restricted       BOOLEAN NOT NULL DEFAULT FALSE,
  is_controlled       BOOLEAN NOT NULL DEFAULT FALSE,

  -- State
  status              TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','phased_out','obsolete','blocked')),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,

  -- Extensibility
  properties          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- typed properties per category
  tags                TEXT[] DEFAULT ARRAY[]::TEXT[],
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Audit
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id),
  updated_by          UUID REFERENCES users(id),
  deleted_at          TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX raw_materials_category_idx     ON raw_materials (category_id) WHERE deleted_at IS NULL;
CREATE INDEX raw_materials_supplier_idx     ON raw_materials (default_supplier_id) WHERE deleted_at IS NULL;
CREATE INDEX raw_materials_status_idx       ON raw_materials (status) WHERE deleted_at IS NULL;
CREATE INDEX raw_materials_cas_idx          ON raw_materials (cas_number) WHERE cas_number IS NOT NULL;
CREATE INDEX raw_materials_name_trgm_idx    ON raw_materials USING GIN (name gin_trgm_ops);
CREATE INDEX raw_materials_tags_idx         ON raw_materials USING GIN (tags);
CREATE INDEX raw_materials_properties_idx   ON raw_materials USING GIN (properties);

CREATE TRIGGER raw_materials_set_updated_at BEFORE UPDATE ON raw_materials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- material_supplier_specs — per-supplier sourcing details
-- ---------------------------------------------------------------------------
CREATE TABLE material_supplier_specs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id     UUID NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  supplier_id         UUID NOT NULL REFERENCES suppliers(id)     ON DELETE CASCADE,
  supplier_sku        TEXT,                       -- supplier's product code
  unit_cost           NUMERIC(14,4),
  cost_currency       CHAR(3) DEFAULT 'USD',
  min_order_quantity  NUMERIC(14,4),
  lead_time_days      INTEGER,
  is_primary          BOOLEAN NOT NULL DEFAULT FALSE,
  notes               TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1,
  UNIQUE (raw_material_id, supplier_id)
);
CREATE INDEX material_supplier_specs_supplier_idx ON material_supplier_specs (supplier_id);
CREATE TRIGGER material_supplier_specs_set_updated_at BEFORE UPDATE ON material_supplier_specs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

INSERT INTO schema_migrations (version, description)
  VALUES ('0004_raw_materials', 'material categories, suppliers, raw_materials, supplier specs')
  ON CONFLICT (version) DO NOTHING;
