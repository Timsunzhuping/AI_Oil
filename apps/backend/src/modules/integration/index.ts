import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { Router } from 'express';
import { AdapterRegistry } from './adapters/registry.js';
import { IntegrationRepository } from './repository.js';
import { JobRunner } from './job-runner.js';
import { IntegrationScheduler } from './scheduler/scheduler.js';
import { makeLoaderResolver } from './loaders.js';
import { buildIntegrationRouter } from './routes.js';

export interface IntegrationModule {
  router: Router;
  scheduler: IntegrationScheduler;
  registry: AdapterRegistry;
  runner: JobRunner;
}

/**
 * One-shot factory used by the v1 router.
 *
 * The scheduler is BUILT here but NOT auto-started — callers (e.g.
 * `src/index.ts`) decide whether to call `.start()`. Tests skip starting it.
 */
export function buildIntegrationModule(
  pool: Pool,
  logger: Logger,
  options: { schedulerEnabled?: boolean; tickIntervalMs?: number } = {}
): IntegrationModule {
  const registry = new AdapterRegistry();
  const repo = new IntegrationRepository(pool);
  const runner = new JobRunner(repo, registry, logger);
  const loaderResolver = makeLoaderResolver(pool);
  const scheduler = new IntegrationScheduler(repo, runner, logger, {
    enabled: options.schedulerEnabled,
    tickIntervalMs: options.tickIntervalMs,
    loaderResolver,
  });
  const router = buildIntegrationRouter(pool, logger, registry);

  return { router, scheduler, registry, runner };
}

export { AdapterRegistry } from './adapters/registry.js';
export { JobRunner } from './job-runner.js';
export { IntegrationRepository } from './repository.js';
export { IntegrationScheduler } from './scheduler/scheduler.js';
export type { Adapter, AdapterRecord, ExtractContext, Loader, SourceRow, SourceType } from './types.js';
