import type { Pool, PoolClient } from 'pg';
import type {
  Issue,
  RawTestResultRow,
  WorkingRow,
} from './types.js';

/**
 * Cleaning module data layer. Reads raw test_results, writes
 * normalized_test_results / data_quality_issues / cleaning_runs.
 */
export class CleaningRepository {
  constructor(private pool: Pool) {}

  // -------------------------- runs --------------------------

  async createRun(input: {
    trigger_type: 'manual' | 'scheduled' | 'integration_job' | 'api';
    triggered_by?: string;
    source_integration_job_id?: string;
    trace_id: string;
    entity_type: 'test_results' | 'materials' | 'metrics' | 'all';
    scope_filter?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const r = await this.pool.query<{ id: string }>(
      `INSERT INTO cleaning_runs
         (trigger_type, triggered_by, source_integration_job_id, trace_id, entity_type, scope_filter, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'queued')
       RETURNING id`,
      [
        input.trigger_type, input.triggered_by ?? null,
        input.source_integration_job_id ?? null, input.trace_id,
        input.entity_type, input.scope_filter ?? {},
      ]
    );
    return r.rows[0]!;
  }

  async markRunRunning(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE cleaning_runs SET status = 'running', started_at = NOW() WHERE id = $1`,
      [id]
    );
  }

  async markRunFinished(id: string, status: 'succeeded' | 'partial' | 'failed', error?: string): Promise<void> {
    await this.pool.query(
      `UPDATE cleaning_runs
          SET status = $2,
              completed_at = NOW(),
              duration_ms = EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, created_at)))::INTEGER * 1000,
              error_message = $3
        WHERE id = $1`,
      [id, status, error ?? null]
    );
  }

  async incrementRunCounters(id: string, deltas: {
    processed?: number;
    normalized?: number;
    skipped?: number;
    issues?: number;
    outliers?: number;
    unresolved?: number;
    missing?: number;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE cleaning_runs SET
          records_processed   = records_processed   + COALESCE($2, 0),
          records_normalized  = records_normalized  + COALESCE($3, 0),
          records_skipped     = records_skipped     + COALESCE($4, 0),
          issues_found        = issues_found        + COALESCE($5, 0),
          outliers_found      = outliers_found      + COALESCE($6, 0),
          unresolved_found    = unresolved_found    + COALESCE($7, 0),
          missing_found       = missing_found       + COALESCE($8, 0)
        WHERE id = $1`,
      [
        id, deltas.processed ?? 0, deltas.normalized ?? 0,
        deltas.skipped ?? 0, deltas.issues ?? 0,
        deltas.outliers ?? 0, deltas.unresolved ?? 0,
        deltas.missing ?? 0,
      ]
    );
  }

  async findRun(id: string): Promise<Record<string, unknown> | null> {
    const r = await this.pool.query(`SELECT * FROM cleaning_runs WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  async listRuns(filter: { status?: string; limit?: number; offset?: number } = {}): Promise<{ items: unknown[]; total: number }> {
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.status) { where.push(`status = $${i++}`); params.push(filter.status); }
    const limit = Math.min(200, Math.max(1, filter.limit ?? 20));
    const offset = Math.max(0, filter.offset ?? 0);
    const total = parseInt(
      (await this.pool.query<{ c: string }>(
        `SELECT COUNT(*)::text c FROM cleaning_runs WHERE ${where.join(' AND ')}`, params
      )).rows[0]?.c ?? '0',
      10
    );
    const rows = (await this.pool.query(
      `SELECT * FROM cleaning_runs WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    )).rows;
    return { items: rows, total };
  }

  // -------------------------- raw input --------------------------

  /**
   * Pull raw test_results that haven't been normalized yet (or have been
   * normalized but with a quality issue, so a re-run would refresh them).
   */
  async streamRawTestResults(filter: { since?: Date; limit?: number } = {}): Promise<RawTestResultRow[]> {
    const params: unknown[] = [];
    const where: string[] = ['t.deleted_at IS NULL'];
    let i = 1;
    if (filter.since) { where.push(`t.measured_at >= $${i++}`); params.push(filter.since); }
    const limit = Math.min(10_000, Math.max(1, filter.limit ?? 1000));
    const r = await this.pool.query<RawTestResultRow>(
      `SELECT t.id, t.test_code, t.test_name, t.measured_value, t.unit_of_measure,
              t.expected_min, t.expected_max, t.pass, t.measured_at, t.measured_by,
              t.sample_code, t.batch_code, t.formula_version_id, t.product_id,
              t.raw_material_id, t.experiment_id, t.metadata
         FROM test_results t
        WHERE ${where.join(' AND ')}
        ORDER BY t.measured_at DESC NULLS LAST, t.id
        LIMIT ${limit}`,
      params
    );
    return r.rows;
  }

  /**
   * Recent measured_value samples for a metric — input for IQR-based
   * outlier detection. Reads the SOURCE table (test_results) for the
   * widest history irrespective of prior cleaning runs.
   */
  async loadMetricHistory(metricCode: string, limit = 200): Promise<number[]> {
    const r = await this.pool.query<{ measured_value: string }>(
      `SELECT measured_value::text
         FROM test_results
        WHERE test_code = $1
          AND measured_value IS NOT NULL
          AND deleted_at IS NULL
        ORDER BY measured_at DESC NULLS LAST
        LIMIT ${Math.min(2000, Math.max(10, limit))}`,
      [metricCode]
    );
    return r.rows
      .map((row) => Number(row.measured_value))
      .filter((n) => Number.isFinite(n));
  }

  // -------------------------- normalized output --------------------------

  async upsertNormalized(row: WorkingRow, runId: string, client?: PoolClient): Promise<{ id: string; created: boolean }> {
    const exec = client ?? this.pool;
    const r = await exec.query<{ id: string; xmax: string }>(
      `INSERT INTO normalized_test_results (
          cleaning_run_id, source_test_result_id, source_external_id, source_system,
          raw_material_id, product_id, formula_id, formula_version_id, experiment_id,
          sample_code, batch_code,
          metric_id, metric_code,
          raw_value, raw_measured_value, raw_unit,
          normalized_value, normalized_unit, unit_id,
          conversion_applied, conversion_factor, conversion_offset,
          is_missing, is_unresolved, is_outlier, outlier_methods, outlier_score,
          pass, expected_min, expected_max,
          has_quality_issues, issue_count,
          measured_at, measured_by, metadata
       )
       VALUES ($1, $2, $3, $4,
               $5, $6, $7, $8, $9,
               $10, $11,
               $12, $13,
               $14, $15, $16,
               $17, $18, $19,
               $20, $21, $22,
               $23, $24, $25, $26, $27,
               $28, $29, $30,
               $31, $32,
               $33, $34, $35)
       ON CONFLICT (source_test_result_id) WHERE source_test_result_id IS NOT NULL AND deleted_at IS NULL
       DO UPDATE SET
          cleaning_run_id = EXCLUDED.cleaning_run_id,
          metric_id = EXCLUDED.metric_id,
          metric_code = EXCLUDED.metric_code,
          raw_measured_value = EXCLUDED.raw_measured_value,
          raw_unit = EXCLUDED.raw_unit,
          normalized_value = EXCLUDED.normalized_value,
          normalized_unit = EXCLUDED.normalized_unit,
          unit_id = EXCLUDED.unit_id,
          conversion_applied = EXCLUDED.conversion_applied,
          conversion_factor = EXCLUDED.conversion_factor,
          conversion_offset = EXCLUDED.conversion_offset,
          is_missing = EXCLUDED.is_missing,
          is_unresolved = EXCLUDED.is_unresolved,
          is_outlier = EXCLUDED.is_outlier,
          outlier_methods = EXCLUDED.outlier_methods,
          outlier_score = EXCLUDED.outlier_score,
          pass = EXCLUDED.pass,
          has_quality_issues = EXCLUDED.has_quality_issues,
          issue_count = EXCLUDED.issue_count
       RETURNING id, xmax::text`,
      [
        runId, row.raw.id, (row.raw.metadata as { external_id?: string })?.external_id ?? null,
        (row.raw.metadata as { source_system?: string })?.source_system ?? null,
        row.raw_material_id, row.product_id, row.formula_id, row.formula_version_id, row.experiment_id,
        row.sample_code, row.batch_code,
        row.metric?.id ?? null, row.metric?.code ?? row.raw.test_code,
        row.raw, asNumeric(row.raw.measured_value), row.raw.unit_of_measure ?? null,
        row.normalized_value, row.normalized_unit, row.target_unit?.id ?? row.raw_unit_obj?.id ?? null,
        row.conversion_applied, row.conversion_factor, row.conversion_offset,
        row.is_missing, row.is_unresolved, row.is_outlier, row.outlier_methods, row.outlier_score,
        row.pass, row.raw.expected_min, row.raw.expected_max,
        row.issues.length > 0, row.issues.length,
        row.raw.measured_at, row.raw.measured_by, row.raw.metadata ?? {},
      ]
    );
    const result = r.rows[0]!;
    // xmax = '0' indicates an INSERT, otherwise an UPDATE
    return { id: result.id, created: result.xmax === '0' };
  }

  async insertIssues(
    issues: Issue[],
    base: {
      run_id: string;
      trace_id: string;
      entity_type: 'test_result' | 'material' | 'metric';
      entity_id: string;
      source_entity_type: string;
      source_entity_id: string;
    },
    client?: PoolClient
  ): Promise<void> {
    if (issues.length === 0) return;
    const exec = client ?? this.pool;
    // Build a multi-row insert
    const cols = [
      'cleaning_run_id','trace_id','entity_type','entity_id',
      'source_entity_type','source_entity_id',
      'issue_type','severity','field','rule_code',
      'raw_value','expected_value','message',
    ];
    const placeholders: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const it of issues) {
      placeholders.push(
        `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`
      );
      params.push(
        base.run_id, base.trace_id, base.entity_type, base.entity_id,
        base.source_entity_type, base.source_entity_id,
        it.type, it.severity, it.field ?? null, it.rule_code ?? null,
        it.raw_value === undefined ? null : JSON.stringify(it.raw_value),
        it.expected_value === undefined ? null : JSON.stringify(it.expected_value),
        it.message
      );
    }
    await exec.query(
      `INSERT INTO data_quality_issues (${cols.join(',')}) VALUES ${placeholders.join(',')}`,
      params
    );
  }

  // -------------------------- queries --------------------------

  async listIssues(filter: {
    run_id?: string;
    issue_type?: string;
    severity?: string;
    status?: string;
    entity_type?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: unknown[]; total: number }> {
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.run_id)      { where.push(`cleaning_run_id = $${i++}`); params.push(filter.run_id); }
    if (filter.issue_type)  { where.push(`issue_type = $${i++}`);      params.push(filter.issue_type); }
    if (filter.severity)    { where.push(`severity = $${i++}`);        params.push(filter.severity); }
    if (filter.status)      { where.push(`status = $${i++}`);          params.push(filter.status); }
    if (filter.entity_type) { where.push(`entity_type = $${i++}`);     params.push(filter.entity_type); }
    const limit = Math.min(500, Math.max(1, filter.limit ?? 50));
    const offset = Math.max(0, filter.offset ?? 0);
    const total = parseInt(
      (await this.pool.query<{ c: string }>(
        `SELECT COUNT(*)::text c FROM data_quality_issues WHERE ${where.join(' AND ')}`,
        params
      )).rows[0]?.c ?? '0',
      10
    );
    const items = (await this.pool.query(
      `SELECT * FROM data_quality_issues WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    )).rows;
    return { items, total };
  }

  async resolveIssue(id: string, opts: { status: 'acknowledged' | 'fixed' | 'wont_fix'; notes?: string; user_id?: string }): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE data_quality_issues
          SET status = $2,
              resolved_at = NOW(),
              resolved_by = $3,
              resolution_notes = $4
        WHERE id = $1 AND status = 'open'`,
      [id, opts.status, opts.user_id ?? null, opts.notes ?? null]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async listNormalizedTestResults(filter: {
    metric_code?: string;
    is_outlier?: boolean;
    has_quality_issues?: boolean;
    formula_version_id?: string;
    batch_code?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: unknown[]; total: number }> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.metric_code)         { where.push(`metric_code = $${i++}`);          params.push(filter.metric_code); }
    if (filter.is_outlier !== undefined)         { where.push(`is_outlier = $${i++}`);         params.push(filter.is_outlier); }
    if (filter.has_quality_issues !== undefined) { where.push(`has_quality_issues = $${i++}`); params.push(filter.has_quality_issues); }
    if (filter.formula_version_id)  { where.push(`formula_version_id = $${i++}`);   params.push(filter.formula_version_id); }
    if (filter.batch_code)          { where.push(`batch_code = $${i++}`);           params.push(filter.batch_code); }
    const limit = Math.min(500, Math.max(1, filter.limit ?? 50));
    const offset = Math.max(0, filter.offset ?? 0);
    const total = parseInt(
      (await this.pool.query<{ c: string }>(
        `SELECT COUNT(*)::text c FROM normalized_test_results WHERE ${where.join(' AND ')}`,
        params
      )).rows[0]?.c ?? '0',
      10
    );
    const items = (await this.pool.query(
      `SELECT * FROM normalized_test_results WHERE ${where.join(' AND ')}
        ORDER BY measured_at DESC NULLS LAST LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    )).rows;
    return { items, total };
  }

  // -------------------------- rules --------------------------

  async listActiveRules(scope?: string): Promise<Array<{
    id: string; code: string; name: string; rule_type: string; scope: string; severity: string;
    condition_expr: unknown; action_expr: unknown; priority: number;
  }>> {
    const where: string[] = ['is_active = TRUE', 'deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (scope) { where.push(`scope = $${i++}`); params.push(scope); }
    const r = await this.pool.query(
      `SELECT id, code, name, rule_type, scope, severity, condition_expr, action_expr, priority
         FROM cleaning_rules
        WHERE ${where.join(' AND ')}
        ORDER BY priority DESC, code`,
      params
    );
    return r.rows as Array<{ id: string; code: string; name: string; rule_type: string; scope: string; severity: string; condition_expr: unknown; action_expr: unknown; priority: number; }>;
  }

  async incrementRuleFireCount(ruleCode: string): Promise<void> {
    await this.pool.query(
      `UPDATE cleaning_rules SET fired_count = fired_count + 1, last_fired_at = NOW()
        WHERE code = $1`,
      [ruleCode]
    );
  }
}

function asNumeric(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
