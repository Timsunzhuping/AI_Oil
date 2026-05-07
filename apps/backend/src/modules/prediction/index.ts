/**
 * Prediction module factory.
 *
 * Wires the predictor adapter (mock | real) → repository → service → router.
 * The factory accepts an explicit adapter override for tests.
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { buildPredictor, type BuildPredictorOptions } from './adapters/index.js';
import { PredictionLogsRepository } from './repository.js';
import { PredictionService } from './service.js';
import { buildPredictionRouter } from './routes.js';
import type { PredictorAdapter } from './adapters/types.js';

export interface BuildPredictionModuleOptions extends BuildPredictorOptions {
  /** Skip prediction_logs persistence (useful in DB-less smoke tests). */
  disableAuditLog?: boolean;
}

export function buildPredictionModule(
  pool: Pool | null,
  logger: Logger,
  opts: BuildPredictionModuleOptions = {}
) {
  const adapter: PredictorAdapter = buildPredictor(opts);
  const repository: PredictionLogsRepository | null =
    pool && !opts.disableAuditLog ? new PredictionLogsRepository(pool) : null;
  const service = new PredictionService({ adapter, repository, logger });
  const router = buildPredictionRouter(service);
  return { adapter, repository, service, router };
}

export { PredictionService } from './service.js';
export { PredictionLogsRepository } from './repository.js';
export { buildPredictor, MockPredictor, RealPredictorScaffold } from './adapters/index.js';
export {
  SinglePredictRequestSchema,
  BatchPredictRequestSchema,
  ExplainPredictRequestSchema,
  BomItemSchema,
} from './schemas.js';
export { deriveRiskWarnings } from './service.js';
export type * from './types.js';
export type { PredictorAdapter } from './adapters/types.js';
