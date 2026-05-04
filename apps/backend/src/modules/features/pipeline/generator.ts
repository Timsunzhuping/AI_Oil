import { v4 as uuidv4 } from 'uuid';
import type { Logger } from 'pino';
import { withContext } from '../../../lib/context.js';
import { FeaturesRepository } from '../repository.js';
import { buildFeatureSet, defaultExtractors } from './builder.js';
import type { CompositionVector, FeatureGenerationRunSummary, FormulaVersionInputs } from '../types.js';

export interface GenerateInput {
  feature_set_version?: string;     // default 'v1.0'
  triggerType?: 'manual' | 'scheduled' | 'api' | 'cleaning_run';
  triggeredBy?: string;
  sourceCleaningRunId?: string;
  traceId?: string;
  scope?: {
    formula_ids?: string[];
    product_category_code?: string;
    only_approved?: boolean;
  };
  limit?: number;
}

/**
 * Feature generation orchestrator.
 *
 * One run produces:
 *   • formula_version_features rows           (one per formula_version)
 *   • mart_forward_training_sample rows       (one per formula_version × batch)
 *   • mart_inverse_generation_base rows       (one per formula_version,
 *                                              with batch-averaged metrics)
 *
 * All in one pass, all in one feature_set_version.
 */
export class FeatureGenerator {
  constructor(
    private repo: FeaturesRepository,
    private logger: Logger,
    private extractors = defaultExtractors()
  ) {}

