/**
 * Reverse Recommendation module factory.
 *
 *   buildRecommendationModule(pool, logger, { adapter? })
 *
 * Wires:
 *   PredictorAdapter (mock | real | injected)
 *     → PredictorBackedEvaluator
 *     → RecommendationPipeline (default generator/filter/ranker)
 *     → RecommendationService
 *     → Express router
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { buildPredictor } from '../prediction/index.js';
import type { PredictorAdapter } from '../prediction/index.js';
import { PredictorBackedEvaluator } from './pipeline/evaluator.js';
import { RecommendationPipeline } from './pipeline/index.js';
import { RecommendationRepository } from './repository.js';
import { RecommendationService } from './service.js';
import { buildRecommendationRouter } from './routes.js';

export interface BuildRecommendationModuleOptions {
  /** Pre-built adapter (e.g. shared with the prediction module). */
  adapter?: PredictorAdapter;
  /** Skip persistence of recommendation_tasks/candidate_results. */
  disablePersistence?: boolean;
}

export function buildRecommendationModule(
  pool: Pool | null,
  logger: Logger,
  opts: BuildRecommendationModuleOptions = {}
) {
  const adapter = opts.adapter ?? buildPredictor();
  const evaluator = new PredictorBackedEvaluator(adapter);
  const pipeline = new RecommendationPipeline({ evaluator });
  const repository = pool && !opts.disablePersistence ? new RecommendationRepository(pool) : null;
  const service = new RecommendationService({ pipeline, evaluator, repository, logger });
  const router = buildRecommendationRouter(service);
  return { adapter, evaluator, pipeline, repository, service, router };
}

export { RecommendationService } from './service.js';
export { RecommendationRepository } from './repository.js';
export { RecommendationPipeline } from './pipeline/index.js';
export { DefaultCandidateGenerator } from './pipeline/generator.js';
export {
  DefaultConstraintFilter,
  estimateBomCost,
  estimateBomCarbon,
  CONSTRAINT_CODES,
} from './pipeline/filter.js';
export { PredictorBackedEvaluator } from './pipeline/evaluator.js';
export { WeightedSumRanker, DEFAULT_WEIGHTS } from './pipeline/ranker.js';
export { resolveStrategy, applyModifications } from './service.js';
export {
  GenerateRequestSchema,
  RecalculateRequestSchema,
  ReplaceMaterialRequestSchema,
  TargetMetricSchema,
  MaterialPoolEntrySchema,
} from './schemas.js';
export { createRng, fallbackSeed } from './random.js';
export type * from './types.js';
