/**
 * Forward-prediction acceptance runner.
 *
 *   for each test case:
 *     – call PredictorAdapter.predict()
 *     – compute per-metric MAPE / MAE / hit
 *     – aggregate across (category × metric) and overall
 *     – mark case PASS when min_metric_pass_rate threshold is met
 */
import type { PredictorAdapter } from '../../prediction/adapters/types.js';
import { hitRate, isHit, mae, mape, passRate, rmse, round4 } from '../metrics.js';
import type {
  ForwardAggregate,
  ForwardCase,
  ForwardCaseResult,
  ForwardReport,
  ReportEnvelopeBase,
  Tolerance,
} from '../types.js';

export interface ForwardRunInput {
  cases: ForwardCase[];
  tolerance: Tolerance;
  envelope: Omit<
    ReportEnvelopeBase,
    'totals' | 'generated_at' | 'completed_at' | 'duration_ms' | 'status'
  >;
  predictor: PredictorAdapter;
  /** Trace id propagated to the predictor adapter. */
  trace_id: string;
}

export interface ForwardRunOutput {
  report: ForwardReport;
  per_case_results: Array<{
    case_id: string;
    case_index: number;
    category: string | null;
    passed: boolean;
    metrics: ForwardAggregate;
    expected: Record<string, number>;
    predicted: Record<string, number | null>;
    failure_reason: string | null;
    duration_ms: number;
  }>;
}

const DEFAULT_TOLERANCE: Required<Tolerance> = {
  max_relative_error: 0.1,
  max_absolute_error: 0,
  min_metric_pass_rate: 0.8,
};