  async run(input: GenerateInput = {}): Promise<FeatureGenerationRunSummary> {
    const traceId = input.traceId ?? uuidv4();
    const featureSetVersion = input.feature_set_version ?? 'v1.0';
    const startMs = Date.now();

    const { id: runId } = await this.repo.createRun({
      feature_set_version: featureSetVersion,
      trigger_type: input.triggerType ?? 'manual',
      triggered_by: input.triggeredBy,
      source_cleaning_run_id: input.sourceCleaningRunId,
      trace_id: traceId,
      scope_filter: input.scope ?? {},
    });

    return withContext({ traceId, startTime: Date.now() }, async () => {
      const log = this.logger.child({ runId, module: 'features', featureSetVersion });
      log.info('feature generation run started');

      try {
        await this.repo.markRunRunning(runId);

        // 1. Fetch inputs
        const versions = await this.repo.listFormulaVersionInputs({
          ...(input.scope?.formula_ids ? { formula_ids: input.scope.formula_ids } : {}),
          ...(input.scope?.product_category_code ? { product_category_code: input.scope.product_category_code } : {}),
          ...(input.scope?.only_approved !== undefined ? { only_approved: input.scope.only_approved } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        });
        log.info({ count: versions.length }, 'fetched formula_version inputs');
        if (versions.length === 0) {
          await this.repo.markRunFinished(runId, 'succeeded');
          return this.summary(runId, traceId, featureSetVersion, 'succeeded', startMs);
        }

        // 2. Fetch achieved targets (averaged + per-batch)
        const versionIds = versions.map((v) => v.formula_version_id);
        const [achievedMap, batchMap] = await Promise.all([
          this.repo.loadAchievedMetrics(versionIds),
          this.repo.loadBatchTargets(versionIds),
        ]);

        // 3. Per-version processing
        const counters = { processed: 0, generated: 0, failed: 0, skipped: 0 };

        for (const v of versions) {
          counters.processed++;
          try {
            // 3a. Build the feature set
            const fset = buildFeatureSet(v, featureSetVersion, this.extractors);
            await this.repo.upsertFormulaVersionFeatures(fset, runId);

            // 3b. Inverse anchor (one per formula_version)
            const compositionVector = makeCompositionVector(v);
            const achieved = achievedMap.get(v.formula_version_id) ?? {};
            const sampleSize = sumSampleSize(achieved);

            await this.repo.upsertInverseAnchor({
              feature_set_version: featureSetVersion,
              generation_run_id: runId,
              formula_version_id: v.formula_version_id,
              formula_id: v.formula_id,
              product_id: v.product_id,
              product_category_code: v.product_category_code,
              features: fset.features,
              composition_vector: compositionVector,
              achieved_metrics: achieved,
              sample_size: sampleSize,
              cost_target: fset.hot.total_cost,
              cost_currency: v.cost_currency,
            });

            // 3c. Forward samples (one per batch)
            const batches = batchMap.get(v.formula_version_id) ?? [];
            if (batches.length === 0) {
              // No targets — still write an X-only sample so the inverse base
              // has lineage; mark has_targets = false so the forward trainer
              // can filter it out.
              await this.repo.upsertForwardSample({
                feature_set_version: featureSetVersion,
                generation_run_id: runId,
                formula_version_id: v.formula_version_id,
                formula_id: v.formula_id,
                product_id: v.product_id,
                product_category_code: v.product_category_code,
                batch_code: null,
                features: fset.features,
                target_metrics: {},
                target_metric_codes: [],
                is_outlier: false,
                is_complete: !fset.has_missing_inputs,
                has_targets: false,
                weight: 0.5, // de-weight in trainers since no y
                source_normalized_test_result_ids: [],
                measured_at: null,
              });
            } else {
              for (const b of batches) {
                await this.repo.upsertForwardSample({
                  feature_set_version: featureSetVersion,
                  generation_run_id: runId,
                  formula_version_id: v.formula_version_id,
                  formula_id: v.formula_id,
                  product_id: v.product_id,
                  product_category_code: v.product_category_code,
                  batch_code: b.batch_code,
                  features: fset.features,
                  target_metrics: b.target_metrics,
                  target_metric_codes: b.target_metric_codes,
                  is_outlier: b.is_outlier,
                  is_complete: !fset.has_missing_inputs,
                  has_targets: Object.keys(b.target_metrics).length > 0,
                  weight: b.is_outlier ? 0.3 : 1.0,
                  source_normalized_test_result_ids: b.source_normalized_test_result_ids,
                  measured_at: b.measured_at,
                });
              }
            }
            counters.generated++;
          } catch (err) {
            counters.failed++;
            log.error({ err, formula_version_id: v.formula_version_id }, 'feature generation failed for version');
          }

          if (counters.processed % 50 === 0) {
            await this.repo.incrementRunCounters(runId, counters);
            for (const k of Object.keys(counters) as Array<keyof typeof counters>) counters[k] = 0;
          }
        }
        await this.repo.incrementRunCounters(runId, counters);

        const status = counters.failed > 0 ? 'partial' : 'succeeded';
        await this.repo.markRunFinished(runId, status);
        const summary = await this.summary(runId, traceId, featureSetVersion, status, startMs);
        log.info(summary, 'feature generation run complete');
        return summary;
      } catch (e) {
        const err = e as Error;
        log.error({ err }, 'feature generation run failed');
        await this.repo.markRunFinished(runId, 'failed', err.message);
        return this.summary(runId, traceId, featureSetVersion, 'failed', startMs, err.message);
      }
    });
  }

  private async summary(
    runId: string,
    traceId: string,
    featureSetVersion: string,
    status: 'succeeded' | 'partial' | 'failed',
    startMs: number,
    error?: string
  ): Promise<FeatureGenerationRunSummary> {
    const r = (await this.repo.findRun(runId)) as Record<string, number | string> | null;
    return {
      run_id: runId,
      trace_id: traceId,
      feature_set_version: featureSetVersion,
      status,
      records_processed: Number(r?.records_processed ?? 0),
      records_generated: Number(r?.records_generated ?? 0),
      records_failed: Number(r?.records_failed ?? 0),
      records_skipped: Number(r?.records_skipped ?? 0),
      duration_ms: Date.now() - startMs,
      ...(error !== undefined ? { error } : {}),
    };
  }
}

function makeCompositionVector(v: FormulaVersionInputs): CompositionVector {
  const vec: CompositionVector = {};
  for (const i of v.items) {
    if (!i.raw_material_id) continue;
    const pct = i.percentage ?? 0;
    vec[i.raw_material_id] = (vec[i.raw_material_id] ?? 0) + pct;
  }
  return vec;
}

function sumSampleSize(achieved: Record<string, { count: number }>): number {
  return Object.values(achieved).reduce((m, v) => Math.max(m, v.count), 0);
}
