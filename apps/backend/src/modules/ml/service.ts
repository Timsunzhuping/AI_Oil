/**
 * MLOps platform service.
 *
 * Orchestrates:
 *   • dataset / feature-template / model registry CRUD
 *   • training-job lifecycle (queued → running → succeeded/failed)
 *     – calls into TrainerAdapter
 *     – on success, registers a new ml_model_versions row
 *   • release / rollback (writes ml_model_releases + flips deployment_status)
 *   • compare reports (pure derivation from version metrics)
 *   • auto-finetune triggers + manual-retrain entry
 */
import type { Logger } from 'pino';
import { BadRequestError, ConflictError, NotFoundError, UpstreamError } from '../../lib/errors.js';
import type { TrainerAdapter, TrainInput } from './adapters/trainer/index.js';
import type { MlRepository } from './repository.js';
import { assertTrainingJobTransition, assertVersionTransition } from './state-machine.js';
import type {
  AutoFinetuneTriggerInput,
  AutoFinetuneTriggerRow,
  CompareReport,
  CompareReportEntry,
  CompareReportMetricRow,
  CreateTrainingJobResponse,
  DatasetInput,
  DatasetRow,
  FeatureTemplateInput,
  FeatureTemplateRow,
  ManualRetrainInput,
  ModelInput,
  ModelLifecycleStatus,
  ModelRow,
  ModelVersionRow,
  ReleaseEnvironment,
  ReleaseInput,
  ReleaseResponse,
  ReleaseRow,
  RollbackInput,
  TrainingConfig,
  TrainingJobInput,
  TrainingJobRow,
  TrainingJobTriggerType,
  KbStatus,
  MlTaskType,
} from './types.js';

interface OpContext {
  trace_id: string;
  user_id: string | null;
}

export interface MlServiceDeps {
  repository: MlRepository;
  trainer: TrainerAdapter;
  logger: Logger;
}

export class MlService {
  constructor(private readonly deps: MlServiceDeps) {}

  // ────────────────────────────────────────────────────────────────────
  // Datasets
  // ────────────────────────────────────────────────────────────────────
  async createDataset(input: DatasetInput, ctx: OpContext): Promise<DatasetRow> {
    const code = input.code ?? (await this.deps.repository.nextDatasetCode());
    return this.deps.repository.createDataset(input, code, ctx.user_id);
  }

  async getDataset(id: string): Promise<DatasetRow> {
    const row = await this.deps.repository.findDataset(id);
    if (!row) throw new NotFoundError('Dataset');
    return row;
  }

  async listDatasets(filter: { q?: string; page: number; pageSize: number }) {
    return this.deps.repository.listDatasets(filter);
  }

  // ────────────────────────────────────────────────────────────────────
  // Feature templates
  // ────────────────────────────────────────────────────────────────────
  async createFeatureTemplate(
    input: FeatureTemplateInput,
    ctx: OpContext
  ): Promise<FeatureTemplateRow> {
    const code = await this.deps.repository.nextFeatureTemplateCode();
    return this.deps.repository.createFeatureTemplate(input, code, ctx.user_id);
  }

  async getFeatureTemplate(id: string): Promise<FeatureTemplateRow> {
    const row = await this.deps.repository.findFeatureTemplate(id);
    if (!row) throw new NotFoundError('Feature template');
    return row;
  }

  async listFeatureTemplates(filter: {
    task_type?: MlTaskType;
    status?: KbStatus;
    page: number;
    pageSize: number;
  }) {
    return this.deps.repository.listFeatureTemplates(filter);
  }

  // ────────────────────────────────────────────────────────────────────
  // Models
  // ────────────────────────────────────────────────────────────────────
  async createModel(input: ModelInput, ctx: OpContext): Promise<ModelRow> {
    const code = input.code ?? (await this.deps.repository.nextModelCode());
    return this.deps.repository.createModel(input, code, ctx.user_id);
  }

  async getModel(id: string): Promise<ModelRow> {
    const row = await this.deps.repository.findModel(id);
    if (!row) throw new NotFoundError('Model');
    return row;
  }

  async listModels(filter: { task_type?: MlTaskType; q?: string; page: number; pageSize: number }) {
    return this.deps.repository.listModels(filter);
  }

