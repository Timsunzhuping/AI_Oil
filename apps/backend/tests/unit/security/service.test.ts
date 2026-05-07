import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { SecurityService } from '../../../src/modules/security/service.js';
import { AuditRecorder } from '../../../src/modules/security/audit.js';
import {
  buildAuthRegistry,
  PasswordAuthAdapter,
  MockSsoAdapter,
} from '../../../src/modules/security/auth/index.js';
import type { SecurityRepository } from '../../../src/modules/security/repository.js';
import type { AuthContext } from '../../../src/modules/security/types.js';
import { FakeSecurityRepository } from './_fakes.js';

const logger = pino({ level: 'silent' });
const TRACE = 'trace-1';

const ALL_PERMS = [
  'user:read',
  'user:manage',
  'role:manage',
  'master_data:read',
  'master_data:write',
  'formula:read',
  'formula:write',
  'formula:approve',
  'predict:execute',
  'recommend:execute',
  'task:read',
  'task:write',
  'knowledge:read',
  'knowledge:write',
  'document:upload',
  'document:review',
  'qa:ask',
  'erp:sap_sync',
  'erp:lims_create',
  'erp:lims_pull',
  'erp:carbon_lookup',
  'ml:dataset_manage',
  'ml:train',
  'ml:release',
  'ml:model_read',
  'export:request',
  'export:approve',
  'export:download',
  'audit:read',
  'asset:read',
  'asset:manage',
];

function buildEnv(
  opts: { autoApproveBelow?: 'public' | 'internal'; defaultWatermark?: string } = {}
) {
  const repo = new FakeSecurityRepository();
  repo.seedPermissions(ALL_PERMS);
  repo.seedRoles([
    { code: 'super_admin', name: '超级管理员', perms: ALL_PERMS },
    {
      code: 'researcher',
      name: '研发人员',
      perms: [
        'formula:read',
        'formula:write',
        'predict:execute',
        'recommend:execute',
        'task:read',
        'task:write',
        'qa:ask',
        'export:request',
        'export:download',
        'knowledge:read',
      ],
    },
    {
      code: 'model_admin',
      name: '模型管理员',
      perms: [
        'ml:dataset_manage',
        'ml:train',
        'ml:release',
        'ml:model_read',
        'asset:read',
        'asset:manage',
        'audit:read',
        'export:approve',
      ],
    },
    {
      code: 'viewer',
      name: '访客',
      perms: ['formula:read', 'task:read', 'qa:ask', 'knowledge:read'],
    },
  ]);
  const audit = new AuditRecorder(repo as unknown as SecurityRepository, logger);
  const password = new PasswordAuthAdapter({ lookup: repo });
  const sso = new MockSsoAdapter();
  const auth = buildAuthRegistry({ password, defaultSso: sso });
  const service = new SecurityService({
    repository: repo as unknown as SecurityRepository,
    auth,
    audit,
    logger,
    ...(opts.autoApproveBelow ? { autoApproveBelowClassification: opts.autoApproveBelow } : {}),
    ...(opts.defaultWatermark ? { defaultWatermarkText: opts.defaultWatermark } : {}),
  });
  return { repo, service };
}

function authCtx(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user_id: 'u-1',
    username: 'alice',
    email: 'alice@example.com',
    roles: ['researcher'],
    permissions: [
      'formula:read',
      'formula:write',
      'predict:execute',
      'export:request',
      'export:download',
      'task:read',
    ],
    data_scopes: [],
    session_id: 'sess-1',
    claims: {},
    ...overrides,
  };
}

// ─── Login / logout ────────────────────────────────────────────────────────

