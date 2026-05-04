-- =============================================================================
-- 0002_identity.sql
-- Users, roles, permissions (RBAC) and sessions.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- users — the principal identity.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT NOT NULL,
  username              TEXT NOT NULL,
  full_name             TEXT,
  password_hash         TEXT,
  password_algo         TEXT,                  -- e.g., 'argon2id', 'bcrypt'
  email_verified_at     TIMESTAMPTZ,
  phone                 TEXT,
  locale                TEXT NOT NULL DEFAULT 'en-US',
  timezone              TEXT NOT NULL DEFAULT 'UTC',
  avatar_url            TEXT,

  -- State
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  is_system             BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at         TIMESTAMPTZ,
  failed_login_count    INTEGER NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,

  -- Standard audit columns
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID,
  updated_by            UUID,
  deleted_at            TIMESTAMPTZ,
  version               INTEGER NOT NULL DEFAULT 1
);

-- Email/username are case-insensitive unique among non-deleted rows.
CREATE UNIQUE INDEX users_email_lower_uniq    ON users (LOWER(email))    WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX users_username_lower_uniq ON users (LOWER(username)) WHERE deleted_at IS NULL;
CREATE INDEX        users_is_active_idx        ON users (is_active)       WHERE deleted_at IS NULL;
CREATE INDEX        users_created_at_idx       ON users (created_at DESC);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

-- Self-referential FKs (added after table creation to avoid the chicken-and-egg)
ALTER TABLE users
  ADD CONSTRAINT users_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id),
  ADD CONSTRAINT users_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id);

-- ---------------------------------------------------------------------------
-- roles & permissions (RBAC)
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,           -- e.g., 'admin', 'scientist', 'viewer'
  name          TEXT NOT NULL,
  description   TEXT,
  is_system     BOOLEAN NOT NULL DEFAULT FALSE, -- system roles cannot be deleted via UI
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID REFERENCES users(id),
  updated_by    UUID REFERENCES users(id),
  deleted_at    TIMESTAMPTZ,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE TRIGGER roles_set_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version();

CREATE TABLE permissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,           -- e.g., 'formula:write'
  resource      TEXT NOT NULL,                  -- e.g., 'formula'
  action        TEXT NOT NULL,                  -- e.g., 'read', 'write', 'approve'
  description   TEXT,
  is_system     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX permissions_resource_action_idx ON permissions (resource, action);

CREATE TABLE role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by    UUID REFERENCES users(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by    UUID REFERENCES users(id),
  expires_at    TIMESTAMPTZ,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_user_id_idx ON user_roles (user_id);
CREATE INDEX user_roles_role_id_idx ON user_roles (role_id);

-- ---------------------------------------------------------------------------
-- user_sessions — issued JWTs / refresh tokens (hashes only)
-- ---------------------------------------------------------------------------
CREATE TABLE user_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  refresh_hash    TEXT UNIQUE,
  ip_address      INET,
  user_agent      TEXT,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX user_sessions_user_id_idx     ON user_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX user_sessions_expires_at_idx  ON user_sessions (expires_at);

INSERT INTO schema_migrations (version, description)
  VALUES ('0002_identity', 'users, roles, permissions, sessions')
  ON CONFLICT (version) DO NOTHING;
