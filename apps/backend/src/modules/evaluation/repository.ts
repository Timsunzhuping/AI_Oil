/**
 * Persistence for the evaluation module.
 *
 *   acceptance_test_sets   — registered datasets
 *   acceptance_runs        — per-run audit + summary report
 *   acceptance_results     — per-case rows for forensics / drill-down
 */
import type { Pool } from 'pg';
import type {
  AcceptanceReport,
  ResultRow,
  RunConfig,
  RunRow,
  RunStatus,
  TestCase,
  TestSetInput,
  TestSetRow,
  TestSetStatus,
  TestType,
  Tolerance,
  StabilityTolerance,
  TriggerType,
} from './types.js';

export class EvaluationRepository {
  constructor(private readonly pool: Pool) {}

  // ── code generators ───────────────────────────────────────────────
  async nextTestSetCode(): Promise<string> {
    return this.nextCode('acceptance_test_sets', 'TS', 4);
  }
  async nextRunCode(): Promise<string> {
    return this.nextCode('acceptance_runs', 'AR', 6);
  }

  private async nextCode(table: string, prefix: string, padTo: number): Promise<string> {
    const year = new Date().getFullYear();
    const r = await this.pool.query<{ code: string }>(
      `SELECT code FROM ${table} WHERE code LIKE $1 ORDER BY code DESC LIMIT 1`,
      [`${prefix}-${year}-%`]
    );
    let n = 1;
    if (r.rows[0]?.code) {
      const m = new RegExp(`^${prefix}-\\d{4}-(\\d+)$`).exec(r.rows[0].code);
      if (m) n = Number(m[1]) + 1;
    }
    return `${prefix}-${year}-${String(n).padStart(padTo, '0')}`;
  }

