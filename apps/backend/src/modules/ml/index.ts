/**
 * MLOps platform module factory.
 *
 *   const { router, service } = buildMlModule(pool, logger, {
 *     trainer?,                       // override the trainer adapter
 *   });
 *   v1.use('/ml', router);
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { buildTrainer, type BuildTrainerOptions } from './adapters/trainer/index.js';
import { MlRepository } from './repository.js';
import { MlService } from './service.js';
import { buildMlRouter } from './routes.js';

export interface BuildMlModuleOptions {
  trainer?: BuildTrainerOptions;
}

export function buildMlModule(pool: Pool, logger: Logger, opts: BuildMlModuleOptions = {}) {
  const trainer = buildTrainer(opts.trainer);
  const repository = new MlRepository(pool);
  const service = new MlService({ repository, trainer, logger });
  const router = buildMlRouter(service);
  return { trainer, repository, service, router };
}

export { MlService } from './service.js';
export { MlRepository } from './repository.js';
export {
  buildTrainer,
  MockTrainerAdapter,
  LocalTrainerAdapter,
  synthesiseMetrics,
} from './adapters/trainer/index.js';
export type {
  TrainerAdapter,
  TrainerIdentity,
  TrainInput,
  TrainOutput,
} from './adapters/trainer/index.js';
export {
  canTransitionTrainingJob,
  canTransitionVersion,
  assertTrainingJobTransition,
  assertVersionTransition,
  isTerminalTrainingStatus,
} from './state-machine.js';
export {
  metricBetterDirection,
  computeMetricRows,
  computeHyperparameterDiffs,
  computeSummary,
} from './service.js';
export {
  CreateDatasetSchema,
  CreateFeatureTemplateSchema,
  CreateModelSchema,
  CreateTrainingJobSchema,
  ReleaseSchema,
  RollbackSchema,
  CompareModelsQuerySchema,
  CreateAutoFinetuneTriggerSchema,
  ManualRetrainSchema,
} from './schemas.js';
export type * from './types.js';
