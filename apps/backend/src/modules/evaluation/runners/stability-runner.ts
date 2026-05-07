/**
 * Stability runner.
 *
 *   for each test case:
 *     – run the same prediction (or recommendation) `runs` times
 *     – build a vector per run from the metric values (predict mode) or
 *       a candidate-id list (recommend mode)
 *     – compute pairwise cosine similarity, per-metric coefficient of
 *       variation (CV), and Jaccard for candidate ordering
 *     – mark stable when min_pairwise_cosine + max_cv thresholds are met
 */
import type { PredictorAdapter } from '../../prediction/adapters/types.js';
import type { LimitedRecommendationPipeline } from './pipeline-shape.js';
import { coefficientOfVariation, jaccard, pairwiseCosine, passRate, round4 } from '../metrics.js';
import type {
  ReportEnvelopeBase,
  StabilityAggregate,
  StabilityCase,
  StabilityCaseResult,
  StabilityReport,
  StabilityTolerance,
} from '../types.js';

export interface StabilityRunInput {
  cases: StabilityCase[];
  tolerance: StabilityTolerance;
  default_runs: number;
  envelope: Omit<
    ReportEnvelopeBase,
    'totals' | 'generated_at' | 'completed_at' | 'duration_ms' | 'status'
  >;
  predictor: PredictorAdapter;
  pipeline: LimitedRecommendationPipeline;
  trace_id: string;
}

export interface StabilityRunOutput {
  report: StabilityReport;
  per_case_results: Array<{
    case_id: string;
    case_index: number;
    category: string | null;
    passed: boolean;
    metrics: StabilityCaseResult['metrics'];
    runs_n: number;
    failure_reason: string | null;
    duration_ms: number;
  }>;
}

const DEFAULT_TOLERANCE: Required<StabilityTolerance> = {
  min_pairwise_cosine: 0.97,
  max_cv: 0.1,
};

export async function runStability(input: StabilityRunInput): Promise<StabilityRunOutput> {
  const startedAt = Date.now();
  const tol: Required<StabilityTolerance> = { ...DEFAULT_TOLERANCE, ...input.tolerance };
  const caseResults: StabilityCaseResult[] = [];
  const perCase: StabilityRunOutput['per_case_results'] = [];

  /* Aggregate buckets. */
  const cosines: number[] = [];
  const allCVs: number[] = [];
  let maxCv = 0;
  const byMetric = new Map<string, number[]>();

  for (let i = 0; i < input.cases.length; i += 1) {
    const c = input.cases[i] as StabilityCase;
    const caseStarted = Date.now();
    const runs = Math.max(2, c.runs ?? input.default_runs);
    const caseTol: Required<StabilityTolerance> = { ...tol, ...(c.tolerance ?? {}) };

    let metrics: StabilityCaseResult['metrics'] = {
      pairwise_cosine_avg: 1,
      pairwise_cosine_min: 1,
      cv_avg: 0,
      max_cv: 0,
    };
    let failure: string | null = null;

    try {
      if (c.mode === 'predict') {
        const result = await runStabilityPredict(c, runs, input.predictor, input.trace_id);
        metrics = result;
        for (const cv of Object.values(result.per_metric_cv ?? {})) {
          allCVs.push(cv);
          if (cv > maxCv) maxCv = cv;
        }
        for (const [m, cv] of Object.entries(result.per_metric_cv ?? {})) {
          const list = byMetric.get(m) ?? [];
          list.push(cv);
          byMetric.set(m, list);
        }
        cosines.push(result.pairwise_cosine_avg);
      } else {
        const result = await runStabilityRecommend(c, runs, input.pipeline);
        metrics = result;
        cosines.push(result.pairwise_cosine_avg);
        allCVs.push(result.cv_avg);
        if (result.max_cv > maxCv) maxCv = result.max_cv;
      }
    } catch (err) {
      failure = (err as Error).message;
    }

    const passed =
      !failure &&
      metrics.pairwise_cosine_min >= caseTol.min_pairwise_cosine &&
      metrics.max_cv <= caseTol.max_cv;
    if (!passed && !failure) {
      const reasons: string[] = [];
      if (metrics.pairwise_cosine_min < caseTol.min_pairwise_cosine) {
        reasons.push(
          `pairwise_cosine_min ${metrics.pairwise_cosine_min.toFixed(3)} < ${caseTol.min_pairwise_cosine}`
        );
      }
      if (metrics.max_cv > caseTol.max_cv) {
        reasons.push(`max_cv ${metrics.max_cv.toFixed(3)} > ${caseTol.max_cv}`);
      }
      failure = reasons.join('; ') || 'stability thresholds not met';
    }

    caseResults.push({
      case_id: c.id,
      category: c.category ?? null,
      passed,
      runs_n: runs,
      metrics,
      failure_reason: passed ? null : failure,
    });
    perCase.push({
      case_id: c.id,
      case_index: i,
      category: c.category ?? null,
      passed,
      metrics,
      runs_n: runs,
      failure_reason: passed ? null : failure,
      duration_ms: Date.now() - caseStarted,
    });
  }

  const totals = {
    cases_total: caseResults.length,
    cases_passed: caseResults.filter((r) => r.passed).length,
    cases_failed: caseResults.filter((r) => !r.passed).length,
    pass_rate: 0,
  };
  totals.pass_rate = round4(passRate(totals.cases_passed, totals.cases_total));

  const overall: StabilityAggregate = {
    avg_pairwise_cosine: round4(
      cosines.length === 0 ? 1 : cosines.reduce((s, v) => s + v, 0) / cosines.length
    ),
    avg_cv: round4(allCVs.length === 0 ? 0 : allCVs.reduce((s, v) => s + v, 0) / allCVs.length),
    max_cv: round4(maxCv),
    stability_rate: totals.pass_rate,
  };

  const byMetricReport: StabilityReport['by_metric'] = [...byMetric.entries()].map(
    ([metric, cvs]) => ({
      metric,
      n_cases: cvs.length,
      mean_cv: round4(cvs.reduce((s, v) => s + v, 0) / cvs.length),
      max_cv: round4(Math.max(...cvs)),
    })
  );

  const completedAt = new Date().toISOString();
  const report: StabilityReport = {
    ...input.envelope,
    test_type: 'stability',
    status:
      totals.cases_failed === 0 ? 'succeeded' : totals.cases_passed === 0 ? 'failed' : 'partial',
    completed_at: completedAt,
    duration_ms: Date.now() - startedAt,
    totals,
    overall_metrics: overall,
    by_metric: byMetricReport,
    case_results: caseResults,
    generated_at: completedAt,
  };
  return { report, per_case_results: perCase };
}

