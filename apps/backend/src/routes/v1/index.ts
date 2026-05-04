import { Router } from 'express';
import { healthRouter } from './health.js';

/**
 * V1 API router. Mount feature routers here under their resource prefix.
 *
 *   v1Router.use('/projects',    projectRouter);
 *   v1Router.use('/formulas',    formulaRouter);
 *   v1Router.use('/experiments', experimentRouter);
 */
export const v1Router: Router = Router();

v1Router.use('/health', healthRouter);

v1Router.get('/', (req, res) => {
  res.json({
    code: 0,
    message: 'success',
    data: {
      version: 'v1',
      endpoints: ['/health', '/health/live', '/health/ready'],
    },
    traceId: req.traceId,
    timestamp: new Date().toISOString(),
  });
});
