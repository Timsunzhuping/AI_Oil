/**
 * Model Factory / MLOps platform — shared types.
 *
 * Built on top of the existing `ml_*` tables (created in migration 0010) and
 * the new `ml_feature_templates`, `ml_model_releases`,
 * `ml_auto_finetune_triggers` tables (migration 0021).
 *
 * The platform exposes a typed contract for:
 *   • dataset registration
 *   • feature-template management
 *   • training-job lifecycle (queued → … → succeeded/failed/cancelled)
 *   • model registry CRUD + version registration
 *   • release / rollback / shadow-deploy actions
 *   • compare reports across versions
 *   • auto-fine-tune triggers + manual retrain entry
 */

// ─── Enumerations ───────────────────────────────────────────────────────────

export const ML_TASK_TYPES = [
  'classification',
  'regression',
  'embedding',
  'llm',
  'vision',
  'clustering',
  'recommendation',
  'time_series',
  'reinforcement',
  'formula_optimization',
] as const;
export type MlTaskType = (typeof ML_TASK_TYPES)[number];

export const TRAINING_JOB_STATUSES = [
  'queued',
  'provisioning',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timeout',
] as const;
export type TrainingJobStatus = (typeof TRAINING_JOB_STATUSES)[number];

export const TRAINING_JOB_TRIGGER_TYPES = [
  'manual',
  'scheduled',
  'auto_retrain',
  'api',
  'webhook',
] as const;
export type TrainingJobTriggerType = (typeof TRAINING_JOB_TRIGGER_TYPES)[number];

export const MODEL_LIFECYCLE_STATUSES = [
  'development',
  'staged',
  'production',
  'retired',
  'deprecated',
] as const;
export type ModelLifecycleStatus = (typeof MODEL_LIFECYCLE_STATUSES)[number];

export const MODEL_VERSION_DEPLOYMENT_STATUSES = [
  'staged',
  'active',
  'shadow',
  'retired',
  'rolled_back',
] as const;
export type ModelVersionDeploymentStatus = (typeof MODEL_VERSION_DEPLOYMENT_STATUSES)[number];

export const RELEASE_ACTIONS = [
  'release',
  'rollback',
  'shadow_promote',
  'shadow_demote',
  'retire',
] as const;
export type ReleaseAction = (typeof RELEASE_ACTIONS)[number];

export const RELEASE_ENVIRONMENTS = ['production', 'staging', 'shadow'] as const;
export type ReleaseEnvironment = (typeof RELEASE_ENVIRONMENTS)[number];

export const RELEASE_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'rolled_back',
] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const KB_STATUSES = ['draft', 'published', 'archived'] as const;
export type KbStatus = (typeof KB_STATUSES)[number];

export const TRAINER_MODES = ['mock', 'local', 'remote'] as const;
export type TrainerMode = (typeof TRAINER_MODES)[number];

// ─── Dataset DTOs ───────────────────────────────────────────────────────────

export interface DatasetInput {
  code?: string;
  name: string;
  description?: string;
  dataset_version?: string;
  storage_url: string;
  format?: string;
  schema_definition?: Record<string, unknown>;
  size_bytes?: number;
  row_count?: number;
  source_query?: string;
  source_at?: string;
  checksum?: string;
  splits?: Record<string, number>;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface DatasetRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  dataset_version: string | null;
  storage_url: string;
  format: string | null;
  schema_definition: Record<string, unknown> | null;
  size_bytes: number | null;
  row_count: number | null;
  source_query: string | null;
  source_at: string | null;
  checksum: string | null;
  splits: Record<string, number> | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  version: number;
}

// ─── Feature template DTOs ──────────────────────────────────────────────────

export interface FeatureTemplateInput {
  name: string;
  description?: string;
  task_type: MlTaskType;
  spec: Record<string, unknown>;
  feature_set_version?: string;
  storage_url?: string;
  status?: KbStatus;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface FeatureTemplateRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  task_type: MlTaskType;
  spec: Record<string, unknown>;
  feature_set_version: string | null;
  storage_url: string | null;
  status: KbStatus;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  version: number;
}

// ─── Model registry DTOs ────────────────────────────────────────────────────

export interface ModelInput {
  code?: string;
  name: string;
  description?: string;
  task_type: MlTaskType;
  framework?: string;
  algorithm?: string;
  use_case?: string;
  team?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ModelRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  task_type: MlTaskType;
  framework: string | null;
  algorithm: string | null;
  use_case: string | null;
  current_version_id: string | null;
  total_versions: number;
  status: ModelLifecycleStatus;
  team: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  version: number;
}

// ─── Model version DTOs ─────────────────────────────────────────────────────

