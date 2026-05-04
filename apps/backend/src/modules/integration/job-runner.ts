import { v4 as uuidv4 } from 'uuid';
import type { Logger } from 'pino';
import type { AdapterRegistry } from './adapters/registry.js';
import type { IntegrationRepository } from './repository.js';
import { computeBackoffMs, shouldRetry } from './retry.js';
import { withContext } from '../../lib/context.js';
import type {
  AdapterRecord,
  Cursor,
  ExtractContext,
  JobType,
  Loader,
  SourceRow,
} from './types.js';

export interface RunInput {
  source: SourceRow;
  entityType: string;
  jobType: JobType;
  triggerType: 'manual' | 'scheduled' | 'event' | 'retry' | 'api';
  triggeredBy?: string;
  parentJobId?: string;
  attemptNumber?: number;
  maxAttempts?: number;
  loader: Loader;
  /**
   * Existing trace_id to reuse (e.g., when called from an HTTP handler).
   * If omitted, a fresh UUID is minted.
   */
  traceId?: string;
  /**
   * Hard timeout for the whole job (ms). Records past this point are
   * abandoned and the job is marked `timeout`.
   */
  timeoutMs?: number;
  batchHint?: number;
}

export interface RunResult {
  job_id: string;
  trace_id: string;
  status: 'succeeded' | 'failed' | 'partial' | 'timeout';
  records_extracted: number;
  records_loaded: number;
  records_failed: number;
  records_skipped: number;
  duration_ms: number;
  error?: { class: string; message: string };
}

/**
 * The canonical "run a sync" orchestrator.
 *
 * Lifecycle:
 *   1. createJob → status = queued, persist trace_id + cursor_from
 *   2. withContext(traceId)  → all logs auto-tagged
 *   3. markJobRunning        → status = running, started_at = NOW()
 *   4. resolve adapter
 *   5. extract* iterator → loader → counters
 *   6. compute next cursor; upsert sync_snapshots
 *   7. markJobFinished with status / counters / error
 *   8. on failure: schedule next retry if attempts remain
 */
export class JobRunner {
  constructor(
    private repo: IntegrationRepository,
    private registry: AdapterRegistry,
    private logger: Logger
  ) {}