describe('SecurityService.login', () => {
  it('issues a session for valid password credentials', async () => {
    const { repo, service } = buildEnv();
    const user = repo.seedUserWithPassword({
      email: 'alice@example.com',
      username: 'alice',
      password: 's3cret',
      roles: ['researcher'],
    });
    const r = await service.login({ username: 'alice', password: 's3cret' }, { trace_id: TRACE });
    expect(r.user.id).toBe(user.id);
    expect(r.roles).toContain('researcher');
    expect(r.session.token).toMatch(/^[a-f0-9]+$/);
    expect(repo.audit.some((a) => a.action === 'login')).toBe(true);
  });

  it('records login_failed when credentials are wrong', async () => {
    const { repo, service } = buildEnv();
    repo.seedUserWithPassword({
      email: 'alice@example.com',
      username: 'alice',
      password: 's3cret',
    });
    await expect(
      service.login({ username: 'alice', password: 'WRONG' }, { trace_id: TRACE })
    ).rejects.toThrow();
    expect(repo.audit.some((a) => a.action === 'login_failed')).toBe(true);
  });

  it('auto-provisions a user on first SSO touch', async () => {
    const { repo, service } = buildEnv();
    const r = await service.login({ sso_token: 'sso:bob@example.com' }, { trace_id: TRACE });
    expect(r.user.email).toBe('bob@example.com');
    expect(repo.users.size).toBe(1);
  });
});

describe('SecurityService.logout', () => {
  it('revokes the session and writes an audit row', async () => {
    const { repo, service } = buildEnv();
    repo.seedUserWithPassword({
      email: 'alice@example.com',
      username: 'alice',
      password: 's3cret',
      roles: ['researcher'],
    });
    const login = await service.login(
      { username: 'alice', password: 's3cret' },
      { trace_id: TRACE }
    );
    const ctx: AuthContext = {
      user_id: login.user.id,
      username: login.user.username,
      email: login.user.email,
      roles: ['researcher'],
      permissions: [],
      data_scopes: [],
      claims: {},
      session_id: login.session.id,
    };
    await service.logout(ctx, { trace_id: TRACE });
    expect(repo.sessions.get(login.session.id)?.revoked).toBe(true);
    expect(repo.audit.some((a) => a.action === 'logout')).toBe(true);
  });
});

// ─── currentUser / menu ────────────────────────────────────────────────────

describe('SecurityService.currentUser', () => {
  it('returns user + roles + permissions + menu', async () => {
    const { repo, service } = buildEnv();
    const user = repo.seedUserWithPassword({
      email: 'r@e.com',
      username: 'r',
      password: 'p',
      roles: ['researcher'],
    });
    const ctx = authCtx({ user_id: user.id });
    const r = await service.currentUser(ctx);
    expect(r.user.id).toBe(user.id);
    expect(r.menu.length).toBeGreaterThan(0);
    /* Visibility resolves from permissions. */
    const dashboard = r.menu.find((m) => m.key === 'dashboard')!;
    expect(dashboard.visible).toBe(true);
    const auditMenu = r.menu.find((m) => m.key === 'audit')!;
    expect(auditMenu.visible).toBe(false);
  });
});

// ─── Role assignment ───────────────────────────────────────────────────────

describe('SecurityService.assignRoles', () => {
  it('replaces the role set and writes an audit row', async () => {
    const { repo, service } = buildEnv();
    const target = repo.seedUserWithPassword({
      email: 't@e.com',
      username: 't',
      password: 'p',
      roles: ['viewer'],
    });
    const admin = authCtx({ roles: ['super_admin'], permissions: [...ALL_PERMS] });
    await service.assignRoles({ user_id: target.id, role_codes: ['researcher'] }, admin, {
      trace_id: TRACE,
    });
    expect([...(repo.userRoles.get(target.id) ?? [])]).toEqual(['researcher']);
    expect(repo.audit.some((a) => a.action === 'permission_change')).toBe(true);
  });
  it('only super_admin can grant super_admin', async () => {
    const { repo, service } = buildEnv();
    const target = repo.seedUserWithPassword({ email: 't2@e.com', username: 't2', password: 'p' });
    const nonSuper = authCtx({ roles: ['model_admin'], permissions: ['role:manage'] });
    await expect(
      service.assignRoles({ user_id: target.id, role_codes: ['super_admin'] }, nonSuper, {
        trace_id: TRACE,
      })
    ).rejects.toThrow();
  });
});

// ─── Audit listing ─────────────────────────────────────────────────────────

