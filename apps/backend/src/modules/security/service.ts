/**
 * Security service.
 *
 * Coordinates: auth (login/logout), session issuance, RBAC mutation,
 * data-scope grants, audit recording, export request + approval workflow,
 * model asset registry CRUD.
 *
 * This service relies on the request-scoped `AuthContext` for all
 * authorisation decisions; HTTP layer + service decorators ensure the
 * caller is the right principal.
 */
import type { Logger } from 'pino';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import type { AuthRegistry } from './auth/index.js';
import type { AuditRecorder } from './audit.js';
import { buildMenu } from './menu.js';
import type { SecurityRepository } from './repository.js';
import { assertAuthenticated, assertPermission } from './decorators.js';
import type {
  AuditQuery,
  AuthContext,
  CurrentUserResponse,
  DataScopeGrant,
  ExportApprovalInput,
  ExportApprovalStatus,
  ExportLogRow,
  ExportRequestInput,
  LoginRequest,
  LoginResponse,
  ModelAssetInput,
  ModelAssetRow,
  PermissionCode,
  RoleCode,
} from './types.js';

export interface SecurityServiceDeps {
  repository: SecurityRepository;
  auth: AuthRegistry;
  audit: AuditRecorder;
  logger: Logger;
  /** Default session TTL in milliseconds. */
  sessionTtlMs?: number;
  /** When `true`, exports below this classification skip approval. */
  autoApproveBelowClassification?: 'public' | 'internal';
  /**
   * When set, the service watermarks every approved export with this text by
   * default. Per-request overrides via `ExportRequestInput.watermark_text`.
   */
  defaultWatermarkText?: string;
}

const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const CLASSIFICATION_RANK: Record<string, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

interface OpContext {
  trace_id: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
}

export class SecurityService {
  constructor(private readonly deps: SecurityServiceDeps) {}

  // ────────────────────────────────────────────────────────────────────
  // Login / logout
  // ────────────────────────────────────────────────────────────────────
  async login(req: LoginRequest, ctx: OpContext): Promise<LoginResponse> {
    let principal;
    try {
      principal = await this.deps.auth.resolve({
        ...(req.username !== undefined ? { username: req.username } : {}),
        ...(req.email !== undefined ? { email: req.email } : {}),
        ...(req.password !== undefined ? { password: req.password } : {}),
        ...(req.sso_token !== undefined ? { sso_token: req.sso_token } : {}),
        ...(req.provider !== undefined ? { provider: req.provider } : {}),
        ...(ctx.ip_address !== undefined && ctx.ip_address !== null
          ? { ip_address: ctx.ip_address }
          : {}),
        ...(ctx.user_agent !== undefined && ctx.user_agent !== null
          ? { user_agent: ctx.user_agent }
          : {}),
        ...(ctx.trace_id !== undefined && ctx.trace_id !== null ? { trace_id: ctx.trace_id } : {}),
      });
    } catch (err) {
      await this.deps.audit.event(
        'login_failed',
        {
          ...ctx,
          user_id: null,
        },
        {
          resource_type: 'session',
          metadata: { reason: (err as Error).message, provider: req.provider ?? null },
        }
      );
      throw err;
    }

    /* Find or create the user row. SSO logins auto-provision; password
     * logins require an existing user. */
    let user = await this.deps.repository.findUserById(principal.external_id);
    if (!user && principal.adapter.mode === 'sso') {
      user = await this.deps.repository.createUserFromSso({
        email: principal.email,
        username: principal.username,
        ...(principal.full_name ? { full_name: principal.full_name } : {}),
        metadata: { sso_adapter: principal.adapter.name, ...principal.claims },
      });
    } else if (!user) {
      /* Password adapter resolves by handle, returning external_id=user.id;
       * if that lookup ever fails treat as not-found. */
      const byHandle = await this.deps.repository.findUserByHandle(principal.email);
      user = byHandle ?? null;
      if (!user) {
        throw new NotFoundError('User');
      }
    }

    await this.deps.repository.markLoginSuccess(user.id);

    const session = await this.deps.repository.createSession(
      user.id,
      ctx.ip_address ?? null,
      ctx.user_agent ?? null,
      this.deps.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS
    );

    const [roles, permissions] = await Promise.all([
      this.deps.repository.listUserRoles(user.id),
      this.deps.repository.listUserPermissions(user.id),
    ]);

    await this.deps.audit.event(
      'login',
      {
        ...ctx,
        user_id: user.id,
      },
      {
        resource_type: 'session',
        resource_id: session.id,
        metadata: {
          adapter: principal.adapter.name,
          provider: req.provider ?? null,
          asserted_roles: principal.asserted_roles ?? [],
        },
      }
    );

    return {
      user,
      roles: roles.map((r) => r.code) as RoleCode[],
      permissions: permissions as PermissionCode[],
      session,
    };
  }

