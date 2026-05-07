/**
 * Persistence for the MLOps platform.
 *
 * Tables touched:
 *   ml_datasets, ml_feature_templates, ml_model_registry, ml_model_versions,
 *   ml_training_jobs, ml_model_releases, ml_auto_finetune_triggers
 *
 * Most rows the platform writes are keyed off auto-generated codes
 * (DS-/FT-/MOD-/REL-/FTR-/JOB- + YYYY-NNNN). The service layer asks the
 * repository for the next code; the repository computes it from MAX(code).
 */
import type { Pool, PoolClient } from 'pg';
import type {
  AutoFinetuneTriggerCondition,
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
  ReleaseAction,
  ReleaseEnvironment,
  ReleaseRow,
  ReleaseStatus,
  TrainingConfig,
  TrainingJobRow,
  TrainingJobStatus,
  TrainingJobTriggerType,
  MlTaskType,
} from './types.js';

export class MlRepository {
  constructor(private readonly pool: Pool) {}

  // ────────────────────────────────────────────────────────────────────
  // Code generators
  // ────────────────────────────────────────────────────────────────────
  async nextDatasetCode(): Promise<string> {
    return this.nextCode('ml_datasets', 'DS', 'code', 4);
  }
  async nextFeatureTemplateCode(): Promise<string> {
    return this.nextCode('ml_feature_templates', 'FT', 'code', 4);
  }
  async nextModelCode(): Promise<string> {
    return this.nextCode('ml_model_registry', 'MOD', 'code', 4);
  }
  async nextTrainingJobCode(): Promise<string> {
    return this.nextCode('ml_training_jobs', 'JOB', 'code', 6);
  }
  async nextReleaseCode(): Promise<string> {
    return this.nextCode('ml_model_releases', 'REL', 'code', 6);
  }
  async nextAutoTriggerCode(): Promise<string> {
    return this.nextCode('ml_auto_finetune_triggers', 'FTR', 'code', 4);
  }

  private async nextCode(
    table: string,
    prefix: string,
    column: string,
    padTo: number
  ): Promise<string> {
    const year = new Date().getFullYear();
    const res = await this.pool.query<{ code: string }>(
      `SELECT ${column} AS code FROM ${table} WHERE ${column} LIKE $1 ORDER BY ${column} DESC LIMIT 1`,
      [`${prefix}-${year}-%`]
    );
    let n = 1;
    if (res.rows[0]?.code) {
      const m = new RegExp(`^${prefix}-\\d{4}-(\\d+)$`).exec(res.rows[0].code);
      if (m) n = Number(m[1]) + 1;
    }
    return `${prefix}-${year}-${String(n).padStart(padTo, '0')}`;
  }

