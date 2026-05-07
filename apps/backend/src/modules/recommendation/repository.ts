/**
 * Persistence for `recommendation_tasks` and `candidate_results`.
 *
 * Single source-of-truth for the rows shaped by `types.ts`. We always
 * persist within a single transaction so a partially-written task can never
 * be observed.
 */
import type { Pool, PoolClient } from 'pg';
import type {
  CandidateOrigin,
  CandidateResult,
  GenerateRequest,
  RecommendationStatus,
  RecommendationStrategy,
  RecommendationTaskRow,
  RecommendationTaskSummary,
} from './types.js';

export interface InsertTaskInput {
  code: string;
  product_category: string;
  application_scene: string | null;
  strategy: RecommendationStrategy;
  target_metrics: GenerateRequest['target_metrics'];
  cost_limit: number | null;
  carbon_limit: number | null;
  inventory_constraints: NonNullable<GenerateRequest['inventory_constraints']>;
  material_pool: NonNullable<GenerateRequest['material_pool']>;
  replacement_pool: NonNullable<GenerateRequest['replacement_pool']>;
  locked_materials: NonNullable<GenerateRequest['locked_materials']>;
  process_constraints: NonNullable<GenerateRequest['process_constraints']>;
  n_candidates: number;
  random_seed: number;
  model_code: string;
  model_version: string;
  predictor_mode: 'mock' | 'real';
  status: RecommendationStatus;
  error_class: string | null;
  error_message: string | null;
  duration_ms: number;
  summary: RecommendationTaskSummary;
  trace_id: string;
  created_by: string | null;
}

export interface InsertCandidateInput {
  task_id: string;
  rank: number;
  name: string;
  headline: string | null;
  origin: CandidateOrigin;
  parent_candidate_id: string | null;
  bom: CandidateResult['bom'];
  predicted_metrics: CandidateResult['predicted_metrics'];
  estimated_cost: number | null;
  cost_unit: string;
  carbon_estimate: number | null;
  risk_warnings: CandidateResult['risk_warnings'];
  constraint_match: CandidateResult['constraint_match'];
  composite_score: number;
  score_breakdown: CandidateResult['score_breakdown'];
  confidence: number;
  metadata: Record<string, unknown>;
}

export class RecommendationRepository {
  constructor(private readonly pool: Pool) {}

