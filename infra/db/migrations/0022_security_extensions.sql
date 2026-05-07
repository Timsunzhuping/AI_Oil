-- =============================================================================
-- 0022_security_extensions.sql
--
-- Security / RBAC / audit extensions for the enterprise platform.
-- Builds on top of the existing identity tables (0002_identity.sql) and the
-- partitioned audit_logs table (0003_audit_logs.sql).
--
-- New tables:
--   export_logs              — every export request + approval / watermark lifecycle
--   model_asset_registry     — physical asset registry (artifacts / datasets / prompts)
--   data_scope_grants        — fine-grained per-user data-scope rules
--
-- Seed (idempotent):
--   • 5 canonical roles (super_admin, model_admin, researcher, lims_user, viewer)
--   • Curated permission catalogue covering every business module
--   • role ↔ permission grants
-- =============================================================================

-- -----------------------------------------------------------------------------
-- export_logs — every export with approval + watermark workflow
-- -----------------------------------------------------------------------------
CREATE TABLE export_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT NOT NULL UNIQUE,                  -- EXP-YYYY-NNNNNN

  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  resource_type         TEXT NOT NULL,                          -- 'formula','task_result','compare_report',…
  resource_id           UUID,
  resource_label        TEXT,
  format                TEXT NOT NULL                           -- 'pdf','xlsx','csv','json','image'
    CHECK (format IN ('pdf','xlsx','csv','json','image','zip')),

  -- Approval workflow
  approval_required     BOOLEAN NOT NULL DEFAULT TRUE,
  approval_status       TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending','approved','rejected','expired','cancelled','auto_approved')),
  approved_by           UUID REFERENCES users(id),
  approved_at           TIMESTAMPTZ,
  rejected_reason       TEXT,

  -- Output
  output_url            TEXT,
  output_size_bytes     BIGINT,
  output_checksum       TEXT,
  output_expires_at     TIMESTAMPTZ,
  download_count        INTEGER NOT NULL DEFAULT 0,
  last_downloaded_at    TIMESTAMPTZ,

  -- Watermark (reserved — backend stamps the policy, exporter applies it later)
  watermark_required    BOOLEAN NOT NULL DEFAULT FALSE,
  watermark_text        TEXT,
  watermark_applied     BOOLEAN NOT NULL DEFAULT FALSE,
  watermark_metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Classification
  classification        TEXT NOT NULL DEFAULT 'internal'
    CHECK (classification IN ('public','internal','confidential','restricted')),

  -- Audit
  trace_id              TEXT,
  ip_address            INET,
  user_agent            TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version               INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX export_logs_user_idx        ON export_logs (user_id, created_at DESC);
CREATE INDEX export_logs_status_idx      ON export_logs (approval_status, created_at DESC);
CREATE INDEX export_logs_resource_idx    ON export_logs (resource_type, resource_id);
CREATE INDEX export_logs_classification_idx ON export_logs (classification);
CREATE INDEX export_logs_trace_idx       ON export_logs (trace_id) WHERE trace_id IS NOT NULL;
CREATE TRIGGER export_logs_set_updated_at BEFORE UPDATE ON export_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

COMMENT ON TABLE  export_logs IS 'Every export request: approval workflow, watermark policy, download counter, classification.';

