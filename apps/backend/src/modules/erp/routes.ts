/**
 * HTTP layer for the ERP integration module.
 *
 *   POST  /erp/sap/sync/bom              full / incremental SAP BOM sync
 *   POST  /erp/sap/sync/cost             cost sync
 *   POST  /erp/sap/sync/inventory        inventory sync
 *
 *   POST  /erp/lims/tasks                push: create a LIMS test task
 *   POST  /erp/lims/tasks/:linkId/pull   pull: fetch latest result for a link
 *   GET   /erp/lims/tasks                list links (paginated)
 *   GET   /erp/lims/tasks/:linkId        link detail
 *
 *   GET   /erp/carbon/material/:material_code   single-material CO₂e lookup
 *   POST  /erp/carbon/formula                   formula CO₂e estimate
 *
 *   GET   /erp/jobs                       paginated audit jobs
 *   GET   /erp/jobs/:id                   job detail + per-job log trail
 */
import { Router, type Request } from 'express';
import { validate } from '../../middleware/validate.js';
import { paginated, success } from '../../lib/response.js';
import {
  CarbonFormulaSchema,
  CreateLimsTaskSchema,
  IdParamSchema,
  LimsLinkIdParamSchema,
  ListJobsQuerySchema,
  ListLimsLinksQuerySchema,
  MaterialCodeParamSchema,
  PullLimsResultSchema,
  SapSyncSchema,
} from './schemas.js';
import type { ErpService } from './service.js';

const userIdOf = (req: Request): string | null =>
  (req as Request & { userId?: string }).userId ?? null;

export function buildErpRouter(service: ErpService): Router {
  const router = Router();

  // ─── SAP ────────────────────────────────────────────────────────
  router.post('/sap/sync/bom', validate({ body: SapSyncSchema }), async (req, res) => {
    const r = await service.syncBom(req.body, { trace_id: req.traceId, user_id: userIdOf(req) });
    res.status(202).json(success(r, 'SAP BOM sync completed', req.traceId));
  });

  router.post('/sap/sync/cost', validate({ body: SapSyncSchema }), async (req, res) => {
    const r = await service.syncCost(req.body, { trace_id: req.traceId, user_id: userIdOf(req) });
    res.status(202).json(success(r, 'SAP cost sync completed', req.traceId));
  });

  router.post('/sap/sync/inventory', validate({ body: SapSyncSchema }), async (req, res) => {
    const r = await service.syncInventory(req.body, {
      trace_id: req.traceId,
      user_id: userIdOf(req),
    });
    res.status(202).json(success(r, 'SAP inventory sync completed', req.traceId));
  });

  // ─── LIMS ───────────────────────────────────────────────────────
  router.post('/lims/tasks', validate({ body: CreateLimsTaskSchema }), async (req, res) => {
    const r = await service.createLimsTask(req.body, {
      trace_id: req.traceId,
      user_id: userIdOf(req),
    });
    res.status(201).json(success(r, 'LIMS task created', req.traceId));
  });

  router.post(
    '/lims/tasks/:linkId/pull',
    validate({ params: LimsLinkIdParamSchema, body: PullLimsResultSchema.optional().default({}) }),
    async (req, res) => {
      const r = await service.pullLimsResult(req.params.linkId as string, req.body ?? {}, {
        trace_id: req.traceId,
        user_id: userIdOf(req),
      });
      res.json(success(r, 'LIMS result pulled', req.traceId));
    }
  );

  router.get('/lims/tasks', validate({ query: ListLimsLinksQuerySchema }), async (req, res) => {
    const q = req.query as unknown as Parameters<ErpService['listLimsLinks']>[0];
    const r = await service.listLimsLinks(q);
    res.json(paginated(r.items, r.total, q.page, q.pageSize, req.traceId));
  });

  router.get(
    '/lims/tasks/:linkId',
    validate({ params: LimsLinkIdParamSchema }),
    async (req, res) => {
      const r = await service.getLimsLink(req.params.linkId as string);
      res.json(success(r, 'success', req.traceId));
    }
  );

  // ─── Carbon ─────────────────────────────────────────────────────
  router.get(
    '/carbon/material/:material_code',
    validate({ params: MaterialCodeParamSchema }),
    async (req, res) => {
      const r = await service.lookupMaterialCarbon(req.params.material_code as string, {
        trace_id: req.traceId,
        user_id: userIdOf(req),
      });
      res.json(success(r, 'success', req.traceId));
    }
  );

  router.post('/carbon/formula', validate({ body: CarbonFormulaSchema }), async (req, res) => {
    const r = await service.estimateFormulaCarbon(req.body, {
      trace_id: req.traceId,
      user_id: userIdOf(req),
    });
    res.json(success(r, 'success', req.traceId));
  });

  // ─── Jobs ───────────────────────────────────────────────────────
  router.get('/jobs', validate({ query: ListJobsQuerySchema }), async (req, res) => {
    const q = req.query as unknown as Parameters<ErpService['listJobs']>[0];
    const r = await service.listJobs(q);
    res.json(paginated(r.items, r.total, q.page, q.pageSize, req.traceId));
  });

  router.get('/jobs/:id', validate({ params: IdParamSchema }), async (req, res) => {
    const r = await service.getJob(req.params.id as string);
    res.json(success(r, 'success', req.traceId));
  });

  return router;
}
