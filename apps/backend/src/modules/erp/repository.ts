/**
 * Persistence for the ERP integration module.
 *
 *   erp_jobs           — per business call (sync / push / pull / lookup)
 *   erp_job_logs       — append-only log per job
 *   lims_task_links    — internal experiment ↔ external LIMS task mapping
 */
import type { Pool } from 'pg';
import type {
  AdapterMode,
  ErpJobLogRow,
  ErpJobMode,
  ErpJobRow,
  ErpJobStatus,
  ErpOperation,
  ErpSourceSystem,
  ErpTriggerType,
  LimsTaskLinkRow,
  LimsTaskStatus,
} from './types.js';

export interface InsertJobInput {
  code: string;
  source_system: ErpSourceSystem;
  operation: ErpOperation;
  mode: ErpJobMode;
  trigger_type: ErpTriggerType;
  adapter_name: string;
  adapter_version: string;
  adapter_mode: AdapterMode;
  max_attempts: number;
  parent_job_id: string | null;
  reference_id: string | null;
  request_payload: Record<string, unknown>;
  cursor_from: Record<string, unknown> | null;
  trace_id: string;
  triggered_by: string | null;
  metadata: Record<string, unknown>;
}

export interface FinaliseJobInput {
  status: ErpJobStatus;
  duration_ms: number;
  cursor_to?: Record<string, unknown> | null;
  records_extracted?: number;
  records_loaded?: number;
  records_failed?: number;
  records_skipped?: number;
  reference_id?: string | null;
  response_payload?: Record<string, unknown> | null;
  error_class?: string | null;
  error_message?: string | null;
}

export interface InsertLogInput {
  job_id: string;
  level: ErpJobLogRow['level'];
  phase: ErpJobLogRow['phase'];
  message: string;
  context?: Record<string, unknown>;
  trace_id: string | null;
}

export interface UpsertLimsLinkInput {
  external_lims_task_id: string;
  internal_experiment_id: string | null;
  related_formula_id: string | null;
  related_formula_version_id: string | null;
  test_method: string | null;
  sample_count: number;
  status: LimsTaskStatus;
  created_via: 'api' | 'manual' | 'batch' | 'event';
  external_url: string | null;
  external_status_raw: string | null;
  request_payload: Record<string, unknown>;
  result_payload: Record<string, unknown> | null;
  result_pulled_at: string | null;
  last_create_job_id: string | null;
  last_pull_job_id: string | null;
  metadata: Record<string, unknown>;
  trace_id: string | null;
  created_by: string | null;
}

export class ErpRepository {
  constructor(private readonly pool: Pool) {}

  // ── code generator (ERP-YYYY-NNNNNN) ───────────────────────────
  async nextJobCode(): Promise<string> {
    const year = new Date().getFullYear();
    const res = await this.pool.query<{ code: string }>(
      `SELECT code FROM erp_jobs WHERE code LIKE $1 ORDER BY code DESC LIMIT 1`,
      [`ERP-${year}-%`]
    );
    let n = 1;
    if (res.rows[0]?.code) {
      const m = /^ERP-\d{4}-(\d+)$/.exec(res.rows[0].code);
      if (m) n = Number(m[1]) + 1;
    }
    return `ERP-${year}-${String(n).padStart(6, '0')}`;
  }

  // ── jobs ────────────────────────────────────────────────────────
  async createJob(input: InsertJobInput): Promise<ErpJobRow> {
    const res = await this.pool.query<RawJob>(
      `INSERT INTO erp_jobs (
         code, source_system, operation, mode, trigger_type,
         adapter_name, adapter_version, adapter_mode,
         status, attempt_number, max_attempts, parent_job_id,
         started_at, cursor_from, reference_id, request_payload,
         trace_id, triggered_by, metadata
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'running',1,$9,$10,NOW(),$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        input.code,
        input.source_system,
        input.operation,
        input.mode,
        input.trigger_type,
        input.adapter_name,
        input.adapter_version,
        input.adapter_mode,
        input.max_attempts,
        input.parent_job_id,
        input.cursor_from === null ? null : JSON.stringify(input.cursor_from),
        input.reference_id,
        JSON.stringify(input.request_payload),
        input.trace_id,
        input.triggered_by,
        JSON.stringify(input.metadata),
      ]
    );
    return mapJob(res.rows[0]!);
  }

  async incrementAttempt(jobId: string): Promise<ErpJobRow | null> {
    const res = await this.pool.query<RawJob>(
      `UPDATE erp_jobs SET attempt_number = attempt_number + 1, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
      [jobId]
    );
    return res.rows[0] ? mapJob(res.rows[0]) : null;
  }

