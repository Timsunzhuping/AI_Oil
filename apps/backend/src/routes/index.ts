import { Express, Router } from 'express';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { livenessHandler } from '../controllers/healthController.js';
import { success } from '../lib/response.js';
import { loadEnv } from '../config/env.js';
import { buildV1Router } from './v1/index.js';
import { buildIntegrationModule, type IntegrationModule } from '../modules/integration/index.js';

export interface RouteDeps {
  pool: Pool | null;
  logger?: Logger;
}

/**
 * Mounts top-level routes:
 *   /            — service banner
 *   /health      — liveness probe (no auth, no rate limit)
 *   {API_PREFIX} — versioned API surface
 *
 * The pool is forwarded to feature routers that need DB access. The
 * integration module is constructed here (so its scheduler is reachable
 * from `main`) and then wired into the v1 router.
 */
export function configureRoutes(
  app: Express,
  deps: RouteDeps = { pool: null }
): { integration: IntegrationModule | null } {
  const env = loadEnv();

  app.get('/health', livenessHandler);

  const root: Router = Router();
  root.get('/', (_req, res) => {
    res.json(
      success({
        service: env.SERVICE_NAME,
        version: env.SERVICE_VERSION,
        env: env.NODE_ENV,
        docs: env.ENABLE_SWAGGER ? `${env.API_PREFIX}/docs` : null,
        v1: `${env.API_PREFIX}/v1`,
      })
    );
  });

  let integration: IntegrationModule | null = null;
  if (deps.pool && deps.logger) {
    integration = buildIntegrationModule(deps.pool, deps.logger, {
      schedulerEnabled: !env.NODE_ENV.startsWith('test'),
    });
  }

  app.use(env.API_PREFIX, root);
  app.use(
    `${env.API_PREFIX}/v1`,
    buildV1Router({ pool: deps.pool, logger: deps.logger, integration })
  );

  return { integration };
}
