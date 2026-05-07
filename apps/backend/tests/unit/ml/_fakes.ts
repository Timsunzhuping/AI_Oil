/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * In-memory MlRepository fake — used by service tests so we don't need
 * Postgres to exercise orchestration logic.
 */
import { randomUUID } from 'node:crypto';
import type {
  AutoFinetuneTriggerInput,
  AutoFinetuneTriggerRow,
  DatasetInput,
  DatasetRow,
  FeatureTemplateInput,
  FeatureTemplateRow,
  KbStatus,
  ModelInput,
  ModelLifecycleStatus,
  ModelRow,
  ModelVersionDeploymentStatus,
  ModelVersionRow,
  MlTaskType,
  ReleaseAction,
  ReleaseEnvironment,
  ReleaseRow,
  ReleaseStatus,
  TrainingConfig,
  TrainingJobRow,
  TrainingJobStatus,
  TrainingJobTriggerType,
} from '../../../src/modules/ml/types.js';

export class FakeMlRepository {
  datasets = new Map<string, DatasetRow>();
  featureTemplates = new Map<string, FeatureTemplateRow>();
  models = new Map<string, ModelRow>();
  versions = new Map<string, ModelVersionRow>();
  jobs = new Map<string, TrainingJobRow>();
  releases = new Map<string, ReleaseRow>();
  triggers = new Map<string, AutoFinetuneTriggerRow>();
  private dsCount = 1;
  private ftCount = 1;
  private modCount = 1;
  private jobCount = 1;
  private relCount = 1;
  private trgCount = 1;

  // ── code generators ───────────────────────────────────────────────
  async nextDatasetCode(): Promise<string> {
    return `DS-2026-${pad4(this.dsCount++)}`;
  }
  async nextFeatureTemplateCode(): Promise<string> {
    return `FT-2026-${pad4(this.ftCount++)}`;
  }
  async nextModelCode(): Promise<string> {
    return `MOD-2026-${pad4(this.modCount++)}`;
  }
  async nextTrainingJobCode(): Promise<string> {
    return `JOB-2026-${pad6(this.jobCount++)}`;
  }
  async nextReleaseCode(): Promise<string> {
    return `REL-2026-${pad6(this.relCount++)}`;
  }
  async nextAutoTriggerCode(): Promise<string> {
    return `FTR-2026-${pad4(this.trgCount++)}`;
  }

  // ── datasets ──────────────────────────────────────────────────────
  async createDataset(
    input: DatasetInput,
    code: string,
    userId: string | null
  ): Promise<DatasetRow> {
    const now = new Date().toISOString();
    const row: DatasetRow = {
      id: randomUUID(),
      code,
      name: input.name,
      description: input.description ?? null,
      dataset_version: input.dataset_version ?? null,
      storage_url: input.storage_url,
      format: input.format ?? null,
      schema_definition: input.schema_definition ?? null,
      size_bytes: input.size_bytes ?? null,
      row_count: input.row_count ?? null,
      source_query: input.source_query ?? null,
      source_at: input.source_at ?? null,
      checksum: input.checksum ?? null,
      splits: input.splits ?? null,
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
      created_at: now,
      updated_at: now,
      created_by: userId,
      version: 1,
    };
    this.datasets.set(row.id, row);
    return row;
  }
  async findDataset(id: string): Promise<DatasetRow | null> {
    return this.datasets.get(id) ?? null;
  }
  async listDatasets(filter: { q?: string; page: number; pageSize: number }) {
    const all = [...this.datasets.values()].filter(
      (d) => !filter.q || d.name.includes(filter.q) || d.code.includes(filter.q)
    );
    const start = (filter.page - 1) * filter.pageSize;
    return { items: all.slice(start, start + filter.pageSize), total: all.length };
  }

