/**
 * HTTP layer for the Forward Prediction Service.
 *
 *   POST  /api/v1/predict/single         single-formula prediction
 *   POST  /api/v1/predict/batch          parallel multi-formula prediction
 *   GET   /api/v1/predict/model-version  current model identity
 *   POST  /api/v1/predict/explain        single-metric feature attribution
 */
import { Router, type Request } from 'express';
import { validate } from '../../middleware/validate.js';
import { success } from '../../lib/response.js';
import {
  BatchPredictRequestSchema,
  ExplainPredictRequestSchema,
  SinglePredictRequestSchema,
} from './schemas.js';
import { PredictionService } from './service.js';

const userIdOf = (req: Request): string | null =>
  (req as Request & { userId?: string }).userId ?? null;

export function buildPredictionRouter(service: PredictionService): Router {
  const router = Router();

  // GET /api/v1/predict/model-version
  router.get('/model-version', (req, res) => {
    res.json(success(service.getModelVersion(), 'success', req.traceId));
  });

  // POST /api/v1/predict/single
  router.post('/single', validate({ body: SinglePredictRequestSchema }), async (req, res) => {
    const result = await service.predictSingle(req.body, {
      trace_id: req.traceId,
      user_id: userIdOf(req),
    });
    res.json(success(result, 'Prediction completed', req.traceId));
  });

  // POST /api/v1/predict/batch
  router.post('/batch', validate({ body: BatchPredictRequestSchema }), async (req, res) => {
    const result = await service.predictBatch(req.body, {
      trace_id: req.traceId,
      user_id: userIdOf(req),
    });
    const status = result.counts.failed === 0 ? 200 : result.counts.success === 0 ? 500 : 207; // partial
    res
      .status(status)
      .json(
        success(
          result,
          status === 207 ? 'Batch completed with partial failures' : 'Batch completed',
          req.traceId
        )
      );
  });

  // POST /api/v1/predict/explain
  router.post('/explain', validate({ body: ExplainPredictRequestSchema }), async (req, res) => {
    const result = await service.predictExplain(req.body, {
      trace_id: req.traceId,
      user_id: userIdOf(req),
    });
    res.json(success(result, 'Explanation generated', req.traceId));
  });

  return router;
}
