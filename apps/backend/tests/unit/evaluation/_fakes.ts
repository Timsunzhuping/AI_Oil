/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * In-memory fakes for evaluation tests:
 *   • FakeEvaluationRepository — mirrors EvaluationRepository's surface
 *   • staticPredictor()        — deterministic predictor adapter
 *   • staticPipeline()         — deterministic recommendation pipeline shape
 */
import { randomUUID } from 'node:crypto';
import type {
  AcceptanceReport,
  ResultRow,
  RunRow,
  RunStatus,
  TestSetInput,
  TestSetRow,
} from '../../../src/modules/evaluation/types.js';
import type { LimitedRecommendationPipeline } from '../../../src/modules/evaluation/runners/pipeline-shape.js';
import type { PredictorAdapter } from '../../../src/modules/prediction/adapters/types.js';

export class FakeEvaluationRepository {
  testSets = new Map<string, TestSetRow>();
  runs = new Map<string, RunRow>();
  results = new Map<string, ResultRow[]>();
  private setCounter = 1;
  private runCounter = 1;

  async nextTestSetCode() {
    return `TS-2026-${String(this.setCounter++).padStart(4, '0')}`;
  }
  async nextRunCode() {
    return `AR-2026-${String(this.runCounter++).padStart(6, '0')}`;
  }

  async createTestSet(
    input: TestSetInput,
    code: string,
    userId: string | null,
    traceId: string | null
  ): Promise<TestSetRow> {
    const now = new Date().toISOString();
    const row: TestSetRow = {
      id: randomUUID(),
      code,
      name: input.name,
      description: input.description ?? null,
      test_type: input.test_type,
      product_category: input.product_category ?? null,
      cases: input.cases,
      default_tolerance: (input.default_tolerance ?? {}) as TestSetRow['default_tolerance'],
      source_dataset_id: input.source_dataset_id ?? null,
      status: input.status ?? 'draft',
      metadata: input.metadata ?? {},
      tags: input.tags ?? [],
      trace_id: traceId,
      created_at: now,
      updated_at: now,
      created_by: userId,
      version: 1,
    };
    this.testSets.set(row.id, row);
    return row;
  }
  async findTestSet(id: string) {
    return this.testSets.get(id) ?? null;
  }
  async findTestSetByCode(code: string) {
    return [...this.testSets.values()].find((t) => t.code === code) ?? null;
  }
  async listTestSets(filter: {
    test_type?: string;
    status?: string;
    q?: string;
    page: number;
    pageSize: number;
  }) {
    const all = [...this.testSets.values()].filter(
      (t) =>
        (!filter.test_type || t.test_type === filter.test_type) &&
        (!filter.status || t.status === filter.status) &&
        (!filter.q || t.name.includes(filter.q) || t.code.includes(filter.q))
    );
    const start = (filter.page - 1) * filter.pageSize;
    return { items: all.slice(start, start + filter.pageSize), total: all.length };
  }

