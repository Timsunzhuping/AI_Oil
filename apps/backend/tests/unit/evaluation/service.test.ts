import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { EvaluationService } from '../../../src/modules/evaluation/service.js';
import type {
  ForwardCase,
  InverseCase,
  RunRequest,
  StabilityCase,
  TestSetInput,
} from '../../../src/modules/evaluation/types.js';
import { FakeEvaluationRepository, staticPipeline, staticPredictor } from './_fakes.js';

const logger = pino({ level: 'silent' });

const BOM = [
  { material_code: 'PAO-6', material_name: 'PAO-6', role: 'base_oil', ratio: 0.6 },
  { material_code: 'PKG-A', material_name: 'PKG-A', role: 'detergent', ratio: 0.4 },
];

function buildService(
  opts: {
    predictor?: ReturnType<typeof staticPredictor>;
    pipeline?: ReturnType<typeof staticPipeline>;
  } = {}
) {
  const repository = new FakeEvaluationRepository();
  const service = new EvaluationService({
    repository: repository as unknown as ConstructorParameters<
      typeof EvaluationService
    >[0]['repository'],
    predictor: opts.predictor ?? staticPredictor({ metrics: { KV_100C: 11, VI: 165 } }),
    pipeline: opts.pipeline ?? staticPipeline(),
    logger,
  });
  return { service, repository };
}