export async function runForward(input: ForwardRunInput): Promise<ForwardRunOutput> {
  const startedAt = Date.now();
  const tol: Required<Tolerance> = { ...DEFAULT_TOLERANCE, ...input.tolerance };

  const caseResults: ForwardCaseResult[] = [];
  const perCase: ForwardRunOutput['per_case_results'] = [];

  /* Buckets for aggregation. */
  const allPairs: Array<{ expected: number; predicted: number | null }> = [];
  const byMetric = new Map<string, Array<{ expected: number; predicted: number | null }>>();
  const byCategory = new Map<
    string,
    { pairs: Array<{ expected: number; predicted: number | null }>; passed: number; n: number }
  >();
  const matrix = new Map<string, Array<{ expected: number; predicted: number | null }>>();

  for (let i = 0; i < input.cases.length; i += 1) {
    const c = input.cases[i] as ForwardCase;
    const caseStarted = Date.now();
    const caseTol: Required<Tolerance> = { ...tol, ...(c.tolerance ?? {}) };

    let predictedMap: Record<string, number | null> = {};
    let failureReason: string | null = null;

    try {
      const out = await input.predictor.predict({
        product_category: 'unknown',
        bom_items: c.bom,
        target_metrics: Object.keys(c.expected_metrics),
      });
      for (const m of out.metrics) {
        predictedMap[m.name] = Number.isFinite(m.predicted_value) ? m.predicted_value : null;
      }
    } catch (err) {
      failureReason = (err as Error).message;
      predictedMap = Object.fromEntries(Object.keys(c.expected_metrics).map((k) => [k, null]));
    }

    /* Per-metric pairs for this case. */
    const perMetric: ForwardCaseResult['per_metric'] = [];
    const casePairs: Array<{ expected: number; predicted: number | null }> = [];
    let metricHitCount = 0;
    const metricNames = Object.keys(c.expected_metrics);

    for (const metric of metricNames) {
      const expected = c.expected_metrics[metric] as number;
      const predicted = predictedMap[metric] ?? null;
      const hit = isHit(expected, predicted, {
        relative: caseTol.max_relative_error,
        absolute: caseTol.max_absolute_error,
      });
      if (hit) metricHitCount += 1;
      const absErr = predicted === null ? null : Math.abs(predicted - expected);
      const denom = Math.abs(expected);
      const relErr = predicted === null || denom < 1e-9 ? null : absErr! / denom;
      perMetric.push({
        metric,
        expected,
        predicted,
        abs_error: absErr === null ? null : round4(absErr),
        rel_error: relErr === null ? null : round4(relErr),
        hit,
      });
      const pair = { expected, predicted };
      casePairs.push(pair);
      allPairs.push(pair);
      const mList = byMetric.get(metric) ?? [];
      mList.push(pair);
      byMetric.set(metric, mList);

      const matrixKey = `${c.category ?? '_'}::${metric}`;
      const cell = matrix.get(matrixKey) ?? [];
      cell.push(pair);
      matrix.set(matrixKey, cell);
    }

    const caseAgg = aggregate(casePairs, caseTol);
    const caseHitRate = metricNames.length === 0 ? 1 : metricHitCount / metricNames.length;
    const passed = !failureReason && caseHitRate >= caseTol.min_metric_pass_rate;
    if (!passed && !failureReason) {
      failureReason = `hit_rate ${caseHitRate.toFixed(2)} below threshold ${caseTol.min_metric_pass_rate.toFixed(2)}`;
    }

    /* Update by-category bucket. */
    const catKey = c.category ?? '_';
    const catBucket = byCategory.get(catKey) ?? { pairs: [], passed: 0, n: 0 };
    catBucket.pairs.push(...casePairs);
    catBucket.n += 1;
    if (passed) catBucket.passed += 1;
    byCategory.set(catKey, catBucket);

    caseResults.push({
      case_id: c.id,
      category: c.category ?? null,
      passed,
      metrics: caseAgg,
      per_metric: perMetric,
      failure_reason: passed ? null : failureReason,
    });

    perCase.push({
      case_id: c.id,
      case_index: i,
      category: c.category ?? null,
      passed,
      metrics: caseAgg,
      expected: c.expected_metrics,
      predicted: predictedMap,
      failure_reason: passed ? null : failureReason,
      duration_ms: Date.now() - caseStarted,
    });
  }

  const completedAt = new Date().toISOString();
  const totals = {
    cases_total: caseResults.length,
    cases_passed: caseResults.filter((r) => r.passed).length,
    cases_failed: caseResults.filter((r) => !r.passed).length,
    pass_rate: 0,
  };
  totals.pass_rate = round4(passRate(totals.cases_passed, totals.cases_total));

  const overall = aggregate(allPairs, tol);

  const byCategoryReport: ForwardReport['by_category'] = [...byCategory.entries()].map(
    ([cat, bucket]) => ({
      category: cat,
      n: bucket.n,
      passed: bucket.passed,
      ...aggregate(bucket.pairs, tol),
    })
  );
  const byMetricReport: ForwardReport['by_metric'] = [...byMetric.entries()].map(
    ([metric, pairs]) => ({
      metric,
      n: pairs.length,
      ...aggregate(pairs, tol),
    })
  );
  const matrixReport: ForwardReport['matrix'] = [...matrix.entries()].map(([key, pairs]) => {
    const [category = '_', metric = ''] = key.split('::');
    return { category, metric, n: pairs.length, ...aggregate(pairs, tol) };
  });

  const report: ForwardReport = {
    ...input.envelope,
    test_type: 'forward',
    status:
      totals.cases_failed === 0 ? 'succeeded' : totals.cases_passed === 0 ? 'failed' : 'partial',
    completed_at: completedAt,
    duration_ms: Date.now() - startedAt,
    totals,
    overall_metrics: overall,
    by_category: byCategoryReport,
    by_metric: byMetricReport,
    matrix: matrixReport,
    case_results: caseResults,
    generated_at: completedAt,
  };

  return { report, per_case_results: perCase };
}

function aggregate(
  pairs: Array<{ expected: number; predicted: number | null }>,
  tol: Required<Tolerance>
): ForwardAggregate {
  return {
    mape: round4(mape(pairs)),
    mae: round4(mae(pairs)),
    rmse: round4(rmse(pairs)),
    hit_rate: round4(
      hitRate(pairs, { relative: tol.max_relative_error, absolute: tol.max_absolute_error })
    ),
  };
}
