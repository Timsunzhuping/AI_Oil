/**
 * HTTP layer for the evaluation module.
 *
 *   POST  /evaluation/test-sets              create a test set
 *   GET   /evaluation/test-sets              list (test_type / status / q)
 *   GET   /evaluation/test-sets/:id          detail
 *
 *   POST  /evaluation/runs                   run acceptance against a test set
 *   GET   /evaluation/runs                   list
 *   GET   /evaluation/runs/:id               detail (run + per-case results)
 *   GET   /evaluation/runs/:id/export?format=json|markdown
 */
import { Router, type Request } from 'express';
import { validate } from '../../middleware/validate.js';
import { paginated, success } from '../../lib/response.js';
import {
  CreateTestSetSchema,
  ExportFormatQuerySchema,
  IdParamSchema,
  ListRunsQuerySchema,
  ListTestSetsQuerySchema,
  RunRequestSchema,
} from './schemas.js';
import type { EvaluationService } from './service.js';

const userIdOf = (req: Request): string | null =>
  (req as Request & { userId?: string }).userId ?? null;

export function buildEvaluationRouter(service: EvaluationService): Router {
  const router = Router();

  router.post('/test-sets', validate({ body: CreateTestSetSchema }), async (req, res) => {
    const r = await service.createTestSet(req.body, {
      trace_id: req.traceId,
      user_id: userIdOf(req),
    });
    res.status(201).json(success(r, 'Test set created', req.traceId));
  });

  router.get('/test-sets', validate({ query: ListTestSetsQuerySchema }), async (req, res) => {
    const q = req.query as unknown as Parameters<EvaluationService['listTestSets']>[0];
    const r = await service.listTestSets(q);
    res.json(paginated(r.items, r.total, q.page, q.pageSize, req.traceId));
  });

  router.get('/test-sets/:id', validate({ params: IdParamSchema }), async (req, res) => {
    const r = await service.getTestSet(req.params.id as string);
    res.json(success(r, 'success', req.traceId));
  });

  router.post('/runs', validate({ body: RunRequestSchema }), async (req, res) => {
    const r = await service.runAcceptance(req.body, {
      trace_id: req.traceId,
      user_id: userIdOf(req),
    });
    res.status(201).json(success(r, 'Acceptance run completed', req.traceId));
  });

  router.get('/runs', validate({ query: ListRunsQuerySchema }), async (req, res) => {
    const q = req.query as unknown as Parameters<EvaluationService['listRuns']>[0];
    const r = await service.listRuns(q);
    res.json(paginated(r.items, r.total, q.page, q.pageSize, req.traceId));
  });

  router.get('/runs/:id', validate({ params: IdParamSchema }), async (req, res) => {
    const r = await service.getRun(req.params.id as string);
    res.json(success(r, 'success', req.traceId));
  });

  router.get(
    '/runs/:id/export',
    validate({ params: IdParamSchema, query: ExportFormatQuerySchema }),
    async (req, res) => {
      const q = req.query as unknown as { format: 'json' | 'markdown' };
      const r = await service.exportRun(req.params.id as string, q.format);
      res.setHeader('Content-Type', r.content_type);
      res.setHeader('Content-Disposition', `attachment; filename="${r.filename}"`);
      res.send(r.body);
    }
  );

  return router;
}
