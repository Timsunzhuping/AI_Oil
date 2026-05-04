import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { v4 as uuidv4 } from 'uuid';
import { withContext } from '../../../lib/context.js';
import type {
  CleaningContext,
  CleaningRunSummary,
  RawTestResultRow,
  Stage,
  WorkingRow,
} from '../types.js';
import { CleaningRepository } from '../repository.js';
import { MasterDataLookup } from '../lookup.js';
import { ResolveStage } from './stages/resolve.js';
import { ConvertStage } from './stages/convert.js';
import { ValidateStage } from './stages/validate.js';
import { LinkStage } from './stages/link.js';
import type { CompiledRule, Condition } from '../rules/engine.js';

export interface PipelineOptions {
  iqrMultiplier?: number;
  iqrMinSamples?: number;
  iqrHistoryLimit?: number;
}

export interface RunInput {
  triggerType?: 'manual' | 'scheduled' | 'integration_job' | 'api';
  triggeredBy?: string;
  sourceIntegrationJobId?: string;
  traceId?: string;
  entityType?: 'test_results';                  // extension point
  scope?: { since?: Date };
  limit?: number;
}

/**
 * The composing class. Holds the stage chain, kicks off a run, manages
 * the run-row lifecycle, and persists everything in a transaction.
 */
export class CleaningPipeline {
  constructor(
    private pool: Pool,
    private repo: CleaningRepository,
    private logger: Logger,
    private options: PipelineOptions = {}
  ) {}

  async run(input: RunInput = {}): Promise<CleaningRunSummary> {
    const traceId = input.traceId ?? uuidv4();
    const startMs = Date.now();

    // 1. Create the run row
    const { id: runId } = await this.repo.createRun({
      trigger_type: input.triggerType ?? 'manual',
      triggered_by: input.triggeredBy,
      source_integration_job_id: input.sourceIntegrationJobId,
      trace_id: traceId,
      entity_type: input.entityType ?? 'test_results',
      scope_filter: input.scope ?? {},
    });

    return withContext({ traceId, startTime: Date.now() }, async () => {
      const log = this.logger.child({ runId, module: 'cleaning' });
      log.info('cleaning run started');

      try {
        await this.repo.markRunRunning(runId);

        // 2. Build the stage chain
        const lookup = new MasterDataLookup(this.pool);
        const compiledRules = await this.loadCompiledRules();
        const stages: Stage[] = [
          new ResolveStage(lookup),
          new ConvertStage(lookup),
          new LinkStage(this.pool),
          new ValidateStage(this.repo, compiledRules, this.options),
        ];

        // 3. Pull the work
        const rows = await this.repo.streamRawTestResults({
          since: input.scope?.since,
          limit: input.limit ?? 1000,
        });
        log.info({ rows: rows.length }, 'fetched raw test_results');

        const ctx: CleaningContext = {
          runId,
          traceId,
          ...(input.triggeredBy !== undefined ? { triggeredBy: input.triggeredBy } : {}),
          scope: { entity_type: input.entityType ?? 'test_results', ...(input.scope?.since !== undefined ? { since: input.scope.since } : {}) },
          logger: log,
        };

        // 4. Process each row through all stages
        const counters = { processed: 0, normalized: 0, skipped: 0, issues: 0, outliers: 0, unresolved: 0, missing: 0 };

        for (const raw of rows) {
          counters.processed++;
          const work = makeWorkingRow(raw);

          let stageError: Error | null = null;
          for (const stage of stages) {
            try {
              await stage.process(work, ctx);
            } catch (e) {
              stageError = e as Error;
              work.issues.push({
                type: 'rule_violation',
                severity: 'error',
                rule_code: `STAGE_${stage.name.toUpperCase()}_THREW`,
                message: `Stage '${stage.name}' threw: ${(e as Error).message}`,
              });
              break;
            }
          }

          // 5. Persist normalized row + issues in one txn
          try {
            const { id: normalizedId } = await this.repo.upsertNormalized(work, runId);
            if (work.issues.length > 0) {
              await this.repo.insertIssues(work.issues, {
                run_id: runId,
                trace_id: traceId,
                entity_type: 'test_result',
                entity_id: normalizedId,
                source_entity_type: 'test_results',
                source_entity_id: work.raw.id,
              });
            }
            counters.normalized += stageError ? 0 : 1;
            counters.skipped    += stageError ? 1 : 0;
            counters.issues     += work.issues.length;
            counters.outliers   += work.is_outlier ? 1 : 0;
            counters.unresolved += work.is_unresolved ? 1 : 0;
            counters.missing    += work.is_missing ? 1 : 0;
          } catch (persistErr) {
            log.error({ err: persistErr, source_id: raw.id }, 'persist failed');
            counters.skipped++;
          }

          if (counters.processed % 100 === 0) {
            log.info(counters, 'cleaning progress');
            await this.repo.incrementRunCounters(runId, counters);
            // Reset counters between batches so we don't double-count
            for (const k of Object.keys(counters) as Array<keyof typeof counters>) counters[k] = 0;
          }
        }

        // Flush remaining counters
        await this.repo.incrementRunCounters(runId, counters);

        const status: 'succeeded' | 'partial' = counters.skipped > 0 ? 'partial' : 'succeeded';
        await this.repo.markRunFinished(runId, status);

        const summary = await this.summarize(runId, traceId, status, startMs);
        log.info(summary, 'cleaning run complete');
        return summary;
      } catch (e) {
        const err = e as Error;
        log.error({ err }, 'cleaning run failed');
        await this.repo.markRunFinished(runId, 'failed', err.message);
        return {
          run_id: runId,
          trace_id: traceId,
          status: 'failed',
          records_processed: 0,
          records_normalized: 0,
          records_skipped: 0,
          issues_found: 0,
          outliers_found: 0,
          unresolved_found: 0,
          missing_found: 0,
          duration_ms: Date.now() - startMs,
          error: err.message,
        };
      }
    });
  }

