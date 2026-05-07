/**
 * Ranking engine.
 *
 * Composite score = weighted sum of:
 *   • target_score      — how well predicted metrics fall within target windows
 *   • cost_score        — 1 - cost / cost_limit (clamped)
 *   • confidence_score  — average prediction confidence
 *   • constraint_score  — fraction of structural constraints satisfied
 *   • risk_penalty      — deduction for critical / warning risk flags
 *
 * Each piece is in [0, 1]; weights are configurable and re-normalised so a
 * caller can dial cost vs. accuracy without breaking the score domain.
 */
import type { PredictedMetric, RiskWarning } from '../../prediction/types.js';
import type { CandidateScoreBreakdown, ConstraintMatch, TargetMetric } from '../types.js';

export interface RankableCandidate {
  predicted_metrics: PredictedMetric[];
  estimated_cost: number | null;
  cost_limit: number | null;
  risk_warnings: RiskWarning[];
  constraint_match: ConstraintMatch;
  target_metrics: TargetMetric[];
}

export interface ScoringWeights {
  target: number;
  cost: number;
  confidence: number;
  constraint: number;
  /** Penalty cap — risk_penalty is subtracted with this multiplier capped at this value. */
  risk: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  target: 0.45,
  cost: 0.2,
  confidence: 0.15,
  constraint: 0.2,
  risk: 0.3,
};

export interface RankingEngine {
  score(
    c: RankableCandidate,
    weights?: Partial<ScoringWeights>
  ): {
    composite: number;
    breakdown: CandidateScoreBreakdown;
  };
}

export class WeightedSumRanker implements RankingEngine {
  score(
    c: RankableCandidate,
    w: Partial<ScoringWeights> = {}
  ): {
    composite: number;
    breakdown: CandidateScoreBreakdown;
  } {
    const weights = { ...DEFAULT_WEIGHTS, ...w };
    const target_score = computeTargetScore(c.predicted_metrics, c.target_metrics);
    const cost_score = computeCostScore(c.estimated_cost, c.cost_limit);
    const confidence_score = computeConfidenceScore(c.predicted_metrics);
    const constraint_score = c.constraint_match.score;
    const risk_penalty = computeRiskPenalty(c.risk_warnings, weights.risk);

    // Normalise the positive component weights so they always sum to 1
    // (risk penalty is subtracted afterwards).
    const positiveSum = weights.target + weights.cost + weights.confidence + weights.constraint;
    const norm = positiveSum > 0 ? positiveSum : 1;

    const positive =
      (weights.target / norm) * target_score +
      (weights.cost / norm) * cost_score +
      (weights.confidence / norm) * confidence_score +
      (weights.constraint / norm) * constraint_score;

    const composite = Math.max(0, Math.min(1, positive - risk_penalty));

    const breakdown: CandidateScoreBreakdown = {
      target_score: round4(target_score),
      cost_score: round4(cost_score),
      confidence_score: round4(confidence_score),
      constraint_score: round4(constraint_score),
      risk_penalty: round4(risk_penalty),
    };

    return { composite: round4(composite), breakdown };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score how well predicted metrics hit their target window:
 *   • inside [lower, upper]: contribution 1.0
 *   • inside but >5 % from edge:    contribution 0.7
 *   • outside:                      contribution = max(0, 1 - distance/abs(target||edge))
 */
export function computeTargetScore(metrics: PredictedMetric[], targets: TargetMetric[]): number {
  if (targets.length === 0) return 1;
  let weighted = 0;
  let weightSum = 0;
  for (const t of targets) {
    const w = t.weight ?? 1;
    weightSum += w;
    const m = metrics.find((x) => x.name === t.name);
    if (!m) {
      // Missing metric → 0 contribution; still counts towards weightSum so a
      // missing prediction drags the composite down.
      continue;
    }
    const contribution = scoreMetric(m, t);
    weighted += contribution * w;
  }
  if (weightSum === 0) return 1;
  return weighted / weightSum;
}

function scoreMetric(m: PredictedMetric, t: TargetMetric): number {
  const v = m.predicted_value;
  const lo = t.lower_bound ?? null;
  const hi = t.upper_bound ?? null;
  if (lo === null && hi === null) {
    if (t.target === undefined) return 1;
    const denom = Math.abs(t.target) > 1e-9 ? Math.abs(t.target) : 1;
    return Math.max(0, 1 - Math.abs(v - t.target) / denom);
  }
  if (lo !== null && v < lo) {
    const denom = Math.abs(lo) > 1e-9 ? Math.abs(lo) : 1;
    return Math.max(0, 1 - (lo - v) / denom);
  }
  if (hi !== null && v > hi) {
    const denom = Math.abs(hi) > 1e-9 ? Math.abs(hi) : 1;
    return Math.max(0, 1 - (v - hi) / denom);
  }
  // Inside the window — reward proximity to target if specified.
  if (t.target !== undefined) {
    const denom = Math.abs(t.target) > 1e-9 ? Math.abs(t.target) : 1;
    const closeness = 1 - Math.min(1, Math.abs(v - t.target) / denom);
    // Inside-window minimum is 0.7; reward up to 1.0 for hitting target.
    return 0.7 + 0.3 * closeness;
  }
  return 1;
}

export function computeCostScore(cost: number | null, limit: number | null): number {
  if (cost === null) return 0.5; // neutral when we don't know
  if (!limit || limit <= 0) return 1; // no budget set → max score
  if (cost <= 0) return 1;
  if (cost >= 2 * limit) return 0;
  // Linear: cost = 0 → 1.0, cost = limit → 0.5, cost = 2*limit → 0.0
  return Math.max(0, Math.min(1, 1 - cost / (2 * limit)));
}

export function computeConfidenceScore(metrics: PredictedMetric[]): number {
  if (metrics.length === 0) return 0;
  const sum = metrics.reduce((s, m) => s + (Number.isFinite(m.confidence) ? m.confidence : 0), 0);
  return sum / metrics.length;
}

export function computeRiskPenalty(risks: RiskWarning[], cap: number): number {
  let p = 0;
  for (const r of risks) {
    p += r.level === 'critical' ? 0.2 : r.level === 'warning' ? 0.05 : 0.01;
  }
  return Math.min(p, Math.max(0, cap));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
