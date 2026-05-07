/**
 * ERP integration service.
 *
 * Each method:
 *   1. Creates an `erp_jobs` row in 'running' state (audit headstone)
 *   2. Calls the relevant adapter under `withRetry` (exponential backoff,
 *      configurable max attempts)
 *   3. Streams events into `erp_job_logs` as it goes
 *   4. Finalises the job to 'succeeded' / 'partial' / 'failed' with
 *      counters + cursor + response payload
 *   5. For LIMS create / pull, also upserts the `lims_task_links` row
 *      with the latest known status / payload
 *
 * Failures NEVER bubble up as raw exceptions to the controller — they are
 * wrapped in `BadRequestError` (validation), `NotFoundError` (link/job
 * missing), or `UpstreamError` (adapter failure after exhausting retries).
 */
import type { Logger } from 'pino';
import { BadRequestError, NotFoundError, UpstreamError } from '../../lib/errors.js';
import type { CarbonAdapter } from './adapters/carbon/index.js';
import type { LimsAdapter } from './adapters/lims/index.js';
import type { SapAdapter } from './adapters/sap/index.js';
import type { ErpRepository, InsertJobInput, InsertLogInput } from './repository.js';
import { withRetry, type RetryOptions } from './retry.js';
import type {
  CarbonFormulaInput,
  CarbonFormulaResponse,
  CarbonFormulaResult,
  CarbonLookupResponse,
  CarbonMaterialRecord,
  CreateLimsTaskResponse,
  ErpJobMode,
  ErpJobRow,
  ErpJobStatus,
  ErpOperation,
  ErpSourceSystem,
  JobDetailResponse,
  LimsCreateTaskInput,
  LimsTaskLinkRow,
  LimsTaskStatus,
  PullLimsResultResponse,
  SapBomLine,
  SapCostRecord,
  SapInventoryRecord,
  SapSyncRequest,
  SapSyncResponse,
} from './types.js';

