/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * In-memory SecurityRepository fake for service / middleware tests.
 *
 * Implements the public methods touched by the service layer; signatures
 * mirror `SecurityRepository`. The `lookup()` method satisfies the
 * `PasswordRecordLookup` contract used by `PasswordAuthAdapter`.
 */
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import type { PasswordRecord } from '../../../src/modules/security/auth/password.js';
import type {
  AssetStatus,
  AssetType,
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
} from '../../../src/modules/security/types.js';

interface UserRecord extends UserRow {
  password_hash: string | null;
  password_algo: string | null;
  salt: string | null;
}

export class FakeSecurityRepository {
  users = new Map<string, UserRecord>();
  roles = new Map<string, RoleRow>();
  permissions = new Map<string, PermissionRow>();
  rolePermissions = new Map<string, Set<string>>(); // role_code → permission codes
  userRoles = new Map<string, Set<string>>(); // user_id → role codes
  scopes = new Map<string, DataScopeGrant[]>(); // user_id → grants
  sessions = new Map<
    string,
    { id: string; user_id: string; expires_at: string; revoked: boolean; tokenHash: string }
  >();
  audit: AuditLogRow[] = [];
  exports = new Map<string, ExportLogRow>();
  assets = new Map<string, ModelAssetRow>();
  private exportCounter = 1;
  private assetCounter = 1;
  /** Token mapped back to id for the test helper to verify it. */
  tokensIssued = new Map<string, string>();

  // ── seed helpers ────────────────────────────────────────────────
  seedRoles(roles: Array<{ code: RoleCode | string; name: string; perms: string[] }>) {
    for (const r of roles) {
      const id = randomUUID();
      this.roles.set(r.code, {
        id,
        code: r.code,
        name: r.name,
        description: null,
        is_system: true,
        metadata: {},
      });
      this.rolePermissions.set(r.code, new Set(r.perms));
    }
  }
  seedPermissions(codes: string[]) {
    for (const c of codes) {
      const [resource, action] = c.split(':');
      this.permissions.set(c, {
        id: randomUUID(),
        code: c,
        resource: resource ?? 'unknown',
        action: action ?? 'unknown',
        description: null,
      });
    }
  }
  seedUserWithPassword(input: {
    email: string;
    username: string;
    password: string;
    roles?: string[];
    full_name?: string;
  }): UserRecord {
    const id = randomUUID();
    const salt = randomBytes(8).toString('hex');
    const hash = createHash('sha256').update(`${salt}|${input.password}`).digest('hex');
    const now = new Date().toISOString();
    const row: UserRecord = {
      id,
      email: input.email,
      username: input.username,
      full_name: input.full_name ?? null,
      is_active: true,
      last_login_at: null,
      failed_login_count: 0,
      locked_until: null,
      metadata: { password_salt: salt },
      created_at: now,
      updated_at: now,
      password_hash: hash,
      password_algo: 'sha256-salt',
      salt,
    };
    this.users.set(id, row);
    if (input.roles) this.userRoles.set(id, new Set(input.roles));
    return row;
  }

  // ── nextCode generators ─────────────────────────────────────────
  async nextExportCode() {
    return `EXP-2026-${String(this.exportCounter++).padStart(6, '0')}`;
  }
  async nextAssetCode() {
    return `ASSET-2026-${String(this.assetCounter++).padStart(6, '0')}`;
  }