export interface ModelVersionRow {
  id: string;
  model_id: string;
  version_number: number;
  version_label: string | null;
  artifact_url: string;
  artifact_hash: string | null;
  artifact_size_bytes: number | null;
  framework_version: string | null;
  training_job_id: string | null;
  training_dataset_id: string | null;
  source_code_repo: string | null;
  source_code_commit: string | null;
  base_model_version_id: string | null;
  hyperparameters: Record<string, unknown>;
  features: Record<string, unknown> | null;
  output_schema: Record<string, unknown> | null;
  metrics: Record<string, number>;
  evaluation_dataset_id: string | null;
  deployment_status: ModelVersionDeploymentStatus;
  promoted_at: string | null;
  retired_at: string | null;
  approved_at: string | null;
  release_notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ─── Training-job DTOs ──────────────────────────────────────────────────────

export interface TrainingJobInput {
  model_id?: string | null;
  trigger_type?: TrainingJobTriggerType;
  dataset_id?: string | null;
  feature_template_id?: string | null;
  config?: TrainingConfig;
  source_code_commit?: string;
  metadata?: Record<string, unknown>;
}

export interface TrainingConfig {
  /** Random seed propagated to the trainer for reproducibility. */
  random_seed?: number;
  /** Hyperparameters surfaced to the trainer adapter as-is. */
  hyperparameters?: Record<string, unknown>;
  /** Optional epoch / step caps for time-bounded runs. */
  max_epochs?: number;
  early_stopping_patience?: number;
  /** Cluster / resource hints for production adapters. */
  resources?: { cpu?: number; gpu?: number; memory_mb?: number };
  /** Free-form passthrough. */
  extras?: Record<string, unknown>;
}

export interface TrainingJobRow {
  id: string;
  code: string;
  model_id: string | null;
  produced_version_id: string | null;
  trigger_type: TrainingJobTriggerType;
  triggered_by: string | null;
  dataset_id: string | null;
  config: TrainingConfig;
  source_code_commit: string | null;
  status: TrainingJobStatus;
  progress_percentage: number;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  compute_provider: string | null;
  cluster: string | null;
  cpu_cores: number | null;
  gpu_count: number | null;
  gpu_type: string | null;
  memory_peak_mb: number | null;
  cost: number | null;
  cost_currency: string | null;
  metrics: Record<string, number>;
  artifact_url: string | null;
  logs_url: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ─── Release / rollback DTOs ────────────────────────────────────────────────

export interface ReleaseInput {
  /** Version id to deploy. Required when action='release'. */
  version_id?: string;
  /** Required env. Defaults to 'production'. */
  environment?: ReleaseEnvironment;
  reason?: string;
  notes?: string;
  /** Optional regression checks the service must verify before flipping over. */
  guardrails?: { metric: string; comparator: 'gte' | 'lte'; threshold: number }[];
  approved_by?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RollbackInput {
  /** Optional explicit target version. When absent, picks the previous active. */
  to_version_id?: string;
  reason?: string;
  notes?: string;
  approved_by?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ReleaseRow {
  id: string;
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
  released_at: string;
  guardrails: Record<string, unknown>;
  guardrails_passed: boolean | null;
  released_artifact_url: string | null;
  metrics_snapshot: Record<string, number>;
  metadata: Record<string, unknown>;
  trace_id: string | null;
  created_at: string;
}

// ─── Auto-finetune trigger DTOs ─────────────────────────────────────────────

export interface AutoFinetuneTriggerCondition {
  type: 'drift' | 'metric_drop' | 'schedule' | 'data_volume' | 'manual';
  metric?: string;
  threshold?: number;
  cron?: string;
  rows_delta?: number;
  notes?: string;
}

export interface AutoFinetuneTriggerInput {
  model_id: string;
  feature_template_id?: string;
  default_dataset_id?: string;
  condition: AutoFinetuneTriggerCondition;
  config?: TrainingConfig;
  is_active?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AutoFinetuneTriggerRow {
  id: string;
  code: string;
  model_id: string;
  feature_template_id: string | null;
  default_dataset_id: string | null;
  condition: AutoFinetuneTriggerCondition;
  config: TrainingConfig;
  is_active: boolean;
  last_fired_at: string | null;
  last_fired_job_id: string | null;
  fire_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  version: number;
}

// ─── Compare-report DTOs ────────────────────────────────────────────────────

export interface CompareReportEntry {
  version_id: string;
  version_number: number;
  version_label: string | null;
  model_id: string;
  model_code: string | null;
  metrics: Record<string, number>;
  hyperparameters: Record<string, unknown>;
  training_job_id: string | null;
  training_dataset_id: string | null;
  artifact_url: string;
  promoted_at: string | null;
  deployment_status: ModelVersionDeploymentStatus;
  is_baseline: boolean;
}

export interface CompareReportMetricRow {
  name: string;
  /** Per-version values; key is version_id. */
  values: Record<string, number | null>;
  /** Per-version delta vs baseline; key is version_id. */
  deltas: Record<string, number | null>;
  /** Per-version delta as a fraction of baseline; key is version_id. */
  delta_pct: Record<string, number | null>;
  /** Direction-of-good for downstream charts. */
  better: 'higher' | 'lower' | 'unknown';
}

export interface CompareReport {
  baseline_version_id: string;
  versions: CompareReportEntry[];
  metric_rows: CompareReportMetricRow[];
  hyperparameter_diffs: Array<{
    key: string;
    values: Record<string, unknown>;
    is_uniform: boolean;
  }>;
  summary: {
    winners: Array<{ metric: string; version_id: string; value: number | null }>;
    regressions: Array<{ metric: string; version_id: string; value: number | null }>;
  };
  generated_at: string;
}

// ─── Service-layer response shapes ──────────────────────────────────────────

export interface CreateTrainingJobResponse {
  job: TrainingJobRow;
  produced_version?: ModelVersionRow;
  trace_id: string | null;
  duration_ms: number;
}

export interface ReleaseResponse {
  release: ReleaseRow;
  model: ModelRow;
  active_version: ModelVersionRow | null;
}

export interface ManualRetrainInput {
  model_id: string;
  dataset_id: string;
  feature_template_id?: string | null;
  config?: TrainingConfig;
  trigger_type?: TrainingJobTriggerType;
  notes?: string;
}