-- -----------------------------------------------------------------------------
-- model_asset_registry — physical asset registry (artifacts / datasets / prompts)
-- -----------------------------------------------------------------------------
CREATE TABLE model_asset_registry (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT NOT NULL UNIQUE,                  -- ASSET-YYYY-NNNNNN
  asset_type            TEXT NOT NULL
    CHECK (asset_type IN ('model_artifact','training_dataset','feature_store','prompt_template','tokenizer','embeddings','other')),
  name                  TEXT NOT NULL,
  description           TEXT,

  /* Optional link to ml_model_versions for end-to-end lineage. */
  ml_model_version_id   UUID REFERENCES ml_model_versions(id) ON DELETE SET NULL,
  ml_dataset_id         UUID REFERENCES ml_datasets(id) ON DELETE SET NULL,

  storage_url           TEXT NOT NULL,
  storage_provider      TEXT NOT NULL DEFAULT 'local'
    CHECK (storage_provider IN ('local','s3','gcs','azure','memory','external')),
  size_bytes            BIGINT,
  checksum_sha256       TEXT,
  framework             TEXT,                                  -- 'pytorch','onnx','sklearn','huggingface',…
  format                TEXT,                                  -- 'safetensors','pkl','parquet',…

  -- Lifecycle
  status                TEXT NOT NULL DEFAULT 'staged'
    CHECK (status IN ('staged','active','retired','revoked')),

  -- Security
  classification        TEXT NOT NULL DEFAULT 'internal'
    CHECK (classification IN ('public','internal','confidential','restricted')),
  owner_id              UUID REFERENCES users(id),
  owning_team           TEXT,

  -- Access control
  allowed_role_codes    TEXT[] DEFAULT ARRAY[]::TEXT[],
  watermark_required    BOOLEAN NOT NULL DEFAULT FALSE,

  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags                  TEXT[] DEFAULT ARRAY[]::TEXT[],

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID REFERENCES users(id),
  updated_by            UUID REFERENCES users(id),
  deleted_at            TIMESTAMPTZ,
  version               INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX model_asset_registry_type_idx       ON model_asset_registry (asset_type, status) WHERE deleted_at IS NULL;
CREATE INDEX model_asset_registry_owner_idx      ON model_asset_registry (owner_id) WHERE deleted_at IS NULL;
CREATE INDEX model_asset_registry_classif_idx    ON model_asset_registry (classification) WHERE deleted_at IS NULL;
CREATE INDEX model_asset_registry_role_idx       ON model_asset_registry USING GIN (allowed_role_codes);
CREATE INDEX model_asset_registry_tags_idx       ON model_asset_registry USING GIN (tags);
CREATE INDEX model_asset_registry_ml_version_idx ON model_asset_registry (ml_model_version_id) WHERE ml_model_version_id IS NOT NULL;
CREATE TRIGGER model_asset_registry_set_updated_at BEFORE UPDATE ON model_asset_registry
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

COMMENT ON TABLE model_asset_registry IS 'Physical asset registry (artifacts / datasets / prompts). Sits alongside ml_model_registry; the latter is the LOGICAL model identity, this table tracks the BYTES and who can touch them.';

-- -----------------------------------------------------------------------------
-- data_scope_grants — per-user data-scope rules
-- -----------------------------------------------------------------------------
CREATE TABLE data_scope_grants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  /* 'product_category' / 'team' / 'region' / 'formula_id' / 'project' / 'custom'
   * The application interprets the (scope_type, scope_value) pair when
   * filtering query results — see security/data-scope.ts. */
  scope_type      TEXT NOT NULL,
  scope_value     TEXT NOT NULL,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by      UUID REFERENCES users(id),
  expires_at      TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT data_scope_grants_uk UNIQUE (user_id, scope_type, scope_value)
);
CREATE INDEX data_scope_grants_user_idx ON data_scope_grants (user_id);
CREATE INDEX data_scope_grants_type_idx ON data_scope_grants (scope_type);

COMMENT ON TABLE data_scope_grants IS 'Per-user, scoped data access rules. Service layer reads these via SecurityService.scopesFor() and AND-merges into list queries.';

-- -----------------------------------------------------------------------------
-- Seed: canonical roles + permissions
-- -----------------------------------------------------------------------------