  // ── users ───────────────────────────────────────────────────────
  async findUserById(id: string): Promise<UserRow | null> {
    const u = this.users.get(id);
    if (!u) return null;
    const { password_hash: _ph, password_algo: _pa, salt: _s, ...rest } = u;
    return rest;
  }
  async findUserByHandle(handle: string) {
    for (const u of this.users.values()) {
      if (
        u.email.toLowerCase() === handle.toLowerCase() ||
        u.username.toLowerCase() === handle.toLowerCase()
      ) {
        const { password_hash, password_algo, salt, ...rest } = u;
        return { ...rest, password_hash, password_algo, salt };
      }
    }
    return null;
  }
  async lookup(handle: string): Promise<PasswordRecord | null> {
    const r = await this.findUserByHandle(handle);
    if (!r || !r.password_hash || !r.password_algo) return null;
    return {
      external_id: r.id,
      email: r.email,
      username: r.username,
      ...(r.full_name ? { full_name: r.full_name } : {}),
      password_hash: r.password_hash,
      password_algo: r.password_algo as PasswordRecord['password_algo'],
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
    const existing = [...this.users.values()].find(
      (u) => u.email.toLowerCase() === input.email.toLowerCase()
    );
    if (existing) return this.findUserById(existing.id) as Promise<UserRow>;
    const id = randomUUID();
    const now = new Date().toISOString();
    const row: UserRecord = {
      id,
      email: input.email,
      username: input.username,
      full_name: input.full_name ?? null,
      is_active: true,
      last_login_at: null,
      failed_login_count: 0,
      locked_until: null,
      metadata: input.metadata ?? {},
      created_at: now,
      updated_at: now,
      password_hash: null,
      password_algo: null,
      salt: null,
    };
    this.users.set(id, row);
    return (await this.findUserById(id))!;
  }
  async markLoginSuccess(userId: string) {
    const u = this.users.get(userId);
    if (u) {
      u.last_login_at = new Date().toISOString();
      u.failed_login_count = 0;
    }
  }
  async markLoginFailure(userId: string) {
    const u = this.users.get(userId);
    if (u) u.failed_login_count += 1;
  }

  // ── roles / permissions ─────────────────────────────────────────
  async listRoles(): Promise<RoleRow[]> {
    return [...this.roles.values()];
  }
  async listPermissions(): Promise<PermissionRow[]> {
    return [...this.permissions.values()];
  }
  async listUserRoles(userId: string): Promise<RoleRow[]> {
    const codes = this.userRoles.get(userId) ?? new Set<string>();
    return [...codes].map((c) => this.roles.get(c)!).filter(Boolean);
  }
  async listUserPermissions(userId: string): Promise<string[]> {
    const codes = this.userRoles.get(userId) ?? new Set<string>();
    const out = new Set<string>();
    for (const c of codes) {
      const perms = this.rolePermissions.get(c);
      if (perms) for (const p of perms) out.add(p);
    }
    return [...out];
  }
  async assignRoles(userId: string, codes: string[], _grantedBy: string | null) {
    this.userRoles.set(userId, new Set(codes));
  }

  // ── sessions ────────────────────────────────────────────────────
  async createSession(userId: string, _ip: string | null, _ua: string | null, ttlMs: number) {
    const token = randomBytes(16).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    this.sessions.set(id, {
      id,
      user_id: userId,
      expires_at: expiresAt,
      revoked: false,
      tokenHash,
    });
    this.tokensIssued.set(tokenHash, id);
    return { id, token, expires_at: expiresAt };
  }
  async findActiveSessionByToken(token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    for (const s of this.sessions.values()) {
      if (s.tokenHash === tokenHash && !s.revoked && new Date(s.expires_at) > new Date()) {
        return { id: s.id, user_id: s.user_id, expires_at: s.expires_at };
      }
    }
    return null;
  }
  async revokeSession(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (s) s.revoked = true;
  }

  // ── audit ───────────────────────────────────────────────────────
  async insertAudit(
    input: Parameters<
      import('../../../src/modules/security/repository.js').SecurityRepository['insertAudit']
    >[0]
  ) {
    const row: AuditLogRow = {
      id: String(this.audit.length + 1),
      occurred_at: new Date().toISOString(),
      ...input,
      metadata: input.metadata ?? {},
    } as AuditLogRow;
    this.audit.push(row);
    return { id: row.id };
  }
  async listAudit(filter: AuditQuery) {
    const all = this.audit.filter(
      (r) =>
        (!filter.user_id || r.user_id === filter.user_id) &&
        (!filter.action || r.action === filter.action) &&
        (!filter.resource_type || r.resource_type === filter.resource_type)
    );
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 50;
    const start = (page - 1) * pageSize;
    return { items: all.slice(start, start + pageSize), total: all.length };
  }

  // ── exports ─────────────────────────────────────────────────────
  async createExport(
    input: Parameters<
      import('../../../src/modules/security/repository.js').SecurityRepository['createExport']
    >[0]
  ): Promise<ExportLogRow> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const row: ExportLogRow = {
      id,
      code: input.code,
      user_id: input.user_id,
      resource_type: input.resource_type,
      resource_id: input.resource_id,
      resource_label: input.resource_label,
      format: input.format as ExportFormat,
      approval_required: input.approval_required,
      approval_status: input.approval_status as ExportApprovalStatus,
      approved_by: null,
      approved_at: null,
      rejected_reason: null,
      output_url: null,
      output_size_bytes: null,
      output_checksum: null,
      output_expires_at: null,
      download_count: 0,
      last_downloaded_at: null,
      watermark_required: input.watermark_required,
      watermark_text: input.watermark_text,
      watermark_applied: false,
      watermark_metadata: {},
      classification: input.classification as Classification,
      trace_id: input.trace_id,
      ip_address: input.ip_address,
      user_agent: input.user_agent,
      metadata: input.metadata,
      created_at: now,
      updated_at: now,
      version: 1,
    };
    this.exports.set(id, row);
    return row;
  }
  async findExport(id: string) {
    return this.exports.get(id) ?? null;
  }
  async listExports(filter: {
    user_id?: string;
    approval_status?: ExportApprovalStatus;
    resource_type?: string;
    page: number;
    pageSize: number;
  }) {
    const all = [...this.exports.values()].filter(
      (r) =>
        (!filter.user_id || r.user_id === filter.user_id) &&
        (!filter.approval_status || r.approval_status === filter.approval_status) &&
        (!filter.resource_type || r.resource_type === filter.resource_type)
    );
    const start = (filter.page - 1) * filter.pageSize;
    return { items: all.slice(start, start + filter.pageSize), total: all.length };
  }
  async updateExportApproval(
    id: string,
    patch: Parameters<
      import('../../../src/modules/security/repository.js').SecurityRepository['updateExportApproval']
    >[1]
  ) {
    const e = this.exports.get(id);
    if (!e) return null;
    e.approval_status = patch.approval_status;
    e.approved_by = patch.approved_by;
    e.approved_at = ['approved', 'auto_approved', 'rejected'].includes(patch.approval_status)
      ? new Date().toISOString()
      : e.approved_at;
    e.rejected_reason = patch.rejected_reason;
    if (patch.output_url !== null) e.output_url = patch.output_url;
    if (patch.output_size_bytes !== null) e.output_size_bytes = patch.output_size_bytes;
    if (patch.output_checksum !== null) e.output_checksum = patch.output_checksum;
    if (patch.output_expires_at !== null) e.output_expires_at = patch.output_expires_at;
    e.watermark_applied = patch.watermark_applied;
    e.watermark_metadata = patch.watermark_metadata;
    return e;
  }
  async incrementExportDownload(id: string) {
    const e = this.exports.get(id);
    if (e) {
      e.download_count += 1;
      e.last_downloaded_at = new Date().toISOString();
    }
  }

