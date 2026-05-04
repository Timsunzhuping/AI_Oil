-- =============================================================================
-- 0011_master_data.sql
-- Master Data Management:
--   units & unit_aliases & unit_conversions
--   metrics & metric_aliases
--   raw_material_aliases (proper aliases table; supersedes alternate_names array)
--   import_jobs (records every CSV/XLSX import + structured error report)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- units — standardized unit dictionary
-- ---------------------------------------------------------------------------
CREATE TABLE units (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL UNIQUE,           -- 'kg', 'cSt', 'C', 'mg/kg'
  name            TEXT NOT NULL,                  -- 'Kilogram'
  symbol          TEXT,                           -- 'kg' (display)
  dimension       TEXT NOT NULL,                  -- 'mass','length','volume','temperature','viscosity','pressure','time','dimensionless'
  base_unit_code  TEXT,                           -- canonical base for the dimension (e.g. 'kg' for mass, 'K' for temp)
  is_si           BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  display_order   INTEGER NOT NULL DEFAULT 0,
  description     TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES users(id),
  updated_by      UUID REFERENCES users(id),
  deleted_at      TIMESTAMPTZ,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX units_dimension_idx ON units (dimension) WHERE deleted_at IS NULL;
CREATE INDEX units_is_active_idx ON units (is_active) WHERE deleted_at IS NULL;
CREATE TRIGGER units_set_updated_at BEFORE UPDATE ON units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- unit_aliases — alternate spellings/abbreviations that resolve to a unit.
-- alias_normalized = lower(trim(alias)) to make lookups case-insensitive.
-- ---------------------------------------------------------------------------
CREATE TABLE unit_aliases (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id           UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  alias             TEXT NOT NULL,                 -- 'Kilogram', 'KG', 'kilo'
  alias_normalized  TEXT NOT NULL,                 -- 'kilogram', 'kg', 'kilo'
  language          TEXT,                          -- 'en','zh','de'
  source            TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','import','auto_suggested','migration')),
  confidence        NUMERIC(3,2) NOT NULL DEFAULT 1.00 CHECK (confidence BETWEEN 0 AND 1),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID REFERENCES users(id),
  updated_by        UUID REFERENCES users(id),
  deleted_at        TIMESTAMPTZ,
  version           INTEGER NOT NULL DEFAULT 1,
  UNIQUE (unit_id, alias_normalized)
);
-- A given normalized alias may resolve to AT MOST ONE active unit
CREATE UNIQUE INDEX unit_aliases_global_uniq
  ON unit_aliases (alias_normalized)
  WHERE is_active = TRUE AND deleted_at IS NULL;
CREATE INDEX unit_aliases_unit_idx ON unit_aliases (unit_id);
CREATE TRIGGER unit_aliases_set_updated_at BEFORE UPDATE ON unit_aliases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- unit_conversions — linear conversion: target = source * factor + offset.
-- For non-linear conversions (e.g. log scales), set `formula` and let the
-- application layer evaluate it.
-- ---------------------------------------------------------------------------
CREATE TABLE unit_conversions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_unit_id    UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  to_unit_id      UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  factor          NUMERIC(20,10) NOT NULL,        -- multiplicative factor
  offset_value    NUMERIC(20,10) NOT NULL DEFAULT 0,
  formula         TEXT,                            -- optional explicit (e.g. 'C = (F - 32) * 5/9')
  is_exact        BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES users(id),
  updated_by      UUID REFERENCES users(id),
  deleted_at      TIMESTAMPTZ,
  version         INTEGER NOT NULL DEFAULT 1,
  UNIQUE (from_unit_id, to_unit_id),
  CHECK (from_unit_id <> to_unit_id)
);
CREATE INDEX unit_conversions_from_idx ON unit_conversions (from_unit_id);
CREATE INDEX unit_conversions_to_idx   ON unit_conversions (to_unit_id);
CREATE TRIGGER unit_conversions_set_updated_at BEFORE UPDATE ON unit_conversions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- metrics — standardized test/quality metric dictionary.
-- ---------------------------------------------------------------------------
CREATE TABLE metrics (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE,         -- 'PH', 'KV_100C'
  name_std            TEXT NOT NULL,                -- 'Kinematic Viscosity @ 100°C'
  name_short          TEXT,                         -- 'KV100'
  category            TEXT NOT NULL DEFAULT 'physical'
    CHECK (category IN ('physical','chemical','microbiological','sensory','rheological','thermal','electrical','optical','other')),
  data_type           TEXT NOT NULL DEFAULT 'numeric'
    CHECK (data_type IN ('numeric','text','boolean','spectrum','image','attachment')),

  default_unit_id     UUID REFERENCES units(id) ON DELETE SET NULL,
  expected_min        NUMERIC(20,6),
  expected_max        NUMERIC(20,6),

  description         TEXT,
  test_method         TEXT,                          -- canonical standard, e.g. 'ASTM D445'
  references          JSONB,                         -- additional standards / docs
  precision_decimals  SMALLINT,                      -- recommended display precision

  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  display_order       INTEGER NOT NULL DEFAULT 0,
  tags                TEXT[] DEFAULT ARRAY[]::TEXT[],
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id),
  updated_by          UUID REFERENCES users(id),
  deleted_at          TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX metrics_category_idx     ON metrics (category) WHERE deleted_at IS NULL;