  // ── feature templates ─────────────────────────────────────────────
  async createFeatureTemplate(
    input: FeatureTemplateInput,
    code: string,
    userId: string | null
  ): Promise<FeatureTemplateRow> {
    const now = new Date().toISOString();
    const row: FeatureTemplateRow = {
      id: randomUUID(),
      code,
      name: input.name,
      description: input.description ?? null,
      task_type: input.task_type,
      spec: input.spec,
      feature_set_version: input.feature_set_version ?? null,
      storage_url: input.storage_url ?? null,
      status: input.status ?? 'draft',
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
      created_at: now,
      updated_at: now,
      created_by: userId,
      version: 1,
    };
    this.featureTemplates.set(row.id, row);
    return row;
  }
  async findFeatureTemplate(id: string): Promise<FeatureTemplateRow | null> {
    return this.featureTemplates.get(id) ?? null;
  }
  async listFeatureTemplates(filter: {
    task_type?: MlTaskType;
    status?: KbStatus;
    page: number;
    pageSize: number;
  }) {
    const all = [...this.featureTemplates.values()].filter(
      (f) =>
        (!filter.task_type || f.task_type === filter.task_type) &&
        (!filter.status || f.status === filter.status)
    );
    const start = (filter.page - 1) * filter.pageSize;
    return { items: all.slice(start, start + filter.pageSize), total: all.length };
  }

  // ── models ────────────────────────────────────────────────────────
  async createModel(input: ModelInput, code: string, userId: string | null): Promise<ModelRow> {
    const now = new Date().toISOString();
    const row: ModelRow = {
      id: randomUUID(),
      code,
      name: input.name,
      description: input.description ?? null,
      task_type: input.task_type,
      framework: input.framework ?? null,
      algorithm: input.algorithm ?? null,
      use_case: input.use_case ?? null,
      current_version_id: null,
      total_versions: 0,
      status: 'development',
      team: input.team ?? null,
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
      created_at: now,
      updated_at: now,
      created_by: userId,
      version: 1,
    };
    this.models.set(row.id, row);
    return row;
  }
  async findModel(id: string): Promise<ModelRow | null> {
    return this.models.get(id) ?? null;
  }
  async listModels(filter: { task_type?: MlTaskType; q?: string; page: number; pageSize: number }) {
    const all = [...this.models.values()].filter(
      (m) =>
        (!filter.task_type || m.task_type === filter.task_type) &&
        (!filter.q || m.name.includes(filter.q) || m.code.includes(filter.q))
    );
    const start = (filter.page - 1) * filter.pageSize;
    return { items: all.slice(start, start + filter.pageSize), total: all.length };
  }
  async updateModelCurrentVersion(
    modelId: string,
    versionId: string | null,
    status: ModelLifecycleStatus | null = null
  ) {
    const m = this.models.get(modelId);
    if (!m) return null;
    m.current_version_id = versionId;
    if (status) m.status = status;
    m.updated_at = new Date().toISOString();
    return m;
  }

  // ── versions ──────────────────────────────────────────────────────
  async createModelVersion(
    input: Parameters<
      import('../../../src/modules/ml/repository.js').MlRepository['createModelVersion']
    >[0]
  ): Promise<ModelVersionRow> {
    const versionsForModel = [...this.versions.values()].filter(
      (v) => v.model_id === input.model_id
    );
    const next = versionsForModel.reduce((m, v) => Math.max(m, v.version_number), 0) + 1;
    const now = new Date().toISOString();
    const row: ModelVersionRow = {
      id: randomUUID(),
      model_id: input.model_id,
      version_number: next,
      version_label: `v${next}`,
      artifact_url: input.artifact_url,
      artifact_hash: input.artifact_hash,
      artifact_size_bytes: input.artifact_size_bytes,
      framework_version: input.framework_version,
      training_job_id: input.training_job_id,
      training_dataset_id: input.training_dataset_id,
      source_code_repo: null,
      source_code_commit: null,
      base_model_version_id: input.base_model_version_id,
      hyperparameters: input.hyperparameters,
      features: input.features,
      output_schema: input.output_schema,
      metrics: input.metrics,
      evaluation_dataset_id: null,
      deployment_status: 'staged',
      promoted_at: null,
      retired_at: null,
      approved_at: null,
      release_notes: input.release_notes,
      metadata: input.metadata,
      created_at: now,
      updated_at: now,
    };
    this.versions.set(row.id, row);
    const m = this.models.get(input.model_id);
    if (m) m.total_versions += 1;
    return row;
  }
  async findModelVersion(id: string): Promise<ModelVersionRow | null> {
    return this.versions.get(id) ?? null;
  }
  async findCurrentActiveVersion(modelId: string): Promise<ModelVersionRow | null> {
    const candidates = [...this.versions.values()].filter(
      (v) => v.model_id === modelId && v.deployment_status === 'active'
    );
    candidates.sort((a, b) => (b.promoted_at ?? '').localeCompare(a.promoted_at ?? ''));
    return candidates[0] ?? null;
  }
  async findPreviousActiveVersion(
    modelId: string,
    currentVersionId: string
  ): Promise<ModelVersionRow | null> {
    const all = [...this.versions.values()].filter(
      (v) =>
        v.model_id === modelId &&
        v.id !== currentVersionId &&
        ['active', 'retired', 'rolled_back'].includes(v.deployment_status)
    );
    all.sort(
      (a, b) =>
        (b.promoted_at ?? '').localeCompare(a.promoted_at ?? '') ||
        b.version_number - a.version_number
    );
    return all[0] ?? null;
  }
  async listModelVersions(modelId: string): Promise<ModelVersionRow[]> {
    return [...this.versions.values()]
      .filter((v) => v.model_id === modelId)
      .sort((a, b) => b.version_number - a.version_number);
  }
  async findModelVersionsByIds(ids: string[]): Promise<ModelVersionRow[]> {
    return ids.map((id) => this.versions.get(id)).filter(Boolean) as ModelVersionRow[];
  }
  async setVersionDeploymentStatus(
    versionId: string,
    status: ModelVersionDeploymentStatus,
    userId: string | null
  ): Promise<ModelVersionRow | null> {
    const v = this.versions.get(versionId);
    if (!v) return null;
    v.deployment_status = status;
    if (status === 'active') v.promoted_at = new Date().toISOString();
    if (status === 'retired') v.retired_at = new Date().toISOString();
    v.updated_at = new Date().toISOString();
    void userId;
    return v;
  }

