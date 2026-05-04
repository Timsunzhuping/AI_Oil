import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { buildCleaningRouter } from './routes.js';

export function buildCleaningModule(pool: Pool, logger: Logger) {
  return { router: buildCleaningRouter(pool, logger) };
}

export { CleaningPipeline } from './pipeline/pipeline.js';
export { CleaningRepository } from './repository.js';
export { MasterDataLookup } from './lookup.js';
export { generateQualityReport } from './reports.js';
export type * from './types.js';