CREATE INDEX metrics_data_type_idx    ON metrics (data_type) WHERE deleted_at IS NULL;
CREATE INDEX metrics_is_active_idx    ON metrics (is_active) WHERE deleted_at IS NULL;
CREATE INDEX metrics_default_unit_idx ON metrics (default_unit_id);
CREATE INDEX metrics_tags_idx         ON metrics USING GIN (tags);
CREATE INDEX metrics_name_trgm_idx    ON metrics USING GIN (name_std gin_trgm_ops);
CREATE TRIGGER metrics_set_updated_at BEFORE UPDATE ON metrics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- metric_aliases — synonyms / mistypings that map to a standard metric.
-- ---------------------------------------------------------------------------
CREATE TABLE metric_aliases (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_id         UUID NOT NULL REFERENCES metrics(id) ON DELETE CASCADE,
  alias             TEXT NOT NULL,                  -- 'pH value', 'PH', 'p.H.'
  alias_normalized  TEXT NOT NULL,                  -- 'ph value', 'ph', 'p.h.'
  language          TEXT,
  source            TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','import','auto_suggested','migration')),
  confidence        NUMERIC(3,2) NOT NULL DEFAULT 1.00 CHECK (confidence BETWEEN 0 AND 1),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID REFERENCES users(id),
  updated_by        UUID REFERENCES users(id),
  deleted_at        TIMESTAMPTZ,
  version           INTEGER NOT NULL DEFAULT 1,
  UNIQUE (metric_id, alias_normalized)
);
CREATE UNIQUE INDEX metric_aliases_global_uniq
  ON metric_aliases (alias_normalized)
  WHERE is_active = TRUE AND deleted_at IS NULL;
CREATE INDEX metric_aliases_metric_idx ON metric_aliases (metric_id);
CREATE TRIGGER metric_aliases_set_updated_at BEFORE UPDATE ON metric_aliases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- raw_material_aliases — proper alias mapping table.
-- (raw_materials.alternate_names array remains for legacy free-form fallback;
--  this table is the canonical, governed mapping.)
-- ---------------------------------------------------------------------------
CREATE TABLE raw_material_aliases (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id   UUID NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  alias             TEXT NOT NULL,                  -- 'Mineral Oil 150 N', 'PB-150N', '150-Neutral'
  alias_normalized  TEXT NOT NULL,                  -- lower(trim(alias))
  alias_type        TEXT NOT NULL DEFAULT 'name'
    CHECK (alias_type IN ('name','abbreviation','trade_name','cas','supplier_sku','legacy_code','synonym')),
  language          TEXT,
  source            TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','import','auto_suggested','migration')),
  confidence        NUMERIC(3,2) NOT NULL DEFAULT 1.00 CHECK (confidence BETWEEN 0 AND 1),
  mapped_by         UUID REFERENCES users(id),
  mapped_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  notes             TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID REFERENCES users(id),
  updated_by        UUID REFERENCES users(id),
  deleted_at        TIMESTAMPTZ,
  version           INTEGER NOT NULL DEFAULT 1,
  UNIQUE (raw_material_id, alias_normalized)
);
-- An alias may resolve to AT MOST ONE active raw material — globally unique.
CREATE UNIQUE INDEX raw_material_aliases_global_uniq
  ON raw_material_aliases (alias_normalized)
  WHERE is_active = TRUE AND deleted_at IS NULL;
CREATE INDEX raw_material_aliases_material_idx ON raw_material_aliases (raw_material_id);
CREATE INDEX raw_material_aliases_type_idx     ON raw_material_aliases (alias_type);
CREATE INDEX raw_material_aliases_trgm_idx     ON raw_material_aliases USING GIN (alias gin_trgm_ops);
CREATE TRIGGER raw_material_aliases_set_updated_at BEFORE UPDATE ON raw_material_aliases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- import_jobs — every CSV/XLSX import operation is recorded here.
-- ---------------------------------------------------------------------------
CREATE TABLE import_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target            TEXT NOT NULL
    CHECK (target IN ('materials','products','suppliers','metrics','units','material_aliases','metric_aliases','unit_aliases')),
  source_filename   TEXT,
  source_format     TEXT NOT NULL CHECK (source_format IN ('csv','xlsx','json')),
  source_size_bytes BIGINT,
  total_rows        INTEGER NOT NULL DEFAULT 0,
  success_count     INTEGER NOT NULL DEFAULT 0,
  error_count       INTEGER NOT NULL DEFAULT 0,
  warning_count     INTEGER NOT NULL DEFAULT 0,
  skipped_count     INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed','partial')),
  mode              TEXT NOT NULL DEFAULT 'upsert'
    CHECK (mode IN ('insert','update','upsert','dry_run')),
  error_report      JSONB NOT NULL DEFAULT '[]'::jsonb,    -- array of structured row errors
  warnings          JSONB NOT NULL DEFAULT '[]'::jsonb,
  imported_by       UUID REFERENCES users(id),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  duration_ms       INTEGER,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX import_jobs_target_idx     ON import_jobs (target, created_at DESC);
CREATE INDEX import_jobs_status_idx     ON import_jobs (status, created_at DESC);
CREATE INDEX import_jobs_imported_idx   ON import_jobs (imported_by, created_at DESC);

INSERT INTO schema_migrations (version, description)
  VALUES ('0011_master_data', 'units, unit_aliases, unit_conversions, metrics, metric_aliases, raw_material_aliases, import_jobs')
  ON CONFLICT (version) DO NOTHING;