  // ── assets ──────────────────────────────────────────────────────
  async createAsset(
    input: ModelAssetInput,
    code: string,
    userId: string | null
  ): Promise<ModelAssetRow> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const row: ModelAssetRow = {
      id,
      code,
      asset_type: input.asset_type as AssetType,
      name: input.name,
      description: input.description ?? null,
      ml_model_version_id: input.ml_model_version_id ?? null,
      ml_dataset_id: input.ml_dataset_id ?? null,
      storage_url: input.storage_url,
      storage_provider: input.storage_provider ?? 'local',
      size_bytes: input.size_bytes ?? null,
      checksum_sha256: input.checksum_sha256 ?? null,
      framework: input.framework ?? null,
      format: input.format ?? null,
      status: 'staged',
      classification: (input.classification ?? 'internal') as Classification,
      owner_id: input.owner_id ?? userId,
      owning_team: input.owning_team ?? null,
      allowed_role_codes: (input.allowed_role_codes ?? []) as string[],
      watermark_required: input.watermark_required ?? false,
      metadata: input.metadata ?? {},
      tags: input.tags ?? [],
      created_at: now,
      updated_at: now,
      created_by: userId,
      version: 1,
    };
    this.assets.set(id, row);
    return row;
  }
  async findAsset(id: string) {
    return this.assets.get(id) ?? null;
  }
  async listAssets(filter: {
    asset_type?: AssetType;
    status?: AssetStatus;
    classification?: Classification;
    page: number;
    pageSize: number;
  }) {
    const all = [...this.assets.values()].filter(
      (r) =>
        (!filter.asset_type || r.asset_type === filter.asset_type) &&
        (!filter.status || r.status === filter.status) &&
        (!filter.classification || r.classification === filter.classification)
    );
    const start = (filter.page - 1) * filter.pageSize;
    return { items: all.slice(start, start + filter.pageSize), total: all.length };
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
    _userId: string | null
  ) {
    const e = this.assets.get(id);
    if (!e) return null;
    if (patch.name !== undefined) e.name = patch.name;
    if (patch.description !== undefined) e.description = patch.description;
    if (patch.status !== undefined) e.status = patch.status;
    if (patch.classification !== undefined) e.classification = patch.classification;
    if (patch.allowed_role_codes !== undefined) e.allowed_role_codes = patch.allowed_role_codes;
    if (patch.watermark_required !== undefined) e.watermark_required = patch.watermark_required;
    if (patch.tags !== undefined) e.tags = patch.tags;
    if (patch.metadata !== undefined) e.metadata = patch.metadata;
    e.updated_at = new Date().toISOString();
    return e;
  }

  // ── data scopes ─────────────────────────────────────────────────
  async listScopesFor(userId: string): Promise<DataScopeGrant[]> {
    return this.scopes.get(userId) ?? [];
  }
  async upsertScope(input: {
    user_id: string;
    scope_type: string;
    scope_value: string;
    granted_by: string | null;
    expires_at: string | null;
    metadata: Record<string, unknown>;
  }): Promise<DataScopeGrant> {
    const list = this.scopes.get(input.user_id) ?? [];
    const existing = list.find(
      (g) => g.scope_type === input.scope_type && g.scope_value === input.scope_value
    );
    const grant: DataScopeGrant = {
      scope_type: input.scope_type,
      scope_value: input.scope_value,
      expires_at: input.expires_at,
    };
    if (!existing) list.push(grant);
    else Object.assign(existing, grant);
    this.scopes.set(input.user_id, list);
    return grant;
  }
  async deleteScope(input: {
    user_id: string;
    scope_type: string;
    scope_value: string;
  }): Promise<boolean> {
    const list = this.scopes.get(input.user_id) ?? [];
    const idx = list.findIndex(
      (g) => g.scope_type === input.scope_type && g.scope_value === input.scope_value
    );
    if (idx < 0) return false;
    list.splice(idx, 1);
    this.scopes.set(input.user_id, list);
    return true;
  }
}
