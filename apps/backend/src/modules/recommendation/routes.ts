/**
 * HTTP layer for the Reverse Recommendation Service.
 *
 *   POST  /api/v1/recommend/generate           run pipeline + persist
 *   POST  /api/v1/recommend/recalculate        re-evaluate user-edited candidate
 *   POST  /api/v1/recommend/replace-material   swap one material in a candidate
 *   GET   /api/v1/recommend/history/:taskId    list candidates of a task
 */
import { Router, type Request } from 'express';
import { validate } from '../../middleware/validate.js';
import { success } from '../../lib/response.js';
import {
  GenerateRequestSchema,
  RecalculateRequestSchema,
  ReplaceMaterialRequestSchema,
  TaskIdParamSchema,
} from './schemas.js';
import { RecommendationService } from './service.js';

const userIdOf = (req: Request): string | null =>
  (req as Request & { userId?: string }).userId ?? null;

export function buildRecommendationRouter(service: RecommendationService): Router {
  const router = Router();

  // POST /api/v1/recommend/generate
  router.post('/generate', validate({ body: GenerateRequestSchema }), async (req, res) => {
    const result = await service.generate(req.body, {
      trace_id: req.traceId,
      user_id: userIdOf(req),
    });
    res.status(201).json(success(result, 'Recommendation generated', req.traceId));
  });

  // POST /api/v1/recommend/recalculate
  router.post('/recalculate', validate({ body: RecalculateRequestSchema }), async (req, res) => {
    const result = await service.recalculate(req.body, { trace_id: req.traceId });
    res.json(success(result, 'Candidate recalculated', req.traceId));
  });

  // POST /api/v1/recommend/replace-material
  router.post(
    '/replace-material',
    validate({ body: ReplaceMaterialRequestSchema }),
    async (req, res) => {
      const result = await service.replaceMaterial(req.body, { trace_id: req.traceId });
      res.json(success(result, 'Material replaced and candidate recalculated', req.traceId));
    }
  );

  // GET /api/v1/recommend/history/:taskId
  router.get('/history/:taskId', validate({ params: TaskIdParamSchema }), async (req, res) => {
    const result = await service.history(req.params.taskId as string);
    res.json(success(result, 'success', req.traceId));
  });

  return router;
}
