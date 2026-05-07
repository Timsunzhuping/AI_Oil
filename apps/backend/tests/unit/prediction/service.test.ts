import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { MockPredictor } from '../../../src/modules/prediction/adapters/mock.js';
import { RealPredictorScaffold } from '../../../src/modules/prediction/adapters/real.js';
import { PredictionService, deriveRiskWarnings } from '../../../src/modules/prediction/service.js';
import { UpstreamError } from '../../../src/lib/errors.js';
import type {
  InsertPredictionLogInput,
  PredictionLogsRepository,
} from '../../../src/modules/prediction/repository.js';
import type {
  BatchPredictRequest,
  ExplainPredictRequest,
  PredictedMetric,
  SinglePredictRequest,
} from '../../../src/modules/prediction/types.js';

const TRACE = '11111111-2222-3333-4444-555555555555';
const logger = pino({ level: 'silent' });

class InMemoryRepo {
  rows: InsertPredictionLogInput[] = [];
  insert = vi.fn(async (row: InsertPredictionLogInput): Promise<{ id: string }> => {
    this.rows.push(row);
    return { id: 'log-' + this.rows.length };
  });
  insertBatch = vi.fn(async (rows: InsertPredictionLogInput[]): Promise<{ ids: string[] }> => {
    this.rows.push(...rows);
    return { ids: rows.map((_, i) => 'log-batch-' + i) };
  });
  findById = vi.fn();
  findByBatchId = vi.fn();
  listRecent = vi.fn();
}

function bom() {
  return [
    { material_code: 'PAO-6', material_name: 'PAO-6', ratio: 0.42, role: 'base_oil' },
    { material_code: 'GIII-4cSt', material_name: 'Group III 4cSt', ratio: 0.38, role: 'base_oil' },
    { material_code: 'OCP', material_name: 'OCP VII', ratio: 0.085, role: 'vii' },
    { material_code: 'PKG-A', material_name: 'Detergent pkg', ratio: 0.115, role: 'detergent' },
  ];
}

function singleReq(over: Partial<SinglePredictRequest> = {}): SinglePredictRequest {
  return {
    product_category: 'engine_oil_pcmo',
    formula_version_id: '00000000-0000-0000-0000-000000000abc',
    bom_items: bom(),
    ...over,
  };
}

function batchReq(over: Partial<BatchPredictRequest> = {}): BatchPredictRequest {
  return {
    product_category: 'engine_oil_pcmo',
    formulas: [
      { label: 'A', bom_items: bom() },
      { label: 'B', bom_items: bom().map((it, i) => (i === 0 ? { ...it, ratio: 0.5 } : it)) },
      { label: 'C', bom_items: bom() },
    ],
    target_metrics: ['KV_100C', 'VI'],
    concurrency: 2,
    ...over,
  };
}

function explainReq(over: Partial<ExplainPredictRequest> = {}): ExplainPredictRequest {
  return {
    product_category: 'engine_oil_pcmo',
    bom_items: bom(),
    metric: 'KV_100C',
    top_k: 4,
    ...over,
  };
}

function service(
  overrides: { adapter?: ReturnType<typeof newAdapter>; repo?: InMemoryRepo | null } = {}
) {
  const adapter = overrides.adapter ?? newAdapter();
  const repo = overrides.repo === null ? null : (overrides.repo ?? new InMemoryRepo());
  const svc = new PredictionService({
    adapter,
    repository: repo as unknown as PredictionLogsRepository | null,
    logger,
  });
  return { svc, adapter, repo };
}

function newAdapter() {
  return new MockPredictor();
}

// ─────────────────────────────────────────────────────────────────────────────

describe('PredictionService.getModelVersion', () => {
  it('mirrors the adapter info', () => {
    const { svc, adapter } = service();
    expect(svc.getModelVersion()).toEqual(adapter.info());
  });
});

describe('PredictionService.predictSingle', () => {
  it('returns metrics + risk_warnings + envelope fields, and writes one log row', async () => {
    const { svc, repo } = service();
    const out = await svc.predictSingle(singleReq(), { trace_id: TRACE, user_id: null });

    expect(out.metrics.length).toBeGreaterThan(0);
    expect(out.model_code).toBe('forward-predictor');
    expect(out.predictor_mode).toBe('mock');
    expect(out.trace_id).toBe(TRACE);
    expect(typeof out.duration_ms).toBe('number');

    expect(repo!.rows).toHaveLength(1);
    const row = repo!.rows[0]!;
    expect(row.request_type).toBe('single');
    expect(row.status).toBe('success');
    expect(row.predictor_mode).toBe('mock');
    expect(row.target_metrics).toEqual([]);
    expect(row.bom_items).toHaveLength(4);
    expect(row.batch_id).toBeNull();
  });

  it('persists FAILURE row and rethrows on adapter error', async () => {
    const adapter = new MockPredictor();
    // Force the adapter to throw
    adapter.predict = vi.fn(async () => {
      throw new Error('model crashed');
    }) as never;

    const { svc, repo } = service({ adapter });
    await expect(
      svc.predictSingle(singleReq(), { trace_id: TRACE, user_id: null })
    ).rejects.toThrow('model crashed');

    expect(repo!.rows).toHaveLength(1);
    expect(repo!.rows[0]!.status).toBe('failed');
    expect(repo!.rows[0]!.error_message).toBe('model crashed');
  });

  it('survives audit-log failures (logs warning, returns response)', async () => {
    const repo = new InMemoryRepo();
    repo.insert = vi.fn(async () => {
      throw new Error('db down');
    });
    const { svc } = service({ repo });
    const out = await svc.predictSingle(singleReq(), { trace_id: TRACE, user_id: null });
    expect(out.metrics.length).toBeGreaterThan(0);
  });

  it('skips persistence when repository is null', async () => {
    const { svc } = service({ repo: null });
    const out = await svc.predictSingle(singleReq(), { trace_id: TRACE, user_id: null });
    expect(out.metrics.length).toBeGreaterThan(0);
  });
});

