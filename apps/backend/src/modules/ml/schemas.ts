/**
 * Zod schemas for the MLOps platform HTTP layer.
 */
import { z } from 'zod';
import { ML_TASK_TYPES, RELEASE_ENVIRONMENTS, TRAINING_JOB_TRIGGER_TYPES } from './types.js';

const Json = z.record(z.unknown());
const Strings = z.array(z.string().min(1).max(64)).max(50).optional();
const MaybeUuid = z.string().uuid().nullable().optional();

// ─── Datasets ───────────────────────────────────────────────────────────────

export const CreateDatasetSchema = z.object({
  code: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  dataset_version: z.string().max(64).optional(),
  storage_url: z.string().min(1).max(500),
  format: z.string().max(32).optional(),
  schema_definition: Json.optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  row_count: z.number().int().nonnegative().optional(),
  source_query: z.string().max(8000).optional(),
  source_at: z.string().optional(),
  checksum: z.string().max(128).optional(),
  splits: z.record(z.number().nonnegative()).optional(),
  tags: Strings,
  metadata: Json.optional(),
});

export const ListDatasetsQuerySchema = z.object({
  q: z.string().max(255).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

// ─── Feature templates ──────────────────────────────────────────────────────

export const CreateFeatureTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  task_type: z.enum(ML_TASK_TYPES),
  spec: Json,
  feature_set_version: z.string().max(64).optional(),
  storage_url: z.string().max(500).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  tags: Strings,
  metadata: Json.optional(),
});

export const UpdateFeatureTemplateSchema = CreateFeatureTemplateSchema.partial();

// ─── Models ─────────────────────────────────────────────────────────────────

export const CreateModelSchema = z.object({
  code: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  task_type: z.enum(ML_TASK_TYPES),
  framework: z.string().max(64).optional(),
  algorithm: z.string().max(64).optional(),
  use_case: z.string().max(64).optional(),
  team: z.string().max(64).optional(),
  tags: Strings,
  metadata: Json.optional(),
});

export const ListModelsQuerySchema = z.object({
  task_type: z.enum(ML_TASK_TYPES).optional(),
  q: z.string().max(255).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export const CompareModelsQuerySchema = z.object({
  /** Comma-separated list of version_ids to compare. */
  versions: z.string().min(1).max(2000),
  /** Optional baseline version_id; defaults to first in `versions`. */
  baseline: z.string().uuid().optional(),
});

// ─── Training jobs ──────────────────────────────────────────────────────────

const HyperparametersSchema = Json.optional();
const ResourcesSchema = z
  .object({
    cpu: z.number().positive().optional(),
    gpu: z.number().int().min(0).optional(),
    memory_mb: z.number().int().positive().optional(),
  })
  .optional();

export const TrainingConfigSchema = z.object({
  random_seed: z.number().int().nonnegative().optional(),
  hyperparameters: HyperparametersSchema,
  max_epochs: z.number().int().min(1).max(1000).optional(),
  early_stopping_patience: z.number().int().min(0).max(50).optional(),
  resources: ResourcesSchema,
  extras: Json.optional(),
});

export const CreateTrainingJobSchema = z.object({
  model_id: MaybeUuid,
  trigger_type: z.enum(TRAINING_JOB_TRIGGER_TYPES).optional(),
  dataset_id: MaybeUuid,
  feature_template_id: MaybeUuid,
  config: TrainingConfigSchema.optional(),
  source_code_commit: z.string().max(64).optional(),
  metadata: Json.optional(),
});

export const ListTrainingJobsQuerySchema = z.object({
  model_id: z.string().uuid().optional(),
  status: z.string().max(32).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

// ─── Release / rollback ─────────────────────────────────────────────────────

export const ReleaseSchema = z.object({
  version_id: z.string().uuid(),
  environment: z.enum(RELEASE_ENVIRONMENTS).optional(),
  reason: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
  guardrails: z
    .array(
      z.object({
        metric: z.string().min(1).max(64),
        comparator: z.enum(['gte', 'lte']),
        threshold: z.number(),
      })
    )
    .max(20)
    .optional(),
  approved_by: MaybeUuid,
  metadata: Json.optional(),
});

export const RollbackSchema = z.object({
  to_version_id: z.string().uuid().optional(),
  reason: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
  approved_by: MaybeUuid,
  metadata: Json.optional(),
});

// ─── Auto-finetune trigger ─────────────────────────────────────────────────

export const AutoFinetuneConditionSchema = z.object({
  type: z.enum(['drift', 'metric_drop', 'schedule', 'data_volume', 'manual']),
  metric: z.string().max(64).optional(),
  threshold: z.number().optional(),
  cron: z.string().max(64).optional(),
  rows_delta: z.number().int().nonnegative().optional(),
  notes: z.string().max(500).optional(),
});

export const CreateAutoFinetuneTriggerSchema = z.object({
  model_id: z.string().uuid(),
  feature_template_id: z.string().uuid().optional(),
  default_dataset_id: z.string().uuid().optional(),
  condition: AutoFinetuneConditionSchema,
  config: TrainingConfigSchema.optional(),
  is_active: z.boolean().optional(),
  metadata: Json.optional(),
});

export const FireAutoFinetuneTriggerSchema = z.object({
  /** Optional override of the dataset used for the fired job. */
  dataset_id: z.string().uuid().optional(),
  config: TrainingConfigSchema.optional(),
  reason: z.string().max(500).optional(),
});

// ─── Manual retrain ─────────────────────────────────────────────────────────

export const ManualRetrainSchema = z.object({
  model_id: z.string().uuid(),
  dataset_id: z.string().uuid(),
  feature_template_id: MaybeUuid,
  config: TrainingConfigSchema.optional(),
  trigger_type: z.enum(TRAINING_JOB_TRIGGER_TYPES).optional(),
  notes: z.string().max(2000).optional(),
});

// ─── Path / param schemas ──────────────────────────────────────────────────

export const IdParamSchema = z.object({ id: z.string().uuid() });

export type ParsedCreateDatasetRequest = z.infer<typeof CreateDatasetSchema>;
export type ParsedCreateModelRequest = z.infer<typeof CreateModelSchema>;
export type ParsedCreateTrainingJobRequest = z.infer<typeof CreateTrainingJobSchema>;
export type ParsedReleaseRequest = z.infer<typeof ReleaseSchema>;
export type ParsedRollbackRequest = z.infer<typeof RollbackSchema>;
export type ParsedAutoFinetuneTriggerRequest = z.infer<typeof CreateAutoFinetuneTriggerSchema>;
export type ParsedManualRetrainRequest = z.infer<typeof ManualRetrainSchema>;