// ─── helpers ───────────────────────────────────────────────────────────────

async function runStabilityPredict(
  c: StabilityCase,
  runs: number,
  predictor: PredictorAdapter,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _traceId: string
): Promise<StabilityCaseResult['metrics']> {
  const payload = c.payload as {
    product_category?: string;
    bom_items: Array<{ material_code: string; material_name: string; ratio: number; role: string }>;
    target_metrics?: string[];
  };
  const allRuns: Array<Record<string, number>> = [];
  for (let i = 0; i < runs; i += 1) {
    const out = await predictor.predict({
      product_category: payload.product_category ?? 'unknown',
      bom_items: payload.bom_items,
      ...(payload.target_metrics ? { target_metrics: payload.target_metrics } : {}),
    });
    const map: Record<string, number> = {};
    for (const m of out.metrics) {
      if (Number.isFinite(m.predicted_value)) map[m.name] = m.predicted_value;
    }
    allRuns.push(map);
  }
  const metricNames = Array.from(new Set(allRuns.flatMap((r) => Object.keys(r))));
  const vectors = allRuns.map((r) => metricNames.map((m) => r[m] ?? 0));
  const cos = pairwiseCosine(vectors);
  const perMetricCv: Record<string, number> = {};
  let cvSum = 0;
  let maxLocalCv = 0;
  for (const m of metricNames) {
    const series = allRuns.map((r) => r[m] ?? NaN);
    const cv = coefficientOfVariation(series);
    perMetricCv[m] = round4(cv);
    cvSum += cv;
    if (cv > maxLocalCv) maxLocalCv = cv;
  }
  return {
    pairwise_cosine_avg: round4(cos.avg),
    pairwise_cosine_min: round4(cos.min),
    cv_avg: round4(metricNames.length === 0 ? 0 : cvSum / metricNames.length),
    max_cv: round4(maxLocalCv),
    per_metric_cv: perMetricCv,
  };
}

async function runStabilityRecommend(
  c: StabilityCase,
  runs: number,
  pipeline: LimitedRecommendationPipeline
): Promise<StabilityCaseResult['metrics']> {
  const payload = c.payload as {
    request: import('../../recommendation/types.js').GenerateRequest;
    strategy?: import('../../recommendation/types.js').RecommendationStrategy;
  };
  const seedBase = (payload.request.random_seed ?? 1234) >>> 0;
  const candidateLists: string[][] = [];
  const costs: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const rng = makeRng(seedBase + i);
    const result = await pipeline.run({
      request: { ...payload.request, random_seed: seedBase + i },
      strategy: payload.strategy ?? 'cost_priority',
      rng,
    });
    const ids = result.candidates.map((cand) =>
      cand.bom
        .map((b) => b.material_code)
        .sort()
        .join('|')
    );
    candidateLists.push(ids);
    if (
      result.candidates[0]?.estimated_cost !== undefined &&
      result.candidates[0]?.estimated_cost !== null
    ) {
      costs.push(result.candidates[0].estimated_cost);
    }
  }
  /* Convert candidate-list overlap into an averaged Jaccard similarity. */
  let pairSum = 0;
  let pairCount = 0;
  let pairMin = 1;
  for (let i = 0; i < candidateLists.length; i += 1) {
    for (let j = i + 1; j < candidateLists.length; j += 1) {
      const s = jaccard(candidateLists[i] as string[], candidateLists[j] as string[]);
      pairSum += s;
      pairCount += 1;
      if (s < pairMin) pairMin = s;
    }
  }
  const cv = coefficientOfVariation(costs);
  return {
    pairwise_cosine_avg: round4(pairCount === 0 ? 1 : pairSum / pairCount),
    pairwise_cosine_min: round4(pairCount === 0 ? 1 : pairMin),
    cv_avg: round4(cv),
    max_cv: round4(cv),
  };
}

function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    nextInt: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo)),
    nextFloat: (lo: number, hi: number) => lo + next() * (hi - lo),
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)] as T,
    shuffle: <T>(items: readonly T[]) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j] as T, out[i] as T];
      }
      return out;
    },
  };
}
