import type { Pool, PoolClient } from 'pg';
import type { Cursor, JobPhase, JobStatus, JobType, LogLevel, SourceRow, SourceType } from './types.js';

/**
 * Thin SQL-only data layer. The job runner / service / routes call into
 * these methods; nothing else touches the integration_* tables.
 */
export class IntegrationRepository {
  constructor(private pool: Pool) {}

  // -------------------------- sources --------------------------

  async findSourceById(id: string): Promise<SourceRow | null> {
    const r = await this.pool.query<SourceRow>(
      `SELECT id, code, name, source_type, config, secret_ref,
              supported_entities, default_retry_max, default_retry_backoff_ms,
              is_active
         FROM integration_sources
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return r.rows[0] ?? null;
  }

  async findSourceByCode(code: string): Promise<SourceRow | null> {
    const r = await this.pool.query<SourceRow>(
      `SELECT id, code, name, source_type, config, secret_ref,
              supported_entities, default_retry_max, default_retry_backoff_ms,
              is_active
         FROM integration_sources
        WHERE code = $1 AND deleted_at IS NULL`,
      [code]
    );
    return r.rows[0] ?? null;
  }

  async listSources(filter: { source_type?: SourceType; is_active?: boolean } = {}): Promise<SourceRow[]> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.source_type)         { where.push(`source_type = $${i++}`); params.push(filter.source_type); }
    if (filter.is_active !== undefined) { where.push(`is_active = $${i++}`);   params.push(filter.is_active); }
    const r = await this.pool.query<SourceRow>(
      `SELECT id, code, name, source_type, config, secret_ref,
              supported_entities, default_retry_max, default_retry_backoff_ms, is_active
         FROM integration_sources
        WHERE ${where.join(' AND ')}
        ORDER BY code`,
      params
    );
    return r.rows;
  }

  async upsertSource(input: {
    code: string;
    name: string;
    source_type: SourceType;
    description?: string | null;
    config?: Record<string, unknown>;
    secret_ref?: string | null;
    supported_entities?: string[];
    is_active?: boolean;
    user_id?: string;
  }): Promise<{ id: string }> {
    const r = await this.pool.query<{ id: string }>(
      `INSERT INTO integration_sources
         (code, name, source_type, description, config, secret_ref, supported_entities, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name,
             source_type = EXCLUDED.source_type,
             description = EXCLUDED.description,
             config = EXCLUDED.config,
             secret_ref = EXCLUDED.secret_ref,
             supported_entities = EXCLUDED.supported_entities,
             is_active = EXCLUDED.is_active,
             updated_by = EXCLUDED.updated_by
       RETURNING id`,
      [
        input.code, input.name, input.source_type, input.description ?? null,
        input.config ?? {}, input.secret_ref ?? null,
        input.supported_entities ?? [], input.is_active ?? true,
        input.user_id ?? null,
      ]
    );
    return r.rows[0]!;
  }

  async softDeleteSource(id: string, userId?: string): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE integration_sources SET deleted_at = NOW(), updated_by = $2
        WHERE id = $1 AND deleted_at IS NULL`,
      [id, userId ?? null]
    );
    return (r.rowCount ?? 0) > 0;
  }

  // -------------------------- snapshots --------------------------

  async getSnapshot(sourceId: string, entityType: string): Promise<{ cursor_value: Cursor; total_records_synced: number } | null> {
    const r = await this.pool.query<{ cursor_value: Cursor; total_records_synced: string }>(
      `SELECT cursor_value, total_records_synced::text
         FROM sync_snapshots
        WHERE source_id = $1 AND entity_type = $2`,
      [sourceId, entityType]
    );
    if (!r.rows[0]) return null;
    return {
      cursor_value: r.rows[0].cursor_value,
      total_records_synced: parseInt(r.rows[0].total_records_synced, 10),
    };
  }

  async upsertSnapshot(input: {
    sourceId: string;
    entityType: string;
    cursor: Cursor;
    job_id: string;
    job_type: JobType;
    payload_hash?: string;
    records_synced_delta: number;
  }, client?: PoolClient): Promise<void> {
    const exec = client ?? this.pool;
    const isFull = input.job_type === 'full_sync';
    await exec.query(
      `INSERT INTO sync_snapshots (
          source_id, entity_type, cursor_value,
          last_full_sync_at, last_full_sync_job_id,
          last_incremental_sync_at, last_incremental_sync_job_id,
          total_records_synced, last_payload_hash
       )
       VALUES ($1, $2, $3,
               CASE WHEN $4 THEN NOW() ELSE NULL END, CASE WHEN $4 THEN $5 ELSE NULL END,
               CASE WHEN $4 THEN NULL ELSE NOW() END, CASE WHEN $4 THEN NULL ELSE $5 END,
               GREATEST(0, $6), $7)
       ON CONFLICT (source_id, entity_type) DO UPDATE SET
          cursor_value = EXCLUDED.cursor_value,
          last_full_sync_at = COALESCE(EXCLUDED.last_full_sync_at, sync_snapshots.last_full_sync_at),
          last_full_sync_job_id = COALESCE(EXCLUDED.last_full_sync_job_id, sync_snapshots.last_full_sync_job_id),
          last_incremental_sync_at = COALESCE(EXCLUDED.last_incremental_sync_at, sync_snapshots.last_incremental_sync_at),
          last_incremental_sync_job_id = COALESCE(EXCLUDED.last_incremental_sync_job_id, sync_snapshots.last_incremental_sync_job_id),
          total_records_synced = sync_snapshots.total_records_synced + $6,
          last_payload_hash = EXCLUDED.last_payload_hash`,
      [
        input.sourceId, input.entityType, input.cursor,
        isFull, input.job_id,
        input.records_synced_delta, input.payload_hash ?? null,
      ]
    );
  }

  async listSnapshots(sourceId?: string): Promise<unknown[]> {
    const r = sourceId
      ? await this.pool.query(`SELECT * FROM sync_snapshots WHERE source_id = $1 ORDER BY entity_type`, [sourceId])
      : await this.pool.query(`SELECT * FROM sync_snapshots ORDER BY source_id, entity_type`);
    return r.rows;
  }

  // -------------------------- jobs --------------------------

  async createJob(input: {
    sourceId: string;
    sourceType: SourceType;
    entityType: string;
    jobType: JobType;
    triggerType: 'manual' | 'scheduled' | 'event' | 'retry' | 'api';
    triggeredBy?: string;
    parentJobId?: string;
    attemptNumber?: number;
    maxAttempts?: number;
    cursorFrom?: Cursor;
    traceId: string;
    configSnapshot?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const r = await this.pool.query<{ id: string }>(
      `INSERT INTO integration_jobs (
          source_id, source_type, entity_type, job_type, trigger_type, triggered_by,
          parent_job_id, attempt_number, max_attempts,
          status, trace_id, cursor_from, config_snapshot, queued_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued',$10,$11,$12, NOW())
       RETURNING id`,
      [
        input.sourceId, input.sourceType, input.entityType, input.jobType,
        input.triggerType, input.triggeredBy ?? null,
        input.parentJobId ?? null, input.attemptNumber ?? 1, input.maxAttempts ?? 3,
        input.traceId, input.cursorFrom ?? null, input.configSnapshot ?? {},
      ]
    );
    return r.rows[0]!;
  }

  async markJobRunning(jobId: string): Promise<void> {
    await this.pool.query(
      `UPDATE integration_jobs SET status = 'running', started_at = NOW() WHERE id = $1`,
      [jobId]
    );
  }

  async markJobFinished(jobId: string, fields: {
    status: JobStatus;
    cursor_to?: Cursor;
    records_extracted: number;
    records_transformed: number;
    records_loaded: number;
    records_failed: number;
    records_skipped: number;
    error_class?: string | null;
    error_message?: string | null;
    error_stack?: string | null;
    next_retry_at?: Date | null;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE integration_jobs SET
          status = $2,
          cursor_to = $3,
          records_extracted = $4,
          records_transformed = $5,
          records_loaded = $6,
          records_failed = $7,
          records_skipped = $8,
          error_class = $9,
          error_message = $10,
          error_stack = $11,
          next_retry_at = $12,
          completed_at = NOW(),
          duration_ms = EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, queued_at)))::INTEGER * 1000
        WHERE id = $1`,
      [
        jobId, fields.status, fields.cursor_to ?? null,
        fields.records_extracted, fields.records_transformed, fields.records_loaded,
        fields.records_failed, fields.records_skipped,
        fields.error_class ?? null, fields.error_message ?? null, fields.error_stack ?? null,
        fields.next_retry_at ?? null,
      ]
    );

    // Maintain source-level last_*_job_id
    if (fields.status === 'succeeded' || fields.status === 'partial') {
      await this.pool.query(
        `UPDATE integration_sources s
            SET last_sync_at = NOW(),
                last_successful_job_id = $1,
                consecutive_failures = 0
          FROM integration_jobs j
          WHERE j.id = $1 AND s.id = j.source_id`,
        [jobId]
      );
    } else if (fields.status === 'failed' || fields.status === 'timeout') {
      await this.pool.query(
        `UPDATE integration_sources s
            SET last_failed_job_id = $1,
                consecutive_failures = consecutive_failures + 1
          FROM integration_jobs j
          WHERE j.id = $1 AND s.id = j.source_id`,
        [jobId]
      );
    }
  }

  async findJobById(jobId: string): Promise<Record<string, unknown> | null> {
    const r = await this.pool.query(`SELECT * FROM integration_jobs WHERE id = $1`, [jobId]);
    return r.rows[0] ?? null;
  }

  async listJobs(filter: {
    sourceId?: string;
    status?: JobStatus;
    entityType?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: unknown[]; total: number }> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.sourceId)   { where.push(`source_id = $${i++}`);   params.push(filter.sourceId); }
    if (filter.status)     { where.push(`status = $${i++}`);      params.push(filter.status); }
    if (filter.entityType) { where.push(`entity_type = $${i++}`); params.push(filter.entityType); }
    const limit = Math.min(200, Math.max(1, filter.limit ?? 20));
    const offset = Math.max(0, filter.offset ?? 0);
    const total = parseInt(
      (await this.pool.query<{ c: string }>(
        `SELECT COUNT(*)::text c FROM integration_jobs WHERE ${where.join(' AND ')}`,
        params
      )).rows[0]?.c ?? '0',
      10
    );
    const rows = (await this.pool.query(
      `SELECT * FROM integration_jobs WHERE ${where.join(' AND ')}
        ORDER BY queued_at DESC LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    )).rows;
    return { items: rows, total };
  }

  async findRetryableJobs(now = new Date()): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT * FROM integration_jobs
        WHERE status = 'failed'
          AND next_retry_at IS NOT NULL
          AND next_retry_at <= $1
          AND attempt_number < max_attempts
        ORDER BY next_retry_at ASC
        LIMIT 100`,
      [now]
    );
    return r.rows;
  }

  // -------------------------- logs --------------------------

  async log(jobId: string, level: LogLevel, message: string, opts: {
    phase?: JobPhase;
    context?: Record<string, unknown>;
    traceId?: string;
  } = {}): Promise<void> {
    await this.pool.query(
      `INSERT INTO integration_job_logs (job_id, level, phase, message, context, trace_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [jobId, level, opts.phase ?? null, message, opts.context ?? {}, opts.traceId ?? null]
    );
  }

  async listJobLogs(jobId: string, opts: { limit?: number; offset?: number; level?: LogLevel } = {}): Promise<{ items: unknown[]; total: number }> {
    const where: string[] = ['job_id = $1'];
    const params: unknown[] = [jobId];
    let i = 2;
    if (opts.level) { where.push(`level = $${i++}`); params.push(opts.level); }
    const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
    const offset = Math.max(0, opts.offset ?? 0);
    const total = parseInt(
      (await this.pool.query<{ c: string }>(
        `SELECT COUNT(*)::text c FROM integration_job_logs WHERE ${where.join(' AND ')}`, params
      )).rows[0]?.c ?? '0',
      10
    );
    const items = (await this.pool.query(
      `SELECT id, level, phase, message, context, trace_id, occurred_at
         FROM integration_job_logs WHERE ${where.join(' AND ')}
         ORDER BY occurred_at DESC, id DESC
         LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    )).rows;
    return { items, total };
  }

  // -------------------------- schedules --------------------------

  async listSchedules(filter: { is_active?: boolean } = {}): Promise<Array<Record<string, unknown>>> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.is_active !== undefined) { where.push(`is_active = $${i++}`); params.push(filter.is_active); }
    const r = await this.pool.query(
      `SELECT s.*, src.code AS source_code, src.source_type
         FROM integration_schedules s
         JOIN integration_sources src ON src.id = s.source_id
        WHERE ${where.join(' AND ')}
        ORDER BY s.next_run_at NULLS LAST, s.created_at`,
      params
    );
    return r.rows;
  }

  async findDueSchedules(now = new Date()): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT s.*, src.source_type
         FROM integration_schedules s
         JOIN integration_sources src ON src.id = s.source_id
        WHERE s.is_active = TRUE
          AND s.deleted_at IS NULL
          AND src.is_active = TRUE
          AND src.deleted_at IS NULL
          AND (s.next_run_at IS NULL OR s.next_run_at <= $1)`,
      [now]
    );
    return r.rows;
  }

  async upsertSchedule(input: {
    source_id: string;
    entity_type: string;
    job_type: JobType;
    cron_expr?: string | null;
    interval_minutes?: number | null;
    is_active?: boolean;
    user_id?: string;
  }): Promise<{ id: string }> {
    const r = await this.pool.query<{ id: string }>(
      `INSERT INTO integration_schedules
          (source_id, entity_type, job_type, cron_expr, interval_minutes, is_active, next_run_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6, NOW(), $7, $7)
       ON CONFLICT (source_id, entity_type, job_type) DO UPDATE
         SET cron_expr = EXCLUDED.cron_expr,
             interval_minutes = EXCLUDED.interval_minutes,
             is_active = EXCLUDED.is_active,
             updated_by = EXCLUDED.updated_by
       RETURNING id`,
      [
        input.source_id, input.entity_type, input.job_type,
        input.cron_expr ?? null, input.interval_minutes ?? null,
        input.is_active ?? true, input.user_id ?? null,
      ]
    );
    return r.rows[0]!;
  }

  async advanceScheduleAfterRun(scheduleId: string, jobId: string, intervalMinutes: number | null): Promise<void> {
    await this.pool.query(
      `UPDATE integration_schedules
          SET last_run_at = NOW(),
              last_job_id = $2,
              next_run_at = CASE
                WHEN $3::int IS NOT NULL THEN NOW() + ($3 || ' minutes')::interval
                ELSE NOW() + INTERVAL '1 hour'  -- fallback if cron parsing isn't wired
              END
        WHERE id = $1`,
      [scheduleId, jobId, intervalMinutes]
    );
  }

  async softDeleteSchedule(id: string, userId?: string): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE integration_schedules SET deleted_at = NOW(), is_active = FALSE, updated_by = $2
        WHERE id = $1 AND deleted_at IS NULL`,
      [id, userId ?? null]
    );
    return (r.rowCount ?? 0) > 0;
  }
}
