/**
 * Local "duck-typed" view of the recommendation pipeline.
 *
 * The acceptance runner doesn't depend on the full module — it just needs
 * the `run({ request, strategy, rng })` shape. Defining a narrow interface
 * here keeps the evaluation module decoupled from recommendation refactors.
 */
import type { Rng } from '../../recommendation/random.js';
import type { GenerateRequest, RecommendationStrategy } from '../../recommendation/types.js';

export interface LimitedScoredCandidate {
  rank: number;
  bom: Array<{ material_code: string; ratio: number; role: string; material_name: string }>;
  estimated_cost: number | null;
  confidence: number;
  risk_warnings: Array<{ level: 'info' | 'warning' | 'critical'; code: string; message: string }>;
  passed_filter: boolean;
}

export interface LimitedPipelineResult {
  candidates: LimitedScoredCandidate[];
}

export interface LimitedRecommendationPipeline {
  run(input: {
    request: GenerateRequest;
    strategy: RecommendationStrategy;
    rng: Rng;
  }): Promise<LimitedPipelineResult>;
}
