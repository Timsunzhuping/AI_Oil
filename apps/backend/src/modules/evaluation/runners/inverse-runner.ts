/**
 * Inverse-recommendation acceptance runner.
 *
 *   for each test case:
 *     – call recommendation pipeline directly (NOT the HTTP endpoint, no DB
 *       writes — we only want the in-process candidate output)
 *     – check expectations: ≥N candidates passed filter, top-1 has the
 *       must-have materials, top-1 cost ≤ ceiling, top-1 confidence ≥ floor,
 *       no critical risks in the top-K
 *     – aggregate feasibility-rate / top-1 feasibility-rate / averages
 */
import type { LimitedRecommendationPipeline } from './pipeline-shape.js';
import { passRate, round4 } from '../metrics.js';
import type {
  InverseAggregate,
  InverseCase,
  InverseCaseResult,
  InverseReport,
  ReportEnvelopeBase,
} from '../types.js';

export interface InverseRunInput {
  cases: InverseCase[];
  envelope: Omit<
    ReportEnvelopeBase,
    'totals' | 'generated_at' | 'completed_at' | 'duration_ms' | 'status'
  >;
  pipeline: LimitedRecommendationPipeline;
  trace_id: string;
}

export interface InverseRunOutput {
  report: InverseReport;
  per_case_results: Array<{
    case_id: string;
    case_index: number;
    category: string | null;
    passed: boolean;
    metrics: InverseCaseResult['metrics'];
    expectations: InverseCase['expectations'];
    failure_reason: string | null;
    duration_ms: number;
  }>;
}

export async function runInverse(input: InverseRunInput): Promise<InverseRunOutput> {
  const startedAt = Date.now();
  const caseResults: InverseCaseResult[] = [];
  const perCase: InverseRunOutput['per_case_results'] = [];

  type Bucket = {
    n: number;
    passed: number;
    passed_candidates: number[];
    top1_cost: number[];
    top1_conf: number[];
    feasible: number;
    top1_feasible: number;
  };
  const byCategory = new Map<string, Bucket>();

  for (let i = 0; i < input.cases.length; i += 1) {
    const c = input.cases[i] as InverseCase;
    const caseStarted = Date.now();
    let failure: string | null = null;
    let metrics: InverseCaseResult['metrics'] = {
      passed_candidates: 0,
      top1_cost: null,
      top1_confidence: 0,
      top1_must_have_satisfied: true,
      top1_no_critical_risks: true,
    };

    try {
      const strategy =
        c.request.base_bom && c.request.replacement_pool
          ? 'material_replacement'
          : c.request.cost_limit !== undefined
            ? 'cost_priority'
            : 'new_product';
      const result = await input.pipeline.run({
        request: c.request as never,
        strategy,
        rng: makeStaticRng(c.request.random_seed ?? 42),
      });

      const passedCandidates = result.candidates.filter((cand) => cand.passed_filter).length;
      const top1 = result.candidates[0];
      const must = c.expectations.top1_must_have_materials ?? [];
      const top1Codes = new Set((top1?.bom ?? []).map((b) => b.material_code));
      const mustHaveOk = must.every((m) => top1Codes.has(m));

      const topK = c.expectations.no_critical_risks_top ?? 1;
      const noCritical = result.candidates
        .slice(0, topK)
        .every((cand) => !(cand.risk_warnings ?? []).some((r) => r.level === 'critical'));

      metrics = {
        passed_candidates: passedCandidates,
        top1_cost: top1?.estimated_cost ?? null,
        top1_confidence: top1?.confidence ?? 0,
        top1_must_have_satisfied: mustHaveOk,
        top1_no_critical_risks: noCritical,
      };
    } catch (err) {
      failure = (err as Error).message;
    }

    const passed = (() => {
      if (failure) return false;
      const exp = c.expectations;
      if (exp.min_passed_candidates && metrics.passed_candidates < exp.min_passed_candidates)
        return false;
      if (
        exp.top1_max_cost !== undefined &&
        metrics.top1_cost !== null &&
        metrics.top1_cost > exp.top1_max_cost
      )
        return false;
      if (
        exp.top1_min_confidence !== undefined &&
        metrics.top1_confidence < exp.top1_min_confidence
      )
        return false;
      if (exp.top1_must_have_materials?.length && !metrics.top1_must_have_satisfied) return false;
      if (exp.no_critical_risks_top !== undefined && !metrics.top1_no_critical_risks) return false;
      return true;
    })();
    if (!passed && !failure) failure = describeFailure(c.expectations, metrics);

    caseResults.push({
      case_id: c.id,
      category: c.category ?? null,
      passed,
      metrics,
      failure_reason: failure,
    });
    perCase.push({
      case_id: c.id,
      case_index: i,
      category: c.category ?? null,
      passed,
      metrics,
      expectations: c.expectations,
      failure_reason: failure,
      duration_ms: Date.now() - caseStarted,
    });

    /* Bucket for category aggregates. */
    const catKey = c.category ?? '_';
    const bucket = byCategory.get(catKey) ?? {
      n: 0,
      passed: 0,
      passed_candidates: [],
      top1_cost: [],
      top1_conf: [],
      feasible: 0,
      top1_feasible: 0,
    };
    bucket.n += 1;
    if (passed) bucket.passed += 1;
    bucket.passed_candidates.push(metrics.passed_candidates);
    if (metrics.top1_cost !== null) bucket.top1_cost.push(metrics.top1_cost);
    bucket.top1_conf.push(metrics.top1_confidence);
    if (metrics.passed_candidates >= (c.expectations.min_passed_candidates ?? 1))
      bucket.feasible += 1;
    if (passed) bucket.top1_feasible += 1;
    byCategory.set(catKey, bucket);
  }

  const totals = {
    cases_total: caseResults.length,
    cases_passed: caseResults.filter((r) => r.passed).length,
    cases_failed: caseResults.filter((r) => !r.passed).length,
    pass_rate: 0,
  };
  totals.pass_rate = round4(passRate(totals.cases_passed, totals.cases_total));

  const overall = aggregateOverall(caseResults, input.cases);

  const byCategoryReport: InverseReport['by_category'] = [...byCategory.entries()].map(
    ([cat, b]) => ({
      category: cat,
      n: b.n,
      passed: b.passed,
      feasibility_rate: round4(b.feasible / Math.max(1, b.n)),
      top1_feasibility_rate: round4(b.top1_feasible / Math.max(1, b.n)),
      avg_passed_candidates: round4(avg(b.passed_candidates)),
      avg_top1_cost: b.top1_cost.length === 0 ? null : round4(avg(b.top1_cost)),
      avg_top1_confidence: round4(avg(b.top1_conf)),
    })
  );

  const completedAt = new Date().toISOString();
  const report: InverseReport = {
    ...input.envelope,
    test_type: 'inverse',
    status:
      totals.cases_failed === 0 ? 'succeeded' : totals.cases_passed === 0 ? 'failed' : 'partial',
    completed_at: completedAt,
    duration_ms: Date.now() - startedAt,
    totals,
    overall_metrics: overall,
    by_category: byCategoryReport,
    case_results: caseResults,
    generated_at: completedAt,
  };

  return { report, per_case_results: perCase };
}

