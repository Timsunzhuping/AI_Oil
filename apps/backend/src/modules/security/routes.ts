/**
 * HTTP layer for the Security / RBAC module.
 *
 *   POST   /security/login                   password / SSO login
 *   POST   /security/logout
 *   GET    /security/me                      current user + menu + scopes
 *
 *   POST   /security/users/:id/roles         assign role list
 *   POST   /security/users/:id/data-scopes   grant a data scope
 *   DELETE /security/users/:id/data-scopes   revoke
 *
 *   GET    /security/audit                   paginated audit log
 *
 *   POST   /security/exports                 request an export
 *   GET    /security/exports                 list (own / all)
 *   POST   /security/exports/:id/approve     approve / reject
 *   POST   /security/exports/:id/download    record + return download link
 *
 *   POST   /security/assets                  register a model asset
 *   GET    /security/assets                  list
 *   GET    /security/assets/:id              detail
 *   PATCH  /security/assets/:id              update / retire / revoke
 */
import { Router, type Request } from 'express';
import { validate } from '../../middleware/validate.js';
import { paginated, success } from '../../lib/response.js';
import { UnauthorizedError } from '../../lib/errors.js';
import {
  AssignRolesSchema,
  CreateModelAssetSchema,
  DataScopeGrantSchema,
  ExportApprovalSchema,
  ExportRequestSchema,
  IdParamSchema,
  ListAuditQuerySchema,
  ListExportsQuerySchema,
  LoginSchema,
  LogoutSchema,
  UpdateModelAssetSchema,
} from './schemas.js';
import type { SecurityService } from './service.js';
import type { AuthContext } from './types.js';

function requireAuthCtx(req: Request): AuthContext {
  if (!req.user) throw new UnauthorizedError('Authentication required');
  return req.user;
}

function opCtx(req: Request) {
  return {
    trace_id: req.traceId,
    ip_address: req.ip ?? null,
    user_agent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  };
}