  async finaliseJob(jobId: string, input: FinaliseJobInput): Promise<ErpJobRow | null> {
    const res = await this.pool.query<RawJob>(
      `UPDATE erp_jobs SET
          status            = $2,
          completed_at      = NOW(),
          duration_ms       = $3,
          cursor_to         = $4,
          records_extracted = COALESCE($5, records_extracted),
          records_loaded    = COALESCE($6, records_loaded),
          records_failed    = COALESCE($7, records_failed),
          records_skipped   = COALESCE($8, records_skipped),
          reference_id      = COALESCE($9, reference_id),
          response_payload  = $10,
          error_class       = $11,
          error_message     = $12,
          updated_at        = NOW()
        WHERE id = $1
        RETURNING *`,
      [
        jobId,
        input.status,
        input.duration_ms,
        input.cursor_to === undefined
          ? null
          : input.cursor_to === null
            ? null
            : JSON.stringify(input.cursor_to),
        input.records_extracted ?? null,
        input.records_loaded ?? null,
        input.records_failed ?? null,
        input.records_skipped ?? null,
        input.reference_id ?? null,
        input.response_payload === undefined || input.response_payload === null
          ? null
          : JSON.stringify(input.response_payload),
        input.error_class ?? null,
        input.error_message ?? null,
      ]
    );
    return res.rows[0] ? mapJob(res.rows[0]) : null;
  }

  async findJob(id: string): Promise<ErpJobRow | null> {
    const res = await this.pool.query<RawJob>(`SELECT * FROM erp_jobs WHERE id = $1`, [id]);
    return res.rows[0] ? mapJob(res.rows[0]) : null;
  }