  async createRun(
    input: Parameters<
      import('../../../src/modules/evaluation/repository.js').EvaluationRepository['createRun']
    >[0]
  ): Promise<RunRow> {
    const now = new Date().toISOString();
    const row: RunRow = {
      id: randomUUID(),
      code: input.code,
      test_set_id: input.test_set_id,
      test_type: input.test_type,
      status: 'running',
      model_code: input.model_code,
      model_version: input.model_version,
      predictor_mode: input.predictor_mode,
      config: input.config,
      summary: { test_type: input.test_type } as AcceptanceReport,
      cases_total: 0,
      cases_passed: 0,
      cases_failed: 0,
      started_at: now,
      completed_at: null,
      duration_ms: 0,
      trigger_type: input.trigger_type,
      triggered_by: input.triggered_by,
      trace_id: input.trace_id,
      metadata: input.metadata,
      error_class: null,
      error_message: null,
      created_at: now,
      updated_at: now,
      version: 1,
    };
    this.runs.set(row.id, row);
    return row;
  }
  async finaliseRun(
    id: string,
    patch: {
      status: RunStatus;
      summary: AcceptanceReport;
      cases_total: number;
      cases_passed: number;
      cases_failed: number;
      duration_ms: number;
      error_class?: string | null;
      error_message?: string | null;
    }
  ): Promise<RunRow | null> {
    const r = this.runs.get(id);
    if (!r) return null;
    r.status = patch.status;
    r.summary = patch.summary;
    r.cases_total = patch.cases_total;
    r.cases_passed = patch.cases_passed;
    r.cases_failed = patch.cases_failed;
    r.duration_ms = patch.duration_ms;
    r.completed_at = new Date().toISOString();
    r.error_class = patch.error_class ?? null;
    r.error_message = patch.error_message ?? null;
    return r;
  }
  async findRun(id: string) {
    return this.runs.get(id) ?? null;
  }
  async listRuns(filter: {
    test_set_id?: string;
    test_type?: string;
    status?: RunStatus;
    page: number;
    pageSize: number;
  }) {
    const all = [...this.runs.values()].filter(
      (r) =>
        (!filter.test_set_id || r.test_set_id === filter.test_set_id) &&
        (!filter.test_type || r.test_type === filter.test_type) &&
        (!filter.status || r.status === filter.status)
    );
    const start = (filter.page - 1) * filter.pageSize;
    return { items: all.slice(start, start + filter.pageSize), total: all.length };
  }

  async insertResults(
    runId: string,
    rows: Array<Omit<ResultRow, 'id' | 'created_at' | 'run_id'>>
  ): Promise<void> {
    const list = this.results.get(runId) ?? [];
    for (const r of rows) {
      list.push({
        ...r,
        id: randomUUID(),
        run_id: runId,
        created_at: new Date().toISOString(),
      } as ResultRow);
    }
    this.results.set(runId, list);
  }
  async listResults(runId: string) {
    return this.results.get(runId) ?? [];
  }
}

// ─── Predictor + pipeline fakes ────────────────────────────────────────────

export function staticPredictor(
  opts: { metrics?: Record<string, number>; throws?: boolean } = {}
): PredictorAdapter {
  return {
    info() {
      return { code: 'forward-predictor', version: 'fake-v1', mode: 'mock', supported_metrics: [] };
    },
    async predict(input) {
      if (opts.throws) throw new Error('predictor failure');
      const wanted = input.target_metrics ?? Object.keys(opts.metrics ?? {});
      return {
        metrics: wanted.map((m) => ({
          name: m,
          predicted_value: opts.metrics?.[m] ?? 1,
          unit: null,
          spec_low: null,
          spec_high: null,
          in_spec: null,
          confidence: 0.85,
        })),
      };
    },
    async explain() {
      throw new Error('not implemented');
    },
  };
}

export function staticPipeline(
  opts: {
    candidates?: Array<{
      rank?: number;
      cost?: number | null;
      confidence?: number;
      codes: string[];
      passed?: boolean;
      risks?: Array<{ level: 'critical' | 'warning' | 'info'; code: string; message: string }>;
    }>;
    throws?: boolean;
  } = {}
): LimitedRecommendationPipeline {
  return {
    async run(_input) {
      if (opts.throws) throw new Error('pipeline failure');
      const list = opts.candidates ?? [
        {
          codes: ['PAO-6', 'GIII-4cSt', 'OCP', 'PKG-A'],
          cost: 18,
          confidence: 0.85,
          passed: true,
          risks: [],
        },
      ];
      return {
        candidates: list.map((c, i) => ({
          rank: c.rank ?? i + 1,
          bom: c.codes.map((code) => ({
            material_code: code,
            material_name: code,
            role: 'base_oil',
            ratio: 1 / c.codes.length,
          })),
          estimated_cost: c.cost ?? null,
          confidence: c.confidence ?? 0.7,
          risk_warnings: c.risks ?? [],
          passed_filter: c.passed ?? true,
        })),
      };
    },
  };
}
