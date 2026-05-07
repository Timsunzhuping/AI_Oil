/**
 * ERP integration module factory.
 *
 *   const { router, scheduler } = buildErpModule(pool, logger, {
 *     sap?, lims?, carbon?, schedule?
 *   });
 *
 *   v1.use('/erp', router);
 *   scheduler.start();   // optional cron-like background sync
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { buildSapAdapter, type BuildSapAdapterOptions } from './adapters/sap/index.js';
import { buildLimsAdapter, type BuildLimsAdapterOptions } from './adapters/lims/index.js';
import { buildCarbonAdapter, type BuildCarbonAdapterOptions } from './adapters/carbon/index.js';
import { ErpRepository } from './repository.js';
import { ErpService } from './service.js';
import { buildErpRouter } from './routes.js';
import { ErpScheduler, type ScheduleEntry } from './scheduler.js';

export interface BuildErpModuleOptions {
  sap?: BuildSapAdapterOptions;
  lims?: BuildLimsAdapterOptions;
  carbon?: BuildCarbonAdapterOptions;
  /** Background sync schedule. Empty disables the scheduler. */
  schedule?: ScheduleEntry[];
  /** Sleep override for tests (no-op skips real backoff delays). */
  sleep?: (ms: number) => Promise<void>;
}

export function buildErpModule(pool: Pool, logger: Logger, opts: BuildErpModuleOptions = {}) {
  const sap = buildSapAdapter(opts.sap);
  const lims = buildLimsAdapter(opts.lims);
  const carbon = buildCarbonAdapter(opts.carbon);
  const repository = new ErpRepository(pool);
  const service = new ErpService({
    repository,
    sap,
    lims,
    carbon,
    logger,
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
  });
  const router = buildErpRouter(service);
  const scheduler = new ErpScheduler({ service, logger, schedule: opts.schedule ?? [] });
  return { sap, lims, carbon, repository, service, router, scheduler };
}

export { ErpService } from './service.js';
export { ErpRepository } from './repository.js';
export { ErpScheduler } from './scheduler.js';
export type { ScheduleEntry } from './scheduler.js';
export { buildSapAdapter, MockSapAdapter } from './adapters/sap/index.js';
export type { SapAdapter } from './adapters/sap/index.js';
export { buildLimsAdapter, MockLimsAdapter } from './adapters/lims/index.js';
export type { LimsAdapter } from './adapters/lims/index.js';
export { buildCarbonAdapter, MockCarbonAdapter } from './adapters/carbon/index.js';
export type { CarbonAdapter } from './adapters/carbon/index.js';
export { withRetry, computeBackoffMs } from './retry.js';
export type * from './types.js';
export {
  SapSyncSchema,
  CreateLimsTaskSchema,
  PullLimsResultSchema,
  CarbonFormulaSchema,
  ListJobsQuerySchema,
  ListLimsLinksQuerySchema,
} from './schemas.js';
