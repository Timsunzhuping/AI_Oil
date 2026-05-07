/**
 * Persistence for the Security / RBAC module.
 *
 * Tables touched:
 *   users / roles / permissions / role_permissions / user_roles / user_sessions
 *   audit_logs
 *   export_logs / model_asset_registry / data_scope_grants
 */
import type { Pool } from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import type {
  AssetStatus,
  AssetType,
  AuditAction,
  AuditLogRow,
  AuditQuery,
  Classification,
  DataScopeGrant,
  ExportApprovalStatus,
  ExportFormat,
  ExportLogRow,
  ModelAssetInput,
  ModelAssetRow,
  PermissionRow,
  RoleCode,
  RoleRow,
  UserRow,
} from './types.js';
import type { PasswordRecord, PasswordRecordLookup } from './auth/password.js';

export class SecurityRepository implements PasswordRecordLookup {
  constructor(private readonly pool: Pool) {}

  // ────────────────────────────────────────────────────────────────────
  // Code generators
  // ────────────────────────────────────────────────────────────────────
  async nextExportCode(): Promise<string> {
    return this.nextCode('export_logs', 'EXP', 6);
  }
  async nextAssetCode(): Promise<string> {
    return this.nextCode('model_asset_registry', 'ASSET', 6);
  }

  private async nextCode(table: string, prefix: string, padTo: number): Promise<string> {
    const year = new Date().getFullYear();
    const res = await this.pool.query<{ code: string }>(
      `SELECT code FROM ${table} WHERE code LIKE $1 ORDER BY code DESC LIMIT 1`,
      [`${prefix}-${year}-%`]
    );
    let n = 1;
    if (res.rows[0]?.code) {
      const m = new RegExp(`^${prefix}-\\d{4}-(\\d+)$`).exec(res.rows[0].code);
      if (m) n = Number(m[1]) + 1;
    }
    return `${prefix}-${year}-${String(n).padStart(padTo, '0')}`;
  }

