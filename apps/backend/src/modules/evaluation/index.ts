/**
 * Evaluation module factory.
 *
 *   const evaluation = buildEvaluationModule(pool, logger, {
 *     predictor,                    // a PredictorAdapter from the prediction module
 *     pipeline,                     // a recommendation pipeline matching LimitedRecommendationPipeline
 *   });
 *   v1.use('/evaluation', evaluation.router);
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { PredictorAdapter } from '../prediction/adapters/types.js';
import { RecommendationPipeline, type DefaultCandidateGenerator } from '../recommendation/index.js';
import type { ScoredCandidate } from '../recommendation/pipeline/index.js';
import type {
  LimitedPipelineResult,
  LimitedRecommendationPipeline,
  LimitedScoredCandidate,
} from './runners/pipeline-shape.js';
import { EvaluationRepository } from './repository.js';
import { EvaluationService } from './service.js';
import { buildEvaluationRouter } from './routes.js';

export interface BuildEvaluationModuleOptions {
  predictor: PredictorAdapter;
  pipeline: LimitedRecommendationPipeline | RecommendationPipeline;
  /** Override the default generator used when wrapping a full RecommendationPipeline. */
  generator?: DefaultCandidateGenerator;
}

export function buildEvaluationModule(
  pool: Pool,
  logger: Logger,
  opts: BuildEvaluationModuleOptions
) {
  const repository = new EvaluationRepository(pool);
  const pipeline = wrapPipeline(opts.pipeline);
  const service = new EvaluationService({
    repository,
    predictor: opts.predictor,
    pipeline,
    logger,
  });
  const router = buildEvaluationRouter(service);
  return { repository, service, router };
}

/** Adapts the production `RecommendationPipeline` to the narrower local shape. */
function wrapPipeline(
  pipeline: LimitedRecommendationPipeline | RecommendationPipeline
): LimitedRecommendationPipeline {
  if ('run' in pipeline && typeof (pipeline as { run: unknown }).run === 'function') {
    /* Both shapes have `run`; the local interface is structurally a subset
     * of `RecommendationPipeline.run`. The wrapper massages the result type. */
    return {
      async run(input) {
        const r = await (pipeline as RecommendationPipeline).run(input);
        const candidates: LimitedScoredCandidate[] = r.candidates.map((c: ScoredCandidate) => ({
          rank: c.rank,
          bom: c.bom.map((b) => ({
            material_code: b.material_code,
            material_name: b.material_name,
            role: b.role,
            ratio: b.ratio,
          })),
          estimated_cost: c.estimated_cost,
          confidence: c.confidence,
          risk_warnings: c.risk_warnings,
          passed_filter: c.passed_filter,
        }));
        const result: LimitedPipelineResult = { candidates };
        return result;
      },
    };
  }
  return pipeline;
}

export { EvaluationService } from './service.js';
export { EvaluationRepository } from './repository.js';
export {
  runForward,
  runInverse,
  runStability,
  type LimitedRecommendationPipeline,
  type LimitedPipelineResult,
  type LimitedScoredCandidate,
} from './runners/index.js';
export {
  mae,
  mape,
  rmse,
  hitRate,
  isHit,
  cosineSimilarity,
  pairwiseCosine,
  coefficientOfVariation,
  jaccard,
  passRate,
  round4,
} from './metrics.js';
export {
  renderJson,
  renderMarkdown,
  renderReportMarkdown,
  reportFromRun,
} from './reporters/index.js';
export {
  CreateTestSetSchema,
  RunRequestSchema,
  ListTestSetsQuerySchema,
  ListRunsQuerySchema,
  ExportFormatQuerySchema,
} from './schemas.js';
export {
  BASELINE_TEST_SETS,
  FORWARD_BASELINE,
  FORWARD_BASELINE_CASES,
  INVERSE_BASELINE,
  INVERSE_BASELINE_CASES,
  STABILITY_BASELINE,
  STABILITY_BASELINE_CASES,
} from './baseline/index.js';
export type * from './types.js';
