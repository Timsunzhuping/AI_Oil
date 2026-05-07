import { describe, it, expect } from 'vitest';
import { runForward } from '../../../src/modules/evaluation/runners/forward-runner.js';
import { runInverse } from '../../../src/modules/evaluation/runners/inverse-runner.js';
import { runStability } from '../../../src/modules/evaluation/runners/stability-runner.js';
import type {
  ForwardCase,
  InverseCase,
  ReportEnvelopeBase,
  StabilityCase,
} from '../../../src/modules/evaluation/types.js';
import { staticPipeline, staticPredictor } from './_fakes.js';

const ENVELOPE: Omit<
  ReportEnvelopeBase,
  'totals' | 'generated_at' | 'completed_at' | 'duration_ms' | 'status'
> = {
  run_id: 'r-1',
  code: 'AR-2026-000001',
  test_set_id: 't-1',
  test_type: 'forward',
  model: { code: 'forward-predictor', version: 'fake-v1', mode: 'mock' },
  started_at: '2026-05-07T00:00:00Z',
  trace_id: 'trace-1',
};

const BOM = [
  { material_code: 'PAO-6', material_name: 'PAO-6', role: 'base_oil', ratio: 0.42 },
  { material_code: 'GIII-4cSt', material_name: 'Group III 4cSt', role: 'base_oil', ratio: 0.38 },
  { material_code: 'OCP', material_name: 'OCP', role: 'vii', ratio: 0.085 },
  { material_code: 'PKG-A', material_name: 'PKG-A', role: 'detergent', ratio: 0.115 },
];

// ─── Forward runner ───────────────────────────────────────────────────────

describe('runForward', () => {
  it('passes cases when predictor matches expected within tolerance', async () => {
    const cases: ForwardCase[] = [
      { id: 'c-1', category: 'A', bom: BOM, expected_metrics: { KV_100C: 11, VI: 165 } },
      { id: 'c-2', category: 'A', bom: BOM, expected_metrics: { KV_100C: 11.05, VI: 164 } },
    ];
    const r = await runForward({
      cases,
      tolerance: { max_relative_error: 0.1, min_metric_pass_rate: 0.5 },
      envelope: ENVELOPE,
      predictor: staticPredictor({ metrics: { KV_100C: 11, VI: 165 } }),
      trace_id: 'trace-1',
    });
    expect(r.report.totals.cases_passed).toBe(2);
    expect(r.report.totals.pass_rate).toBeCloseTo(1, 5);
    expect(r.report.overall_metrics.hit_rate).toBeGreaterThan(0.9);
    expect(r.report.by_metric.find((m) => m.metric === 'KV_100C')).toBeDefined();
    expect(r.report.matrix.length).toBeGreaterThan(0);
    expect(r.report.status).toBe('succeeded');
  });

  it('marks cases failed when relative error exceeds tolerance', async () => {
    const cases: ForwardCase[] = [
      { id: 'c-bad', category: 'A', bom: BOM, expected_metrics: { KV_100C: 100 } },
    ];
    const r = await runForward({
      cases,
      tolerance: { max_relative_error: 0.05, min_metric_pass_rate: 1 },
      envelope: ENVELOPE,
      predictor: staticPredictor({ metrics: { KV_100C: 50 } }),
      trace_id: 'trace-1',
    });
    expect(r.report.totals.cases_failed).toBe(1);
    expect(r.report.case_results[0]!.passed).toBe(false);
    expect(r.report.case_results[0]!.failure_reason).toMatch(/hit_rate/);
    expect(r.report.status).toBe('failed');
  });

  it('captures predictor failures per-case', async () => {
    const cases: ForwardCase[] = [{ id: 'c-1', bom: BOM, expected_metrics: { KV_100C: 11 } }];
    const r = await runForward({
      cases,
      tolerance: {},
      envelope: ENVELOPE,
      predictor: staticPredictor({ throws: true }),
      trace_id: 'trace-1',
    });
    expect(r.report.case_results[0]!.passed).toBe(false);
    expect(r.report.case_results[0]!.failure_reason).toMatch(/predictor failure/);
  });

  it('builds category × metric matrix with n counts', async () => {
    const cases: ForwardCase[] = [
      { id: 'c-1', category: 'A', bom: BOM, expected_metrics: { KV_100C: 11 } },
      { id: 'c-2', category: 'B', bom: BOM, expected_metrics: { KV_100C: 11, VI: 165 } },
    ];
    const r = await runForward({
      cases,
      tolerance: { max_relative_error: 0.5 },
      envelope: ENVELOPE,
      predictor: staticPredictor({ metrics: { KV_100C: 11, VI: 165 } }),
      trace_id: 'trace-1',
    });
    expect(r.report.matrix.find((m) => m.category === 'A' && m.metric === 'KV_100C')?.n).toBe(1);
    expect(r.report.matrix.find((m) => m.category === 'B' && m.metric === 'VI')?.n).toBe(1);
  });
});