  // ────────────────────────────────────────────────────────────────────
  // Users
  // ────────────────────────────────────────────────────────────────────
  async findUserById(id: string): Promise<UserRow | null> {
    const r = await this.pool.query<RawUser>(
      `SELECT id, email, username, full_name, is_active, last_login_at,
              failed_login_count, locked_until, metadata, created_at, updated_at
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return r.rows[0] ? mapUser(r.rows[0]) : null;
  }

  async findUserByHandle(
    handle: string
  ): Promise<
    | (UserRow & {
        password_hash: string | null;
        password_algo: string | null;
        salt: string | null;
      })
    | null
  > {
    const r = await this.pool.query<
      RawUser & { password_hash: string | null; password_algo: string | null }
    >(
      `SELECT id, email, username, full_name, is_active, last_login_at,
              failed_login_count, locked_until, metadata, created_at, updated_at,
              password_hash, password_algo
         FROM users
        WHERE deleted_at IS NULL
          AND (LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1))
        LIMIT 1`,
      [handle]
    );
    if (!r.rows[0]) return null;
    const u = r.rows[0];
    /* Salt lives in metadata.password_salt for the sha256-salt algo so we
     * don't have to ALTER the existing users table. */
    const salt =
      (u.metadata &&
        ((u.metadata as Record<string, unknown>)['password_salt'] as string | undefined)) ??
      null;
    return { ...mapUser(u), password_hash: u.password_hash, password_algo: u.password_algo, salt };
  }

  /** Required by PasswordAuthAdapter. */
  async lookup(usernameOrEmail: string): Promise<PasswordRecord | null> {
    const r = await this.findUserByHandle(usernameOrEmail);
    if (!r || !r.password_hash || !r.password_algo) return null;
    return {
      external_id: r.id,
      email: r.email,
      username: r.username,
      ...(r.full_name ? { full_name: r.full_name } : {}),
      password_hash: r.password_hash,
      password_algo: (r.password_algo as PasswordRecord['password_algo']) ?? 'sha256-salt',
      is_active: r.is_active,
      ...(r.salt ? { salt: r.salt } : {}),
    };
  }

  async createUserFromSso(input: {
    email: string;
    username: string;
    full_name?: string;
    metadata?: Record<string, unknown>;
  }): Promise<UserRow> {
    const r = await this.pool.query<RawUser>(
      `INSERT INTO users (email, username, full_name, is_active, metadata, password_algo)
       VALUES ($1, $2, $3, TRUE, $4, NULL)
       ON CONFLICT (LOWER(email)) WHERE deleted_at IS NULL DO UPDATE SET
         updated_at = NOW(), full_name = COALESCE(EXCLUDED.full_name, users.full_name)
       RETURNING id, email, username, full_name, is_active, last_login_at,
                 failed_login_count, locked_until, metadata, created_at, updated_at`,
      [input.email, input.username, input.full_name ?? null, JSON.stringify(input.metadata ?? {})]
    );
    return mapUser(r.rows[0]!);
  }

  async markLoginSuccess(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE users SET last_login_at = NOW(), failed_login_count = 0 WHERE id = $1`,
      [userId]
    );
  }
  async markLoginFailure(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE users SET failed_login_count = failed_login_count + 1 WHERE id = $1`,
      [userId]
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // Roles / permissions
  // ────────────────────────────────────────────────────────────────────
  async listRoles(): Promise<RoleRow[]> {
    const r = await this.pool.query<RoleRow>(
      `SELECT id, code, name, description, is_system, metadata FROM roles WHERE deleted_at IS NULL ORDER BY code`
    );
    return r.rows;
  }
  async listPermissions(): Promise<PermissionRow[]> {
    const r = await this.pool.query<PermissionRow>(
      `SELECT id, code, resource, action, description FROM permissions ORDER BY code`
    );
    return r.rows;
  }
  async listUserRoles(userId: string): Promise<RoleRow[]> {
    const r = await this.pool.query<RoleRow>(
      `SELECT r.id, r.code, r.name, r.description, r.is_system, r.metadata
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1
          AND r.deleted_at IS NULL
          AND (ur.expires_at IS NULL OR ur.expires_at > NOW())`,
      [userId]
    );
    return r.rows;
  }
  async listUserPermissions(userId: string): Promise<string[]> {
    const r = await this.pool.query<{ code: string }>(
      `SELECT DISTINCT p.code
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = $1
          AND (ur.expires_at IS NULL OR ur.expires_at > NOW())`,
      [userId]
    );
    return r.rows.map((row) => row.code);
  }

  async assignRoles(
    userId: string,
    roleCodes: RoleCode[] | string[],
    grantedBy: string | null
  ): Promise<void> {
    /* Remove all current roles, then re-insert; idempotent and atomic. */
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
      if (roleCodes.length > 0) {
        await client.query(
          `INSERT INTO user_roles (user_id, role_id, granted_by)
             SELECT $1, r.id, $2 FROM roles r WHERE r.code = ANY($3::text[]) AND r.deleted_at IS NULL`,
          [userId, grantedBy, roleCodes]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Sessions
  // ────────────────────────────────────────────────────────────────────
  async createSession(
    userId: string,
    ipAddress: string | null,
    userAgent: string | null,
    ttlMs: number
  ): Promise<{ id: string; token: string; expires_at: string }> {
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + ttlMs);
    const r = await this.pool.query<{ id: string; expires_at: Date }>(
      `INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, expires_at`,
      [userId, tokenHash, ipAddress, userAgent, expiresAt]
    );
    return { id: r.rows[0]!.id, token, expires_at: r.rows[0]!.expires_at.toISOString() };
  }

  async findActiveSessionByToken(
    token: string
  ): Promise<{ id: string; user_id: string; expires_at: string } | null> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const r = await this.pool.query<{ id: string; user_id: string; expires_at: Date }>(
      `SELECT id, user_id, expires_at
         FROM user_sessions
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > NOW()
        LIMIT 1`,
      [tokenHash]
    );
    if (!r.rows[0]) return null;
    return {
      id: r.rows[0].id,
      user_id: r.rows[0].user_id,
      expires_at: r.rows[0].expires_at.toISOString(),
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.pool.query(`UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1`, [sessionId]);
  }

  // ────────────────────────────────────────────────────────────────────
  // Audit logs
  // ────────────────────────────────────────────────────────────────────
  async insertAudit(input: {
    user_id: string | null;
    impersonator_id: string | null;
    trace_id: string | null;
    action: AuditAction | string;
    resource_type: string;
    resource_id: string | null;
    resource_code: string | null;
    resource_label: string | null;
    before_state: Record<string, unknown> | null;
    after_state: Record<string, unknown> | null;
    changes: Record<string, unknown> | null;
    request_method: string | null;
    request_path: string | null;
    status_code: number | null;
    duration_ms: number | null;
    error_code: number | null;
    error_message: string | null;
    ip_address: string | null;
    user_agent: string | null;
    metadata: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const r = await this.pool.query<{ id: string }>(
      `INSERT INTO audit_logs (
         trace_id, user_id, impersonator_id, ip_address, user_agent,
         action, resource_type, resource_id, resource_code, resource_label,
         before_state, after_state, changes,
         request_method, request_path, status_code, duration_ms,
         error_code, error_message, metadata
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING id::text`,
      [
        input.trace_id,
        input.user_id,
        input.impersonator_id,
        input.ip_address,
        input.user_agent,
        input.action,
        input.resource_type,
        input.resource_id,
        input.resource_code,
        input.resource_label,
        input.before_state === null ? null : JSON.stringify(input.before_state),
        input.after_state === null ? null : JSON.stringify(input.after_state),
        input.changes === null ? null : JSON.stringify(input.changes),
        input.request_method,
        input.request_path,
        input.status_code,
        input.duration_ms,
        input.error_code,
        input.error_message,
        JSON.stringify(input.metadata),
      ]
    );
    return { id: r.rows[0]!.id };
  }

  async listAudit(filter: AuditQuery): Promise<{ items: AuditLogRow[]; total: number }> {
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.user_id) {
      where.push(`user_id = $${i++}`);
      params.push(filter.user_id);
    }
    if (filter.action) {
      where.push(`action = $${i++}`);
      params.push(filter.action);
    }
    if (filter.resource_type) {
      where.push(`resource_type = $${i++}`);
      params.push(filter.resource_type);
    }
    if (filter.resource_id) {
      where.push(`resource_id = $${i++}`);
      params.push(filter.resource_id);
    }
    if (filter.from) {
      where.push(`occurred_at >= $${i++}`);
      params.push(filter.from);
    }
    if (filter.to) {
      where.push(`occurred_at <  $${i++}`);
      params.push(filter.to);
    }
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 50;

    const total = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit_logs WHERE ${where.join(' AND ')}`,
      params
    );
    const items = await this.pool.query<RawAuditLog>(
      `SELECT id::text, occurred_at, trace_id, user_id, impersonator_id,
              action, resource_type, resource_id, resource_code, resource_label,
              before_state, after_state, changes,
              request_method, request_path, status_code, duration_ms,
              error_code, error_message, metadata
         FROM audit_logs
        WHERE ${where.join(' AND ')}
        ORDER BY occurred_at DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params
    );
    return { items: items.rows.map(mapAudit), total: Number(total.rows[0]!.count) };
  }

  // ────────────────────────────────────────────────────────────────────
  // Exports
  // ────────────────────────────────────────────────────────────────────
  async createExport(input: {
    code: string;
    user_id: string;
    resource_type: string;
    resource_id: string | null;
    resource_label: string | null;
    format: ExportFormat;
    classification: Classification;
    approval_required: boolean;
    approval_status: ExportApprovalStatus;
    watermark_required: boolean;
    watermark_text: string | null;
    trace_id: string | null;
    ip_address: string | null;
    user_agent: string | null;
    metadata: Record<string, unknown>;
  }): Promise<ExportLogRow> {
    const r = await this.pool.query<RawExport>(
      `INSERT INTO export_logs (
         code, user_id, resource_type, resource_id, resource_label,
         format, classification, approval_required, approval_status,
         watermark_required, watermark_text,
         trace_id, ip_address, user_agent, metadata
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        input.code,
        input.user_id,
        input.resource_type,
        input.resource_id,
        input.resource_label,
        input.format,
        input.classification,
        input.approval_required,
        input.approval_status,
        input.watermark_required,
        input.watermark_text,
        input.trace_id,
        input.ip_address,
        input.user_agent,
        JSON.stringify(input.metadata),
      ]
    );
    return mapExport(r.rows[0]!);
  }

  async findExport(id: string): Promise<ExportLogRow | null> {
    const r = await this.pool.query<RawExport>(`SELECT * FROM export_logs WHERE id = $1`, [id]);
    return r.rows[0] ? mapExport(r.rows[0]) : null;
  }

  async listExports(filter: {
    user_id?: string;
    approval_status?: ExportApprovalStatus;
    resource_type?: string;
    page: number;
    pageSize: number;
  }) {
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.user_id) {
      where.push(`user_id = $${i++}`);
      params.push(filter.user_id);
    }
    if (filter.approval_status) {
      where.push(`approval_status = $${i++}`);
      params.push(filter.approval_status);
    }
    if (filter.resource_type) {
      where.push(`resource_type = $${i++}`);
      params.push(filter.resource_type);
    }
    const total = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM export_logs WHERE ${where.join(' AND ')}`,
      params
    );
    const items = await this.pool.query<RawExport>(
      `SELECT * FROM export_logs WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT ${filter.pageSize} OFFSET ${(filter.page - 1) * filter.pageSize}`,
      params
    );
    return { items: items.rows.map(mapExport), total: Number(total.rows[0]!.count) };
  }

  async updateExportApproval(
    id: string,
    patch: {
      approval_status: ExportApprovalStatus;
      approved_by: string | null;
      rejected_reason: string | null;
      output_url: string | null;
      output_size_bytes: number | null;
      output_checksum: string | null;
      output_expires_at: string | null;
      watermark_applied: boolean;
      watermark_metadata: Record<string, unknown>;
    }
  ): Promise<ExportLogRow | null> {
    const r = await this.pool.query<RawExport>(
      `UPDATE export_logs SET
         approval_status = $2,
         approved_by = $3,
         approved_at = CASE WHEN $2 IN ('approved','auto_approved','rejected') THEN NOW() ELSE approved_at END,
         rejected_reason = $4,
         output_url = COALESCE($5, output_url),
         output_size_bytes = COALESCE($6, output_size_bytes),
         output_checksum = COALESCE($7, output_checksum),
         output_expires_at = COALESCE($8, output_expires_at),
         watermark_applied = $9,
         watermark_metadata = $10
       WHERE id = $1
       RETURNING *`,
      [
        id,
        patch.approval_status,
        patch.approved_by,
        patch.rejected_reason,
        patch.output_url,
        patch.output_size_bytes,
        patch.output_checksum,
        patch.output_expires_at,
        patch.watermark_applied,
        JSON.stringify(patch.watermark_metadata),
      ]
    );
    return r.rows[0] ? mapExport(r.rows[0]) : null;
  }

  async incrementExportDownload(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE export_logs SET download_count = download_count + 1, last_downloaded_at = NOW() WHERE id = $1`,
      [id]
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // Model assets
  // ────────────────────────────────────────────────────────────────────
  async createAsset(
    input: ModelAssetInput,
    code: string,
    userId: string | null
  ): Promise<ModelAssetRow> {
    const r = await this.pool.query<RawAsset>(
      `INSERT INTO model_asset_registry (
         code, asset_type, name, description,
         ml_model_version_id, ml_dataset_id,
         storage_url, storage_provider, size_bytes, checksum_sha256, framework, format,
         classification, owner_id, owning_team,
         allowed_role_codes, watermark_required,
         metadata, tags, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [
        code,
        input.asset_type,
        input.name,
        input.description ?? null,
        input.ml_model_version_id ?? null,
        input.ml_dataset_id ?? null,
        input.storage_url,
        input.storage_provider ?? 'local',
        input.size_bytes ?? null,
        input.checksum_sha256 ?? null,
        input.framework ?? null,
        input.format ?? null,
        input.classification ?? 'internal',
        input.owner_id ?? userId,
        input.owning_team ?? null,
        input.allowed_role_codes ?? [],
        input.watermark_required ?? false,
        JSON.stringify(input.metadata ?? {}),
        input.tags ?? [],
        userId,
      ]
    );
    return mapAsset(r.rows[0]!);
  }

  async findAsset(id: string): Promise<ModelAssetRow | null> {
    const r = await this.pool.query<RawAsset>(
      `SELECT * FROM model_asset_registry WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return r.rows[0] ? mapAsset(r.rows[0]) : null;
  }

  async listAssets(filter: {
    asset_type?: AssetType;
    status?: AssetStatus;
    classification?: Classification;
    page: number;
    pageSize: number;
  }) {
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.asset_type) {
      where.push(`asset_type = $${i++}`);
      params.push(filter.asset_type);
    }
    if (filter.status) {
      where.push(`status = $${i++}`);
      params.push(filter.status);
    }
    if (filter.classification) {
      where.push(`classification = $${i++}`);
      params.push(filter.classification);
    }
    const total = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM model_asset_registry WHERE ${where.join(' AND ')}`,
      params
    );
    const items = await this.pool.query<RawAsset>(
      `SELECT * FROM model_asset_registry WHERE ${where.join(' AND ')}
         ORDER BY updated_at DESC
         LIMIT ${filter.pageSize} OFFSET ${(filter.page - 1) * filter.pageSize}`,
      params
    );
    return { items: items.rows.map(mapAsset), total: Number(total.rows[0]!.count) };
  }

  async patchAsset(
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      status?: AssetStatus;
      classification?: Classification;
      allowed_role_codes?: string[];
      watermark_required?: boolean;
      tags?: string[];
      metadata?: Record<string, unknown>;
    },
    userId: string | null
  ): Promise<ModelAssetRow | null> {
    const sets: string[] = ['updated_at = NOW()', 'updated_by = $2'];
    const params: unknown[] = [id, userId];
    let i = 3;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      sets.push(`${k} = $${i++}`);
      params.push(k === 'metadata' ? JSON.stringify(v) : v);
    }
    const r = await this.pool.query<RawAsset>(
      `UPDATE model_asset_registry SET ${sets.join(', ')} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      params
    );
    return r.rows[0] ? mapAsset(r.rows[0]) : null;
  }

  // ────────────────────────────────────────────────────────────────────
  // Data scope grants
  // ────────────────────────────────────────────────────────────────────
  async listScopesFor(userId: string): Promise<DataScopeGrant[]> {
    const r = await this.pool.query<{
      scope_type: string;
      scope_value: string;
      expires_at: Date | null;
    }>(
      `SELECT scope_type, scope_value, expires_at
         FROM data_scope_grants
        WHERE user_id = $1
          AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId]
    );
    return r.rows.map((row) => ({
      scope_type: row.scope_type,
      scope_value: row.scope_value,
      expires_at: row.expires_at ? row.expires_at.toISOString() : null,
    }));
  }

  async upsertScope(input: {
    user_id: string;
    scope_type: string;
    scope_value: string;
    granted_by: string | null;
    expires_at: string | null;
    metadata: Record<string, unknown>;
  }): Promise<DataScopeGrant> {
    const r = await this.pool.query<{
      scope_type: string;
      scope_value: string;
      expires_at: Date | null;
    }>(
      `INSERT INTO data_scope_grants (user_id, scope_type, scope_value, granted_by, expires_at, metadata)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, scope_type, scope_value) DO UPDATE SET
         granted_at = NOW(),
         granted_by = EXCLUDED.granted_by,
         expires_at = EXCLUDED.expires_at,
         metadata   = data_scope_grants.metadata || EXCLUDED.metadata
       RETURNING scope_type, scope_value, expires_at`,
      [
        input.user_id,
        input.scope_type,
        input.scope_value,
        input.granted_by,
        input.expires_at,
        JSON.stringify(input.metadata),
      ]
    );
    const row = r.rows[0]!;
    return {
      scope_type: row.scope_type,
      scope_value: row.scope_value,
      expires_at: row.expires_at ? row.expires_at.toISOString() : null,
    };
  }

  async deleteScope(input: {
    user_id: string;
    scope_type: string;
    scope_value: string;
  }): Promise<boolean> {
    const r = await this.pool.query(
      `DELETE FROM data_scope_grants WHERE user_id = $1 AND scope_type = $2 AND scope_value = $3`,
      [input.user_id, input.scope_type, input.scope_value]
    );
    return (r.rowCount ?? 0) > 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Row mapping
// ─────────────────────────────────────────────────────────────────────────────
interface RawUser {
  id: string;
  email: string;
  username: string;
  full_name: string | null;
  is_active: boolean;
  last_login_at: Date | null;
  failed_login_count: number;
  locked_until: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}
interface RawAuditLog {
  id: string;
  occurred_at: Date;
  trace_id: string | null;
  user_id: string | null;
  impersonator_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_code: string | null;
  resource_label: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  changes: Record<string, unknown> | null;
  request_method: string | null;
  request_path: string | null;
  status_code: number | null;
  duration_ms: number | null;
  error_code: number | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
}
interface RawExport {
  id: string;
  code: string;
  user_id: string;
  resource_type: string;
  resource_id: string | null;
  resource_label: string | null;
  format: ExportFormat;
  approval_required: boolean;
  approval_status: ExportApprovalStatus;
  approved_by: string | null;
  approved_at: Date | null;
  rejected_reason: string | null;
  output_url: string | null;
  output_size_bytes: string | number | null;
  output_checksum: string | null;
  output_expires_at: Date | null;
  download_count: number;
  last_downloaded_at: Date | null;
  watermark_required: boolean;
  watermark_text: string | null;
  watermark_applied: boolean;
  watermark_metadata: Record<string, unknown>;
  classification: Classification;
  trace_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  version: number;
}
interface RawAsset {
  id: string;
  code: string;
  asset_type: AssetType;
  name: string;
  description: string | null;
  ml_model_version_id: string | null;
  ml_dataset_id: string | null;
  storage_url: string;
  storage_provider: string;
  size_bytes: string | number | null;
  checksum_sha256: string | null;
  framework: string | null;
  format: string | null;
  status: AssetStatus;
  classification: Classification;
  owner_id: string | null;
  owning_team: string | null;
  allowed_role_codes: string[];
  watermark_required: boolean;
  metadata: Record<string, unknown>;
  tags: string[];
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  version: number;
}

function mapUser(r: RawUser): UserRow {
  return {
    id: r.id,
    email: r.email,
    username: r.username,
    full_name: r.full_name,
    is_active: r.is_active,
    last_login_at: r.last_login_at ? r.last_login_at.toISOString() : null,
    failed_login_count: r.failed_login_count,
    locked_until: r.locked_until ? r.locked_until.toISOString() : null,
    metadata: r.metadata ?? {},
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}
function mapAudit(r: RawAuditLog): AuditLogRow {
  return {
    ...r,
    occurred_at: r.occurred_at.toISOString(),
    metadata: r.metadata ?? {},
  };
}
function mapExport(r: RawExport): ExportLogRow {
  return {
    ...r,
    output_size_bytes: r.output_size_bytes === null ? null : Number(r.output_size_bytes),
    approved_at: r.approved_at ? r.approved_at.toISOString() : null,
    output_expires_at: r.output_expires_at ? r.output_expires_at.toISOString() : null,
    last_downloaded_at: r.last_downloaded_at ? r.last_downloaded_at.toISOString() : null,
    watermark_metadata: r.watermark_metadata ?? {},
    metadata: r.metadata ?? {},
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}
function mapAsset(r: RawAsset): ModelAssetRow {
  return {
    ...r,
    size_bytes: r.size_bytes === null ? null : Number(r.size_bytes),
    allowed_role_codes: r.allowed_role_codes ?? [],
    metadata: r.metadata ?? {},
    tags: r.tags ?? [],
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}