  async logout(authCtx: AuthContext, ctx: OpContext): Promise<{ session_id: string }> {
    assertAuthenticated(authCtx);
    if (!authCtx.session_id) throw new BadRequestError('No session in context');
    await this.deps.repository.revokeSession(authCtx.session_id);
    await this.deps.audit.event(
      'logout',
      { ...ctx, user_id: authCtx.user_id },
      {
        resource_type: 'session',
        resource_id: authCtx.session_id,
      }
    );
    return { session_id: authCtx.session_id };
  }

  // ────────────────────────────────────────────────────────────────────
  // Current-user / menu
  // ────────────────────────────────────────────────────────────────────
  async currentUser(authCtx: AuthContext): Promise<CurrentUserResponse> {
    assertAuthenticated(authCtx);
    const user = await this.deps.repository.findUserById(authCtx.user_id);
    if (!user) throw new NotFoundError('User');
    const grantedSet = new Set<string>(authCtx.permissions);
    const roleSet = new Set<string>(authCtx.roles);
    const menu = buildMenu(grantedSet, roleSet);
    return {
      user,
      roles: authCtx.roles,
      permissions: authCtx.permissions,
      data_scopes: authCtx.data_scopes,
      menu,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Roles / data-scope mutation
  // ────────────────────────────────────────────────────────────────────
  async assignRoles(
    input: { user_id: string; role_codes: RoleCode[]; reason?: string },
    authCtx: AuthContext,
    ctx: OpContext
  ): Promise<void> {
    assertPermission(authCtx, 'role:manage');
    const target = await this.deps.repository.findUserById(input.user_id);
    if (!target) throw new NotFoundError('User');
    /* Only super_admin can grant super_admin. */
    if (
      input.role_codes.includes('super_admin' as RoleCode) &&
      !authCtx.roles.includes('super_admin')
    ) {
      throw new ForbiddenError('Only a super_admin can grant the super_admin role');
    }
    const previous = (await this.deps.repository.listUserRoles(input.user_id)).map((r) => r.code);
    await this.deps.repository.assignRoles(input.user_id, input.role_codes, authCtx.user_id);
    await this.deps.audit.record({
      action: 'permission_change',
      resource_type: 'user',
      resource_id: input.user_id,
      resource_label: target.username,
      before_state: { roles: previous },
      after_state: { roles: input.role_codes },
      ...(input.reason ? { metadata: { reason: input.reason } } : {}),
      ctx: { ...ctx, user_id: authCtx.user_id },
    });
  }

  async grantDataScope(
    input: {
      user_id: string;
      scope_type: string;
      scope_value: string;
      expires_at?: string;
      metadata?: Record<string, unknown>;
    },
    authCtx: AuthContext,
    ctx: OpContext
  ): Promise<DataScopeGrant> {
    assertPermission(authCtx, 'role:manage');
    const result = await this.deps.repository.upsertScope({
      user_id: input.user_id,
      scope_type: input.scope_type,
      scope_value: input.scope_value,
      granted_by: authCtx.user_id,
      expires_at: input.expires_at ?? null,
      metadata: input.metadata ?? {},
    });
    await this.deps.audit.event(
      'data_scope_change',
      { ...ctx, user_id: authCtx.user_id },
      {
        resource_type: 'data_scope',
        resource_id: input.user_id,
        metadata: { scope_type: input.scope_type, scope_value: input.scope_value, action: 'grant' },
      }
    );
    return result;
  }

  async revokeDataScope(
    input: { user_id: string; scope_type: string; scope_value: string },
    authCtx: AuthContext,
    ctx: OpContext
  ): Promise<void> {
    assertPermission(authCtx, 'role:manage');
    const ok = await this.deps.repository.deleteScope(input);
    if (!ok) throw new NotFoundError('Data scope grant');
    await this.deps.audit.event(
      'data_scope_change',
      { ...ctx, user_id: authCtx.user_id },
      {
        resource_type: 'data_scope',
        resource_id: input.user_id,
        metadata: {
          scope_type: input.scope_type,
          scope_value: input.scope_value,
          action: 'revoke',
        },
      }
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // Audit log query
  // ────────────────────────────────────────────────────────────────────
  async listAudit(filter: AuditQuery, authCtx: AuthContext) {
    assertPermission(authCtx, 'audit:read');
    return this.deps.repository.listAudit(filter);
  }

  // ────────────────────────────────────────────────────────────────────
  // Export workflow
  // ────────────────────────────────────────────────────────────────────
  async requestExport(
    input: ExportRequestInput,
    authCtx: AuthContext,
    ctx: OpContext
  ): Promise<ExportLogRow> {
    assertPermission(authCtx, 'export:request');
    const classification = input.classification ?? 'internal';
    const approvalRequired = this.classificationRequiresApproval(classification);
    const approvalStatus: ExportApprovalStatus = approvalRequired ? 'pending' : 'auto_approved';
    const watermarkRequired =
      input.watermark_required ??
      (classification === 'confidential' || classification === 'restricted');

    const code = await this.deps.repository.nextExportCode();
    const row = await this.deps.repository.createExport({
      code,
      user_id: authCtx.user_id,
      resource_type: input.resource_type,
      resource_id: input.resource_id ?? null,
      resource_label: input.resource_label ?? null,
      format: input.format,
      classification,
      approval_required: approvalRequired,
      approval_status: approvalStatus,
      watermark_required: watermarkRequired,
      watermark_text: input.watermark_text ?? this.deps.defaultWatermarkText ?? null,
      trace_id: ctx.trace_id ?? null,
      ip_address: ctx.ip_address ?? null,
      user_agent: ctx.user_agent ?? null,
      metadata: { ...(input.metadata ?? {}), reason: input.reason ?? null },
    });

    await this.deps.audit.event(
      'export_request',
      { ...ctx, user_id: authCtx.user_id },
      {
        resource_type: 'export',
        resource_id: row.id,
        resource_label: row.code,
        metadata: {
          export_format: input.format,
          classification,
          approval_status: approvalStatus,
          watermark_required: watermarkRequired,
        },
      }
    );
    return row;
  }

  async listExports(
    filter: {
      user_id?: string;
      approval_status?: ExportApprovalStatus;
      resource_type?: string;
      page: number;
      pageSize: number;
    },
    authCtx: AuthContext
  ) {
    assertAuthenticated(authCtx);
    /* Non-admins see only their own exports unless they hold export:approve. */
    const canSeeAll =
      authCtx.permissions.includes('export:approve' as PermissionCode) ||
      authCtx.roles.includes('super_admin');
    const effective = { ...filter, ...(canSeeAll ? {} : { user_id: authCtx.user_id }) };
    return this.deps.repository.listExports(effective);
  }

  async approveExport(
    id: string,
    body: ExportApprovalInput,
    authCtx: AuthContext,
    ctx: OpContext
  ): Promise<ExportLogRow> {
    assertPermission(authCtx, 'export:approve');
    const existing = await this.deps.repository.findExport(id);
    if (!existing) throw new NotFoundError('Export request');
    if (existing.approval_status !== 'pending' && existing.approval_status !== 'auto_approved') {
      throw new ConflictError(`Export already ${existing.approval_status}`);
    }
    const status: ExportApprovalStatus = body.approve ? 'approved' : 'rejected';
    const expiresAt = body.approve
      ? new Date(Date.now() + (body.output_expires_in_minutes ?? 60 * 24) * 60_000).toISOString()
      : null;

    const watermarkApplied = body.approve && existing.watermark_required ? true : false;
    const watermarkMetadata = watermarkApplied
      ? {
          applied_by: authCtx.user_id,
          applied_at: new Date().toISOString(),
          policy:
            existing.watermark_text ??
            this.deps.defaultWatermarkText ??
            `User: ${authCtx.username}`,
        }
      : existing.watermark_metadata;

    const updated = await this.deps.repository.updateExportApproval(id, {
      approval_status: status,
      approved_by: authCtx.user_id,
      rejected_reason: body.approve ? null : (body.rejected_reason ?? null),
      output_url: body.approve ? `signed://export/${existing.code}` : null,
      output_size_bytes: null,
      output_checksum: null,
      output_expires_at: expiresAt,
      watermark_applied: watermarkApplied,
      watermark_metadata: watermarkMetadata,
    });
    if (!updated) throw new NotFoundError('Export request');

    await this.deps.audit.event(
      body.approve ? 'export_approve' : 'export_reject',
      {
        ...ctx,
        user_id: authCtx.user_id,
      },
      {
        resource_type: 'export',
        resource_id: updated.id,
        resource_label: updated.code,
        metadata: { rejected_reason: body.rejected_reason ?? null },
      }
    );
    return updated;
  }

  async recordExportDownload(
    id: string,
    authCtx: AuthContext,
    ctx: OpContext
  ): Promise<ExportLogRow> {
    assertPermission(authCtx, 'export:download');
    const row = await this.deps.repository.findExport(id);
    if (!row) throw new NotFoundError('Export');
    if (row.approval_status !== 'approved' && row.approval_status !== 'auto_approved') {
      throw new ForbiddenError('Export not approved');
    }
    if (
      row.user_id !== authCtx.user_id &&
      !authCtx.permissions.includes('export:approve' as PermissionCode) &&
      !authCtx.roles.includes('super_admin')
    ) {
      throw new ForbiddenError("Cannot download another user's export");
    }
    if (row.output_expires_at && new Date(row.output_expires_at) < new Date()) {
      throw new ConflictError('Export download link expired');
    }
    await this.deps.repository.incrementExportDownload(id);
    await this.deps.audit.event(
      'export_download',
      { ...ctx, user_id: authCtx.user_id },
      {
        resource_type: 'export',
        resource_id: row.id,
        resource_label: row.code,
      }
    );
    /* Return a fresh copy with incremented counter. */
    return (await this.deps.repository.findExport(id))!;
  }

  // ────────────────────────────────────────────────────────────────────
  // Model asset registry
  // ────────────────────────────────────────────────────────────────────
  async createAsset(
    input: ModelAssetInput,
    authCtx: AuthContext,
    ctx: OpContext
  ): Promise<ModelAssetRow> {
    assertPermission(authCtx, 'asset:manage');
    const code = await this.deps.repository.nextAssetCode();
    const row = await this.deps.repository.createAsset(input, code, authCtx.user_id);
    await this.deps.audit.record({
      action: 'asset_register',
      resource_type: 'asset',
      resource_id: row.id,
      resource_label: row.code,
      after_state: row as unknown as Record<string, unknown>,
      ctx: { ...ctx, user_id: authCtx.user_id },
    });
    return row;
  }

  async listAssets(filter: Parameters<SecurityRepository['listAssets']>[0], authCtx: AuthContext) {
    assertPermission(authCtx, 'asset:read');
    return this.deps.repository.listAssets(filter);
  }

  async getAsset(id: string, authCtx: AuthContext): Promise<ModelAssetRow> {
    assertPermission(authCtx, 'asset:read');
    const row = await this.deps.repository.findAsset(id);
    if (!row) throw new NotFoundError('Asset');
    /* Per-asset role gate: when allowed_role_codes is set, users without an
     * explicit role match (or super_admin) are blocked. */
    if (row.allowed_role_codes.length > 0 && !authCtx.roles.includes('super_admin')) {
      const ok = row.allowed_role_codes.some((c) => authCtx.roles.includes(c as RoleCode));
      if (!ok)
        throw new ForbiddenError(
          `Asset access restricted to roles: ${row.allowed_role_codes.join(', ')}`
        );
    }
    return row;
  }

  async updateAsset(
    id: string,
    patch: Parameters<SecurityRepository['patchAsset']>[1],
    authCtx: AuthContext,
    ctx: OpContext
  ): Promise<ModelAssetRow> {
    assertPermission(authCtx, 'asset:manage');
    const before = await this.deps.repository.findAsset(id);
    if (!before) throw new NotFoundError('Asset');
    const after = await this.deps.repository.patchAsset(id, patch, authCtx.user_id);
    if (!after) throw new NotFoundError('Asset');
    const action = patch.status === 'revoked' ? 'asset_revoke' : 'asset_update';
    await this.deps.audit.record({
      action,
      resource_type: 'asset',
      resource_id: after.id,
      resource_label: after.code,
      before_state: before as unknown as Record<string, unknown>,
      after_state: after as unknown as Record<string, unknown>,
      ctx: { ...ctx, user_id: authCtx.user_id },
    });
    return after;
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  private classificationRequiresApproval(classification: string): boolean {
    const ceiling = this.deps.autoApproveBelowClassification ?? 'internal';
    const ceilingRank = CLASSIFICATION_RANK[ceiling] ?? 1;
    const rank = CLASSIFICATION_RANK[classification] ?? 1;
    return rank > ceilingRank;
  }
}