  async run(input: RunInput): Promise<RunResult> {
    const traceId = input.traceId ?? uuidv4();
    const attempt = input.attemptNumber ?? 1;
    const maxAttempts = input.maxAttempts ?? input.source.default_retry_max;

    // 1. Read existing cursor (incremental only)
    const snapshot = await this.repo.getSnapshot(input.source.id, input.entityType);
    const cursorFrom: Cursor | null =
      input.jobType === 'incremental_sync' ? (snapshot?.cursor_value ?? null) : null;

    // 2. Persist queued job
    const { id: jobId } = await this.repo.createJob({
      sourceId: input.source.id,
      sourceType: input.source.source_type,
      entityType: input.entityType,
      jobType: input.jobType,
      triggerType: input.triggerType,
      triggeredBy: input.triggeredBy,
      parentJobId: input.parentJobId,
      attemptNumber: attempt,
      maxAttempts,
      cursorFrom: cursorFrom ?? undefined,
      traceId,
      configSnapshot: {
        source_code: input.source.code,
        source_type: input.source.source_type,
        entity_type: input.entityType,
        config: input.source.config,
      },
    });

    return withContext({ traceId, startTime: Date.now() }, async () => {
      const log = this.logger.child({ jobId, sourceCode: input.source.code, entityType: input.entityType });
      const startMs = Date.now();
      let extracted = 0;
      let loaded = 0;
      let failed = 0;
      let skipped = 0;
      let lastRecord: AdapterRecord | null = null;
      let nextCursor: Cursor | null = cursorFrom;
      let timedOut = false;

      try {
        await this.repo.markJobRunning(jobId);
        await this.repo.log(jobId, 'info', `Job started (attempt ${attempt}/${maxAttempts})`, {
          phase: 'init',
          traceId,
          context: { jobType: input.jobType, cursorFrom: cursorFrom ?? null },
        });

        const adapter = this.registry.resolve(input.source.source_type);
        const ctx: ExtractContext = {
          source: input.source,
          entityType: input.entityType,
          jobId,
          traceId,
          batchHint: input.batchHint ?? 500,
        };

        const iter =
          input.jobType === 'full_sync'
            ? adapter.extractFull(ctx)
            : adapter.extractIncremental(ctx, cursorFrom);

        const deadline = input.timeoutMs ? Date.now() + input.timeoutMs : Infinity;

        for await (const record of iter) {
          if (Date.now() > deadline) {
            timedOut = true;
            await this.repo.log(jobId, 'warn', 'Job exceeded timeoutMs; aborting iteration', {
              phase: 'extract', traceId,
            });
            break;
          }
          extracted++;
          lastRecord = record;

          try {
            const result = await input.loader(record, ctx);
            switch (result.outcome) {
              case 'inserted':
              case 'updated':
                loaded++;
                break;
              case 'unchanged':
                skipped++;
                break;
              case 'failed':
                failed++;
                await this.repo.log(jobId, 'warn', `Load failed for ${record.external_id}: ${result.error ?? 'unknown'}`, {
                  phase: 'load',
                  traceId,
                  context: { external_id: record.external_id, error: result.error },
                });
                break;
            }
          } catch (e) {
            failed++;
            const err = e as Error;
            await this.repo.log(jobId, 'error', `Loader threw on ${record.external_id}: ${err.message}`, {
              phase: 'load',
              traceId,
              context: { external_id: record.external_id, stack: err.stack },
            });
          }

          if (extracted % 100 === 0) {
            await this.repo.log(jobId, 'info', `Progress: ${extracted} extracted, ${loaded} loaded, ${failed} failed`, {
              phase: 'extract', traceId,
            });
          }
        }

        // Compute next cursor — even on partial success we want to advance
        // so we don't keep replaying the same record.
        nextCursor = adapter.nextCursor(cursorFrom, lastRecord);

        // Persist snapshot when records were loaded successfully.
        if (loaded > 0 || (extracted > 0 && failed === 0)) {
          await this.repo.upsertSnapshot({
            sourceId: input.source.id,
            entityType: input.entityType,
            cursor: nextCursor ?? cursorFrom ?? {},
            job_id: jobId,
            job_type: input.jobType,
            records_synced_delta: loaded,
          });
        }

        const status: 'succeeded' | 'partial' | 'timeout' =
          timedOut ? 'timeout' : failed > 0 ? 'partial' : 'succeeded';

        await this.repo.markJobFinished(jobId, {
          status,
          cursor_to: nextCursor ?? undefined,
          records_extracted: extracted,
          records_transformed: extracted,
          records_loaded: loaded,
          records_failed: failed,
          records_skipped: skipped,
        });

        await this.repo.log(jobId, 'info', `Job ${status}: ${loaded}/${extracted} loaded (${failed} failed, ${skipped} skipped)`, {
          phase: 'finalize', traceId,
        });

        log.info({ status, extracted, loaded, failed, skipped }, 'integration_job complete');

        return {
          job_id: jobId,
          trace_id: traceId,
          status,
          records_extracted: extracted,
          records_loaded: loaded,
          records_failed: failed,
          records_skipped: skipped,
          duration_ms: Date.now() - startMs,
        };
      } catch (e) {
        const err = e as Error;
        log.error({ err }, 'integration_job failed');
        await this.repo.log(jobId, 'error', err.message, {
          phase: 'extract', traceId,
          context: { stack: err.stack },
        });

        // Schedule retry if attempts remain
        let nextRetry: Date | null = null;
        if (shouldRetry(attempt, maxAttempts)) {
          const ms = computeBackoffMs(attempt, { baseMs: input.source.default_retry_backoff_ms });
          nextRetry = new Date(Date.now() + ms);
          await this.repo.log(jobId, 'info', `Retry scheduled at ${nextRetry.toISOString()} (attempt ${attempt + 1}/${maxAttempts})`, {
            phase: 'retry', traceId,
          });
        }

        await this.repo.markJobFinished(jobId, {
          status: 'failed',
          records_extracted: extracted,
          records_transformed: extracted,
          records_loaded: loaded,
          records_failed: failed + 1,
          records_skipped: skipped,
          error_class: err.name,
          error_message: err.message,
          error_stack: err.stack ?? null,
          next_retry_at: nextRetry,
        });

        return {
          job_id: jobId,
          trace_id: traceId,
          status: 'failed',
          records_extracted: extracted,
          records_loaded: loaded,
          records_failed: failed + 1,
          records_skipped: skipped,
          duration_ms: Date.now() - startMs,
          error: { class: err.name, message: err.message },
        };
      }
    });
  }

  /**
   * Idempotent retry — picks up failed jobs whose `next_retry_at` is in the
   * past and re-runs them with attempt_number+1.
   */
  async runDueRetries(loaderResolver: (entityType: string) => Loader): Promise<RunResult[]> {
    const due = await this.repo.findRetryableJobs();
    const results: RunResult[] = [];
    for (const j of due) {
      const source = await this.repo.findSourceById(j.source_id as string);
      if (!source) continue;
      const result = await this.run({
        source,
        entityType: j.entity_type as string,
        jobType: (j.job_type ?? 'incremental_sync') as JobType,
        triggerType: 'retry',
        parentJobId: j.id as string,
        attemptNumber: (j.attempt_number as number) + 1,
        maxAttempts: j.max_attempts as number,
        loader: loaderResolver(j.entity_type as string),
        traceId: j.trace_id as string,
      });
      results.push(result);
    }
    return results;
  }
}