// ─── Inverse runner ───────────────────────────────────────────────────────

describe('runInverse', () => {
  function buildCases(): InverseCase[] {
    return [
      {
        id: 'inv-1',
        category: 'engine_oil_pcmo',
        request: {
          product_category: 'engine_oil_pcmo',
          target_metrics: [{ name: 'KV_100C', target: 11 }],
          cost_limit: 30,
          n_candidates: 3,
          random_seed: 1,
        },
        expectations: {
          min_passed_candidates: 1,
          top1_min_confidence: 0.5,
          no_critical_risks_top: 1,
        },
      },
    ];
  }

  it('passes when expectations are met', async () => {
    const r = await runInverse({
      cases: buildCases(),
      envelope: { ...ENVELOPE, test_type: 'inverse' },
      pipeline: staticPipeline({
        candidates: [
          { codes: ['PAO-6', 'GIII-4cSt'], cost: 18, confidence: 0.85, passed: true, risks: [] },
        ],
      }),
      trace_id: 't',
    });
    expect(r.report.totals.cases_passed).toBe(1);
    expect(r.report.overall_metrics.feasibility_rate).toBe(1);
    expect(r.report.overall_metrics.top1_feasibility_rate).toBe(1);
  });

  it('fails when must-have material is missing', async () => {
    const cases: InverseCase[] = [
      {
        id: 'inv-2',
        request: {
          product_category: 'engine_oil_pcmo',
          target_metrics: [{ name: 'KV_100C' }],
          n_candidates: 1,
          random_seed: 1,
        },
        expectations: { min_passed_candidates: 1, top1_must_have_materials: ['PAO-6'] },
      },
    ];
    const r = await runInverse({
      cases,
      envelope: { ...ENVELOPE, test_type: 'inverse' },
      pipeline: staticPipeline({ candidates: [{ codes: ['GIII-4cSt'], cost: 14, passed: true }] }),
      trace_id: 't',
    });
    expect(r.report.case_results[0]!.passed).toBe(false);
    expect(r.report.case_results[0]!.failure_reason).toMatch(/missing required materials/);
  });

  it('fails when top1 cost exceeds ceiling', async () => {
    const cases: InverseCase[] = [
      {
        id: 'inv-3',
        request: { product_category: 'p', target_metrics: [{ name: 'KV_100C' }], n_candidates: 1 },
        expectations: { top1_max_cost: 10 },
      },
    ];
    const r = await runInverse({
      cases,
      envelope: { ...ENVELOPE, test_type: 'inverse' },
      pipeline: staticPipeline({ candidates: [{ codes: ['X'], cost: 25, passed: true }] }),
      trace_id: 't',
    });
    expect(r.report.case_results[0]!.failure_reason).toMatch(/cost 25 exceeds 10/);
  });

  it('fails when critical risks are present', async () => {
    const cases: InverseCase[] = [
      {
        id: 'inv-4',
        request: { product_category: 'p', target_metrics: [{ name: 'KV_100C' }], n_candidates: 1 },
        expectations: { no_critical_risks_top: 1 },
      },
    ];
    const r = await runInverse({
      cases,
      envelope: { ...ENVELOPE, test_type: 'inverse' },
      pipeline: staticPipeline({
        candidates: [
          {
            codes: ['X'],
            passed: true,
            risks: [{ level: 'critical', code: 'SPEC_FAIL', message: 'oops' }],
          },
        ],
      }),
      trace_id: 't',
    });
    expect(r.report.case_results[0]!.passed).toBe(false);
  });

  it('captures pipeline failures per-case', async () => {
    const r = await runInverse({
      cases: buildCases(),
      envelope: { ...ENVELOPE, test_type: 'inverse' },
      pipeline: staticPipeline({ throws: true }),
      trace_id: 't',
    });
    expect(r.report.case_results[0]!.passed).toBe(false);
    expect(r.report.case_results[0]!.failure_reason).toMatch(/pipeline failure/);
  });
});