  // ── training jobs ─────────────────────────────────────────────────
  async createTrainingJob(input: {
    code: string;
    model_id: string | null;
    trigger_type: TrainingJobTriggerType;
    triggered_by: string | null;
    dataset_id: string | null;
    config: TrainingConfig;
    source_code_commit: string | null;
    metadata: Record<string, unknown>;
  }): Promise<TrainingJobRow> {
    const now = new Date().toISOString();
    const row: TrainingJobRow = {
      id: randomUUID(),
      code: input.code,
      model_id: input.model_id,
      produced_version_id: null,
      trigger_type: input.trigger_type,
      triggered_by: input.triggered_by,
      dataset_id: input.dataset_id,
      config: input.config,
      source_code_commit: input.source_code_commit,
      status: 'queued',
      progress_percentage: 0,
      queued_at: now,
      started_at: null,
      completed_at: null,
      duration_seconds: null,
      compute_provider: null,
      cluster: null,
      cpu_cores: null,
      gpu_count: null,
      gpu_type: null,
      memory_peak_mb: null,
      cost: null,
      cost_currency: null,
      metrics: {},
      artifact_url: null,
      logs_url: null,
      error_message: null,
      metadata: input.metadata,
      created_at: now,
      updated_at: now,
    };
    this.jobs.set(row.id, row);
    return row;
  }
  async findTrainingJob(id: string): Promise<TrainingJobRow | null> {
    return this.jobs.get(id) ?? null;
  }
  async listTrainingJobs(filter: {
    model_id?: string;
    status?: TrainingJobStatus;
    page: number;
    pageSize: number;
  }) {
    const all = [...this.jobs.values()].filter(
      (j) =>
        (!filter.model_id || j.model_id === filter.model_id) &&
        (!filter.status || j.status === filter.status)
    );
    const start = (filter.page - 1) * filter.pageSize;
    return { items: all.slice(start, start + filter.pageSize), total: all.length };
  }
  async setTrainingJobStatus(
    id: string,
    status: TrainingJobStatus,
    patch: {
      progress_percentage?: number;
      started_at?: Date | null;
      completed_at?: Date | null;
      duration_seconds?: number | null;
      metrics?: Record<string, number>;
      artifact_url?: string | null;
      logs_url?: string | null;
      error_message?: string | null;
      produced_version_id?: string | null;
    } = {}
  ): Promise<TrainingJobRow | null> {
    const j = this.jobs.get(id);
    if (!j) return null;
    j.status = status;
    j.updated_at = new Date().toISOString();
    if (patch.progress_percentage !== undefined) j.progress_percentage = patch.progress_percentage;
    if (patch.started_at !== undefined)
      j.started_at = patch.started_at ? patch.started_at.toISOString() : null;
    if (patch.completed_at !== undefined)
      j.completed_at = patch.completed_at ? patch.completed_at.toISOString() : null;
    if (patch.duration_seconds !== undefined) j.duration_seconds = patch.duration_seconds;
    if (patch.metrics !== undefined) j.metrics = patch.metrics;
    if (patch.artifact_url !== undefined) j.artifact_url = patch.artifact_url;
    if (patch.logs_url !== undefined) j.logs_url = patch.logs_url;
    if (patch.error_message !== undefined) j.error_message = patch.error_message;
    if (patch.produced_version_id !== undefined) j.produced_version_id = patch.produced_version_id;
    return j;
  }

