import { Router } from 'express';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { healthRouter } from './health.js';
import { buildMasterDataRouter } from '../../modules/master-data/index.js';
import { buildIntegrationModule } from '../../modules/integration/index.js';
import { buildCleaningModule } from '../../modules/cleaning/index.js';

export interface V1Deps {
  pool: Pool | null;
  logger?: Logger;
  /** When provided, the scheduler will NOT auto-start here; main wires it. */
  integration?: ReturnType<typeof buildIntegrationModule> | null;
}

/**
 * V1 API router.
 *
 * Feature modules are mounted here under their resource prefix.
 * DB-bound modules (master-data, integration, cleaning) only mount when a
 * pool is available, keeping health-only / DB-less test runs working.
 */
export function buildV1Router(deps: V1Deps): Router {
  const v1 = Router();

  v1.use('/health', healthRouter);

  const mounted: string[] = ['/health', '/health/live', '/health/ready'];

  if (deps.pool) {
    v1.use('/master-data', buildMasterDataRouter(deps.pool));
    mounted.push('/master-data');

    if (deps.integration) {
      v1.use('/integration', deps.integration.router);
      mounted.push('/integration');
    }

    if (deps.logger) {
      const cleaning = buildCleaningModule(deps.pool, deps.logger);
      v1.use('/cleaning', cleaning.router);
      mounted.push('/cleaning');
    }
  }

  v1.get('/', (req, res) => {
    res.json({
      code: 0,
      message: 'success',
      data: { version: 'v1', endpoints: mounted },
      traceId: req.traceId,
      timestamp: new Date().toISOString(),
    });
  });

  return v1;
}

// Backwards-compat export so legacy imports of { v1Router } still work.
export const v1Router = buildV1Router({ pool: null });