function aggregateOverall(results: InverseCaseResult[], cases: InverseCase[]): InverseAggregate {
  const total = results.length;
  if (total === 0) {
    return {
      feasibility_rate: 0,
      top1_feasibility_rate: 0,
      avg_passed_candidates: 0,
      avg_top1_cost: null,
      avg_top1_confidence: 0,
    };
  }
  let feasible = 0;
  let top1Feasible = 0;
  const passedCandidates: number[] = [];
  const top1Costs: number[] = [];
  const top1Conf: number[] = [];
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i] as InverseCaseResult;
    const c = cases[i] as InverseCase;
    if (r.metrics.passed_candidates >= (c.expectations.min_passed_candidates ?? 1)) feasible += 1;
    if (r.passed) top1Feasible += 1;
    passedCandidates.push(r.metrics.passed_candidates);
    if (r.metrics.top1_cost !== null) top1Costs.push(r.metrics.top1_cost);
    top1Conf.push(r.metrics.top1_confidence);
  }
  return {
    feasibility_rate: round4(feasible / total),
    top1_feasibility_rate: round4(top1Feasible / total),
    avg_passed_candidates: round4(avg(passedCandidates)),
    avg_top1_cost: top1Costs.length === 0 ? null : round4(avg(top1Costs)),
    avg_top1_confidence: round4(avg(top1Conf)),
  };
}

function describeFailure(
  exp: InverseCase['expectations'],
  m: InverseCaseResult['metrics']
): string {
  const parts: string[] = [];
  if (exp.min_passed_candidates && m.passed_candidates < exp.min_passed_candidates) {
    parts.push(
      `only ${m.passed_candidates} candidates passed (need ≥${exp.min_passed_candidates})`
    );
  }
  if (exp.top1_max_cost !== undefined && m.top1_cost !== null && m.top1_cost > exp.top1_max_cost) {
    parts.push(`top1 cost ${m.top1_cost} exceeds ${exp.top1_max_cost}`);
  }
  if (exp.top1_min_confidence !== undefined && m.top1_confidence < exp.top1_min_confidence) {
    parts.push(`top1 confidence ${m.top1_confidence.toFixed(3)} below ${exp.top1_min_confidence}`);
  }
  if (exp.top1_must_have_materials?.length && !m.top1_must_have_satisfied) {
    parts.push(`top1 missing required materials [${exp.top1_must_have_materials.join(', ')}]`);
  }
  if (exp.no_critical_risks_top !== undefined && !m.top1_no_critical_risks) {
    parts.push(`critical risks present in top-${exp.no_critical_risks_top}`);
  }
  return parts.length === 0 ? 'unspecified failure' : parts.join('; ');
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

/** Static seeded RNG used to feed the recommendation pipeline. */
function makeStaticRng(seed: number) {
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