  async listModelVersions(modelId: string): Promise<ModelVersionRow[]> {
    return this.deps.repository.listModelVersions(modelId);
  }

  // ────────────────────────────────────────────────────────────────────
  // Training jobs
  // ────────────────────────────────────────────────────────────────────
  async createTrainingJob(
    input: TrainingJobInput,
    ctx: OpContext
  ): Promise<CreateTrainingJobResponse> {
    const startedAt = Date.now();
    const code = await this.deps.repository.nextTrainingJobCode();

    // Enrich config from feature_template if supplied.
    const featureTemplate = input.feature_template_id
      ? await this.deps.repository.findFeatureTemplate(input.feature_template_id)
      : null;
    if (input.feature_template_id && !featureTemplate) throw new NotFoundError('Feature template');

    const dataset = input.dataset_id
      ? await this.deps.repository.findDataset(input.dataset_id)
      : null;
    if (input.dataset_id && !dataset) throw new NotFoundError('Dataset');

    const model = input.model_id ? await this.deps.repository.findModel(input.model_id) : null;
    if (input.model_id && !model) throw new NotFoundError('Model');

    const config: TrainingConfig = input.config ?? {};

    let job = await this.deps.repository.createTrainingJob({
      code,
      model_id: input.model_id ?? null,
      trigger_type: input.trigger_type ?? 'manual',
      triggered_by: ctx.user_id,
      dataset_id: input.dataset_id ?? null,
      config,
      source_code_commit: input.source_code_commit ?? null,
      metadata: {
        ...(input.metadata ?? {}),
        feature_template_id: input.feature_template_id ?? null,
      },
    });

    // Move queued → running. We skip the provisioning state for in-process
    // adapters; remote ones can write their own intermediate transitions.
    assertTrainingJobTransition(job.status, 'running');
    job =
      (await this.deps.repository.setTrainingJobStatus(job.id, 'running', {
        started_at: new Date(),
        progress_percentage: 0,
      })) ?? job;

    let trainOutput;
    try {
      trainOutput = await this.deps.trainer.train({
        job_id: job.id,
        dataset_id: dataset?.id ?? null,
        dataset_url: dataset?.storage_url ?? null,
        feature_spec:
          featureTemplate?.spec ??
          (config.extras?.['feature_spec'] as Record<string, unknown> | undefined),
        task_type:
          model?.task_type ??
          (config.extras?.['task_type'] as MlTaskType | undefined) ??
          'regression',
        config,
        trace_id: ctx.trace_id,
        onProgress: async (pct: number) => {
          try {
            await this.deps.repository.setTrainingJobStatus(job.id, 'running', {
              progress_percentage: Math.max(0, Math.min(100, Math.round(pct))),
            });
          } catch (err) {
            this.deps.logger.warn({ err, jobId: job.id }, 'progress write failed');
          }
        },
      } as TrainInput);
    } catch (err) {
      const e = asError(err);
      assertTrainingJobTransition(job.status, 'failed');
      const completedAt = new Date();
      await this.deps.repository.setTrainingJobStatus(job.id, 'failed', {
        completed_at: completedAt,
        duration_seconds: Math.floor((Date.now() - startedAt) / 1000),
        error_message: e.message,
        progress_percentage: 100,
      });
      throw new UpstreamError(`Training failed: ${e.message}`, err);
    }

    // Register a new model_version when a model_id is provided. Standalone
    // training (no model_id) still succeeds — useful for exploratory runs.
    let producedVersion: ModelVersionRow | undefined;
    if (input.model_id) {
      producedVersion = await this.deps.repository.createModelVersion({
        model_id: input.model_id,
        artifact_url: trainOutput.artifact_url,
        artifact_hash: trainOutput.artifact_hash,
        artifact_size_bytes: trainOutput.artifact_size_bytes,
        framework_version: trainOutput.framework_version,
        training_job_id: job.id,
        training_dataset_id: input.dataset_id ?? null,
        base_model_version_id: null,
        hyperparameters: trainOutput.hyperparameters,
        features: trainOutput.features ?? null,
        output_schema: trainOutput.output_schema ?? null,
        metrics: trainOutput.metrics,
        release_notes: trainOutput.notes ?? null,
        metadata: {
          trainer_name: this.deps.trainer.identity().name,
          trainer_version: this.deps.trainer.identity().version,
        },
        created_by: ctx.user_id,
      });
    }

    assertTrainingJobTransition(job.status, 'succeeded');
    const completedAt = new Date();
    const final =
      (await this.deps.repository.setTrainingJobStatus(job.id, 'succeeded', {
        completed_at: completedAt,
        duration_seconds: Math.floor((Date.now() - startedAt) / 1000),
        progress_percentage: 100,
        metrics: trainOutput.metrics,
        artifact_url: trainOutput.artifact_url,
        produced_version_id: producedVersion?.id ?? null,
      })) ?? job;

    return {
      job: final,
      ...(producedVersion ? { produced_version: producedVersion } : {}),
      trace_id: ctx.trace_id,
      duration_ms: Date.now() - startedAt,
    };
  }

