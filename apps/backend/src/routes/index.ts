import { Express, Router } from 'express';
import type { Pool } from 'pg';
import { livenessHandler } from '../controllers/healthController.js';
import { success } from '../lib/response.js';
import { loadEnv } from '../config/env.js';
import { buildV1Router } from './v1/index.js';

export interface RouteDeps {
  pool: Pool | null;
}

/**
 * Mounts top-level routes:
 *   /            — service banner
 *   /health      — liveness probe (no auth, no rate limit)
 *   {API_PREFIX} — versioned API surface
 *
 * The pool is forwarded to feature routers that need DB access (master-data, etc).
 */
export function configureRoutes(app: Express, deps: RouteDeps = { pool: null }): void {
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

  app.use(env.API_PREFIX, root);
  app.use(`${env.API_PREFIX}/v1`, buildV1Router(deps));
}