export function buildSecurityRouter(service: SecurityService): Router {
  const router = Router();

  // ─── Login / logout / me ────────────────────────────────────────
  router.post('/login', validate({ body: LoginSchema }), async (req, res) => {
    const result = await service.login(req.body, opCtx(req));
    res.json(success(result, 'Login successful', req.traceId));
  });

  router.post('/logout', validate({ body: LogoutSchema }), async (req, res) => {
    const ctx = requireAuthCtx(req);
    const r = await service.logout(ctx, opCtx(req));
    res.json(success(r, 'Logout successful', req.traceId));
  });

  router.get('/me', async (req, res) => {
    const ctx = requireAuthCtx(req);
    const r = await service.currentUser(ctx);
    res.json(success(r, 'success', req.traceId));
  });

  // ─── Roles + data scopes ────────────────────────────────────────
  router.post(
    '/users/:id/roles',
    validate({ params: IdParamSchema, body: AssignRolesSchema }),
    async (req, res) => {
      const ctx = requireAuthCtx(req);
      const body = req.body as {
        user_id: string;
        role_codes: import('./types.js').RoleCode[];
        reason?: string;
      };
      /* Allow the URL param to override the body (idempotent). */
      body.user_id = req.params.id as string;
      await service.assignRoles(body, ctx, opCtx(req));
      res.status(204).end();
    }
  );

  router.post(
    '/users/:id/data-scopes',
    validate({ params: IdParamSchema, body: DataScopeGrantSchema }),
    async (req, res) => {
      const ctx = requireAuthCtx(req);
      const body = req.body as {
        user_id: string;
        scope_type: string;
        scope_value: string;
        expires_at?: string;
        metadata?: Record<string, unknown>;
      };
      body.user_id = req.params.id as string;
      const r = await service.grantDataScope(body, ctx, opCtx(req));
      res.status(201).json(success(r, 'Data scope granted', req.traceId));
    }
  );

  router.delete(
    '/users/:id/data-scopes',
    validate({
      params: IdParamSchema,
      body: DataScopeGrantSchema.pick({ scope_type: true, scope_value: true, user_id: true }),
    }),
    async (req, res) => {
      const ctx = requireAuthCtx(req);
      const body = req.body as { user_id: string; scope_type: string; scope_value: string };
      body.user_id = req.params.id as string;
      await service.revokeDataScope(body, ctx, opCtx(req));
      res.status(204).end();
    }
  );

  // ─── Audit log ──────────────────────────────────────────────────
  router.get('/audit', validate({ query: ListAuditQuerySchema }), async (req, res) => {
    const ctx = requireAuthCtx(req);
    const q = req.query as unknown as Parameters<SecurityService['listAudit']>[0];
    const r = await service.listAudit(q, ctx);
    res.json(paginated(r.items, r.total, q.page ?? 1, q.pageSize ?? 50, req.traceId));
  });

  // ─── Exports ────────────────────────────────────────────────────
  router.post('/exports', validate({ body: ExportRequestSchema }), async (req, res) => {
    const ctx = requireAuthCtx(req);
    const r = await service.requestExport(req.body, ctx, opCtx(req));
    res.status(201).json(success(r, 'Export requested', req.traceId));
  });

  router.get('/exports', validate({ query: ListExportsQuerySchema }), async (req, res) => {
    const ctx = requireAuthCtx(req);
    const q = req.query as unknown as Parameters<SecurityService['listExports']>[0];
    const r = await service.listExports(q, ctx);
    res.json(paginated(r.items, r.total, q.page, q.pageSize, req.traceId));
  });

  router.post(
    '/exports/:id/approve',
    validate({ params: IdParamSchema, body: ExportApprovalSchema }),
    async (req, res) => {
      const ctx = requireAuthCtx(req);
      const r = await service.approveExport(req.params.id as string, req.body, ctx, opCtx(req));
      res.json(
        success(
          r,
          r.approval_status === 'approved' ? 'Export approved' : 'Export rejected',
          req.traceId
        )
      );
    }
  );

  router.post('/exports/:id/download', validate({ params: IdParamSchema }), async (req, res) => {
    const ctx = requireAuthCtx(req);
    const r = await service.recordExportDownload(req.params.id as string, ctx, opCtx(req));
    res.json(success(r, 'Download recorded', req.traceId));
  });

  // ─── Model asset registry ───────────────────────────────────────
  router.post('/assets', validate({ body: CreateModelAssetSchema }), async (req, res) => {
    const ctx = requireAuthCtx(req);
    const r = await service.createAsset(req.body, ctx, opCtx(req));
    res.status(201).json(success(r, 'Asset registered', req.traceId));
  });

  router.get('/assets', async (req, res) => {
    const ctx = requireAuthCtx(req);
    const q = {
      asset_type:
        (req.query.asset_type as Parameters<SecurityService['listAssets']>[0]['asset_type']) ??
        undefined,
      status:
        (req.query.status as Parameters<SecurityService['listAssets']>[0]['status']) ?? undefined,
      classification:
        (req.query.classification as Parameters<
          SecurityService['listAssets']
        >[0]['classification']) ?? undefined,
      page: Math.max(1, Number(req.query.page ?? 1)),
      pageSize: Math.min(200, Math.max(1, Number(req.query.pageSize ?? 20))),
    };
    const r = await service.listAssets(q, ctx);
    res.json(paginated(r.items, r.total, q.page, q.pageSize, req.traceId));
  });

  router.get('/assets/:id', validate({ params: IdParamSchema }), async (req, res) => {
    const ctx = requireAuthCtx(req);
    const r = await service.getAsset(req.params.id as string, ctx);
    res.json(success(r, 'success', req.traceId));
  });

  router.patch(
    '/assets/:id',
    validate({ params: IdParamSchema, body: UpdateModelAssetSchema }),
    async (req, res) => {
      const ctx = requireAuthCtx(req);
      const r = await service.updateAsset(req.params.id as string, req.body, ctx, opCtx(req));
      res.json(success(r, 'Asset updated', req.traceId));
    }
  );

  return router;
}
