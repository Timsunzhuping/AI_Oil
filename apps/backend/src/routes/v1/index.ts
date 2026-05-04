import { Router } from 'express';
import type { Pool } from 'pg';
import { healthRouter } from './health.js';
import { buildMasterDataRouter } from '../../modules/master-data/index.js';

export interface V1Deps {
  pool: Pool | null;
}

/**
 * V1 API router.
 *
 * Mount feature routers under their resource prefix:
 *   v1Router.use('/projects',    projectRouter);
 *   v1Router.use('/formulas',    formulaRouter);
 *   v1Router.use('/experiments', experimentRouter);
 */
export function buildV1Router(deps: V1Deps): Router {
  const v1 = Router();

  v1.use('/health', healthRouter);

  if (deps.pool) {
    v1.use('/master-data', buildMasterDataRouter(deps.pool));
  }

  v1.get('/', (req, res) => {
    res.json({
      code: 0,
      message: 'success',
      data: {
        version: 'v1',
        endpoints: ['/health', '/health/live', '/health/ready', ...(deps.pool ? ['/master-data'] : [])],
      },
      traceId: req.traceId,
      timestamp: new Date().toISOString(),
    });
  });

  return v1;
}

// Backwards-compat export so legacy imports of { v1Router } still work.
export const v1Router = buildV1Router({ pool: null });