describe('PredictionService.predictBatch', () => {
  it('processes all formulas in parallel and stamps a batch_id', async () => {
    const { svc, repo } = service();
    const out = await svc.predictBatch(batchReq(), { trace_id: TRACE, user_id: null });

    expect(out.results).toHaveLength(3);
    expect(out.counts).toEqual({ total: 3, success: 3, failed: 0 });
    expect(out.batch_id).toMatch(/[0-9a-f-]{36}/);

    expect(repo!.rows).toHaveLength(3);
    const ids = new Set(repo!.rows.map((r) => r.batch_id));
    expect(ids.size).toBe(1);
    expect(ids.has(out.batch_id)).toBe(true);
    // Indexes 0..2
    expect(repo!.rows.map((r) => r.batch_index).sort()).toEqual([0, 1, 2]);
  });

  it('isolates per-formula failures and reports them in `error`', async () => {
    const adapter = new MockPredictor();
    let call = 0;
    const original = adapter.predict.bind(adapter);
    adapter.predict = vi.fn(async (input) => {
      call += 1;
      if (call === 2) throw new Error('boom on 2nd');
      return original(input);
    }) as never;

    const { svc } = service({ adapter });
    const out = await svc.predictBatch(batchReq({ concurrency: 1 }), {
      trace_id: TRACE,
      user_id: null,
    });

    expect(out.counts.failed).toBe(1);
    expect(out.counts.success).toBe(2);
    const failed = out.results.find((r) => r.error);
    expect(failed?.error?.message).toBe('boom on 2nd');
  });

  it('honours target_metrics and forwards them to each formula', async () => {
    const { svc } = service();
    const out = await svc.predictBatch(batchReq({ target_metrics: ['KV_100C'] }), {
      trace_id: TRACE,
      user_id: null,
    });
    for (const r of out.results) {
      const names = r.metrics?.map((m) => m.name) ?? [];
      expect(names).toEqual(['KV_100C']);
    }
  });
});

describe('PredictionService.predictExplain', () => {
  it('returns explanations + metrics + writes one log row', async () => {
    const { svc, repo } = service();
    const out = await svc.predictExplain(explainReq(), { trace_id: TRACE, user_id: null });
    expect(out.explanations).toBeDefined();
    expect(out.explanations!.length).toBeGreaterThan(0);
    expect(out.metrics.length).toBeGreaterThan(0);

    expect(repo!.rows).toHaveLength(1);
    expect(repo!.rows[0]!.request_type).toBe('explain');
  });

  it('wraps adapter explain failures in UpstreamError', async () => {
    // RealPredictorScaffold throws UpstreamError on every call.
    const adapter = new RealPredictorScaffold({
      version: 'real-stub-1',
      supported_metrics: [],
    });
    const { svc, repo } = service({ adapter });
    await expect(
      svc.predictExplain(explainReq(), { trace_id: TRACE, user_id: null })
    ).rejects.toBeInstanceOf(UpstreamError);
    expect(repo!.rows[0]!.status).toBe('failed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('deriveRiskWarnings', () => {
  function metric(over: Partial<PredictedMetric>): PredictedMetric {
    return {
      name: 'KV_100C',
      display_name: '100℃ 黏度',
      unit: 'mm²/s',
      predicted_value: 11,
      spec_low: 9.3,
      spec_high: 12.5,
      in_spec: true,
      confidence: 0.85,
      ...over,
    };
  }

  it('emits SPEC_FAIL when in_spec === false', () => {
    const out = deriveRiskWarnings([metric({ in_spec: false, predicted_value: 13 })], {});
    expect(out.find((w) => w.code === 'SPEC_FAIL')).toBeDefined();
  });

  it('emits CLOSE_TO_SPEC when value is within 5 % of an edge', () => {
    const out = deriveRiskWarnings([metric({ predicted_value: 12.4, spec_high: 12.5 })], {});
    expect(out.find((w) => w.code === 'CLOSE_TO_SPEC')).toBeDefined();
  });

  it('emits LOW_CONFIDENCE when confidence < 0.6', () => {
    const out = deriveRiskWarnings([metric({ confidence: 0.4 })], {});
    expect(out.find((w) => w.code === 'LOW_CONFIDENCE')).toBeDefined();
  });

  it('emits NO_METRICS when result is empty', () => {
    expect(deriveRiskWarnings([], {})[0]?.code).toBe('NO_METRICS');
    const targeted = deriveRiskWarnings([], { target_metrics: ['X'] });
    expect(targeted[0]?.message).toMatch(/X/);
  });
});