INSERT INTO roles (code, name, description, is_system) VALUES
  ('super_admin', '超级管理员', 'Full platform access; only super_admins can grant the super_admin role.', TRUE),
  ('model_admin', '模型管理员', 'Manage ML datasets, training jobs, model release/rollback, and asset registry.', TRUE),
  ('researcher',  '研发人员',   'Create & modify formulas, run prediction / recommendation, request exports.', TRUE),
  ('lims_user',   '实验员',     'Create LIMS tasks, view experimental results, view formulas read-only.', TRUE),
  ('viewer',      '只读访客',   'Read-only access to dashboards and published knowledge entries.', TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code, resource, action, description, is_system) VALUES
  -- Identity / RBAC
  ('user:read',                    'user',             'read',     'View users and roles', TRUE),
  ('user:manage',                  'user',             'manage',   'Create / edit / disable users + assign roles', TRUE),
  ('role:manage',                  'role',             'manage',   'Create / edit roles + grants', TRUE),
  -- Master data
  ('master_data:read',             'master_data',      'read',     'Read raw materials / suppliers / units / etc.', TRUE),
  ('master_data:write',            'master_data',      'write',    'Modify master data', TRUE),
  -- Formula / R&D
  ('formula:read',                 'formula',          'read',     'View formulas', TRUE),
  ('formula:write',                'formula',          'write',    'Create / edit formulas', TRUE),
  ('formula:approve',              'formula',          'approve',  'Approve formula versions', TRUE),
  -- Predict / recommend
  ('predict:execute',              'predict',          'execute',  'Run /predict endpoints', TRUE),
  ('recommend:execute',            'recommend',        'execute',  'Run /recommend endpoints', TRUE),
  -- Task center / R&D demand
  ('task:read',                    'task',             'read',     'View R&D tasks', TRUE),
  ('task:write',                   'task',             'write',    'Submit / edit demand input', TRUE),
  -- Knowledge / docs
  ('knowledge:read',               'knowledge',        'read',     'Read KB entries', TRUE),
  ('knowledge:write',              'knowledge',        'write',    'Edit KB entries', TRUE),
  ('document:upload',              'document',         'upload',   'Upload documents for parsing', TRUE),
  ('document:review',              'document',         'review',   'Approve / edit OCR results', TRUE),
  -- QA
  ('qa:ask',                       'qa',               'ask',      'Use the QA assistant', TRUE),
  -- ERP / LIMS / Carbon
  ('erp:sap_sync',                 'erp_sap',          'sync',     'Trigger SAP BOM/cost/inventory sync', TRUE),
  ('erp:lims_create',              'erp_lims',         'create',   'Create LIMS tasks', TRUE),
  ('erp:lims_pull',                'erp_lims',         'pull',     'Pull LIMS results', TRUE),
  ('erp:carbon_lookup',            'erp_carbon',       'read',     'Look up carbon factors / estimate formula CO₂e', TRUE),
  -- ML / model factory
  ('ml:dataset_manage',            'ml_dataset',       'manage',   'Create datasets / feature templates', TRUE),
  ('ml:train',                     'ml_training',      'execute',  'Submit training jobs', TRUE),
  ('ml:release',                   'ml_release',       'release',  'Release / rollback model versions', TRUE),
  ('ml:model_read',                'ml_model',         'read',     'View model registry + compare', TRUE),
  -- Export / audit
  ('export:request',               'export',           'request',  'Request a data export', TRUE),
  ('export:approve',               'export',           'approve',  'Approve / reject export requests', TRUE),
  ('export:download',              'export',           'download', 'Download an approved export', TRUE),
  ('audit:read',                   'audit',            'read',     'Read audit log', TRUE),
  -- Asset registry
  ('asset:read',                   'asset',            'read',     'View model asset registry', TRUE),
  ('asset:manage',                 'asset',            'manage',   'Manage model asset registry', TRUE)
ON CONFLICT (code) DO NOTHING;

-- ── role grants — super_admin gets every permission ──────────────────────
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
  WHERE r.code = 'super_admin'
ON CONFLICT DO NOTHING;

-- model_admin: ML / asset / model release + read most things
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'ml:dataset_manage','ml:train','ml:release','ml:model_read',
    'asset:read','asset:manage',
    'master_data:read','formula:read','task:read','knowledge:read',
    'audit:read','export:request','export:approve','export:download',
    'predict:execute','recommend:execute','qa:ask'
  )
  WHERE r.code = 'model_admin'
ON CONFLICT DO NOTHING;

-- researcher: full R&D loop
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'master_data:read','formula:read','formula:write',
    'predict:execute','recommend:execute',
    'task:read','task:write',
    'knowledge:read','knowledge:write','document:upload','document:review',
    'qa:ask',
    'ml:model_read',
    'export:request','export:download',
    'erp:carbon_lookup'
  )
  WHERE r.code = 'researcher'
ON CONFLICT DO NOTHING;

-- lims_user: lab / experiment focus
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'master_data:read','formula:read',
    'task:read',
    'knowledge:read','document:upload',
    'qa:ask',
    'erp:lims_create','erp:lims_pull',
    'export:request','export:download'
  )
  WHERE r.code = 'lims_user'
ON CONFLICT DO NOTHING;

-- viewer: read-only
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'master_data:read','formula:read','task:read',
    'knowledge:read',
    'qa:ask',
    'ml:model_read'
  )
  WHERE r.code = 'viewer'
ON CONFLICT DO NOTHING;