  private async loadCompiledRules(): Promise<CompiledRule[]> {
    const rows = await this.repo.listActiveRules('test_result');
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      severity: r.severity as CompiledRule['severity'],
      scope: r.scope,
      rule_type: r.rule_type,
      condition: r.condition_expr as Condition,
      action: r.action_expr as Record<string, unknown>,
      priority: r.priority,
    }));
  }

  private async summarize(runId: string, traceId: string, status: 'succeeded' | 'partial', startMs: number): Promise<CleaningRunSummary> {
    const r = await this.repo.findRun(runId);
    return {
      run_id: runId,
      trace_id: traceId,
      status,
      records_processed: Number((r as { records_processed?: number })?.records_processed ?? 0),
      records_normalized: Number((r as { records_normalized?: number })?.records_normalized ?? 0),
      records_skipped: Number((r as { records_skipped?: number })?.records_skipped ?? 0),
      issues_found: Number((r as { issues_found?: number })?.issues_found ?? 0),
      outliers_found: Number((r as { outliers_found?: number })?.outliers_found ?? 0),
      unresolved_found: Number((r as { unresolved_found?: number })?.unresolved_found ?? 0),
      missing_found: Number((r as { missing_found?: number })?.missing_found ?? 0),
      duration_ms: Date.now() - startMs,
    };
  }
}

function makeWorkingRow(raw: RawTestResultRow): WorkingRow {
  return {
    raw,
    metric: null,
    metric_resolution: null,
    raw_unit_obj: null,
    target_unit: null,
    normalized_value: null,
    normalized_unit: null,
    conversion_applied: false,
    conversion_factor: null,
    conversion_offset: null,
    is_missing: false,
    is_unresolved: false,
    is_outlier: false,
    outlier_methods: [],
    outlier_score: null,
    pass: null,
    formula_id: null,
    formula_version_id: null,
    product_id: null,
    raw_material_id: null,
    experiment_id: null,
    sample_code: null,
    batch_code: null,
    issues: [],
  };
}