describe('EvaluationService — test sets', () => {
  it('creates a test set and assigns a generated code when none is provided', async () => {
    const { service, repository } = buildService();
    const input: TestSetInput = {
      name: 'forward smoke',
      test_type: 'forward',
      cases: [{ id: 'c-1', bom: BOM, expected_metrics: { KV_100C: 11 } } as ForwardCase],
    };
    const row = await service.createTestSet(input, { trace_id: 't', user_id: 'u-1' });
    expect(row.code).toMatch(/^TS-\d{4}-\d{4}$/);
    expect(repository.testSets.size).toBe(1);
  });

  it('rejects empty cases', async () => {
    const { service } = buildService();
    await expect(
      service.createTestSet(
        { name: 'x', test_type: 'forward', cases: [] },
        { trace_id: null, user_id: null }
      )
    ).rejects.toThrow(/at least one/);
  });

  it('lists + retrieves test sets and 404s on unknown id', async () => {
    const { service } = buildService();
    const row = await service.createTestSet(
      {
        name: 'a',
        test_type: 'forward',
        cases: [{ id: 'x', bom: BOM, expected_metrics: { KV_100C: 1 } } as ForwardCase],
      },
      { trace_id: null, user_id: null }
    );
    const found = await service.getTestSet(row.id);
    expect(found.id).toBe(row.id);
    await expect(service.getTestSet('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      /Test set/
    );
    const list = await service.listTestSets({ page: 1, pageSize: 10 });
    expect(list.total).toBe(1);
  });
});

describe('EvaluationService — runAcceptance (forward)', () => {
  it('persists a succeeded run + per-case results', async () => {
    const { service, repository } = buildService();
    const set = await service.createTestSet(
      {
        name: 'fwd',
        test_type: 'forward',
        default_tolerance: { max_relative_error: 0.1, min_metric_pass_rate: 0.5 },
        cases: [
          {
            id: 'c-1',
            category: 'A',
            bom: BOM,
            expected_metrics: { KV_100C: 11, VI: 165 },
          } as ForwardCase,
          {
            id: 'c-2',
            category: 'B',
            bom: BOM,
            expected_metrics: { KV_100C: 11, VI: 165 },
          } as ForwardCase,
        ],
      },
      { trace_id: 't', user_id: 'u' }
    );
    const req: RunRequest = { test_set_id: set.id, trigger_type: 'manual' };
    const { run, results } = await service.runAcceptance(req, { trace_id: 't', user_id: 'u' });
    expect(run.status).toBe('succeeded');
    expect(run.cases_total).toBe(2);
    expect(run.cases_passed).toBe(2);
    expect(results.length).toBe(2);
    expect(repository.runs.size).toBe(1);
  });

  it('honours config.case_ids to filter cases', async () => {
    const { service } = buildService();
    const set = await service.createTestSet(
      {
        name: 'fwd-filter',
        test_type: 'forward',
        cases: [
          { id: 'a', bom: BOM, expected_metrics: { KV_100C: 11 } } as ForwardCase,
          { id: 'b', bom: BOM, expected_metrics: { KV_100C: 11 } } as ForwardCase,
          { id: 'c', bom: BOM, expected_metrics: { KV_100C: 11 } } as ForwardCase,
        ],
      },
      { trace_id: null, user_id: null }
    );
    const { run } = await service.runAcceptance(
      { test_set_id: set.id, config: { case_ids: ['a', 'c'] } },
      { trace_id: null, user_id: null }
    );
    expect(run.cases_total).toBe(2);
  });

  it('rejects when no cases match the config filter', async () => {
    const { service } = buildService();
    const set = await service.createTestSet(
      {
        name: 'fwd-empty',
        test_type: 'forward',
        cases: [{ id: 'a', bom: BOM, expected_metrics: { KV_100C: 11 } } as ForwardCase],
      },
      { trace_id: null, user_id: null }
    );
    await expect(
      service.runAcceptance(
        { test_set_id: set.id, config: { case_ids: ['nope'] } },
        { trace_id: null, user_id: null }
      )
    ).rejects.toThrow(/No cases match/);
  });

  it('marks run failed when tolerance is breached', async () => {
    const { service } = buildService({ predictor: staticPredictor({ metrics: { KV_100C: 1 } }) });
    const set = await service.createTestSet(
      {
        name: 'tight',
        test_type: 'forward',
        default_tolerance: { max_relative_error: 0.01, min_metric_pass_rate: 1 },
        cases: [{ id: 'c', bom: BOM, expected_metrics: { KV_100C: 100 } } as ForwardCase],
      },
      { trace_id: null, user_id: null }
    );
    const { run } = await service.runAcceptance(
      { test_set_id: set.id },
      { trace_id: null, user_id: null }
    );
    expect(run.status).toBe('failed');
    expect(run.cases_failed).toBe(1);
  });
});

describe('EvaluationService — runAcceptance (inverse + stability)', () => {
  it('runs inverse acceptance with pipeline candidates', async () => {
    const { service } = buildService({
      pipeline: staticPipeline({
        candidates: [{ codes: ['PAO-6', 'PKG-A'], cost: 18, confidence: 0.85, passed: true }],
      }),
    });
    const cases: InverseCase[] = [
      {
        id: 'inv-1',
        request: { product_category: 'p', target_metrics: [{ name: 'KV_100C' }], n_candidates: 1 },
        expectations: { min_passed_candidates: 1, top1_min_confidence: 0.5 },
      },
    ];
    const set = await service.createTestSet(
      { name: 'inv', test_type: 'inverse', cases },
      { trace_id: null, user_id: null }
    );
    const { run } = await service.runAcceptance(
      { test_set_id: set.id },
      { trace_id: null, user_id: null }
    );
    expect(run.status).toBe('succeeded');
  });

  it('runs stability acceptance with default_runs override', async () => {
    const cases: StabilityCase[] = [
      {
        id: 's-1',
        mode: 'predict',
        payload: { product_category: 'p', bom_items: BOM, target_metrics: ['KV_100C'] },
      },
    ];
    const { service } = buildService();
    const set = await service.createTestSet(
      { name: 'stab', test_type: 'stability', cases },
      { trace_id: null, user_id: null }
    );
    const { run } = await service.runAcceptance(
      {
        test_set_id: set.id,
        config: {
          default_runs: 3,
          stability_tolerance: { min_pairwise_cosine: 0.9, max_cv: 0.05 },
        },
      },
      { trace_id: null, user_id: null }
    );
    expect(run.status).toBe('succeeded');
    expect(run.cases_total).toBe(1);
  });
});

describe('EvaluationService — export', () => {
  let svc: ReturnType<typeof buildService>['service'];
  let runId: string;

  beforeEach(async () => {
    const built = buildService();
    svc = built.service;
    const set = await svc.createTestSet(
      {
        name: 'exp',
        test_type: 'forward',
        cases: [{ id: 'c-1', bom: BOM, expected_metrics: { KV_100C: 11 } } as ForwardCase],
      },
      { trace_id: null, user_id: null }
    );
    const { run } = await svc.runAcceptance(
      { test_set_id: set.id },
      { trace_id: null, user_id: null }
    );
    runId = run.id;
  });

  it('exports JSON with the expected envelope', async () => {
    const r = await svc.exportRun(runId, 'json');
    expect(r.content_type).toBe('application/json');
    expect(r.filename).toMatch(/\.report\.json$/);
    const parsed = JSON.parse(r.body);
    expect(parsed.test_type).toBe('forward');
    expect(parsed.totals.cases_total).toBe(1);
  });

  it('exports Markdown with a heading', async () => {
    const r = await svc.exportRun(runId, 'markdown');
    expect(r.content_type).toMatch(/markdown/);
    expect(r.body).toMatch(/^#/);
  });

  it('throws NotFound on unknown run id', async () => {
    await expect(svc.exportRun('00000000-0000-0000-0000-000000000000', 'json')).rejects.toThrow(
      /Acceptance run/
    );
  });
});