  // ────────────────────────────────────────────────────────────────────
  // Datasets
  // ────────────────────────────────────────────────────────────────────
  async createDataset(
    input: DatasetInput,
    code: string,
    userId: string | null
  ): Promise<DatasetRow> {
    const res = await this.pool.query<RawDataset>(
      `INSERT INTO ml_datasets (
         code, name, description, dataset_version, storage_url, format,
         schema_definition, size_bytes, row_count, source_query, source_at,
         checksum, splits, tags, metadata, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        code,
        input.name,
        input.description ?? null,
        input.dataset_version ?? null,
        input.storage_url,
        input.format ?? null,
        input.schema_definition === undefined ? null : JSON.stringify(input.schema_definition),
        input.size_bytes ?? null,
        input.row_count ?? null,
        input.source_query ?? null,
        input.source_at ?? null,
        input.checksum ?? null,
        input.splits === undefined ? null : JSON.stringify(input.splits),
        input.tags ?? [],
        JSON.stringify(input.metadata ?? {}),
        userId,
      ]
    );
    return mapDataset(res.rows[0]!);
  }

  async findDataset(id: string): Promise<DatasetRow | null> {
    const res = await this.pool.query<RawDataset>(
      `SELECT * FROM ml_datasets WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return res.rows[0] ? mapDataset(res.rows[0]) : null;
  }

  async listDatasets(filter: {
    q?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: DatasetRow[]; total: number }> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.q) {
      where.push(`(name ILIKE $${i} OR code ILIKE $${i})`);
      params.push(`%${filter.q}%`);
      i += 1;
    }
    const total = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ml_datasets WHERE ${where.join(' AND ')}`,
      params
    );
    const items = await this.pool.query<RawDataset>(
      `SELECT * FROM ml_datasets WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT ${filter.pageSize} OFFSET ${(filter.page - 1) * filter.pageSize}`,
      params
    );
    return { items: items.rows.map(mapDataset), total: Number(total.rows[0]!.count) };
  }

  // ────────────────────────────────────────────────────────────────────
  // Feature templates
  // ────────────────────────────────────────────────────────────────────
  async createFeatureTemplate(
    input: FeatureTemplateInput,
    code: string,
    userId: string | null
  ): Promise<FeatureTemplateRow> {
    const res = await this.pool.query<RawFeatureTemplate>(
      `INSERT INTO ml_feature_templates (
         code, name, description, task_type, spec, feature_set_version, storage_url,
         status, tags, metadata, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        code,
        input.name,
        input.description ?? null,
        input.task_type,
        JSON.stringify(input.spec),
        input.feature_set_version ?? null,
        input.storage_url ?? null,
        input.status ?? 'draft',
        input.tags ?? [],
        JSON.stringify(input.metadata ?? {}),
        userId,
      ]
    );
    return mapFeatureTemplate(res.rows[0]!);
  }

  async findFeatureTemplate(id: string): Promise<FeatureTemplateRow | null> {
    const res = await this.pool.query<RawFeatureTemplate>(
      `SELECT * FROM ml_feature_templates WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return res.rows[0] ? mapFeatureTemplate(res.rows[0]) : null;
  }

  async listFeatureTemplates(filter: {
    task_type?: MlTaskType;
    status?: KbStatus;
    page: number;
    pageSize: number;
  }): Promise<{ items: FeatureTemplateRow[]; total: number }> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.task_type) {
      where.push(`task_type = $${i++}`);
      params.push(filter.task_type);
    }
    if (filter.status) {
      where.push(`status = $${i++}`);
      params.push(filter.status);
    }
    const total = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ml_feature_templates WHERE ${where.join(' AND ')}`,
      params
    );
    const items = await this.pool.query<RawFeatureTemplate>(
      `SELECT * FROM ml_feature_templates WHERE ${where.join(' AND ')}
         ORDER BY updated_at DESC
         LIMIT ${filter.pageSize} OFFSET ${(filter.page - 1) * filter.pageSize}`,
      params
    );
    return { items: items.rows.map(mapFeatureTemplate), total: Number(total.rows[0]!.count) };
  }

  // ────────────────────────────────────────────────────────────────────
  // Models
  // ────────────────────────────────────────────────────────────────────
  async createModel(input: ModelInput, code: string, userId: string | null): Promise<ModelRow> {
    const res = await this.pool.query<RawModel>(
      `INSERT INTO ml_model_registry (
         code, name, description, task_type, framework, algorithm, use_case,
         team, tags, metadata, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        code,
        input.name,
        input.description ?? null,
        input.task_type,
        input.framework ?? null,
        input.algorithm ?? null,
        input.use_case ?? null,
        input.team ?? null,
        input.tags ?? [],
        JSON.stringify(input.metadata ?? {}),
        userId,
      ]
    );
    return mapModel(res.rows[0]!);
  }

  async findModel(id: string): Promise<ModelRow | null> {
    const res = await this.pool.query<RawModel>(
      `SELECT * FROM ml_model_registry WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return res.rows[0] ? mapModel(res.rows[0]) : null;
  }

  async listModels(filter: {
    task_type?: MlTaskType;
    q?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: ModelRow[]; total: number }> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.task_type) {
      where.push(`task_type = $${i++}`);
      params.push(filter.task_type);
    }
    if (filter.q) {
      where.push(`(name ILIKE $${i} OR code ILIKE $${i})`);
      params.push(`%${filter.q}%`);
      i += 1;
    }
    const total = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ml_model_registry WHERE ${where.join(' AND ')}`,
      params
    );
    const items = await this.pool.query<RawModel>(
      `SELECT * FROM ml_model_registry WHERE ${where.join(' AND ')}
         ORDER BY updated_at DESC
         LIMIT ${filter.pageSize} OFFSET ${(filter.page - 1) * filter.pageSize}`,
      params
    );
    return { items: items.rows.map(mapModel), total: Number(total.rows[0]!.count) };
  }

  async updateModelCurrentVersion(
    modelId: string,
    versionId: string | null,
    status: ModelLifecycleStatus | null = null
  ): Promise<ModelRow | null> {
    const res = await this.pool.query<RawModel>(
      `UPDATE ml_model_registry
          SET current_version_id = $2,
              status = COALESCE($3, status),
              updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *`,
      [modelId, versionId, status]
    );
    return res.rows[0] ? mapModel(res.rows[0]) : null;
  }

  // ────────────────────────────────────────────────────────────────────
  // Versions
  // ────────────────────────────────────────────────────────────────────
  async createModelVersion(input: {
    model_id: string;
    artifact_url: string;
    artifact_hash: string | null;
    artifact_size_bytes: number | null;
    framework_version: string | null;
    training_job_id: string | null;
    training_dataset_id: string | null;
    base_model_version_id: string | null;
    hyperparameters: Record<string, unknown>;
    features: Record<string, unknown> | null;
    output_schema: Record<string, unknown> | null;
    metrics: Record<string, number>;
    release_notes: string | null;
    metadata: Record<string, unknown>;
    created_by: string | null;
  }): Promise<ModelVersionRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const seq = await client.query<{ next_version: number }>(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
           FROM ml_model_versions WHERE model_id = $1`,
        [input.model_id]
      );
      const next = seq.rows[0]!.next_version;
      const res = await client.query<RawModelVersion>(
        `INSERT INTO ml_model_versions (
           model_id, version_number, version_label,
           artifact_url, artifact_hash, artifact_size_bytes, framework_version,
           training_job_id, training_dataset_id, base_model_version_id,
           hyperparameters, features, output_schema, metrics,
           deployment_status, release_notes, metadata, created_by
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'staged',$15,$16,$17)
         RETURNING *`,
        [
          input.model_id,
          next,
          `v${next}`,
          input.artifact_url,
          input.artifact_hash,
          input.artifact_size_bytes,
          input.framework_version,
          input.training_job_id,
          input.training_dataset_id,
          input.base_model_version_id,
          JSON.stringify(input.hyperparameters),
          input.features === null ? null : JSON.stringify(input.features),
          input.output_schema === null ? null : JSON.stringify(input.output_schema),
          JSON.stringify(input.metrics),
          input.release_notes,
          JSON.stringify(input.metadata),
          input.created_by,
        ]
      );
      await client.query(
        `UPDATE ml_model_registry SET total_versions = total_versions + 1 WHERE id = $1`,
        [input.model_id]
      );
      await client.query('COMMIT');
      return mapModelVersion(res.rows[0]!);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async findModelVersion(id: string): Promise<ModelVersionRow | null> {
    const res = await this.pool.query<RawModelVersion>(
      `SELECT * FROM ml_model_versions WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return res.rows[0] ? mapModelVersion(res.rows[0]) : null;
  }

  async findCurrentActiveVersion(modelId: string): Promise<ModelVersionRow | null> {
    const res = await this.pool.query<RawModelVersion>(
      `SELECT * FROM ml_model_versions
         WHERE model_id = $1 AND deployment_status = 'active' AND deleted_at IS NULL
         ORDER BY promoted_at DESC NULLS LAST
         LIMIT 1`,
      [modelId]
    );
    return res.rows[0] ? mapModelVersion(res.rows[0]) : null;
  }

  async findPreviousActiveVersion(
    modelId: string,
    currentVersionId: string
  ): Promise<ModelVersionRow | null> {
    const res = await this.pool.query<RawModelVersion>(
      `SELECT * FROM ml_model_versions
         WHERE model_id = $1
           AND id <> $2
           AND deployment_status IN ('active','retired','rolled_back')
           AND deleted_at IS NULL
         ORDER BY promoted_at DESC NULLS LAST, version_number DESC
         LIMIT 1`,
      [modelId, currentVersionId]
    );
    return res.rows[0] ? mapModelVersion(res.rows[0]) : null;
  }

  async listModelVersions(modelId: string): Promise<ModelVersionRow[]> {
    const res = await this.pool.query<RawModelVersion>(
      `SELECT * FROM ml_model_versions
         WHERE model_id = $1 AND deleted_at IS NULL
         ORDER BY version_number DESC`,
      [modelId]
    );
    return res.rows.map(mapModelVersion);
  }

  async findModelVersionsByIds(ids: string[]): Promise<ModelVersionRow[]> {
    if (ids.length === 0) return [];
    const res = await this.pool.query<RawModelVersion>(
      `SELECT * FROM ml_model_versions WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids]
    );
    return res.rows.map(mapModelVersion);
  }

  async setVersionDeploymentStatus(
    versionId: string,
    status: ModelVersionDeploymentStatus,
    userId: string | null
  ): Promise<ModelVersionRow | null> {
    const promotedClause = status === 'active' ? ', promoted_at = NOW(), promoted_by = $3' : '';
    const retiredClause = status === 'retired' ? ', retired_at = NOW(), retired_by = $3' : '';
    const res = await this.pool.query<RawModelVersion>(
      `UPDATE ml_model_versions
          SET deployment_status = $2 ${promotedClause}${retiredClause}, updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *`,
      [versionId, status, userId]
    );
    return res.rows[0] ? mapModelVersion(res.rows[0]) : null;
  }

  // ────────────────────────────────────────────────────────────────────
  // Training jobs
  // ────────────────────────────────────────────────────────────────────
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
    const res = await this.pool.query<RawTrainingJob>(
      `INSERT INTO ml_training_jobs (
         code, model_id, trigger_type, triggered_by,
         dataset_id, config, source_code_commit, status, metadata
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8)
       RETURNING *`,
      [
        input.code,
        input.model_id,
        input.trigger_type,
        input.triggered_by,
        input.dataset_id,
        JSON.stringify(input.config),
        input.source_code_commit,
        JSON.stringify(input.metadata),
      ]
    );
    return mapTrainingJob(res.rows[0]!);
  }

  async findTrainingJob(id: string): Promise<TrainingJobRow | null> {
    const res = await this.pool.query<RawTrainingJob>(
      `SELECT * FROM ml_training_jobs WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return res.rows[0] ? mapTrainingJob(res.rows[0]) : null;
  }

  async listTrainingJobs(filter: {
    model_id?: string;
    status?: TrainingJobStatus;
    page: number;
    pageSize: number;
  }): Promise<{ items: TrainingJobRow[]; total: number }> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.model_id) {
      where.push(`model_id = $${i++}`);
      params.push(filter.model_id);
    }
    if (filter.status) {
      where.push(`status = $${i++}`);
      params.push(filter.status);
    }
    const total = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ml_training_jobs WHERE ${where.join(' AND ')}`,
      params
    );
    const items = await this.pool.query<RawTrainingJob>(
      `SELECT * FROM ml_training_jobs WHERE ${where.join(' AND ')}
         ORDER BY queued_at DESC
         LIMIT ${filter.pageSize} OFFSET ${(filter.page - 1) * filter.pageSize}`,
      params
    );
    return { items: items.rows.map(mapTrainingJob), total: Number(total.rows[0]!.count) };
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
    const sets: string[] = ['status = $2', 'updated_at = NOW()'];
    const params: unknown[] = [id, status];
    let i = 3;
    if (patch.progress_percentage !== undefined) {
      sets.push(`progress_percentage = $${i++}`);
      params.push(patch.progress_percentage);
    }
    if (patch.started_at !== undefined) {
      sets.push(`started_at = $${i++}`);
      params.push(patch.started_at);
    }
    if (patch.completed_at !== undefined) {
      sets.push(`completed_at = $${i++}`);
      params.push(patch.completed_at);
    }
    if (patch.duration_seconds !== undefined) {
      sets.push(`duration_seconds = $${i++}`);
      params.push(patch.duration_seconds);
    }
    if (patch.metrics !== undefined) {
      sets.push(`metrics = $${i++}`);
      params.push(JSON.stringify(patch.metrics));
    }
    if (patch.artifact_url !== undefined) {
      sets.push(`artifact_url = $${i++}`);
      params.push(patch.artifact_url);
    }
    if (patch.logs_url !== undefined) {
      sets.push(`logs_url = $${i++}`);
      params.push(patch.logs_url);
    }
    if (patch.error_message !== undefined) {
      sets.push(`error_message = $${i++}`);
      params.push(patch.error_message);
    }
    if (patch.produced_version_id !== undefined) {
      sets.push(`produced_version_id = $${i++}`);
      params.push(patch.produced_version_id);
    }
    const res = await this.pool.query<RawTrainingJob>(
      `UPDATE ml_training_jobs SET ${sets.join(', ')} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      params
    );
    return res.rows[0] ? mapTrainingJob(res.rows[0]) : null;
  }

  // ────────────────────────────────────────────────────────────────────
  // Releases
  // ────────────────────────────────────────────────────────────────────
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
    const res = await this.pool.query<RawRelease>(
      `INSERT INTO ml_model_releases (
         code, model_id, to_version_id, from_version_id, action, environment,
         status, reason, notes, approved_by, released_by,
         guardrails, guardrails_passed, released_artifact_url, metrics_snapshot,
         metadata, trace_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        input.code,
        input.model_id,
        input.to_version_id,
        input.from_version_id,
        input.action,
        input.environment,
        input.status,
        input.reason,
        input.notes,
        input.approved_by,
        input.released_by,
        JSON.stringify(input.guardrails),
        input.guardrails_passed,
        input.released_artifact_url,
        JSON.stringify(input.metrics_snapshot),
        JSON.stringify(input.metadata),
        input.trace_id,
      ]
    );
    return mapRelease(res.rows[0]!);
  }

  async listReleases(modelId: string, limit = 50): Promise<ReleaseRow[]> {
    const res = await this.pool.query<RawRelease>(
      `SELECT * FROM ml_model_releases
         WHERE model_id = $1
         ORDER BY released_at DESC
         LIMIT $2`,
      [modelId, Math.min(Math.max(limit, 1), 500)]
    );
    return res.rows.map(mapRelease);
  }

  // ────────────────────────────────────────────────────────────────────
  // Auto-finetune triggers
  // ────────────────────────────────────────────────────────────────────
  async createAutoFinetuneTrigger(
    input: AutoFinetuneTriggerInput,
    code: string,
    userId: string | null
  ): Promise<AutoFinetuneTriggerRow> {
    const res = await this.pool.query<RawAutoTrigger>(
      `INSERT INTO ml_auto_finetune_triggers (
         code, model_id, feature_template_id, default_dataset_id,
         condition, config, is_active, metadata, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        code,
        input.model_id,
        input.feature_template_id ?? null,
        input.default_dataset_id ?? null,
        JSON.stringify(input.condition),
        JSON.stringify(input.config ?? {}),
        input.is_active ?? true,
        JSON.stringify(input.metadata ?? {}),
        userId,
      ]
    );
    return mapAutoTrigger(res.rows[0]!);
  }

  async findAutoFinetuneTrigger(id: string): Promise<AutoFinetuneTriggerRow | null> {
    const res = await this.pool.query<RawAutoTrigger>(
      `SELECT * FROM ml_auto_finetune_triggers WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return res.rows[0] ? mapAutoTrigger(res.rows[0]) : null;
  }

  async listAutoFinetuneTriggers(modelId: string | null): Promise<AutoFinetuneTriggerRow[]> {
    const where = modelId
      ? 'WHERE model_id = $1 AND deleted_at IS NULL'
      : 'WHERE deleted_at IS NULL';
    const params = modelId ? [modelId] : [];
    const res = await this.pool.query<RawAutoTrigger>(
      `SELECT * FROM ml_auto_finetune_triggers ${where} ORDER BY created_at DESC`,
      params
    );
    return res.rows.map(mapAutoTrigger);
  }

  async recordAutoTriggerFire(triggerId: string, jobId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ml_auto_finetune_triggers
          SET last_fired_at = NOW(),
              last_fired_job_id = $2,
              fire_count = fire_count + 1,
              updated_at = NOW()
        WHERE id = $1`,
      [triggerId, jobId]
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Row mapping
// ─────────────────────────────────────────────────────────────────────────────

interface RawDataset {
  id: string;
  code: string;
  name: string;
  description: string | null;
  dataset_version: string | null;
  storage_url: string;
  format: string | null;
  schema_definition: Record<string, unknown> | null;
  size_bytes: string | number | null;
  row_count: string | number | null;
  source_query: string | null;
  source_at: Date | null;
  checksum: string | null;
  splits: Record<string, number> | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  version: number;
}
interface RawFeatureTemplate {
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
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  version: number;
}
interface RawModel {
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
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  version: number;
}
interface RawModelVersion {
  id: string;
  model_id: string;
  version_number: number;
  version_label: string | null;
  artifact_url: string;
  artifact_hash: string | null;
  artifact_size_bytes: string | number | null;
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
  promoted_at: Date | null;
  retired_at: Date | null;
  approved_at: Date | null;
  release_notes: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}
interface RawTrainingJob {
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
  queued_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  duration_seconds: number | null;
  compute_provider: string | null;
  cluster: string | null;
  cpu_cores: string | number | null;
  gpu_count: number | null;
  gpu_type: string | null;
  memory_peak_mb: number | null;
  cost: string | number | null;
  cost_currency: string | null;
  metrics: Record<string, number>;
  artifact_url: string | null;
  logs_url: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}
interface RawRelease {
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
  released_at: Date;
  guardrails: Record<string, unknown>;
  guardrails_passed: boolean | null;
  released_artifact_url: string | null;
  metrics_snapshot: Record<string, number>;
  metadata: Record<string, unknown>;
  trace_id: string | null;
  created_at: Date;
}
interface RawAutoTrigger {
  id: string;
  code: string;
  model_id: string;
  feature_template_id: string | null;
  default_dataset_id: string | null;
  condition: AutoFinetuneTriggerCondition;
  config: TrainingConfig;
  is_active: boolean;
  last_fired_at: Date | null;
  last_fired_job_id: string | null;
  fire_count: number;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  version: number;
}

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function mapDataset(r: RawDataset): DatasetRow {
  return {
    ...r,
    size_bytes: num(r.size_bytes),
    row_count: num(r.row_count),
    source_at: r.source_at ? r.source_at.toISOString() : null,
    schema_definition: r.schema_definition ?? null,
    splits: r.splits ?? null,
    tags: r.tags ?? [],
    metadata: r.metadata ?? {},
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}
function mapFeatureTemplate(r: RawFeatureTemplate): FeatureTemplateRow {
  return {
    ...r,
    spec: r.spec ?? {},
    tags: r.tags ?? [],
    metadata: r.metadata ?? {},
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}
function mapModel(r: RawModel): ModelRow {
  return {
    ...r,
    tags: r.tags ?? [],
    metadata: r.metadata ?? {},
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}
function mapModelVersion(r: RawModelVersion): ModelVersionRow {
  return {
    ...r,
    artifact_size_bytes: num(r.artifact_size_bytes),
    hyperparameters: r.hyperparameters ?? {},
    features: r.features ?? null,
    output_schema: r.output_schema ?? null,
    metrics: r.metrics ?? {},
    promoted_at: r.promoted_at ? r.promoted_at.toISOString() : null,
    retired_at: r.retired_at ? r.retired_at.toISOString() : null,
    approved_at: r.approved_at ? r.approved_at.toISOString() : null,
    metadata: r.metadata ?? {},
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}
function mapTrainingJob(r: RawTrainingJob): TrainingJobRow {
  return {
    ...r,
    config: r.config ?? {},
    metrics: r.metrics ?? {},
    cpu_cores: num(r.cpu_cores),
    cost: num(r.cost),
    queued_at: r.queued_at.toISOString(),
    started_at: r.started_at ? r.started_at.toISOString() : null,
    completed_at: r.completed_at ? r.completed_at.toISOString() : null,
    metadata: r.metadata ?? {},
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}
function mapRelease(r: RawRelease): ReleaseRow {
  return {
    ...r,
    guardrails: r.guardrails ?? {},
    metrics_snapshot: r.metrics_snapshot ?? {},
    metadata: r.metadata ?? {},
    released_at: r.released_at.toISOString(),
    created_at: r.created_at.toISOString(),
  };
}
function mapAutoTrigger(r: RawAutoTrigger): AutoFinetuneTriggerRow {
  return {
    ...r,
    config: r.config ?? {},
    metadata: r.metadata ?? {},
    last_fired_at: r.last_fired_at ? r.last_fired_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

export type { PoolClient };