  // ──────────────────────────────────────────────────────────────────────
  // Task code generator (REC-YYYY-NNNN)
  // ──────────────────────────────────────────────────────────────────────
  async nextTaskCode(): Promise<string> {
    const year = new Date().getFullYear();
    const res = await this.pool.query<{ code: string }>(
      `SELECT code FROM recommendation_tasks
        WHERE code LIKE $1 ORDER BY code DESC LIMIT 1`,
      [`REC-${year}-%`]
    );
    let n = 1;
    if (res.rows[0]?.code) {
      const m = /^REC-\d{4}-(\d+)$/.exec(res.rows[0].code);
      if (m) n = Number(m[1]) + 1;
    }
    return `REC-${year}-${String(n).padStart(4, '0')}`;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Tasks
  // ──────────────────────────────────────────────────────────────────────
  async createTaskWithCandidates(
    task: InsertTaskInput,
    candidates: InsertCandidateInput[]
  ): Promise<{ task_id: string; candidate_ids: string[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const taskRes = await client.query<{ id: string }>(
        `INSERT INTO recommendation_tasks (
            code, product_category, application_scene, strategy,
            target_metrics, cost_limit, carbon_limit,
            inventory_constraints, material_pool, replacement_pool,
            locked_materials, process_constraints, n_candidates,
            random_seed, model_code, model_version, predictor_mode,
            status, error_class, error_message, duration_ms, summary,
            trace_id, created_by
          )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         RETURNING id`,
        [
          task.code,
          task.product_category,
          task.application_scene,
          task.strategy,
          JSON.stringify(task.target_metrics),
          task.cost_limit,
          task.carbon_limit,
          JSON.stringify(task.inventory_constraints),
          JSON.stringify(task.material_pool),
          JSON.stringify(task.replacement_pool),
          JSON.stringify(task.locked_materials),
          JSON.stringify(task.process_constraints),
          task.n_candidates,
          task.random_seed,
          task.model_code,
          task.model_version,
          task.predictor_mode,
          task.status,
          task.error_class,
          task.error_message,
          task.duration_ms,
          JSON.stringify(task.summary),
          task.trace_id,
          task.created_by,
        ]
      );
      const taskId = taskRes.rows[0]!.id;

      const candidateIds: string[] = [];
      for (const c of candidates) {
        const id = await this.runInsertCandidate(client, { ...c, task_id: taskId });
        candidateIds.push(id);
      }
      await client.query('COMMIT');
      return { task_id: taskId, candidate_ids: candidateIds };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async insertCandidate(c: InsertCandidateInput): Promise<{ id: string }> {
    const id = await this.runInsertCandidate(this.pool, c);
    return { id };
  }

  async findTaskById(id: string): Promise<RecommendationTaskRow | null> {
    const res = await this.pool.query<RawTaskRow>(
      `SELECT * FROM recommendation_tasks WHERE id = $1`,
      [id]
    );
    if (!res.rows[0]) return null;
    return mapTaskRow(res.rows[0]);
  }

  async findCandidateById(id: string): Promise<CandidateResult | null> {
    const res = await this.pool.query<RawCandidateRow>(
      `SELECT * FROM candidate_results WHERE id = $1`,
      [id]
    );
    if (!res.rows[0]) return null;
    return mapCandidateRow(res.rows[0]);
  }

  async listCandidatesByTask(taskId: string): Promise<CandidateResult[]> {
    const res = await this.pool.query<RawCandidateRow>(
      `SELECT * FROM candidate_results
         WHERE task_id = $1
         ORDER BY rank ASC, created_at ASC`,
      [taskId]
    );
    return res.rows.map(mapCandidateRow);
  }

  async maxRankForTask(taskId: string): Promise<number> {
    const res = await this.pool.query<{ max: number | null }>(
      `SELECT MAX(rank) AS max FROM candidate_results WHERE task_id = $1`,
      [taskId]
    );
    return res.rows[0]?.max ?? 0;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────────
  private async runInsertCandidate(
    runner: Pool | PoolClient,
    c: InsertCandidateInput
  ): Promise<string> {
    const res = await runner.query<{ id: string }>(
      `INSERT INTO candidate_results (
          task_id, rank, name, headline, origin, parent_candidate_id,
          bom, predicted_metrics, estimated_cost, cost_unit, carbon_estimate,
          risk_warnings, constraint_match, composite_score, score_breakdown,
          confidence, metadata
        )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        c.task_id,
        c.rank,
        c.name,
        c.headline,
        c.origin,
        c.parent_candidate_id,
        JSON.stringify(c.bom),
        JSON.stringify(c.predicted_metrics),
        c.estimated_cost,
        c.cost_unit,
        c.carbon_estimate,
        JSON.stringify(c.risk_warnings),
        JSON.stringify(c.constraint_match),
        c.composite_score,
        JSON.stringify(c.score_breakdown),
        c.confidence,
        JSON.stringify(c.metadata),
      ]
    );
    return res.rows[0]!.id;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Row → DTO mapping. Postgres returns JSONB as parsed objects already; only
// numeric columns may need type coercion (NUMERIC ⇒ string by default).
// ─────────────────────────────────────────────────────────────────────────────
interface RawTaskRow {
  id: string;
  code: string;
  product_category: string;
  application_scene: string | null;
  strategy: RecommendationStrategy;
  target_metrics: GenerateRequest['target_metrics'];
  cost_limit: string | number | null;
  carbon_limit: string | number | null;
  inventory_constraints: GenerateRequest['inventory_constraints'];
  material_pool: GenerateRequest['material_pool'];
  replacement_pool: GenerateRequest['replacement_pool'];
  locked_materials: GenerateRequest['locked_materials'];
  process_constraints: GenerateRequest['process_constraints'];
  n_candidates: number;
  random_seed: string | number;
  model_code: string;
  model_version: string;
  predictor_mode: 'mock' | 'real';
  status: RecommendationStatus;
  error_class: string | null;
  error_message: string | null;
  duration_ms: number;
  summary: RecommendationTaskSummary;
  trace_id: string;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
}

interface RawCandidateRow {
  id: string;
  task_id: string;
  rank: number;
  name: string;
  headline: string | null;
  origin: CandidateOrigin;
  parent_candidate_id: string | null;
  bom: CandidateResult['bom'];
  predicted_metrics: CandidateResult['predicted_metrics'];
  estimated_cost: string | number | null;
  cost_unit: string;
  carbon_estimate: string | number | null;
  risk_warnings: CandidateResult['risk_warnings'];
  constraint_match: CandidateResult['constraint_match'];
  composite_score: string | number | null;
  score_breakdown: CandidateResult['score_breakdown'];
  confidence: string | number | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapTaskRow(r: RawTaskRow): RecommendationTaskRow {
  return {
    id: r.id,
    code: r.code,
    product_category: r.product_category,
    application_scene: r.application_scene,
    strategy: r.strategy,
    target_metrics: r.target_metrics,
    cost_limit: num(r.cost_limit),
    carbon_limit: num(r.carbon_limit),
    inventory_constraints: (r.inventory_constraints ?? []) as NonNullable<
      GenerateRequest['inventory_constraints']
    >,
    material_pool: (r.material_pool ?? []) as NonNullable<GenerateRequest['material_pool']>,
    replacement_pool: (r.replacement_pool ?? []) as NonNullable<
      GenerateRequest['replacement_pool']
    >,
    locked_materials: (r.locked_materials ?? []) as NonNullable<
      GenerateRequest['locked_materials']
    >,
    process_constraints: (r.process_constraints ?? {}) as NonNullable<
      GenerateRequest['process_constraints']
    >,
    n_candidates: r.n_candidates,
    random_seed: Number(r.random_seed),
    model_code: r.model_code,
    model_version: r.model_version,
    predictor_mode: r.predictor_mode,
    status: r.status,
    error_class: r.error_class,
    error_message: r.error_message,
    duration_ms: r.duration_ms,
    summary: r.summary,
    trace_id: r.trace_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    created_by: r.created_by,
  };
}

function mapCandidateRow(r: RawCandidateRow): CandidateResult {
  return {
    id: r.id,
    task_id: r.task_id,
    rank: r.rank,
    name: r.name,
    headline: r.headline ?? '',
    origin: r.origin,
    parent_candidate_id: r.parent_candidate_id,
    bom: r.bom ?? [],
    predicted_metrics: r.predicted_metrics ?? [],
    estimated_cost: num(r.estimated_cost),
    cost_unit: r.cost_unit,
    carbon_estimate: num(r.carbon_estimate),
    risk_warnings: r.risk_warnings ?? [],
    constraint_match: r.constraint_match ?? { passed: [], failed: [], score: 0 },
    composite_score: num(r.composite_score) ?? 0,
    score_breakdown:
      r.score_breakdown ??
      ({
        target_score: 0,
        cost_score: 0,
        confidence_score: 0,
        constraint_score: 0,
        risk_penalty: 0,
      } as CandidateResult['score_breakdown']),
    confidence: num(r.confidence) ?? 0,
    metadata: r.metadata ?? {},
    created_at: r.created_at.toISOString(),
  };
}
