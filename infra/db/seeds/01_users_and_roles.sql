-- =============================================================================
-- 01_users_and_roles.sql
-- Bootstrap admin/scientist/viewer roles + seed system users.
-- Idempotent — uses ON CONFLICT.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Permissions catalog (resource:action)
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, resource, action, description, is_system) VALUES
  ('raw_material:read',     'raw_material',     'read',     'View raw materials', TRUE),
  ('raw_material:write',    'raw_material',     'write',    'Create/edit raw materials', TRUE),
  ('product:read',          'product',          'read',     'View products', TRUE),
  ('product:write',         'product',          'write',    'Create/edit products', TRUE),
  ('formula:read',          'formula',          'read',     'View formulas', TRUE),
  ('formula:write',         'formula',          'write',    'Create/edit formula drafts', TRUE),
  ('formula:approve',       'formula',          'approve',  'Approve formula versions', TRUE),
  ('experiment:read',       'experiment',       'read',     'View experiments', TRUE),
  ('experiment:write',      'experiment',       'write',    'Create/edit experiments', TRUE),
  ('test_result:read',      'test_result',      'read',     'View test results', TRUE),
  ('test_result:write',     'test_result',      'write',    'Record test results', TRUE),
  ('rd_task:read',          'rd_task',          'read',     'View R&D tasks', TRUE),
  ('rd_task:write',         'rd_task',          'write',    'Create/assign R&D tasks', TRUE),
  ('knowledge:read',        'knowledge',        'read',     'View knowledge documents', TRUE),
  ('knowledge:write',       'knowledge',        'write',    'Author knowledge documents', TRUE),
  ('expert_rule:read',      'expert_rule',      'read',     'View expert rules', TRUE),
  ('expert_rule:write',     'expert_rule',      'write',    'Author expert rules', TRUE),
  ('ml_model:read',         'ml_model',         'read',     'View ML registry', TRUE),
  ('ml_model:write',        'ml_model',         'write',    'Register / version ML models', TRUE),
  ('ml_model:promote',      'ml_model',         'promote',  'Promote a model version to production', TRUE),
  ('user:read',             'user',             'read',     'View users', TRUE),
  ('user:write',            'user',             'write',    'Create/edit users', TRUE),
  ('audit:read',            'audit',            'read',     'Read audit logs', TRUE)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
INSERT INTO roles (id, code, name, description, is_system) VALUES
  ('11111111-1111-1111-1111-111111111101', 'admin',     'Administrator',  'Full access to every resource', TRUE),
  ('11111111-1111-1111-1111-111111111102', 'scientist', 'R&D Scientist',  'Create formulas, experiments, knowledge', TRUE),
  ('11111111-1111-1111-1111-111111111103', 'reviewer',  'Reviewer',       'Approve formulas and review experiments', TRUE),
  ('11111111-1111-1111-1111-111111111104', 'analyst',   'Analyst',        'Read-only analytics + ML insight access', TRUE),
  ('11111111-1111-1111-1111-111111111105', 'viewer',    'Viewer',         'Read-only access to non-sensitive data', TRUE)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Role → permission mapping
-- ---------------------------------------------------------------------------
-- admin: every permission
INSERT INTO role_permissions (role_id, permission_id)
SELECT '11111111-1111-1111-1111-111111111101', id FROM permissions
ON CONFLICT DO NOTHING;

-- scientist: read everything, write most operational tables (no approval, no user mgmt)
INSERT INTO role_permissions (role_id, permission_id)
SELECT '11111111-1111-1111-1111-111111111102', id FROM permissions
WHERE code IN (
  'raw_material:read','raw_material:write',
  'product:read','product:write',
  'formula:read','formula:write',
  'experiment:read','experiment:write',
  'test_result:read','test_result:write',
  'rd_task:read','rd_task:write',
  'knowledge:read','knowledge:write',
  'expert_rule:read',
  'ml_model:read'
) ON CONFLICT DO NOTHING;

-- reviewer: read all + approve formulas
INSERT INTO role_permissions (role_id, permission_id)
SELECT '11111111-1111-1111-1111-111111111103', id FROM permissions
WHERE action = 'read' OR code IN ('formula:approve','rd_task:write','expert_rule:write')
ON CONFLICT DO NOTHING;

-- analyst: read everything + ml insights
INSERT INTO role_permissions (role_id, permission_id)
SELECT '11111111-1111-1111-1111-111111111104', id FROM permissions
WHERE action = 'read'
ON CONFLICT DO NOTHING;

-- viewer: read non-sensitive
INSERT INTO role_permissions (role_id, permission_id)
SELECT '11111111-1111-1111-1111-111111111105', id FROM permissions
WHERE code IN ('product:read','formula:read','knowledge:read','rd_task:read','experiment:read')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- System users (hashed passwords are placeholders — replace before going live)
-- ---------------------------------------------------------------------------
INSERT INTO users (id, email, username, full_name, password_hash, password_algo, is_active, is_system, email_verified_at) VALUES
  ('22222222-2222-2222-2222-222222222201', 'system@fluidmind.local', 'system', 'System',
   'PLACEHOLDER_REPLACE_ME', 'argon2id', TRUE, TRUE, NOW()),
  ('22222222-2222-2222-2222-222222222202', 'admin@fluidmind.local',  'admin',  'Default Administrator',
   'PLACEHOLDER_REPLACE_ME', 'argon2id', TRUE, TRUE, NOW()),
  ('22222222-2222-2222-2222-222222222203', 'alice@fluidmind.local',  'alice',  'Alice (Scientist)',
   'PLACEHOLDER_REPLACE_ME', 'argon2id', TRUE, FALSE, NOW()),
  ('22222222-2222-2222-2222-222222222204', 'bob@fluidmind.local',    'bob',    'Bob (Reviewer)',
   'PLACEHOLDER_REPLACE_ME', 'argon2id', TRUE, FALSE, NOW())
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Assign roles to users
-- ---------------------------------------------------------------------------
INSERT INTO user_roles (user_id, role_id) VALUES
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111101'),  -- system → admin
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111101'),  -- admin → admin
  ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111102'),  -- alice → scientist
  ('22222222-2222-2222-2222-222222222204', '11111111-1111-1111-1111-111111111103')   -- bob → reviewer
ON CONFLICT DO NOTHING;