  // ── test sets ─────────────────────────────────────────────────────
  async createTestSet(
    input: TestSetInput,
    code: string,
    userId: string | null,
    traceId: string | null
  ): Promise<TestSetRow> {
    const r = await this.pool.query<RawTestSet>(
      `INSERT INTO acceptance_test_sets (
         code, name, description, test_type, product_category,
         cases, default_tolerance, source_dataset_id, status,
         metadata, tags, trace_id, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        code,
        input.name,
        input.description ?? null,
        input.test_type,
        input.product_category ?? null,
        JSON.stringify(input.cases),
        JSON.stringify(input.default_tolerance ?? {}),
        input.source_dataset_id ?? null,
        input.status ?? 'draft',
        JSON.stringify(input.metadata ?? {}),
        input.tags ?? [],
        traceId,
        userId,
      ]
    );
    return mapTestSet(r.rows[0]!);
  }

  async findTestSet(id: string): Promise<TestSetRow | null> {
    const r = await this.pool.query<RawTestSet>(
      `SELECT * FROM acceptance_test_sets WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return r.rows[0] ? mapTestSet(r.rows[0]) : null;
  }

  async findTestSetByCode(code: string): Promise<TestSetRow | null> {
    const r = await this.pool.query<RawTestSet>(
      `SELECT * FROM acceptance_test_sets WHERE code = $1 AND deleted_at IS NULL`,
      [code]
    );
    return r.rows[0] ? mapTestSet(r.rows[0]) : null;
  }

  async listTestSets(filter: {
    test_type?: TestType;
    status?: TestSetStatus;
    q?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: TestSetRow[]; total: number }> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.test_type) {
      where.push(`test_type = $${i++}`);
      params.push(filter.test_type);
    }
    if (filter.status) {
      where.push(`status = $${i++}`);
      params.push(filter.status);
    }
    if (filter.q) {
      where.push(`(name ILIKE $${i} OR code ILIKE $${i})`);
      params.push(`%${filter.q}%`);
      i += 1;
    }
    const total = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM acceptance_test_sets WHERE ${where.join(' AND ')}`,
      params
    );
    const items = await this.pool.query<RawTestSet>(
      `SELECT * FROM acceptance_test_sets WHERE ${where.join(' AND ')}
         ORDER BY updated_at DESC
         LIMIT ${filter.pageSize} OFFSET ${(filter.page - 1) * filter.pageSize}`,
      params
    );
    return { items: items.rows.map(mapTestSet), total: Number(total.rows[0]!.count) };
  }

  // ── runs ──────────────────────────────────────────────────────────
  async createRun(input: {
    code: string;
    test_set_id: string;
    test_type: TestType;
    model_code: string;
    model_version: string;
    predictor_mode: 'mock' | 'real';
    config: RunConfig;
    trigger_type: TriggerType;
    triggered_by: string | null;
    trace_id: string | null;
    metadata: Record<string, unknown>;
  }): Promise<RunRow> {
    const r = await this.pool.query<RawRun>(
      `INSERT INTO acceptance_runs (
         code, test_set_id, test_type, status,
         model_code, model_version, predictor_mode,
         config, started_at, trigger_type, triggered_by, trace_id, metadata
       )
       VALUES ($1,$2,$3,'running',$4,$5,$6,$7,NOW(),$8,$9,$10,$11)
       RETURNING *`,
      [
        input.code,
        input.test_set_id,
        input.test_type,
        input.model_code,
        input.model_version,
        input.predictor_mode,
        JSON.stringify(input.config),
        input.trigger_type,
        input.triggered_by,
        input.trace_id,
        JSON.stringify(input.metadata),
      ]
    );
    return mapRun(r.rows[0]!);
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
    const r = await this.pool.query<RawRun>(
      `UPDATE acceptance_runs SET
         status = $2,
         summary = $3,
         cases_total = $4,
         cases_passed = $5,
         cases_failed = $6,
         duration_ms = $7,
         completed_at = NOW(),
         error_class = $8,
         error_message = $9,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        patch.status,
        JSON.stringify(patch.summary),
        patch.cases_total,
        patch.cases_passed,
        patch.cases_failed,
        patch.duration_ms,
        patch.error_class ?? null,
        patch.error_message ?? null,
      ]
    );
    return r.rows[0] ? mapRun(r.rows[0]) : null;
  }

  async findRun(id: string): Promise<RunRow | null> {
    const r = await this.pool.query<RawRun>(`SELECT * FROM acceptance_runs WHERE id = $1`, [id]);
    return r.rows[0] ? mapRun(r.rows[0]) : null;
  }

  async listRuns(filter: {
    test_set_id?: string;
    test_type?: TestType;
    status?: RunStatus;
    page: number;
    pageSize: number;
  }): Promise<{ items: RunRow[]; total: number }> {
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.test_set_id) {
      where.push(`test_set_id = $${i++}`);
      params.push(filter.test_set_id);
    }
    if (filter.test_type) {
      where.push(`test_type = $${i++}`);
      params.push(filter.test_type);
    }
    if (filter.status) {
      where.push(`status = $${i++}`);
      params.push(filter.status);
    }
    const total = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM acceptance_runs WHERE ${where.join(' AND ')}`,
      params
    );
    const items = await this.pool.query<RawRun>(
      `SELECT * FROM acceptance_runs WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT ${filter.pageSize} OFFSET ${(filter.page - 1) * filter.pageSize}`,
      params
    );
    return { items: items.rows.map(mapRun), total: Number(total.rows[0]!.count) };
  }

  // ── results ───────────────────────────────────────────────────────
  async insertResults(
    runId: string,
    results: Array<{
      case_id: string;
      case_index: number;
      category: string | null;
      passed: boolean;
      metrics: Record<string, unknown>;
      expected: unknown;
      predicted: unknown;
      raw_payload: unknown;
      failure_reason: string | null;
      duration_ms: number;
    }>
  ): Promise<void> {
    if (results.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const r of results) {
        await client.query(
          `INSERT INTO acceptance_results (
             run_id, case_id, case_index, category, passed,
             metrics, expected, predicted, raw_payload, failure_reason, duration_ms
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            runId,
            r.case_id,
            r.case_index,
            r.category,
            r.passed,
            JSON.stringify(r.metrics),
            r.expected === undefined || r.expected === null ? null : JSON.stringify(r.expected),
            r.predicted === undefined || r.predicted === null ? null : JSON.stringify(r.predicted),
            r.raw_payload === undefined || r.raw_payload === null
              ? null
              : JSON.stringify(r.raw_payload),
            r.failure_reason,
            r.duration_ms,
          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listResults(runId: string): Promise<ResultRow[]> {
    const r = await this.pool.query<RawResult>(
      `SELECT * FROM acceptance_results WHERE run_id = $1 ORDER BY case_index ASC`,
      [runId]
    );
    return r.rows.map(mapResult);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Row mapping
// ─────────────────────────────────────────────────────────────────────────────

interface RawTestSet {
  id: string;
  code: string;
  name: string;
  description: string | null;
  test_type: TestType;
  product_category: string | null;
  cases: TestCase[];
  default_tolerance: Tolerance | StabilityTolerance;
  source_dataset_id: string | null;
  status: TestSetStatus;
  metadata: Record<string, unknown>;
  tags: string[];
  trace_id: string | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  version: number;
}
interface RawRun {
  id: string;
  code: string;
  test_set_id: string;
  test_type: TestType;
  status: RunStatus;
  model_code: string;
  model_version: string;
  predictor_mode: 'mock' | 'real';
  config: RunConfig;
  summary: AcceptanceReport;
  cases_total: number;
  cases_passed: number;
  cases_failed: number;
  started_at: Date | null;
  completed_at: Date | null;
  duration_ms: number;
  trigger_type: TriggerType;
  triggered_by: string | null;
  trace_id: string | null;
  metadata: Record<string, unknown>;
  error_class: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  version: number;
}
interface RawResult {
  id: string;
  run_id: string;
  case_id: string;
  case_index: number;
  category: string | null;
  passed: boolean;
  metrics: Record<string, unknown>;
  expected: unknown;
  predicted: unknown;
  raw_payload: unknown;
  failure_reason: string | null;
  duration_ms: number;
  created_at: Date;
}

function mapTestSet(r: RawTestSet): TestSetRow {
  return {
    ...r,
    cases: r.cases ?? [],
    default_tolerance: r.default_tolerance ?? {},
    metadata: r.metadata ?? {},
    tags: r.tags ?? [],
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}
function mapRun(r: RawRun): RunRow {
  return {
    ...r,
    config: r.config ?? {},
    summary: r.summary ?? ({} as AcceptanceReport),
    metadata: r.metadata ?? {},
    started_at: r.started_at ? r.started_at.toISOString() : null,
    completed_at: r.completed_at ? r.completed_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}
function mapResult(r: RawResult): ResultRow {
  return {
    ...r,
    metrics: r.metrics ?? {},
    created_at: r.created_at.toISOString(),
  };
}