  async getTrainingJob(id: string): Promise<TrainingJobRow> {
    const row = await this.deps.repository.findTrainingJob(id);
    if (!row) throw new NotFoundError('Training job');
    return row;
  }

  async listTrainingJobs(filter: Parameters<MlRepository['listTrainingJobs']>[0]) {
    return this.deps.repository.listTrainingJobs(filter);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async cancelTrainingJob(id: string, _ctx: OpContext): Promise<TrainingJobRow> {
    const job = await this.deps.repository.findTrainingJob(id);
    if (!job) throw new NotFoundError('Training job');
    if (job.status !== 'queued' && job.status !== 'running' && job.status !== 'provisioning') {
      throw new ConflictError(`Cannot cancel job in status '${job.status}'`);
    }
    assertTrainingJobTransition(job.status, 'cancelled');
    if (this.deps.trainer.cancel) {
      try {
        await this.deps.trainer.cancel(id);
      } catch (err) {
        this.deps.logger.warn({ err, jobId: id }, 'trainer.cancel failed (continuing)');
      }
    }
    const final = await this.deps.repository.setTrainingJobStatus(id, 'cancelled', {
      completed_at: new Date(),
      progress_percentage: job.progress_percentage,
    });
    return final ?? job;
  }

  // ────────────────────────────────────────────────────────────────────
  // Release / rollback
  // ────────────────────────────────────────────────────────────────────
  async releaseModel(
    modelId: string,
    input: ReleaseInput,
    ctx: OpContext
  ): Promise<ReleaseResponse> {
    if (!input.version_id) throw new BadRequestError('version_id is required for release');
    const model = await this.deps.repository.findModel(modelId);
    if (!model) throw new NotFoundError('Model');
    const target = await this.deps.repository.findModelVersion(input.version_id);
    if (!target || target.model_id !== modelId) throw new NotFoundError('Target model version');

    const env: ReleaseEnvironment = input.environment ?? 'production';
    const previousActive = await this.deps.repository.findCurrentActiveVersion(modelId);

    /* Guardrails — pre-release regression checks against previous active. */
    const guardrails = input.guardrails ?? [];
    let guardrailsPassed: boolean | null = null;
    if (guardrails.length > 0) {
      guardrailsPassed = guardrails.every((g) => {
        const v = target.metrics[g.metric];
        if (typeof v !== 'number') return false;
        return g.comparator === 'gte' ? v >= g.threshold : v <= g.threshold;
      });
      if (!guardrailsPassed) {
        // Persist a failed release row for audit and bail.
        const code = await this.deps.repository.nextReleaseCode();
        await this.deps.repository.insertRelease({
          code,
          model_id: modelId,
          to_version_id: target.id,
          from_version_id: previousActive?.id ?? null,
          action: 'release',
          environment: env,
          status: 'failed',
          reason: input.reason ?? null,
          notes: 'guardrails not met',
          approved_by: input.approved_by ?? null,
          released_by: ctx.user_id,
          guardrails: { rules: guardrails },
          guardrails_passed: false,
          released_artifact_url: target.artifact_url,
          metrics_snapshot: target.metrics,
          metadata: input.metadata ?? {},
          trace_id: ctx.trace_id,
        });
        throw new ConflictError('Release guardrails not met');
      }
    }

    /* Demote previous active. */
    if (previousActive && previousActive.id !== target.id) {
      assertVersionTransition(previousActive.deployment_status, 'retired');
      await this.deps.repository.setVersionDeploymentStatus(
        previousActive.id,
        'retired',
        ctx.user_id
      );
    }

    /* Promote target. */
    assertVersionTransition(target.deployment_status, 'active');
    const promoted = await this.deps.repository.setVersionDeploymentStatus(
      target.id,
      'active',
      ctx.user_id
    );

    const updatedModel =
      (await this.deps.repository.updateModelCurrentVersion(
        modelId,
        target.id,
        env === 'production' ? 'production' : null
      )) ?? model;

    const code = await this.deps.repository.nextReleaseCode();
    const release = await this.deps.repository.insertRelease({
      code,
      model_id: modelId,
      to_version_id: target.id,
      from_version_id: previousActive?.id ?? null,
      action: 'release',
      environment: env,
      status: 'succeeded',
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      approved_by: input.approved_by ?? null,
      released_by: ctx.user_id,
      guardrails: { rules: guardrails },
      guardrails_passed: guardrailsPassed,
      released_artifact_url: target.artifact_url,
      metrics_snapshot: target.metrics,
      metadata: input.metadata ?? {},
      trace_id: ctx.trace_id,
    });

    return { release, model: updatedModel, active_version: promoted };
  }

  async rollbackModel(
    modelId: string,
    input: RollbackInput,
    ctx: OpContext
  ): Promise<ReleaseResponse> {
    const model = await this.deps.repository.findModel(modelId);
    if (!model) throw new NotFoundError('Model');
    const currentActive = await this.deps.repository.findCurrentActiveVersion(modelId);
    if (!currentActive) throw new ConflictError('No active version to roll back from');

    const target = input.to_version_id
      ? await this.deps.repository.findModelVersion(input.to_version_id)
      : await this.deps.repository.findPreviousActiveVersion(modelId, currentActive.id);
    if (!target || target.model_id !== modelId) {
      throw new NotFoundError(input.to_version_id ? 'Target version' : 'Previous active version');
    }
    if (target.id === currentActive.id) {
      throw new ConflictError('Rollback target equals current active version');
    }

    /* Mark current as rolled_back, target as active. */
    assertVersionTransition(currentActive.deployment_status, 'rolled_back');
    await this.deps.repository.setVersionDeploymentStatus(
      currentActive.id,
      'rolled_back',
      ctx.user_id
    );
    assertVersionTransition(target.deployment_status, 'active');
    const restored = await this.deps.repository.setVersionDeploymentStatus(
      target.id,
      'active',
      ctx.user_id
    );

    const updatedModel =
      (await this.deps.repository.updateModelCurrentVersion(modelId, target.id)) ?? model;

    const code = await this.deps.repository.nextReleaseCode();
    const release = await this.deps.repository.insertRelease({
      code,
      model_id: modelId,
      to_version_id: target.id,
      from_version_id: currentActive.id,
      action: 'rollback',
      environment: 'production',
      status: 'succeeded',
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      approved_by: input.approved_by ?? null,
      released_by: ctx.user_id,
      guardrails: {},
      guardrails_passed: null,
      released_artifact_url: target.artifact_url,
      metrics_snapshot: target.metrics,
      metadata: input.metadata ?? {},
      trace_id: ctx.trace_id,
    });

    return { release, model: updatedModel, active_version: restored };
  }

  async listReleases(modelId: string): Promise<ReleaseRow[]> {
    const model = await this.deps.repository.findModel(modelId);
    if (!model) throw new NotFoundError('Model');
    return this.deps.repository.listReleases(modelId);
  }

  // ────────────────────────────────────────────────────────────────────
  // Compare report
  // ────────────────────────────────────────────────────────────────────
  async compareModels(versionIds: string[], baselineId?: string): Promise<CompareReport> {
    if (versionIds.length === 0) throw new BadRequestError('versions must not be empty');
    const versions = await this.deps.repository.findModelVersionsByIds(versionIds);
    if (versions.length !== versionIds.length) {
      throw new NotFoundError('One or more model versions');
    }
    const orderedIds = versionIds; // preserve caller order
    const byId = new Map(versions.map((v) => [v.id, v]));
    const baselineVersionId =
      baselineId && byId.has(baselineId) ? baselineId : (orderedIds[0] as string);
    const baseline = byId.get(baselineVersionId)!;

    const modelCodes = await this.deps.repository.listModels({
      page: 1,
      pageSize: 200,
    });
    const modelCodeById = new Map(modelCodes.items.map((m) => [m.id, m.code]));

    const entries: CompareReportEntry[] = orderedIds.map((id) => {
      const v = byId.get(id)!;
      return {
        version_id: v.id,
        version_number: v.version_number,
        version_label: v.version_label,
        model_id: v.model_id,
        model_code: modelCodeById.get(v.model_id) ?? null,
        metrics: v.metrics,
        hyperparameters: v.hyperparameters,
        training_job_id: v.training_job_id,
        training_dataset_id: v.training_dataset_id,
        artifact_url: v.artifact_url,
        promoted_at: v.promoted_at,
        deployment_status: v.deployment_status,
        is_baseline: v.id === baselineVersionId,
      };
    });

    const metricRows = computeMetricRows(orderedIds, byId, baselineVersionId, baseline);
    const hyperparameterDiffs = computeHyperparameterDiffs(orderedIds, byId);
    const summary = computeSummary(orderedIds, byId, metricRows);

    return {
      baseline_version_id: baselineVersionId,
      versions: entries,
      metric_rows: metricRows,
      hyperparameter_diffs: hyperparameterDiffs,
      summary,
      generated_at: new Date().toISOString(),
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Auto-finetune triggers + manual retrain
  // ────────────────────────────────────────────────────────────────────
  async createAutoFinetuneTrigger(
    input: AutoFinetuneTriggerInput,
    ctx: OpContext
  ): Promise<AutoFinetuneTriggerRow> {
    const model = await this.deps.repository.findModel(input.model_id);
    if (!model) throw new NotFoundError('Model');
    if (input.feature_template_id) {
      const ft = await this.deps.repository.findFeatureTemplate(input.feature_template_id);
      if (!ft) throw new NotFoundError('Feature template');
    }
    if (input.default_dataset_id) {
      const ds = await this.deps.repository.findDataset(input.default_dataset_id);
      if (!ds) throw new NotFoundError('Default dataset');
    }
    const code = await this.deps.repository.nextAutoTriggerCode();
    return this.deps.repository.createAutoFinetuneTrigger(input, code, ctx.user_id);
  }

  async listAutoFinetuneTriggers(modelId: string | null): Promise<AutoFinetuneTriggerRow[]> {
    return this.deps.repository.listAutoFinetuneTriggers(modelId);
  }

  /** Programmatic / scheduled fire: kicks a training job via the same path as /jobs. */
  async fireAutoFinetuneTrigger(
    triggerId: string,
    overrides: { dataset_id?: string; config?: TrainingConfig; reason?: string },
    ctx: OpContext
  ): Promise<CreateTrainingJobResponse> {
    const trigger = await this.deps.repository.findAutoFinetuneTrigger(triggerId);
    if (!trigger) throw new NotFoundError('Auto-finetune trigger');
    if (!trigger.is_active) throw new ConflictError('Trigger is inactive');
    const dataset_id = overrides.dataset_id ?? trigger.default_dataset_id;
    if (!dataset_id) throw new BadRequestError('dataset_id required (no default on trigger)');

    const config: TrainingConfig = { ...trigger.config, ...(overrides.config ?? {}) };
    const result = await this.createTrainingJob(
      {
        model_id: trigger.model_id,
        dataset_id,
        ...(trigger.feature_template_id
          ? { feature_template_id: trigger.feature_template_id }
          : {}),
        config,
        trigger_type: 'auto_retrain' as TrainingJobTriggerType,
        metadata: {
          auto_finetune_trigger_id: trigger.id,
          reason: overrides.reason ?? null,
          condition: trigger.condition,
        },
      },
      ctx
    );
    await this.deps.repository.recordAutoTriggerFire(trigger.id, result.job.id);
    return result;
  }

  /** Manual one-click retrain entry. Equivalent to POST /jobs but with explicit semantics. */
  async manualRetrain(
    input: ManualRetrainInput,
    ctx: OpContext
  ): Promise<CreateTrainingJobResponse> {
    return this.createTrainingJob(
      {
        model_id: input.model_id,
        dataset_id: input.dataset_id,
        ...(input.feature_template_id ? { feature_template_id: input.feature_template_id } : {}),
        config: input.config ?? {},
        trigger_type: input.trigger_type ?? 'manual',
        metadata: { ...(input.notes ? { notes: input.notes } : {}) },
      },
      ctx
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

const HIGHER_BETTER = new Set([
  'accuracy',
  'precision',
  'recall',
  'f1',
  'auc',
  'roc_auc',
  'r2',
  'ndcg',
  'recall_at_10',
  'recall_at_5',
  'map',
  'score',
]);
const LOWER_BETTER = new Set(['rmse', 'mae', 'mape', 'loss', 'cross_entropy']);

export function metricBetterDirection(name: string): 'higher' | 'lower' | 'unknown' {
  const k = name.toLowerCase();
  if (HIGHER_BETTER.has(k)) return 'higher';
  if (LOWER_BETTER.has(k)) return 'lower';
  return 'unknown';
}

export function computeMetricRows(
  orderedIds: string[],
  byId: Map<string, ModelVersionRow>,
  baselineId: string,
  baseline: ModelVersionRow
): CompareReportMetricRow[] {
  const allMetrics = new Set<string>();
  for (const id of orderedIds) {
    const v = byId.get(id);
    if (v) Object.keys(v.metrics).forEach((k) => allMetrics.add(k));
  }
  const rows: CompareReportMetricRow[] = [];
  for (const name of allMetrics) {
    const values: Record<string, number | null> = {};
    const deltas: Record<string, number | null> = {};
    const delta_pct: Record<string, number | null> = {};
    const baselineVal = baseline.metrics[name];
    for (const id of orderedIds) {
      const v = byId.get(id);
      const value = typeof v?.metrics[name] === 'number' ? (v.metrics[name] as number) : null;
      values[id] = value;
      if (typeof baselineVal === 'number' && value !== null) {
        const delta = round4(value - baselineVal);
        deltas[id] = delta;
        delta_pct[id] = baselineVal === 0 ? null : round4(delta / Math.abs(baselineVal));
      } else {
        deltas[id] = null;
        delta_pct[id] = null;
      }
    }
    /* Force-zero the baseline's delta for clarity. */
    deltas[baselineId] = 0;
    delta_pct[baselineId] = 0;
    rows.push({ name, values, deltas, delta_pct, better: metricBetterDirection(name) });
  }
  return rows;
}

export function computeHyperparameterDiffs(
  orderedIds: string[],
  byId: Map<string, ModelVersionRow>
): CompareReport['hyperparameter_diffs'] {
  const allKeys = new Set<string>();
  for (const id of orderedIds) {
    const v = byId.get(id);
    if (v) Object.keys(v.hyperparameters).forEach((k) => allKeys.add(k));
  }
  const out: CompareReport['hyperparameter_diffs'] = [];
  for (const key of allKeys) {
    const values: Record<string, unknown> = {};
    const seen = new Set<string>();
    for (const id of orderedIds) {
      const v = byId.get(id);
      const val = v?.hyperparameters[key];
      values[id] = val;
      seen.add(JSON.stringify(val ?? null));
    }
    out.push({ key, values, is_uniform: seen.size === 1 });
  }
  return out;
}

export function computeSummary(
  orderedIds: string[],
  byId: Map<string, ModelVersionRow>,
  metricRows: CompareReportMetricRow[]
): CompareReport['summary'] {
  const winners: CompareReport['summary']['winners'] = [];
  const regressions: CompareReport['summary']['regressions'] = [];
  for (const row of metricRows) {
    if (row.better === 'unknown') continue;
    let bestId: string | null = null;
    let bestVal: number | null = null;
    let worstId: string | null = null;
    let worstVal: number | null = null;
    for (const id of orderedIds) {
      const v = row.values[id];
      if (typeof v !== 'number') continue;
      if (bestVal === null || (row.better === 'higher' ? v > bestVal : v < bestVal)) {
        bestVal = v;
        bestId = id;
      }
      if (worstVal === null || (row.better === 'higher' ? v < worstVal : v > worstVal)) {
        worstVal = v;
        worstId = id;
      }
    }
    if (bestId && bestVal !== null)
      winners.push({ metric: row.name, version_id: bestId, value: bestVal });
    if (worstId && worstVal !== null)
      regressions.push({ metric: row.name, version_id: worstId, value: worstVal });
    void byId;
  }
  return { winners, regressions };
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// Re-export status checks for convenience.
export { ModelLifecycleStatus };
