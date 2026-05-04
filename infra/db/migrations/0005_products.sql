-- =============================================================================
-- 0005_products.sql
-- Products: finished and semi-finished goods produced from formulas.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- product_categories — hierarchical category tree (mirrors material_categories).
-- ---------------------------------------------------------------------------
CREATE TABLE product_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  parent_id     UUID REFERENCES product_categories(id) ON DELETE SET NULL,
  level         SMALLINT NOT NULL DEFAULT 1,
  path          TEXT NOT NULL,
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
CREATE INDEX product_categories_parent_idx ON product_categories (parent_id);
CREATE INDEX product_categories_path_idx   ON product_categories (path);
CREATE TRIGGER product_categories_set_updated_at BEFORE UPDATE ON product_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- products — finished or semi-finished goods.
-- A product points to its currently-promoted formula version once approved.
-- ---------------------------------------------------------------------------
CREATE TABLE products (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  product_type        TEXT NOT NULL DEFAULT 'finished'
    CHECK (product_type IN ('finished','semi_finished','intermediate','sample')),
  category_id         UUID REFERENCES product_categories(id) ON DELETE SET NULL,
  description         TEXT,

  -- Lifecycle
  status              TEXT NOT NULL DEFAULT 'development'
    CHECK (status IN ('development','testing','approved','production','discontinued','archived')),
  lifecycle_stage     TEXT,                       -- 'concept' | 'design' | 'pilot' | 'mass_production'

  -- Active formula pointer (set after approval; FK added in migration 0006 to avoid cycle)
  current_formula_version_id UUID,

  -- Target specs the product must satisfy
  target_specifications  JSONB NOT NULL DEFAULT '{}'::jsonb,
                                                  -- e.g., { "ph": {min: 5, max: 7}, "viscosity_cst": {...} }
  intended_use           TEXT,
  market_segment         TEXT,
  unit_of_measure        TEXT NOT NULL DEFAULT 'kg',
  package_size           NUMERIC(14,4),
  package_unit           TEXT,

  -- Commercial
  list_price             NUMERIC(14,4),
  price_currency         CHAR(3) DEFAULT 'USD',

  -- Compliance
  regulatory_codes       TEXT[] DEFAULT ARRAY[]::TEXT[],
  certifications         TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Extensibility
  properties             JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags                   TEXT[] DEFAULT ARRAY[]::TEXT[],
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Audit
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by             UUID REFERENCES users(id),
  updated_by             UUID REFERENCES users(id),
  deleted_at             TIMESTAMPTZ,
  version                INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX products_category_idx       ON products (category_id) WHERE deleted_at IS NULL;
CREATE INDEX products_status_idx         ON products (status) WHERE deleted_at IS NULL;
CREATE INDEX products_type_idx           ON products (product_type) WHERE deleted_at IS NULL;
CREATE INDEX products_name_trgm_idx      ON products USING GIN (name gin_trgm_ops);
CREATE INDEX products_tags_idx           ON products USING GIN (tags);
CREATE INDEX products_target_specs_idx   ON products USING GIN (target_specifications);
CREATE INDEX products_current_fv_idx     ON products (current_formula_version_id);

CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- product_specifications — explicit, queryable target spec rows
-- (target_specifications JSONB is the lightweight snapshot;
--  this table is the normalized form for spec-vs-test-result matching).
-- ---------------------------------------------------------------------------
CREATE TABLE product_specifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  spec_code           TEXT NOT NULL,                -- e.g., 'PH', 'VISCOSITY_40C'
  spec_name           TEXT NOT NULL,
  test_method         TEXT,                          -- referenced standard, e.g. 'ASTM D445'
  unit_of_measure     TEXT,
  target_value        NUMERIC(14,6),
  min_value           NUMERIC(14,6),
  max_value           NUMERIC(14,6),
  tolerance_pct       NUMERIC(6,3),
  is_critical         BOOLEAN NOT NULL DEFAULT FALSE,
  display_order       INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id),
  updated_by          UUID REFERENCES users(id),
  deleted_at          TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1,
  UNIQUE (product_id, spec_code)
);
CREATE INDEX product_specifications_product_idx ON product_specifications (product_id);
CREATE TRIGGER product_specifications_set_updated_at BEFORE UPDATE ON product_specifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

INSERT INTO schema_migrations (version, description)
  VALUES ('0005_products', 'product categories, products, product_specifications')
  ON CONFLICT (version) DO NOTHING;
