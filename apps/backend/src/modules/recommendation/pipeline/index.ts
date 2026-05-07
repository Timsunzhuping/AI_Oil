/**
 * Pipeline orchestrator.
 *
 * Wires the four pluggable stages — generator → filter → evaluator → ranker —
 * into one call. Service layer talks to this orchestrator; controllers don't
 * know it exists.
 */
import type { BomItem } from '../../prediction/types.js';
import { deriveRiskWarnings } from '../../prediction/index.js';
import type { Rng } from '../random.js';
import type {
  CandidateResult,
  CandidateScoreBreakdown,
  ConstraintMatch,
  GenerateRequest,
  RecommendationStrategy,
} from '../types.js';
import {
  DefaultConstraintFilter,
  estimateBomCarbon,
  estimateBomCost,
  type ConstraintFilter,
} from './filter.js';
import {
  DefaultCandidateGenerator,
  type CandidateGenerator,
  type RawCandidate,
} from './generator.js';
import { type SurrogateEvaluator } from './evaluator.js';
import { WeightedSumRanker, type RankingEngine, type ScoringWeights } from './ranker.js';

export interface PipelineDeps {
  generator?: CandidateGenerator;
  filter?: ConstraintFilter;
  evaluator: SurrogateEvaluator;
  ranker?: RankingEngine;
  /** Custom scoring weights — overrides DEFAULT_WEIGHTS partially. */
  weights?: Partial<ScoringWeights>;
}

export interface PipelineRunInput {
  request: GenerateRequest;
  strategy: RecommendationStrategy;
  rng: Rng;
}

export interface ScoredCandidate {
  rank: number;
  raw: RawCandidate;
  bom: BomItem[];
  constraint_match: ConstraintMatch;
  /** When constraint check failed, evaluator was skipped and these are empty. */
  predicted_metrics: CandidateResult['predicted_metrics'];
  estimated_cost: number | null;
  carbon_estimate: number | null;
  risk_warnings: CandidateResult['risk_warnings'];
  composite_score: number;
  score_breakdown: CandidateScoreBreakdown;
  confidence: number;
  /** Whether this candidate cleared all hard constraints. */
  passed_filter: boolean;
}

export interface PipelineRunSummary {
  generated: number;
  passed_filters: number;
  evaluated: number;
  ranked: number;
}

export interface PipelineResult {
  candidates: ScoredCandidate[];
  summary: PipelineRunSummary;
  modelInfo: { code: string; version: string; mode: 'mock' | 'real' };
}

export class RecommendationPipeline {
  readonly generator: CandidateGenerator;
  readonly filter: ConstraintFilter;
  readonly evaluator: SurrogateEvaluator;
  readonly ranker: RankingEngine;
  readonly weights: Partial<ScoringWeights> | undefined;

  constructor(deps: PipelineDeps) {
    this.generator = deps.generator ?? new DefaultCandidateGenerator();
    this.filter = deps.filter ?? new DefaultConstraintFilter();
    this.evaluator = deps.evaluator;
    this.ranker = deps.ranker ?? new WeightedSumRanker();
    this.weights = deps.weights;
  }

  async run({ request, strategy, rng }: PipelineRunInput): Promise<PipelineResult> {
    const raws = this.generator.generate(request, strategy, rng);
    const summary: PipelineRunSummary = {
      generated: raws.length,
      passed_filters: 0,
      evaluated: 0,
      ranked: 0,
    };

    const intermediate: ScoredCandidate[] = [];
    for (const raw of raws) {
      const constraint = this.filter.evaluate(raw.bom, request);
      const passed = this.filter.passes(constraint);
      if (passed) summary.passed_filters += 1;

      const cost = estimateBomCost(raw.bom, request.material_pool ?? []);
      const carbon = estimateBomCarbon(raw.bom, request.material_pool ?? []);

      let predicted_metrics: CandidateResult['predicted_metrics'] = [];
      let risks: CandidateResult['risk_warnings'] = [];
      let confidence = 0;
      if (passed) {
        try {
          predicted_metrics = await this.evaluator.evaluate(raw.bom, request);
          risks = deriveRiskWarnings(predicted_metrics, {
            target_metrics: request.target_metrics.map((t) => t.name),
          });
          summary.evaluated += 1;
          confidence =
            predicted_metrics.length > 0
              ? predicted_metrics.reduce((s, m) => s + m.confidence, 0) / predicted_metrics.length
              : 0;
        } catch {
          // Evaluator failure does NOT abort the run — the candidate just
          // ranks low. Surface a synthetic risk so the UI can pick it up.
          risks = [
            {
              level: 'critical',
              code: 'EVALUATOR_FAILED',
              message: 'Surrogate model failed to evaluate this candidate.',
            },
          ];
        }
      }

      const { composite, breakdown } = this.ranker.score(
        {
          predicted_metrics,
          estimated_cost: cost,
          cost_limit: request.cost_limit ?? null,
          risk_warnings: risks,
          constraint_match: constraint,
          target_metrics: request.target_metrics,
        },
        this.weights
      );

      intermediate.push({
        rank: 0,
        raw,
        bom: raw.bom,
        constraint_match: constraint,
        predicted_metrics,
        estimated_cost: cost,
        carbon_estimate: carbon,
        risk_warnings: risks,
        composite_score: composite,
        score_breakdown: breakdown,
        confidence: Math.round(confidence * 1000) / 1000,
        passed_filter: passed,
      });
    }

    // Take only filter-passers for ranking; if none pass, fall back to the
    // best-of-failed so the user can see WHY they were rejected.
    const passers = intermediate.filter((c) => c.passed_filter);
    const fallback = passers.length === 0 ? intermediate : passers;

    fallback.sort((a, b) => b.composite_score - a.composite_score);
    const n = clamp(request.n_candidates ?? 5, 1, 10);
    const top = fallback.slice(0, n).map((c, idx) => ({ ...c, rank: idx + 1 }));
    summary.ranked = top.length;

    return { candidates: top, summary, modelInfo: this.evaluator.modelInfo() };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export {
  DefaultCandidateGenerator,
  type CandidateGenerator,
  type RawCandidate,
} from './generator.js';
export {
  DefaultConstraintFilter,
  estimateBomCost,
  estimateBomCarbon,
  CONSTRAINT_CODES,
  type ConstraintFilter,
} from './filter.js';
export { PredictorBackedEvaluator, type SurrogateEvaluator } from './evaluator.js';
export {
  WeightedSumRanker,
  DEFAULT_WEIGHTS,
  type RankingEngine,
  type ScoringWeights,
} from './ranker.js';