export interface ErpServiceDeps {
  repository: ErpRepository;
  sap: SapAdapter;
  lims: LimsAdapter;
  carbon: CarbonAdapter;
  logger: Logger;
  /** Override sleep implementation (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

interface OpContext {
  trace_id: string;
  user_id: string | null;
}

export class ErpService {
  constructor(private readonly deps: ErpServiceDeps) {}

  // ────────────────────────────────────────────────────────────────────
  // SAP — BOM / cost / inventory sync
  // ────────────────────────────────────────────────────────────────────
  async syncBom(req: SapSyncRequest, ctx: OpContext): Promise<SapSyncResponse<SapBomLine>> {
    return this.runSapSync('sap_bom_sync', req, ctx, (input) => this.deps.sap.syncBom(input));
  }

  async syncCost(req: SapSyncRequest, ctx: OpContext): Promise<SapSyncResponse<SapCostRecord>> {
    return this.runSapSync('sap_cost_sync', req, ctx, (input) => this.deps.sap.syncCost(input));
  }

  async syncInventory(
    req: SapSyncRequest,
    ctx: OpContext
  ): Promise<SapSyncResponse<SapInventoryRecord>> {
    return this.runSapSync('sap_inventory_sync', req, ctx, (input) =>
      this.deps.sap.syncInventory(input)
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // LIMS — push (create task)
  // ────────────────────────────────────────────────────────────────────
  async createLimsTask(
    req: LimsCreateTaskInput & { max_attempts?: number },
    ctx: OpContext
  ): Promise<CreateLimsTaskResponse> {
    const startedAt = Date.now();
    const adapter = this.deps.lims.identity();
    const code = await this.deps.repository.nextJobCode();

    const job = await this.deps.repository.createJob({
      code,
      source_system: 'lims',
      operation: 'lims_create_task',
      mode: 'manual',
      trigger_type: 'api',
      adapter_name: adapter.name,
      adapter_version: adapter.version,
      adapter_mode: adapter.mode,
      max_attempts: req.max_attempts ?? 3,
      parent_job_id: null,
      reference_id: null,
      cursor_from: null,
      request_payload: {
        test_method: req.test_method,
        sample_count: req.sample_count ?? 1,
        due_date: req.due_date ?? null,
      },
      trace_id: ctx.trace_id,
      triggered_by: ctx.user_id,
      metadata: req.metadata ?? {},
    });
    await this.log(job.id, 'info', 'init', `LIMS create_task — method=${req.test_method}`, {
      formula_version_id: req.related_formula_version_id ?? null,
    });

    let output;
    try {
      output = await this.callWithRetry(job.id, req.max_attempts ?? 3, async () =>
        this.deps.lims.createTask(req, { trace_id: ctx.trace_id })
      );
    } catch (err) {
      await this.failJob(job.id, startedAt, err);
      throw new UpstreamError(`LIMS createTask failed: ${asError(err).message}`, err);
    }

    const link = await this.deps.repository.upsertLimsLink({
      external_lims_task_id: output.external_lims_task_id,
      internal_experiment_id: req.internal_experiment_id ?? null,
      related_formula_id: req.related_formula_id ?? null,
      related_formula_version_id: req.related_formula_version_id ?? null,
      test_method: req.test_method,
      sample_count: req.sample_count ?? 1,
      status: 'submitted',
      created_via: 'api',
      external_url: output.external_url ?? null,
      external_status_raw: output.external_status_raw ?? null,
      request_payload: {
        test_method: req.test_method,
        sample_count: req.sample_count ?? 1,
        notes: req.notes ?? null,
        due_date: req.due_date ?? null,
      },
      result_payload: null,
      result_pulled_at: null,
      last_create_job_id: job.id,
      last_pull_job_id: null,
      metadata: req.metadata ?? {},
      trace_id: ctx.trace_id,
      created_by: ctx.user_id,
    });

    const finalJob = await this.deps.repository.finaliseJob(job.id, {
      status: 'succeeded',
      duration_ms: Date.now() - startedAt,
      reference_id: link.id,
      response_payload: {
        external_lims_task_id: output.external_lims_task_id,
        accepted: output.accepted,
      },
      records_loaded: 1,
    });
    await this.log(job.id, 'info', 'finalize', 'LIMS task created', {
      link_id: link.id,
      external_lims_task_id: output.external_lims_task_id,
    });
    return {
      job_id: (finalJob ?? job).id,
      link,
      trace_id: ctx.trace_id,
      duration_ms: Date.now() - startedAt,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // LIMS — pull (result)
  // ────────────────────────────────────────────────────────────────────
  async pullLimsResult(
    linkId: string,
    overrides: { external_lims_task_id?: string; max_attempts?: number },
    ctx: OpContext
  ): Promise<PullLimsResultResponse> {
    const startedAt = Date.now();
    const link = await this.deps.repository.findLimsLink(linkId);
    if (!link) throw new NotFoundError('LIMS task link');
    const externalId = overrides.external_lims_task_id ?? link.external_lims_task_id;

    const adapter = this.deps.lims.identity();
    const code = await this.deps.repository.nextJobCode();
    const job = await this.deps.repository.createJob({
      code,
      source_system: 'lims',
      operation: 'lims_pull_result',
      mode: 'manual',
      trigger_type: 'api',
      adapter_name: adapter.name,
      adapter_version: adapter.version,
      adapter_mode: adapter.mode,
      max_attempts: overrides.max_attempts ?? 3,
      parent_job_id: null,
      reference_id: link.id,
      cursor_from: null,
      request_payload: { external_lims_task_id: externalId },
      trace_id: ctx.trace_id,
      triggered_by: ctx.user_id,
      metadata: {},
    });
    await this.log(job.id, 'info', 'init', `LIMS pull_result — external=${externalId}`);

    let pulled;
    try {
      pulled = await this.callWithRetry(job.id, overrides.max_attempts ?? 3, async () =>
        this.deps.lims.pullResult(externalId, { trace_id: ctx.trace_id })
      );
    } catch (err) {
      await this.failJob(job.id, startedAt, err);
      throw new UpstreamError(`LIMS pullResult failed: ${asError(err).message}`, err);
    }

    const updated = await this.deps.repository.upsertLimsLink({
      external_lims_task_id: externalId,
      internal_experiment_id: link.internal_experiment_id,
      related_formula_id: link.related_formula_id,
      related_formula_version_id: link.related_formula_version_id,
      test_method: link.test_method,
      sample_count: link.sample_count,
      status: pulled.status,
      created_via: link.created_via,
      external_url: link.external_url,
      external_status_raw: pulled.external_status_raw ?? null,
      request_payload: link.request_payload,
      result_payload: pulled.raw_payload ?? { metrics: pulled.metrics ?? [] },
      result_pulled_at: new Date().toISOString(),
      last_create_job_id: link.last_create_job_id,
      last_pull_job_id: job.id,
      metadata: link.metadata,
      trace_id: ctx.trace_id,
      created_by: ctx.user_id,
    });

    const finalJob = await this.deps.repository.finaliseJob(job.id, {
      status: pulled.status === 'failed' ? 'partial' : 'succeeded',
      duration_ms: Date.now() - startedAt,
      records_loaded: (pulled.metrics ?? []).length,
      response_payload: { status: pulled.status, metrics: pulled.metrics ?? [] },
    });
    await this.log(job.id, 'info', 'finalize', `LIMS result pulled — status=${pulled.status}`, {
      link_id: link.id,
      metrics: (pulled.metrics ?? []).length,
    });
    return {
      job_id: (finalJob ?? job).id,
      link: updated,
      status: pulled.status,
      metrics: pulled.metrics ?? [],
      trace_id: ctx.trace_id,
      duration_ms: Date.now() - startedAt,
    };
  }

  async listLimsLinks(filter: {
    status?: LimsTaskStatus;
    test_method?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: LimsTaskLinkRow[]; total: number }> {
    return this.deps.repository.listLimsLinks(filter);
  }

  async getLimsLink(id: string): Promise<LimsTaskLinkRow> {
    const row = await this.deps.repository.findLimsLink(id);
    if (!row) throw new NotFoundError('LIMS task link');
    return row;
  }

  // ────────────────────────────────────────────────────────────────────
  // Carbon — material lookup + formula estimate
  // ────────────────────────────────────────────────────────────────────
  async lookupMaterialCarbon(materialCode: string, ctx: OpContext): Promise<CarbonLookupResponse> {
    const startedAt = Date.now();
    const adapter = this.deps.carbon.identity();
    const code = await this.deps.repository.nextJobCode();
    const job = await this.deps.repository.createJob({
      code,
      source_system: 'carbon',
      operation: 'carbon_material_lookup',
      mode: 'manual',
      trigger_type: 'api',
      adapter_name: adapter.name,
      adapter_version: adapter.version,
      adapter_mode: adapter.mode,
      max_attempts: 1,
      parent_job_id: null,
      reference_id: null,
      cursor_from: null,
      request_payload: { material_code: materialCode },
      trace_id: ctx.trace_id,
      triggered_by: ctx.user_id,
      metadata: {},
    });

    let record: CarbonMaterialRecord | null;
    try {
      record = await this.deps.carbon.lookupMaterial(materialCode, { trace_id: ctx.trace_id });
    } catch (err) {
      await this.failJob(job.id, startedAt, err);
      throw new UpstreamError(`Carbon lookup failed: ${asError(err).message}`, err);
    }

    if (!record) {
      await this.deps.repository.finaliseJob(job.id, {
        status: 'partial',
        duration_ms: Date.now() - startedAt,
        records_loaded: 0,
      });
      throw new NotFoundError(`Carbon factor for material '${materialCode}'`);
    }

    await this.deps.repository.finaliseJob(job.id, {
      status: 'succeeded',
      duration_ms: Date.now() - startedAt,
      records_loaded: 1,
      response_payload: {
        material_code: record.material_code,
        kgCO2e_per_kg: record.kgCO2e_per_kg,
        source: record.source,
      },
    });

    return {
      job_id: job.id,
      record,
      trace_id: ctx.trace_id,
    };
  }

  async estimateFormulaCarbon(
    input: CarbonFormulaInput,
    ctx: OpContext
  ): Promise<CarbonFormulaResponse> {
    if (!input.bom?.length) throw new BadRequestError('bom must contain at least one entry');
    const startedAt = Date.now();
    const adapter = this.deps.carbon.identity();
    const code = await this.deps.repository.nextJobCode();
    const job = await this.deps.repository.createJob({
      code,
      source_system: 'carbon',
      operation: 'carbon_formula_estimate',
      mode: 'manual',
      trigger_type: 'api',
      adapter_name: adapter.name,
      adapter_version: adapter.version,
      adapter_mode: adapter.mode,
      max_attempts: 1,
      parent_job_id: null,
      reference_id: null,
      cursor_from: null,
      request_payload: input as unknown as Record<string, unknown>,
      trace_id: ctx.trace_id,
      triggered_by: ctx.user_id,
      metadata: {},
    });

    let result: CarbonFormulaResult;
    try {
      result = await this.deps.carbon.estimateFormula(input, { trace_id: ctx.trace_id });
    } catch (err) {
      await this.failJob(job.id, startedAt, err);
      throw new UpstreamError(`Carbon estimate failed: ${asError(err).message}`, err);
    }

    await this.deps.repository.finaliseJob(job.id, {
      status: result.missing_materials.length === 0 ? 'succeeded' : 'partial',
      duration_ms: Date.now() - startedAt,
      records_loaded: result.breakdown.length,
      records_skipped: result.missing_materials.length,
      response_payload: {
        kgCO2e_per_kg: result.kgCO2e_per_kg,
        missing_materials: result.missing_materials,
      },
    });
    return {
      job_id: job.id,
      result,
      trace_id: ctx.trace_id,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Job introspection
  // ────────────────────────────────────────────────────────────────────
  async getJob(id: string): Promise<JobDetailResponse> {
    const job = await this.deps.repository.findJob(id);
    if (!job) throw new NotFoundError('ERP job');
    const logs = await this.deps.repository.listLogs(id);
    return { job, logs };
  }

  async listJobs(filter: {
    source_system?: ErpSourceSystem;
    operation?: string;
    status?: ErpJobStatus;
    page: number;
    pageSize: number;
  }): Promise<{ items: ErpJobRow[]; total: number }> {
    return this.deps.repository.listJobs(filter);
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  private async runSapSync<T extends { external_updated_at?: string }>(
    operation: ErpOperation,
    req: SapSyncRequest,
    ctx: OpContext,
    callAdapter: (input: {
      mode: ErpJobMode;
      cursor: Record<string, unknown> | null;
      limit?: number;
      trace_id: string;
    }) => Promise<{ records: T[]; next_cursor: Record<string, unknown> | null }>
  ): Promise<SapSyncResponse<T>> {
    const startedAt = Date.now();
    const mode: ErpJobMode = req.mode ?? 'incremental';
    const cursorFrom = req.cursor ?? null;
    const adapter = this.deps.sap.identity();
    const code = await this.deps.repository.nextJobCode();

    const job = await this.deps.repository.createJob({
      code,
      source_system: 'sap',
      operation,
      mode,
      trigger_type: 'api',
      adapter_name: adapter.name,
      adapter_version: adapter.version,
      adapter_mode: adapter.mode,
      max_attempts: req.max_attempts ?? 3,
      parent_job_id: null,
      reference_id: null,
      cursor_from: cursorFrom,
      request_payload: { mode, cursor: cursorFrom, limit: req.limit ?? 100 },
      trace_id: ctx.trace_id,
      triggered_by: ctx.user_id,
      metadata: req.metadata ?? {},
    });
    await this.log(job.id, 'info', 'init', `SAP sync — operation=${operation}, mode=${mode}`);

    let result;
    try {
      result = await this.callWithRetry(job.id, req.max_attempts ?? 3, async () =>
        callAdapter({
          mode,
          cursor: cursorFrom,
          ...(req.limit !== undefined ? { limit: req.limit } : {}),
          trace_id: ctx.trace_id,
        })
      );
    } catch (err) {
      await this.failJob(job.id, startedAt, err);
      throw new UpstreamError(`SAP ${operation} failed: ${asError(err).message}`, err);
    }

    const finalJob = await this.deps.repository.finaliseJob(job.id, {
      status: 'succeeded',
      duration_ms: Date.now() - startedAt,
      cursor_to: result.next_cursor,
      records_extracted: result.records.length,
      records_loaded: result.records.length,
      response_payload: {
        record_count: result.records.length,
        first_id: result.records[0]?.['external_id' as never] ?? null,
      },
    });
    await this.log(
      job.id,
      'info',
      'finalize',
      `SAP sync complete — ${result.records.length} records`
    );

    return {
      job_id: (finalJob ?? job).id,
      status: (finalJob ?? job).status,
      records_extracted: result.records.length,
      records_loaded: result.records.length,
      records_failed: 0,
      cursor_from: cursorFrom,
      cursor_to: result.next_cursor,
      records: result.records,
      trace_id: ctx.trace_id,
      duration_ms: Date.now() - startedAt,
    };
  }

  /** Wraps `withRetry` with audit logging hooks on each attempt / failure. */
  private async callWithRetry<T>(
    jobId: string,
    maxAttempts: number,
    fn: () => Promise<T>
  ): Promise<T> {
    const opts: RetryOptions = {
      maxAttempts,
      ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}),
      hooks: {
        onAttempt: async (attempt) => {
          if (attempt > 1) {
            await this.deps.repository.incrementAttempt(jobId);
            await this.log(jobId, 'warn', 'retry', `Retrying — attempt ${attempt}`);
          }
        },
        onFailure: async (attempt, err, willRetry) => {
          await this.log(
            jobId,
            willRetry ? 'warn' : 'error',
            'response',
            `Attempt ${attempt} failed: ${asError(err).message}`,
            { error_class: asError(err).name, will_retry: willRetry }
          );
        },
      },
    };
    return withRetry(() => fn(), opts);
  }

  private async failJob(jobId: string, startedAt: number, err: unknown): Promise<void> {
    const e = asError(err);
    await this.deps.repository.finaliseJob(jobId, {
      status: 'failed',
      duration_ms: Date.now() - startedAt,
      error_class: e.name,
      error_message: e.message,
    });
    this.deps.logger.warn({ err, jobId }, 'ERP job failed after retries');
  }

  private async log(
    job_id: string,
    level: InsertLogInput['level'],
    phase: InsertLogInput['phase'],
    message: string,
    context: Record<string, unknown> = {}
  ): Promise<void> {
    try {
      await this.deps.repository.insertLog({
        job_id,
        level,
        phase,
        message,
        context,
        trace_id: null,
      });
    } catch (err) {
      // Logging failure must never crash the business operation.
      this.deps.logger.warn({ err, job_id, message }, 'Failed to write erp_job_logs row');
    }
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────
function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

// Re-export needed types so consumers don't have to thread imports.
export type { InsertJobInput };