  // ── releases ──────────────────────────────────────────────────────
  async insertRelease(input: {
    code: string;
    model_id: string;
    to_version_id: string | null;
    from_version_id: string | null;
    action: ReleaseAction;
    environment: ReleaseEnvironment;
    status: ReleaseStatus;
    reason: string | null;
    notes: string | null;
    approved_by: string | null;
    released_by: string | null;
    guardrails: Record<string, unknown>;
    guardrails_passed: boolean | null;
    released_artifact_url: string | null;
    metrics_snapshot: Record<string, number>;
    metadata: Record<string, unknown>;
    trace_id: string | null;
  }): Promise<ReleaseRow> {
    const now = new Date().toISOString();
    const row: ReleaseRow = {
      id: randomUUID(),
      code: input.code,
      model_id: input.model_id,
      to_version_id: input.to_version_id,
      from_version_id: input.from_version_id,
      action: input.action,
      environment: input.environment,
      status: input.status,
      reason: input.reason,
      notes: input.notes,
      approved_by: input.approved_by,
      released_by: input.released_by,
      released_at: now,
      guardrails: input.guardrails,
      guardrails_passed: input.guardrails_passed,
      released_artifact_url: input.released_artifact_url,
      metrics_snapshot: input.metrics_snapshot,
      metadata: input.metadata,
      trace_id: input.trace_id,
      created_at: now,
    };
    this.releases.set(row.id, row);
    return row;
  }
  async listReleases(modelId: string, limit = 50): Promise<ReleaseRow[]> {
    return [...this.releases.values()]
      .filter((r) => r.model_id === modelId)
      .sort((a, b) => b.released_at.localeCompare(a.released_at))
      .slice(0, limit);
  }

  // ── auto-finetune triggers ───────────────────────────────────────
  async createAutoFinetuneTrigger(
    input: AutoFinetuneTriggerInput,
    code: string,
    userId: string | null
  ): Promise<AutoFinetuneTriggerRow> {
    const now = new Date().toISOString();
    const row: AutoFinetuneTriggerRow = {
      id: randomUUID(),
      code,
      model_id: input.model_id,
      feature_template_id: input.feature_template_id ?? null,
      default_dataset_id: input.default_dataset_id ?? null,
      condition: input.condition,
      config: input.config ?? {},
      is_active: input.is_active ?? true,
      last_fired_at: null,
      last_fired_job_id: null,
      fire_count: 0,
      metadata: input.metadata ?? {},
      created_at: now,
      updated_at: now,
      created_by: userId,
      version: 1,
    };
    this.triggers.set(row.id, row);
    return row;
  }
  async findAutoFinetuneTrigger(id: string): Promise<AutoFinetuneTriggerRow | null> {
    return this.triggers.get(id) ?? null;
  }
  async listAutoFinetuneTriggers(modelId: string | null): Promise<AutoFinetuneTriggerRow[]> {
    const all = [...this.triggers.values()].filter((t) => !modelId || t.model_id === modelId);
    return all.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async recordAutoTriggerFire(triggerId: string, jobId: string): Promise<void> {
    const t = this.triggers.get(triggerId);
    if (!t) return;
    t.last_fired_at = new Date().toISOString();
    t.last_fired_job_id = jobId;
    t.fire_count += 1;
  }
}

function pad4(n: number) {
  return String(n).padStart(4, '0');
}
function pad6(n: number) {
  return String(n).padStart(6, '0');
}
