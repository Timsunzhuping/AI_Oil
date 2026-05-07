/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * In-memory ErpRepository fake — used by service tests so we don't need
 * Postgres to exercise orchestration logic.
 */
import { randomUUID } from 'node:crypto';
import type {
  ErpJobLogRow,
  ErpJobRow,
  ErpJobStatus,
  ErpOperation,
  ErpSourceSystem,
  LimsTaskLinkRow,
  LimsTaskStatus,
} from '../../../src/modules/erp/types.js';
import type {
  FinaliseJobInput,
  InsertJobInput,
  InsertLogInput,
  UpsertLimsLinkInput,
} from '../../../src/modules/erp/repository.js';

export class FakeErpRepository {
  jobs = new Map<string, ErpJobRow>();
  logs = new Map<string, ErpJobLogRow[]>();
  links = new Map<string, LimsTaskLinkRow>();
  private codeCounter = 1;

  async nextJobCode(): Promise<string> {
    return `ERP-2026-${String(this.codeCounter++).padStart(6, '0')}`;
  }

  async createJob(input: InsertJobInput): Promise<ErpJobRow> {
    const now = new Date().toISOString();
    const row: ErpJobRow = {
      id: randomUUID(),
      code: input.code,
      source_system: input.source_system,
      operation: input.operation,
      mode: input.mode,
      trigger_type: input.trigger_type,
      adapter_name: input.adapter_name,
      adapter_version: input.adapter_version,
      adapter_mode: input.adapter_mode,
      status: 'running',
      attempt_number: 1,
      max_attempts: input.max_attempts,
      parent_job_id: input.parent_job_id,
      started_at: now,
      completed_at: null,
      duration_ms: 0,
      cursor_from: input.cursor_from,
      cursor_to: null,
      records_extracted: 0,
      records_loaded: 0,
      records_failed: 0,
      records_skipped: 0,
      reference_id: input.reference_id,
      request_payload: input.request_payload,
      response_payload: null,
      error_class: null,
      error_message: null,
      trace_id: input.trace_id,
      triggered_by: input.triggered_by,
      metadata: input.metadata,
      created_at: now,
      updated_at: now,
      version: 1,
    };
    this.jobs.set(row.id, row);
    this.logs.set(row.id, []);
    return row;
  }

  async incrementAttempt(jobId: string): Promise<ErpJobRow | null> {
    const j = this.jobs.get(jobId);
    if (!j) return null;
    j.attempt_number += 1;
    return j;
  }

  async finaliseJob(jobId: string, input: FinaliseJobInput): Promise<ErpJobRow | null> {
    const j = this.jobs.get(jobId);
    if (!j) return null;
    j.status = input.status;
    j.completed_at = new Date().toISOString();
    j.duration_ms = input.duration_ms;
    if (input.cursor_to !== undefined) j.cursor_to = input.cursor_to ?? null;
    if (input.records_extracted !== undefined) j.records_extracted = input.records_extracted;
    if (input.records_loaded !== undefined) j.records_loaded = input.records_loaded;
    if (input.records_failed !== undefined) j.records_failed = input.records_failed;
    if (input.records_skipped !== undefined) j.records_skipped = input.records_skipped;
    if (input.reference_id !== undefined) j.reference_id = input.reference_id ?? null;
    if (input.response_payload !== undefined) j.response_payload = input.response_payload ?? null;
    j.error_class = input.error_class ?? null;
    j.error_message = input.error_message ?? null;
    return j;
  }

  async findJob(id: string): Promise<ErpJobRow | null> {
    return this.jobs.get(id) ?? null;
  }

  async listJobs(filter: {
    source_system?: ErpSourceSystem;
    operation?: string;
    status?: ErpJobStatus;
    page: number;
    pageSize: number;
  }): Promise<{ items: ErpJobRow[]; total: number }> {
    const all = [...this.jobs.values()].filter(
      (j) =>
        (!filter.source_system || j.source_system === filter.source_system) &&
        (!filter.operation || j.operation === (filter.operation as ErpOperation)) &&
        (!filter.status || j.status === filter.status)
    );
    const start = (filter.page - 1) * filter.pageSize;
    return { items: all.slice(start, start + filter.pageSize), total: all.length };
  }

  async insertLog(input: InsertLogInput): Promise<ErpJobLogRow> {
    const row: ErpJobLogRow = {
      id: randomUUID(),
      job_id: input.job_id,
      level: input.level,
      phase: input.phase,
      message: input.message,
      context: input.context ?? {},
      trace_id: input.trace_id,
      occurred_at: new Date().toISOString(),
    };
    const list = this.logs.get(input.job_id) ?? [];
    list.push(row);
    this.logs.set(input.job_id, list);
    return row;
  }

  async listLogs(jobId: string): Promise<ErpJobLogRow[]> {
    return this.logs.get(jobId) ?? [];
  }

  async upsertLimsLink(input: UpsertLimsLinkInput): Promise<LimsTaskLinkRow> {
    const existing = [...this.links.values()].find(
      (l) => l.external_lims_task_id === input.external_lims_task_id
    );
    if (existing) {
      existing.status = input.status;
      existing.external_url = input.external_url ?? existing.external_url;
      existing.external_status_raw = input.external_status_raw;
      if (input.result_payload !== null) existing.result_payload = input.result_payload;
      if (input.result_pulled_at !== null) existing.result_pulled_at = input.result_pulled_at;
      if (input.last_create_job_id !== null) existing.last_create_job_id = input.last_create_job_id;
      if (input.last_pull_job_id !== null) existing.last_pull_job_id = input.last_pull_job_id;
      existing.last_sync_at = new Date().toISOString();
      existing.metadata = { ...existing.metadata, ...input.metadata };
      existing.trace_id = input.trace_id;
      return existing;
    }
    const now = new Date().toISOString();
    const row: LimsTaskLinkRow = {
      id: randomUUID(),
      external_lims_task_id: input.external_lims_task_id,
      internal_experiment_id: input.internal_experiment_id,
      related_formula_id: input.related_formula_id,
      related_formula_version_id: input.related_formula_version_id,
      test_method: input.test_method,
      sample_count: input.sample_count,
      status: input.status,
      created_via: input.created_via,
      external_url: input.external_url,
      external_status_raw: input.external_status_raw,
      request_payload: input.request_payload,
      result_payload: input.result_payload,
      result_pulled_at: input.result_pulled_at,
      last_create_job_id: input.last_create_job_id,
      last_pull_job_id: input.last_pull_job_id,
      last_sync_at: now,
      metadata: input.metadata,
      trace_id: input.trace_id,
      created_at: now,
      updated_at: now,
      created_by: input.created_by,
      version: 1,
    };
    this.links.set(row.id, row);
    return row;
  }

  async findLimsLink(id: string): Promise<LimsTaskLinkRow | null> {
    return this.links.get(id) ?? null;
  }

  async findLimsLinkByExternalId(externalId: string): Promise<LimsTaskLinkRow | null> {
    return [...this.links.values()].find((l) => l.external_lims_task_id === externalId) ?? null;
  }

  async listLimsLinks(filter: {
    status?: LimsTaskStatus;
    test_method?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: LimsTaskLinkRow[]; total: number }> {
    const all = [...this.links.values()].filter(
      (l) =>
        (!filter.status || l.status === filter.status) &&
        (!filter.test_method || l.test_method === filter.test_method)
    );
    const start = (filter.page - 1) * filter.pageSize;
    return { items: all.slice(start, start + filter.pageSize), total: all.length };
  }
}
