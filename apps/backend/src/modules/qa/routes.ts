/**
 * HTTP layer for the QA module.
 *
 *   POST  /qa/ask                    user question → answer + citations
 *   GET   /qa/history/:sessionId     session + messages
 *   POST  /qa/feedback               rate an assistant message
 */
import { Router, type Request } from 'express';
import { validate } from '../../middleware/validate.js';
import { success } from '../../lib/response.js';
import { AskSchema, FeedbackSchema, SessionIdParamSchema } from './schemas.js';
import type { QaService } from './service.js';

const userIdOf = (req: Request): string | null =>
  (req as Request & { userId?: string }).userId ?? null;

export function buildQaRouter(service: QaService): Router {
  const router = Router();

  router.post('/ask', validate({ body: AskSchema }), async (req, res) => {
    const result = await service.ask(req.body, {
      trace_id: req.traceId,
      user_id: userIdOf(req),
    });
    const status = result.no_source_fallback ? 200 : 200;
    res.status(status).json(success(result, 'Answer generated', req.traceId));
  });

  router.get(
    '/history/:sessionId',
    validate({ params: SessionIdParamSchema }),
    async (req, res) => {
      const result = await service.history(req.params.sessionId as string);
      res.json(success(result, 'success', req.traceId));
    }
  );

  router.post('/feedback', validate({ body: FeedbackSchema }), async (req, res) => {
    const result = await service.submitFeedback(req.body, {
      trace_id: req.traceId,
      user_id: userIdOf(req),
    });
    res.status(201).json(success(result, 'Feedback recorded', req.traceId));
  });

  return router;
}