describe('SecurityService.listAudit', () => {
  it('requires audit:read permission', async () => {
    const { service } = buildEnv();
    await expect(service.listAudit({ page: 1, pageSize: 10 }, authCtx())).rejects.toThrow(
      /audit:read/
    );
  });
  it('returns rows when the caller holds audit:read', async () => {
    const { service, repo } = buildEnv();
    const user = repo.seedUserWithPassword({ email: 'a@e.com', username: 'a', password: 'p' });
    await service.login({ username: 'a', password: 'p' }, { trace_id: TRACE });
    const r = await service.listAudit(
      { page: 1, pageSize: 10 },
      authCtx({ user_id: user.id, roles: ['super_admin'], permissions: ALL_PERMS })
    );
    expect(r.items.length).toBeGreaterThan(0);
  });
});

// ─── Export workflow ───────────────────────────────────────────────────────

describe('SecurityService.requestExport / approveExport', () => {
  it('auto-approves below the configured ceiling', async () => {
    const { service } = buildEnv({ autoApproveBelow: 'internal' });
    const r = await service.requestExport(
      { resource_type: 'formula', format: 'pdf', classification: 'internal' },
      authCtx(),
      { trace_id: TRACE }
    );
    expect(r.approval_required).toBe(false);
    expect(r.approval_status).toBe('auto_approved');
    expect(r.watermark_required).toBe(false);
  });

  it('requires approval for confidential and applies a watermark', async () => {
    const { service } = buildEnv({ defaultWatermark: 'CONFIDENTIAL' });
    const r = await service.requestExport(
      { resource_type: 'compare_report', format: 'pdf', classification: 'confidential' },
      authCtx(),
      { trace_id: TRACE }
    );
    expect(r.approval_status).toBe('pending');
    expect(r.watermark_required).toBe(true);
    expect(r.watermark_text).toBe('CONFIDENTIAL');
  });

  it('only export:approve holders can approve', async () => {
    const { service } = buildEnv();
    const req = await service.requestExport(
      { resource_type: 'compare_report', format: 'pdf', classification: 'confidential' },
      authCtx(),
      { trace_id: TRACE }
    );
    await expect(
      service.approveExport(req.id, { approve: true }, authCtx(), { trace_id: TRACE })
    ).rejects.toThrow();
  });

  it('approves and stamps watermark policy', async () => {
    const { service, repo } = buildEnv({ defaultWatermark: 'CONFIDENTIAL' });
    const req = await service.requestExport(
      { resource_type: 'compare_report', format: 'pdf', classification: 'confidential' },
      authCtx(),
      { trace_id: TRACE }
    );
    const approver = authCtx({
      user_id: 'admin-1',
      username: 'admin',
      roles: ['super_admin'],
      permissions: ALL_PERMS,
    });
    const out = await service.approveExport(req.id, { approve: true }, approver, {
      trace_id: TRACE,
    });
    expect(out.approval_status).toBe('approved');
    expect(out.watermark_applied).toBe(true);
    expect(out.output_url).toMatch(/^signed:\/\//);
    expect(repo.audit.some((a) => a.action === 'export_approve')).toBe(true);
  });

  it('rejects an export with reason', async () => {
    const { service } = buildEnv();
    const req = await service.requestExport(
      { resource_type: 'compare_report', format: 'pdf', classification: 'confidential' },
      authCtx(),
      { trace_id: TRACE }
    );
    const approver = authCtx({ roles: ['super_admin'], permissions: ALL_PERMS });
    const out = await service.approveExport(
      req.id,
      { approve: false, rejected_reason: 'security review failed' },
      approver,
      { trace_id: TRACE }
    );
    expect(out.approval_status).toBe('rejected');
    expect(out.rejected_reason).toBe('security review failed');
  });

  it('records download and counter increments', async () => {
    const { service } = buildEnv({ autoApproveBelow: 'internal' });
    const req = await service.requestExport(
      { resource_type: 'formula', format: 'pdf', classification: 'internal' },
      authCtx(),
      { trace_id: TRACE }
    );
    /* Auto-approved exports are immediately downloadable. */
    const dl = await service.recordExportDownload(req.id, authCtx(), { trace_id: TRACE });
    expect(dl.download_count).toBe(1);
  });

  it("blocks downloads of someone else's export when not an approver", async () => {
    const { service } = buildEnv({ autoApproveBelow: 'internal' });
    const req = await service.requestExport(
      { resource_type: 'formula', format: 'pdf', classification: 'internal' },
      authCtx({ user_id: 'u-author' }),
      { trace_id: TRACE }
    );
    const other = authCtx({ user_id: 'u-other' });
    await expect(
      service.recordExportDownload(req.id, other, { trace_id: TRACE })
    ).rejects.toThrow();
  });
});

// ─── Asset registry ────────────────────────────────────────────────────────

describe('SecurityService.createAsset / updateAsset', () => {
  it('requires asset:manage', async () => {
    const { service } = buildEnv();
    await expect(
      service.createAsset(
        { name: 'x', asset_type: 'model_artifact', storage_url: 's3://b/k' },
        authCtx(),
        { trace_id: TRACE }
      )
    ).rejects.toThrow();
  });

  it('allows asset:manage to register, then asset:read to fetch', async () => {
    const { service } = buildEnv();
    const admin = authCtx({ roles: ['model_admin'], permissions: ['asset:manage', 'asset:read'] });
    const created = await service.createAsset(
      {
        name: 'KV regressor v1',
        asset_type: 'model_artifact',
        storage_url: 's3://m/v1',
        allowed_role_codes: ['model_admin'],
      },
      admin,
      { trace_id: TRACE }
    );
    expect(created.code).toMatch(/^ASSET-2026-/);
    const read = await service.getAsset(created.id, admin);
    expect(read.id).toBe(created.id);
  });

  it('per-asset role gate blocks unauthorised access', async () => {
    const { service } = buildEnv();
    const admin = authCtx({ roles: ['super_admin'], permissions: ALL_PERMS });
    const asset = await service.createAsset(
      {
        name: 'restricted',
        asset_type: 'model_artifact',
        storage_url: 's3://r',
        allowed_role_codes: ['model_admin'],
      },
      admin,
      { trace_id: TRACE }
    );
    const researcher = authCtx({ roles: ['researcher'], permissions: ['asset:read'] });
    await expect(service.getAsset(asset.id, researcher)).rejects.toThrow(/restricted to roles/);
  });

  it('updateAsset writes asset_revoke when status becomes revoked', async () => {
    const { service, repo } = buildEnv();
    const admin = authCtx({ roles: ['super_admin'], permissions: ALL_PERMS });
    const a = await service.createAsset(
      { name: 'x', asset_type: 'model_artifact', storage_url: 's3://x' },
      admin,
      { trace_id: TRACE }
    );
    await service.updateAsset(a.id, { status: 'revoked' }, admin, { trace_id: TRACE });
    expect(repo.audit.some((r) => r.action === 'asset_revoke')).toBe(true);
  });
});

// ─── Data scope grants ────────────────────────────────────────────────────

describe('SecurityService data-scope grants', () => {
  it('grants and revokes scopes with audit rows', async () => {
    const { service, repo } = buildEnv();
    const target = repo.seedUserWithPassword({ email: 't@e.com', username: 't', password: 'p' });
    const admin = authCtx({ roles: ['super_admin'], permissions: ALL_PERMS });
    await service.grantDataScope(
      { user_id: target.id, scope_type: 'product_category', scope_value: 'engine_oil_pcmo' },
      admin,
      { trace_id: TRACE }
    );
    let scopes = await repo.listScopesFor(target.id);
    expect(scopes).toHaveLength(1);
    await service.revokeDataScope(
      { user_id: target.id, scope_type: 'product_category', scope_value: 'engine_oil_pcmo' },
      admin,
      { trace_id: TRACE }
    );
    scopes = await repo.listScopesFor(target.id);
    expect(scopes).toHaveLength(0);
    const events = repo.audit.filter((a) => a.action === 'data_scope_change');
    expect(events).toHaveLength(2);
  });
});
