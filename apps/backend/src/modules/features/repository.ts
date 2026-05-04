import type { Pool, PoolClient } from 'pg';
import type {
  AchievedMetrics,
  CompositionVector,
  FeatureMap,
  FormulaItemInput,
  FormulaVersionFeatureSet,
  FormulaVersionInputs,
} from './types.js';

export class FeaturesRepository {
  constructor(private pool: Pool) {}

  // -------------------------- runs --------------------------

  async createRun(input: {
    feature_set_version: string;
    trigger_type: 'manual' | 'scheduled' | 'api' | 'cleaning_run';
    triggered_by?: string;
    source_cleaning_run_id?: string;
    trace_id: string;
    scope_filter?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const r = await this.pool.query<{ id: string }>(
      `INSERT INTO feature_generation_runs
         (feature_set_version, trigger_type, triggered_by, source_cleaning_run_id,
          trace_id, scope_filter, status)
       VALUES ($1,$2,$3,$4,$5,$6,'queued')
       RETURNING id`,
      [
        input.feature_set_version, input.trigger_type, input.triggered_by ?? null,
        input.source_cleaning_run_id ?? null, input.trace_id,
        input.scope_filter ?? {},
      ]
    );
    return r.rows[0]!;
  }

  async markRunRunning(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE feature_generation_runs SET status='running', started_at=NOW() WHERE id=$1`,
      [id]
    );
  }

  async markRunFinished(id: string, status: 'succeeded' | 'partial' | 'failed', error?: string): Promise<void> {
    await this.pool.query(
      `UPDATE feature_generation_runs
          SET status = $2,
              completed_at = NOW(),
              duration_ms = EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, created_at)))::INTEGER * 1000,
              error_message = $3
        WHERE id = $1`,
      [id, status, error ?? null]
    );
  }

  async incrementRunCounters(id: string, deltas: {
    processed?: number; generated?: number; failed?: number; skipped?: number;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE feature_generation_runs SET
          records_processed = records_processed + COALESCE($2,0),
          records_generated = records_generated + COALESCE($3,0),
          records_failed    = records_failed    + COALESCE($4,0),
          records_skipped   = records_skipped   + COALESCE($5,0)
        WHERE id = $1`,
      [id, deltas.processed ?? 0, deltas.generated ?? 0, deltas.failed ?? 0, deltas.skipped ?? 0]
    );
  }

  async findRun(id: string): Promise<Record<string, unknown> | null> {
    const r = await this.pool.query(`SELECT * FROM feature_generation_runs WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  async listRuns(filter: { status?: string; feature_set_version?: string; limit?: number; offset?: number } = {}): Promise<{ items: unknown[]; total: number }> {
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.status)              { where.push(`status = $${i++}`);              params.push(filter.status); }
    if (filter.feature_set_version) { where.push(`feature_set_version = $${i++}`); params.push(filter.feature_set_version); }
    const limit = Math.min(200, Math.max(1, filter.limit ?? 20));
    const offset = Math.max(0, filter.offset ?? 0);
    const total = parseInt(
      (await this.pool.query<{ c: string }>(
        `SELECT COUNT(*)::text c FROM feature_generation_runs WHERE ${where.join(' AND ')}`,
        params
      )).rows[0]?.c ?? '0', 10
    );
    const items = (await this.pool.query(
      `SELECT * FROM feature_generation_runs WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    )).rows;
    return { items, total };
  }

  // -------------------------- inputs --------------------------

  /**
   * Pull every formula version + its joined items + materials in one round trip.
   * Filterable by formula_id list, product_category_code, since.
   */
  async listFormulaVersionInputs(filter: {
    formula_ids?: string[];
    product_category_code?: string;
    only_approved?: boolean;
    limit?: number;
  } = {}): Promise<FormulaVersionInputs[]> {
    const where: string[] = ['fv.deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;

    if (filter.formula_ids && filter.formula_ids.length > 0) {
      where.push(`fv.formula_id = ANY($${i++})`);
      params.push(filter.formula_ids);
    }
    if (filter.product_category_code) {
      where.push(`pc.code = $${i++}`);
      params.push(filter.product_category_code);
    }
    if (filter.only_approved) {
      where.push(`fv.status = 'approved'`);
    }
    const limit = Math.min(5000, Math.max(1, filter.limit ?? 500));

    const versions = await this.pool.query<{
      formula_version_id: string;
      formula_id: string;
      formula_code: string;
      formula_name: string;
      product_id: string | null;
      product_category_code: string | null;
      product_code: string | null;
      batch_size: string | null;
      batch_unit: string;
      cost_currency: string;
    }>(
      `SELECT fv.id  AS formula_version_id,
              fv.formula_id,
              f.code  AS formula_code,
              f.name  AS formula_name,
              p.id    AS product_id,
              pc.code AS product_category_code,
              p.code  AS product_code,
              fv.batch_size::text AS batch_size,
              COALESCE(fv.batch_unit, 'kg') AS batch_unit,
              COALESCE(fv.cost_currency, 'USD') AS cost_currency
         FROM formula_versions fv
         JOIN formulas f ON f.id = fv.formula_id
         LEFT JOIN products p ON p.id = f.product_id
         LEFT JOIN product_categories pc ON pc.id = p.category_id
        WHERE ${where.join(' AND ')}
        ORDER BY fv.created_at DESC
        LIMIT ${limit}`,
      params
    );
    if (versions.rows.length === 0) return [];

    const versionIds = versions.rows.map((r) => r.formula_version_id);

    // Join items + materials in ONE query
    const itemsRes = await this.pool.query<FormulaItemInput & { formula_version_id: string }>(
      `SELECT fi.id         AS formula_item_id,
              fi.formula_version_id,
              fi.raw_material_id,
              fi.product_id,
              fi.sequence_no,
              fi.step_no,
              fi.phase,
              fi.amount::float8       AS amount,
              fi.percentage::float8   AS percentage,
              fi.unit_of_measure,
              fi.role,
              COALESCE(fi.is_optional, false) AS is_optional,
              COALESCE(fi.is_critical, false) AS is_critical,
              fi.unit_cost::float8    AS unit_cost,
              fi.total_cost::float8   AS total_cost,
              rm.code  AS material_code,
              rm.name  AS material_name,
              rm.density::float8           AS material_density,
              rm.molecular_weight::float8  AS material_molecular_weight,
              rm.flash_point_c::float8     AS material_flash_point_c,
              rm.viscosity_cst::float8     AS material_viscosity_cst,
              rm.ph_value::float8          AS material_ph,
              rm.default_unit_cost::float8 AS material_default_unit_cost,
              COALESCE(rm.tags, ARRAY[]::TEXT[]) AS material_tags,
              COALESCE(rm.properties, '{}'::jsonb) AS material_properties
         FROM formula_items fi
         LEFT JOIN raw_materials rm ON rm.id = fi.raw_material_id
        WHERE fi.formula_version_id = ANY($1)
          AND fi.deleted_at IS NULL
        ORDER BY fi.formula_version_id, fi.sequence_no`,
      [versionIds]
    );

    const itemsByVersion = new Map<string, FormulaItemInput[]>();
    for (const row of itemsRes.rows) {
      const { formula_version_id, ...item } = row;
      const list = itemsByVersion.get(formula_version_id) ?? [];
      list.push(item);
      itemsByVersion.set(formula_version_id, list);
    }

    return versions.rows.map((v) => ({
      formula_version_id: v.formula_version_id,
      formula_id: v.formula_id,
      formula_code: v.formula_code,
      formula_name: v.formula_name,
      product_id: v.product_id,
      product_category_code: v.product_category_code,
      product_code: v.product_code,
      batch_size: v.batch_size === null ? null : Number(v.batch_size),
      batch_unit: v.batch_unit,
      cost_currency: v.cost_currency,
      items: itemsByVersion.get(v.formula_version_id) ?? [],
    }));
  }

  /**
   * Per-formula-version achieved targets — averaged + std over normalized rows
   * that aren't outliers and aren't unresolved.
   */
  async loadAchievedMetrics(formulaVersionIds: string[]): Promise<Map<string, AchievedMetrics>> {
    if (formulaVersionIds.length === 0) return new Map();
    const r = await this.pool.query<{
      formula_version_id: string;
      metric_code: string;
      mean: string;
      std: string;
      cnt: string;
    }>(
      `SELECT formula_version_id,
              metric_code,
              AVG(normalized_value)::text  AS mean,
              COALESCE(stddev_pop(normalized_value),0)::text AS std,
              COUNT(*)::text AS cnt
         FROM normalized_test_results
        WHERE formula_version_id = ANY($1)
          AND deleted_at IS NULL
          AND is_outlier = FALSE
          AND is_unresolved = FALSE
          AND is_missing = FALSE
          AND normalized_value IS NOT NULL
          AND metric_code IS NOT NULL
        GROUP BY formula_version_id, metric_code`,
      [formulaVersionIds]
    );
    const map = new Map<string, AchievedMetrics>();
    for (const row of r.rows) {
      const cur = map.get(row.formula_version_id) ?? {};
      cur[row.metric_code] = {
        mean: Number(row.mean),
        std: Number(row.std),
        count: parseInt(row.cnt, 10),
      };
      map.set(row.formula_version_id, cur);
    }
    return map;
  }

  /**
   * Per-(formula_version, batch_code) achieved values for the FORWARD mart.
   * Returns one row per distinct batch.
   */
  async loadBatchTargets(formulaVersionIds: string[]): Promise<Map<string, Array<{
    batch_code: string | null;
    measured_at: Date | null;
    target_metrics: Record<string, number>;
    target_metric_codes: string[];
    source_normalized_test_result_ids: string[];
    is_outlier: boolean;
  }>>> {
    if (formulaVersionIds.length === 0) return new Map();
    const r = await this.pool.query<{
      formula_version_id: string;
      batch_code: string | null;
      measured_at: Date | null;
      target_metrics: Record<string, number>;
      target_metric_codes: string[];
      source_ids: string[];
      any_outlier: boolean;
    }>(
      `SELECT formula_version_id,
              COALESCE(batch_code, '') AS batch_code,
              MAX(measured_at) AS measured_at,
              jsonb_object_agg(metric_code, normalized_value) FILTER (WHERE metric_code IS NOT NULL AND normalized_value IS NOT NULL) AS target_metrics,
              array_agg(DISTINCT metric_code) FILTER (WHERE metric_code IS NOT NULL) AS target_metric_codes,
              array_agg(id) AS source_ids,
              bool_or(is_outlier) AS any_outlier
         FROM normalized_test_results
        WHERE formula_version_id = ANY($1)
          AND deleted_at IS NULL
          AND is_unresolved = FALSE
          AND is_missing = FALSE
          AND metric_code IS NOT NULL
        GROUP BY formula_version_id, batch_code`,
      [formulaVersionIds]
    );

    const out = new Map<string, Array<{
      batch_code: string | null;
      measured_at: Date | null;
      target_metrics: Record<string, number>;
      target_metric_codes: string[];
      source_normalized_test_result_ids: string[];
      is_outlier: boolean;
    }>>();
    for (const row of r.rows) {
      const list = out.get(row.formula_version_id) ?? [];
      list.push({
        batch_code: row.batch_code === '' ? null : row.batch_code,
        measured_at: row.measured_at ?? null,
        target_metrics: row.target_metrics ?? {},
        target_metric_codes: row.target_metric_codes ?? [],
        source_normalized_test_result_ids: row.source_ids ?? [],
        is_outlier: row.any_outlier ?? false,
      });
      out.set(row.formula_version_id, list);
    }
    return out;
  }

  // -------------------------- writes --------------------------

  async upsertFormulaVersionFeatures(
    fs: FormulaVersionFeatureSet,
    runId: string,
    client?: PoolClient
  ): Promise<{ id: string }> {
    const exec = client ?? this.pool;
    const r = await exec.query<{ id: string }>(
      `INSERT INTO formula_version_features (
          formula_version_id, feature_set_version, generation_run_id, features,
          num_items, num_phases, num_active, total_active_pct,
          weighted_density, weighted_viscosity_log, blended_viscosity_cst,
          total_cost, cost_currency, complexity_entropy,
          has_missing_inputs, missing_inputs
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (formula_version_id, feature_set_version) DO UPDATE SET
          generation_run_id = EXCLUDED.generation_run_id,
          features          = EXCLUDED.features,
          num_items         = EXCLUDED.num_items,
          num_phases        = EXCLUDED.num_phases,
          num_active        = EXCLUDED.num_active,
          total_active_pct  = EXCLUDED.total_active_pct,
          weighted_density  = EXCLUDED.weighted_density,
          weighted_viscosity_log = EXCLUDED.weighted_viscosity_log,
          blended_viscosity_cst  = EXCLUDED.blended_viscosity_cst,
          total_cost        = EXCLUDED.total_cost,
          cost_currency     = EXCLUDED.cost_currency,
          complexity_entropy = EXCLUDED.complexity_entropy,
          has_missing_inputs = EXCLUDED.has_missing_inputs,
          missing_inputs     = EXCLUDED.missing_inputs,
          computed_at        = NOW()
       RETURNING id`,
      [
        fs.formula_version_id, fs.feature_set_version, runId, fs.features,
        fs.hot.num_items, fs.hot.num_phases, fs.hot.num_active, fs.hot.total_active_pct,
        fs.hot.weighted_density, fs.hot.weighted_viscosity_log, fs.hot.blended_viscosity_cst,
        fs.hot.total_cost, fs.hot.cost_currency, fs.hot.complexity_entropy,
        fs.has_missing_inputs, JSON.stringify(fs.missing_inputs),
      ]
    );
    return r.rows[0]!;
  }

  async upsertForwardSample(input: {
    feature_set_version: string;
    generation_run_id: string;
    formula_version_id: string;
    formula_id: string;
    product_id: string | null;
    product_category_code: string | null;
    batch_code: string | null;
    features: FeatureMap;
    target_metrics: Record<string, number>;
    target_metric_codes: string[];
    is_outlier: boolean;
    is_complete: boolean;
    has_targets: boolean;
    weight: number;
    source_normalized_test_result_ids: string[];
    measured_at: Date | null;
  }, client?: PoolClient): Promise<void> {
    const exec = client ?? this.pool;
    await exec.query(
      `INSERT INTO mart_forward_training_sample (
          feature_set_version, generation_run_id, formula_version_id, formula_id,
          product_id, product_category_code, batch_code,
          features, target_metrics, target_metric_codes,
          is_outlier, is_complete, has_targets, weight,
          source_normalized_test_result_ids, measured_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (formula_version_id, batch_code, feature_set_version) DO UPDATE SET
          generation_run_id = EXCLUDED.generation_run_id,
          features          = EXCLUDED.features,
          target_metrics    = EXCLUDED.target_metrics,
          target_metric_codes = EXCLUDED.target_metric_codes,
          is_outlier        = EXCLUDED.is_outlier,
          is_complete       = EXCLUDED.is_complete,
          has_targets       = EXCLUDED.has_targets,
          weight            = EXCLUDED.weight,
          source_normalized_test_result_ids = EXCLUDED.source_normalized_test_result_ids,
          measured_at       = EXCLUDED.measured_at`,
      [
        input.feature_set_version, input.generation_run_id, input.formula_version_id, input.formula_id,
        input.product_id, input.product_category_code, input.batch_code,
        input.features, input.target_metrics, input.target_metric_codes,
        input.is_outlier, input.is_complete, input.has_targets, input.weight,
        input.source_normalized_test_result_ids, input.measured_at,
      ]
    );
  }

  async upsertInverseAnchor(input: {
    feature_set_version: string;
    generation_run_id: string;
    formula_version_id: string;
    formula_id: string;
    product_id: string | null;
    product_category_code: string | null;
    features: FeatureMap;
    composition_vector: CompositionVector;
    achieved_metrics: AchievedMetrics;
    sample_size: number;
    cost_target: number | null;
    cost_currency: string;
  }, client?: PoolClient): Promise<void> {
    const exec = client ?? this.pool;
    await exec.query(
      `INSERT INTO mart_inverse_generation_base (
          feature_set_version, generation_run_id, formula_version_id, formula_id,
          product_id, product_category_code, features, composition_vector,
          achieved_metrics, sample_size, cost_target, cost_currency
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (formula_version_id, feature_set_version) DO UPDATE SET
          generation_run_id   = EXCLUDED.generation_run_id,
          features            = EXCLUDED.features,
          composition_vector  = EXCLUDED.composition_vector,
          achieved_metrics    = EXCLUDED.achieved_metrics,
          sample_size         = EXCLUDED.sample_size,
          cost_target         = EXCLUDED.cost_target,
          cost_currency       = EXCLUDED.cost_currency`,
      [
        input.feature_set_version, input.generation_run_id, input.formula_version_id, input.formula_id,
        input.product_id, input.product_category_code, input.features, input.composition_vector,
        input.achieved_metrics, input.sample_size, input.cost_target, input.cost_currency,
      ]
    );
  }

  // -------------------------- queries --------------------------

  async getFeatureDictionary(version?: string): Promise<unknown[]> {
    if (version) {
      const r = await this.pool.query(
        `SELECT * FROM feature_definitions
          WHERE feature_set_version = $1 AND deleted_at IS NULL AND is_active = TRUE
          ORDER BY feature_group, display_order, feature_name`,
        [version]
      );
      return r.rows;
    }
    const r = await this.pool.query(
      `SELECT * FROM feature_definitions
        WHERE deleted_at IS NULL AND is_active = TRUE
        ORDER BY feature_set_version DESC, feature_group, display_order, feature_name`
    );
    return r.rows;
  }

  async listForwardSamples(filter: {
    feature_set_version?: string;
    product_category_code?: string;
    target_metric?: string;
    is_complete?: boolean;
    formula_version_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: unknown[]; total: number }> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.feature_set_version)   { where.push(`feature_set_version = $${i++}`);  params.push(filter.feature_set_version); }
    if (filter.product_category_code) { where.push(`product_category_code = $${i++}`);params.push(filter.product_category_code); }
    if (filter.target_metric)         { where.push(`target_metric_codes @> ARRAY[$${i++}]::text[]`); params.push(filter.target_metric); }
    if (filter.is_complete !== undefined) { where.push(`is_complete = $${i++}`); params.push(filter.is_complete); }
    if (filter.formula_version_id)    { where.push(`formula_version_id = $${i++}`);   params.push(filter.formula_version_id); }
    const limit = Math.min(5000, Math.max(1, filter.limit ?? 100));
    const offset = Math.max(0, filter.offset ?? 0);
    const total = parseInt(
      (await this.pool.query<{ c: string }>(
        `SELECT COUNT(*)::text c FROM mart_forward_training_sample WHERE ${where.join(' AND ')}`,
        params
      )).rows[0]?.c ?? '0', 10
    );
    const items = (await this.pool.query(
      `SELECT * FROM mart_forward_training_sample WHERE ${where.join(' AND ')}
        ORDER BY measured_at DESC NULLS LAST LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    )).rows;
    return { items, total };
  }

  async listInverseAnchors(filter: {
    feature_set_version?: string;
    product_category_code?: string;
    status?: string;
    formula_version_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: unknown[]; total: number }> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.feature_set_version)   { where.push(`feature_set_version = $${i++}`);  params.push(filter.feature_set_version); }
    if (filter.product_category_code) { where.push(`product_category_code = $${i++}`);params.push(filter.product_category_code); }
    if (filter.status)                { where.push(`status = $${i++}`);               params.push(filter.status); }
    if (filter.formula_version_id)    { where.push(`formula_version_id = $${i++}`);   params.push(filter.formula_version_id); }
    const limit = Math.min(5000, Math.max(1, filter.limit ?? 100));
    const offset = Math.max(0, filter.offset ?? 0);
    const total = parseInt(
      (await this.pool.query<{ c: string }>(
        `SELECT COUNT(*)::text c FROM mart_inverse_generation_base WHERE ${where.join(' AND ')}`,
        params
      )).rows[0]?.c ?? '0', 10
    );
    const items = (await this.pool.query(
      `SELECT * FROM mart_inverse_generation_base WHERE ${where.join(' AND ')}
        ORDER BY updated_at DESC LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    )).rows;
    return { items, total };
  }

  async getFormulaVersionFeatures(formulaVersionId: string, version?: string): Promise<unknown | null> {
    const params: unknown[] = [formulaVersionId];
    let sql = `SELECT * FROM formula_version_features WHERE formula_version_id = $1 AND deleted_at IS NULL`;
    if (version) {
      sql += ` AND feature_set_version = $2`;
      params.push(version);
    }
    sql += ` ORDER BY computed_at DESC LIMIT 1`;
    const r = await this.pool.query(sql, params);
    return r.rows[0] ?? null;
  }
}