  async listJobs(filter: {
    source_system?: ErpSourceSystem;
    operation?: string;
    status?: ErpJobStatus;
    page: number;
    pageSize: number;
  }): Promise<{ items: ErpJobRow[]; total: number }> {
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.source_system) {
      where.push(`source_system = $${i++}`);
      params.push(filter.source_system);
    }
    if (filter.operation) {
      where.push(`operation = $${i++}`);
      params.push(filter.operation);
    }
    if (filter.status) {
      where.push(`status = $${i++}`);
      params.push(filter.status);
    }
    const total = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM erp_jobs WHERE ${where.join(' AND ')}`,
      params
    );
    const offset = (filter.page - 1) * filter.pageSize;
    const items = await this.pool.query<RawJob>(
      `SELECT * FROM erp_jobs WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT ${filter.pageSize} OFFSET ${offset}`,
      params
    );
    return { items: items.rows.map(mapJob), total: Number(total.rows[0]!.count) };
  }

  // ── logs ────────────────────────────────────────────────────────
  async insertLog(input: InsertLogInput): Promise<ErpJobLogRow> {
    const res = await this.pool.query<RawLog>(
      `INSERT INTO erp_job_logs (job_id, level, phase, message, context, trace_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        input.job_id,
        input.level,
        input.phase,
        input.message,
        JSON.stringify(input.context ?? {}),
        input.trace_id,
      ]
    );
    return mapLog(res.rows[0]!);
  }

  async listLogs(jobId: string): Promise<ErpJobLogRow[]> {
    const res = await this.pool.query<RawLog>(
      `SELECT * FROM erp_job_logs WHERE job_id = $1 ORDER BY occurred_at ASC`,
      [jobId]
    );
    return res.rows.map(mapLog);
  }

  // ── lims_task_links ─────────────────────────────────────────────
  async upsertLimsLink(input: UpsertLimsLinkInput): Promise<LimsTaskLinkRow> {
    // Insert-or-update keyed by external_lims_task_id.
    const res = await this.pool.query<RawLink>(
      `INSERT INTO lims_task_links (
         external_lims_task_id, internal_experiment_id, related_formula_id,
         related_formula_version_id, test_method, sample_count, status,
         created_via, external_url, external_status_raw,
         request_payload, result_payload, result_pulled_at,
         last_create_job_id, last_pull_job_id, last_sync_at,
         metadata, trace_id, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),$16,$17,$18)
       ON CONFLICT (external_lims_task_id) DO UPDATE SET
         status               = EXCLUDED.status,
         external_url         = COALESCE(EXCLUDED.external_url, lims_task_links.external_url),
         external_status_raw  = EXCLUDED.external_status_raw,
         result_payload       = COALESCE(EXCLUDED.result_payload, lims_task_links.result_payload),
         result_pulled_at     = COALESCE(EXCLUDED.result_pulled_at, lims_task_links.result_pulled_at),
         last_create_job_id   = COALESCE(EXCLUDED.last_create_job_id, lims_task_links.last_create_job_id),
         last_pull_job_id     = COALESCE(EXCLUDED.last_pull_job_id, lims_task_links.last_pull_job_id),
         last_sync_at         = NOW(),
         metadata             = lims_task_links.metadata || EXCLUDED.metadata,
         updated_by           = EXCLUDED.created_by,
         trace_id             = EXCLUDED.trace_id
       RETURNING *`,
      [
        input.external_lims_task_id,
        input.internal_experiment_id,
        input.related_formula_id,
        input.related_formula_version_id,
        input.test_method,
        input.sample_count,
        input.status,
        input.created_via,
        input.external_url,
        input.external_status_raw,
        JSON.stringify(input.request_payload),
        input.result_payload === null ? null : JSON.stringify(input.result_payload),
        input.result_pulled_at,
        input.last_create_job_id,
        input.last_pull_job_id,
        JSON.stringify(input.metadata),
        input.trace_id,
        input.created_by,
      ]
    );
    return mapLink(res.rows[0]!);
  }

  async findLimsLink(id: string): Promise<LimsTaskLinkRow | null> {
    const res = await this.pool.query<RawLink>(`SELECT * FROM lims_task_links WHERE id = $1`, [id]);
    return res.rows[0] ? mapLink(res.rows[0]) : null;
  }

  async findLimsLinkByExternalId(externalId: string): Promise<LimsTaskLinkRow | null> {
    const res = await this.pool.query<RawLink>(
      `SELECT * FROM lims_task_links WHERE external_lims_task_id = $1`,
      [externalId]
    );
    return res.rows[0] ? mapLink(res.rows[0]) : null;
  }

  async listLimsLinks(filter: {
    status?: LimsTaskStatus;
    test_method?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: LimsTaskLinkRow[]; total: number }> {
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.status) {
      where.push(`status = $${i++}`);
      params.push(filter.status);
    }
    if (filter.test_method) {
      where.push(`test_method = $${i++}`);
      params.push(filter.test_method);
    }
    const total = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM lims_task_links WHERE ${where.join(' AND ')}`,
      params
    );
    const offset = (filter.page - 1) * filter.pageSize;
    const items = await this.pool.query<RawLink>(
      `SELECT * FROM lims_task_links WHERE ${where.join(' AND ')}
         ORDER BY updated_at DESC
         LIMIT ${filter.pageSize} OFFSET ${offset}`,
      params
    );
    return { items: items.rows.map(mapLink), total: Number(total.rows[0]!.count) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Row mapping
// ─────────────────────────────────────────────────────────────────────────────

interface RawJob {
  id: string;
  code: string;
  source_system: ErpSourceSystem;
  operation: ErpOperation;
  mode: ErpJobMode;
  trigger_type: ErpTriggerType;
  adapter_name: string;
  adapter_version: string;
  adapter_mode: AdapterMode;
  status: ErpJobStatus;
  attempt_number: number;
  max_attempts: number;
  parent_job_id: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  duration_ms: number;
  cursor_from: Record<string, unknown> | null;
  cursor_to: Record<string, unknown> | null;
  records_extracted: number;
  records_loaded: number;
  records_failed: number;
  records_skipped: number;
  reference_id: string | null;
  request_payload: Record<string, unknown>;
  response_payload: Record<string, unknown> | null;
  error_class: string | null;
  error_message: string | null;
  trace_id: string;
  triggered_by: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  version: number;
}

interface RawLog {
  id: string;
  job_id: string;
  level: ErpJobLogRow['level'];
  phase: ErpJobLogRow['phase'];
  message: string;
  context: Record<string, unknown>;
  trace_id: string | null;
  occurred_at: Date;
}

interface RawLink {
  id: string;
  external_lims_task_id: string;
  internal_experiment_id: string | null;
  related_formula_id: string | null;
  related_formula_version_id: string | null;
  test_method: string | null;
  sample_count: number;
  status: LimsTaskStatus;
  created_via: 'api' | 'manual' | 'batch' | 'event';
  external_url: string | null;
  external_status_raw: string | null;
  request_payload: Record<string, unknown>;
  result_payload: Record<string, unknown> | null;
  result_pulled_at: Date | null;
  last_create_job_id: string | null;
  last_pull_job_id: string | null;
  last_sync_at: Date | null;
  metadata: Record<string, unknown>;
  trace_id: string | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  version: number;
}

function mapJob(r: RawJob): ErpJobRow {
  return {
    ...r,
    started_at: r.started_at ? r.started_at.toISOString() : null,
    completed_at: r.completed_at ? r.completed_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function mapLog(r: RawLog): ErpJobLogRow {
  return {
    id: String(r.id),
    job_id: r.job_id,
    level: r.level,
    phase: r.phase,
    message: r.message,
    context: r.context ?? {},
    trace_id: r.trace_id,
    occurred_at: r.occurred_at.toISOString(),
  };
}

function mapLink(r: RawLink): LimsTaskLinkRow {
  return {
    ...r,
    request_payload: r.request_payload ?? {},
    result_payload: r.result_payload,
    result_pulled_at: r.result_pulled_at ? r.result_pulled_at.toISOString() : null,
    last_sync_at: r.last_sync_at ? r.last_sync_at.toISOString() : null,
    metadata: r.metadata ?? {},
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}