// ─── Stability runner ─────────────────────────────────────────────────────

describe('runStability', () => {
  it('predict mode is stable when predictor is deterministic', async () => {
    const cases: StabilityCase[] = [
      {
        id: 'stab-1',
        mode: 'predict',
        runs: 5,
        payload: { product_category: 'p', bom_items: BOM, target_metrics: ['KV_100C', 'VI'] },
      },
    ];
    const r = await runStability({
      cases,
      tolerance: { min_pairwise_cosine: 0.95, max_cv: 0.05 },
      default_runs: 5,
      envelope: { ...ENVELOPE, test_type: 'stability' },
      predictor: staticPredictor({ metrics: { KV_100C: 11, VI: 165 } }),
      pipeline: staticPipeline(),
      trace_id: 't',
    });
    expect(r.report.totals.cases_passed).toBe(1);
    expect(r.report.overall_metrics.stability_rate).toBe(1);
    expect(r.report.case_results[0]!.metrics.pairwise_cosine_avg).toBeGreaterThan(0.99);
    expect(r.report.case_results[0]!.metrics.max_cv).toBeLessThan(0.001);
  });

  it('recommend mode is stable when pipeline returns same set', async () => {
    const cases: StabilityCase[] = [
      {
        id: 'stab-rec-1',
        mode: 'recommend',
        runs: 4,
        payload: {
          request: {
            product_category: 'p',
            target_metrics: [{ name: 'KV_100C' }],
            n_candidates: 3,
            random_seed: 1,
          },
          strategy: 'cost_priority',
        },
      },
    ];
    const r = await runStability({
      cases,
      tolerance: { min_pairwise_cosine: 0.9, max_cv: 0.01 },
      default_runs: 4,
      envelope: { ...ENVELOPE, test_type: 'stability' },
      predictor: staticPredictor(),
      pipeline: staticPipeline({
        candidates: [{ codes: ['PAO-6', 'GIII-4cSt'], cost: 18, passed: true }],
      }),
      trace_id: 't',
    });
    expect(r.report.totals.cases_passed).toBe(1);
    expect(r.report.case_results[0]!.metrics.pairwise_cosine_avg).toBe(1);
  });

  it('emits per-metric CV in predict mode', async () => {
    const cases: StabilityCase[] = [
      {
        id: 's',
        mode: 'predict',
        runs: 3,
        payload: { product_category: 'p', bom_items: BOM, target_metrics: ['KV_100C'] },
      },
    ];
    const r = await runStability({
      cases,
      tolerance: {},
      default_runs: 3,
      envelope: { ...ENVELOPE, test_type: 'stability' },
      predictor: staticPredictor({ metrics: { KV_100C: 11 } }),
      pipeline: staticPipeline(),
      trace_id: 't',
    });
    expect(r.report.case_results[0]!.metrics.per_metric_cv).toEqual({ KV_100C: 0 });
    expect(r.report.by_metric.find((m) => m.metric === 'KV_100C')?.n_cases).toBe(1);
  });
});
