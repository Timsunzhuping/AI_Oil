/**
 * Reverse Recommendation Service.
 *
 * High-level lifecycle:
 *
 *   POST /generate          → run pipeline, persist task + candidates
 *   POST /recalculate       → fetch candidate, apply user edits, re-run
 *                             evaluator + filter + ranker for that single
 *                             BOM, optionally persist as a NEW row
 *   POST /replace-material  → convenience wrapper: swap one material in the
 *                             reference candidate, then recalculate
 *   GET  /history/:taskId   → return task + ordered candidate list
 *
 * The service is intentionally I/O-light — pipeline does the math, repo does
 * the persistence. We just orchestrate.
 */
import type { Logger } from 'pino';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { deriveRiskWarnings } from '../prediction/index.js';
import type { BomItem } from '../prediction/types.js';
import { createRng, fallbackSeed, type Rng } from './random.js';
import {
  RecommendationPipeline,
  type ScoredCandidate,
  estimateBomCost,
  estimateBomCarbon,
  type SurrogateEvaluator,
} from './pipeline/index.js';
import { DefaultConstraintFilter, type ConstraintFilter } from './pipeline/filter.js';
import { WeightedSumRanker, type RankingEngine } from './pipeline/ranker.js';
import type { RecommendationRepository, InsertCandidateInput } from './repository.js';
import type {
  CandidateOrigin,
  CandidateResult,
  GenerateRequest,
  GenerateResponse,
  HistoryResponse,
  RecalculateRequest,
  RecalculateResponse,
  RecommendationStrategy,
  RecommendationTaskRow,
  ReplaceMaterialRequest,
} from './types.js';

export interface RecommendationServiceDeps {
  pipeline: RecommendationPipeline;
  /** Used for one-off recalculations; defaults to pipeline.evaluator. */
  evaluator?: SurrogateEvaluator;
  filter?: ConstraintFilter;
  ranker?: RankingEngine;
  repository: RecommendationRepository | null;
  logger: Logger;
}

export class RecommendationService {
  private readonly pipeline: RecommendationPipeline;
  private readonly evaluator: SurrogateEvaluator;
  private readonly filter: ConstraintFilter;
  private readonly ranker: RankingEngine;
  private readonly repository: RecommendationRepository | null;
  private readonly logger: Logger;

  constructor(deps: RecommendationServiceDeps) {
    this.pipeline = deps.pipeline;
    this.evaluator = deps.evaluator ?? deps.pipeline.evaluator;
    this.filter = deps.filter ?? new DefaultConstraintFilter();
    this.ranker = deps.ranker ?? new WeightedSumRanker();
    this.repository = deps.repository;
    this.logger = deps.logger;
  }

  // ────────────────────────────────────────────────────────────────────
  // POST /generate
  // ────────────────────────────────────────────────────────────────────
  async generate(
    req: GenerateRequest,
    ctx: { trace_id: string; user_id: string | null }
  ): Promise<GenerateResponse> {
    const startedAt = Date.now();
    const strategy = resolveStrategy(req);
    const random_seed = req.random_seed ?? fallbackSeed();
    const rng: Rng = createRng(random_seed);

    let pipelineResult;
    try {
      pipelineResult = await this.pipeline.run({ request: req, strategy, rng });
    } catch (err) {
      // Pipeline failure → persist a 'failed' task row for traceability.
      const duration_ms = Date.now() - startedAt;
      const failureMessage = err instanceof Error ? err.message : String(err);
      const failureClass = err instanceof Error ? err.name : 'Error';
      const info = this.evaluator.modelInfo();
      const code = await this.repository?.nextTaskCode().catch(() => 'REC-UNSAVED');
      if (this.repository && code) {
        try {
          await this.repository.createTaskWithCandidates(
            buildInsertTaskInput(req, strategy, random_seed, info, code, {
              status: 'failed',
              error_class: failureClass,
              error_message: failureMessage,
              duration_ms,
              summary: { generated: 0, passed_filters: 0, evaluated: 0, ranked: 0 },
              trace_id: ctx.trace_id,
              created_by: ctx.user_id,
            }),
            []
          );
        } catch (persistErr) {
          this.logger.warn(
            { err: persistErr, trace_id: ctx.trace_id },
            'Persisting failed recommendation task itself failed'
          );
        }
      }
      throw err;
    }

    const { candidates: scored, summary, modelInfo } = pipelineResult;
    const duration_ms = Date.now() - startedAt;
    const status =
      scored.length === 0 ? 'failed' : summary.passed_filters === 0 ? 'partial' : 'succeeded';

    const code = (await this.repository?.nextTaskCode()) ?? `REC-${new Date().getFullYear()}-MEM`;
    const taskInput = buildInsertTaskInput(req, strategy, random_seed, modelInfo, code, {
      status,
      error_class: null,
      error_message: null,
      duration_ms,
      summary,
      trace_id: ctx.trace_id,
      created_by: ctx.user_id,
    });

    const candidateInputs: InsertCandidateInput[] = scored.map((c) => ({
      task_id: 'placeholder',
      rank: c.rank,
      name: nameFor(strategy, c),
      headline: headlineFor(c),
      origin: 'generated' as CandidateOrigin,
      parent_candidate_id: null,
      bom: c.bom,
      predicted_metrics: c.predicted_metrics,
      estimated_cost: c.estimated_cost,
      cost_unit: 'CNY/kg',
      carbon_estimate: c.carbon_estimate,
      risk_warnings: c.risk_warnings,
      constraint_match: c.constraint_match,
      composite_score: c.composite_score,
      score_breakdown: c.score_breakdown,
      confidence: c.confidence,
      metadata: { ...c.raw.metadata, label: c.raw.label },
    }));

    let task_id: string;
    let candidate_ids: string[] = [];
    if (this.repository) {
      const ins = await this.repository.createTaskWithCandidates(taskInput, candidateInputs);
      task_id = ins.task_id;
      candidate_ids = ins.candidate_ids;
    } else {
      task_id = `mem-${Date.now()}`;
      candidate_ids = scored.map((_, i) => `${task_id}-c-${i + 1}`);
    }

    const taskRow = await this.materialiseTask(
      task_id,
      code,
      taskInput,
      ctx,
      duration_ms,
      summary,
      status
    );
    const candidates: CandidateResult[] = scored.map((c, i) => ({
      id: candidate_ids[i] ?? `${task_id}-c-${i + 1}`,
      task_id,
      rank: c.rank,
      name: candidateInputs[i]!.name,
      headline: candidateInputs[i]!.headline ?? '',
      origin: 'generated',
      parent_candidate_id: null,
      bom: c.bom,
      predicted_metrics: c.predicted_metrics,
      estimated_cost: c.estimated_cost,
      cost_unit: 'CNY/kg',
      carbon_estimate: c.carbon_estimate,
      risk_warnings: c.risk_warnings,
      constraint_match: c.constraint_match,
      composite_score: c.composite_score,
      score_breakdown: c.score_breakdown,
      confidence: c.confidence,
      metadata: candidateInputs[i]!.metadata,
      created_at: new Date().toISOString(),
    }));

    return {
      task: taskRow,
      candidates,
      random_seed,
      model_version: modelInfo.version,
      model_code: modelInfo.code,
      predictor_mode: modelInfo.mode,
      trace_id: ctx.trace_id,
      duration_ms,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // POST /recalculate
  // ────────────────────────────────────────────────────────────────────
  async recalculate(
    req: RecalculateRequest,
    ctx: { trace_id: string }
  ): Promise<RecalculateResponse> {
    const startedAt = Date.now();
    const { task, candidate } = await this.requireTaskAndCandidate(req.task_id, req.candidate_id);

    const newBom = req.full_bom ?? applyModifications(candidate.bom, req.modifications ?? []);
    if (newBom.length === 0) throw new BadRequestError('Recalculate produced an empty BOM');

    const result = await this.evaluateOne(task, newBom);
    const persist = req.persist ?? true;

    let persistedId: string | null = null;
    if (persist && this.repository) {
      const nextRank = (await this.repository.maxRankForTask(task.id)) + 1;
      const { id } = await this.repository.insertCandidate({
        task_id: task.id,
        rank: nextRank,
        name: `${candidate.name} (调整后)`,
        headline: headlineFor(result),
        origin: 'recalculated',
        parent_candidate_id: candidate.id,
        bom: newBom,
        predicted_metrics: result.predicted_metrics,
        estimated_cost: result.estimated_cost,
        cost_unit: candidate.cost_unit,
        carbon_estimate: result.carbon_estimate,
        risk_warnings: result.risk_warnings,
        constraint_match: result.constraint_match,
        composite_score: result.composite_score,
        score_breakdown: result.score_breakdown,
        confidence: result.confidence,
        metadata: { source: 'recalculate', modifications: req.modifications ?? null },
      });
      persistedId = id;
    }

    return {
      task_id: task.id,
      base_candidate_id: candidate.id,
      candidate: {
        id: persistedId ?? `${task.id}-recalc-${Date.now()}`,
        task_id: task.id,
        rank: -1,
        name: `${candidate.name} (调整后)`,
        headline: headlineFor(result),
        origin: 'recalculated',
        parent_candidate_id: candidate.id,
        bom: newBom,
        predicted_metrics: result.predicted_metrics,
        estimated_cost: result.estimated_cost,
        cost_unit: candidate.cost_unit,
        carbon_estimate: result.carbon_estimate,
        risk_warnings: result.risk_warnings,
        constraint_match: result.constraint_match,
        composite_score: result.composite_score,
        score_breakdown: result.score_breakdown,
        confidence: result.confidence,
        metadata: { source: 'recalculate' },
        created_at: new Date().toISOString(),
      },
      trace_id: ctx.trace_id,
      duration_ms: Date.now() - startedAt,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // POST /replace-material
  // ────────────────────────────────────────────────────────────────────
  async replaceMaterial(
    req: ReplaceMaterialRequest,
    ctx: { trace_id: string }
  ): Promise<RecalculateResponse> {
    const startedAt = Date.now();
    const { task, candidate } = await this.requireTaskAndCandidate(req.task_id, req.candidate_id);

    const targetIdx = candidate.bom.findIndex(
      (it) => it.material_code === req.swap.from_material_code
    );
    if (targetIdx < 0) {
      throw new BadRequestError(
        `Candidate does not contain material '${req.swap.from_material_code}'`
      );
    }

    const replacementMeta = task.material_pool.find(
      (m) => m.material_code === req.swap.to_material_code
    );
    if (!replacementMeta) {
      throw new BadRequestError(
        `Material '${req.swap.to_material_code}' is not present in the task's material_pool`
      );
    }
    const oldItem = candidate.bom[targetIdx]!;
    const ratio = req.swap.new_ratio ?? oldItem.ratio;
    const newBom: BomItem[] = candidate.bom.map((it, i) =>
      i === targetIdx
        ? {
            ...it,
            material_code: replacementMeta.material_code,
            material_name: replacementMeta.material_name,
            role: replacementMeta.role,
            ratio,
            ...(replacementMeta.supplier_code
              ? { supplier_code: replacementMeta.supplier_code }
              : {}),
          }
        : it
    );

    const result = await this.evaluateOne(task, newBom);
    const persist = req.persist ?? true;

    let persistedId: string | null = null;
    if (persist && this.repository) {
      const nextRank = (await this.repository.maxRankForTask(task.id)) + 1;
      const { id } = await this.repository.insertCandidate({
        task_id: task.id,
        rank: nextRank,
        name: `${candidate.name} (替换 ${req.swap.from_material_code} → ${req.swap.to_material_code})`,
        headline: headlineFor(result),
        origin: 'replaced',
        parent_candidate_id: candidate.id,
        bom: newBom,
        predicted_metrics: result.predicted_metrics,
        estimated_cost: result.estimated_cost,
        cost_unit: candidate.cost_unit,
        carbon_estimate: result.carbon_estimate,
        risk_warnings: result.risk_warnings,
        constraint_match: result.constraint_match,
        composite_score: result.composite_score,
        score_breakdown: result.score_breakdown,
        confidence: result.confidence,
        metadata: { source: 'replace_material', swap: req.swap },
      });
      persistedId = id;
    }

    return {
      task_id: task.id,
      base_candidate_id: candidate.id,
      candidate: {
        id: persistedId ?? `${task.id}-replaced-${Date.now()}`,
        task_id: task.id,
        rank: -1,
        name: `${candidate.name} (替换 ${req.swap.from_material_code} → ${req.swap.to_material_code})`,
        headline: headlineFor(result),
        origin: 'replaced',
        parent_candidate_id: candidate.id,
        bom: newBom,
        predicted_metrics: result.predicted_metrics,
        estimated_cost: result.estimated_cost,
        cost_unit: candidate.cost_unit,
        carbon_estimate: result.carbon_estimate,
        risk_warnings: result.risk_warnings,
        constraint_match: result.constraint_match,
        composite_score: result.composite_score,
        score_breakdown: result.score_breakdown,
        confidence: result.confidence,
        metadata: { source: 'replace_material', swap: req.swap },
        created_at: new Date().toISOString(),
      },
      trace_id: ctx.trace_id,
      duration_ms: Date.now() - startedAt,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // GET /history/:taskId
  // ────────────────────────────────────────────────────────────────────
  async history(taskId: string): Promise<HistoryResponse> {
    if (!this.repository) {
      throw new ConflictError('History endpoint requires a database connection');
    }
    const task = await this.repository.findTaskById(taskId);
    if (!task) throw new NotFoundError('Recommendation task');
    const candidates = await this.repository.listCandidatesByTask(taskId);
    return { task, candidates };
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  /** Re-evaluate a single BOM under the original task's request context. */
  private async evaluateOne(
    task: RecommendationTaskRow,
    bom: BomItem[]
  ): Promise<{
    predicted_metrics: CandidateResult['predicted_metrics'];
    estimated_cost: number | null;
    carbon_estimate: number | null;
    risk_warnings: CandidateResult['risk_warnings'];
    constraint_match: CandidateResult['constraint_match'];
    composite_score: number;
    score_breakdown: CandidateResult['score_breakdown'];
    confidence: number;
  }> {
    const baseRequest: GenerateRequest = {
      product_category: task.product_category,
      target_metrics: task.target_metrics,
      ...(task.application_scene !== null ? { application_scene: task.application_scene } : {}),
      ...(task.cost_limit !== null ? { cost_limit: task.cost_limit } : {}),
      ...(task.carbon_limit !== null ? { carbon_limit: task.carbon_limit } : {}),
      inventory_constraints: task.inventory_constraints,
      material_pool: task.material_pool,
      replacement_pool: task.replacement_pool,
      locked_materials: task.locked_materials,
      process_constraints: task.process_constraints,
      n_candidates: task.n_candidates,
    };

    const constraint = this.filter.evaluate(bom, baseRequest);
    const cost = estimateBomCost(bom, task.material_pool);
    const carbon = estimateBomCarbon(bom, task.material_pool);

    let metrics: CandidateResult['predicted_metrics'] = [];
    let risks: CandidateResult['risk_warnings'] = [];
    let confidence = 0;
    if (constraint.failed.length === 0) {
      metrics = await this.evaluator.evaluate(bom, baseRequest);
      risks = deriveRiskWarnings(metrics, {
        target_metrics: task.target_metrics.map((t) => t.name),
      });
      if (metrics.length > 0) {
        confidence = metrics.reduce((s, m) => s + m.confidence, 0) / metrics.length;
      }
    }

    const { composite, breakdown } = this.ranker.score({
      predicted_metrics: metrics,
      estimated_cost: cost,
      cost_limit: task.cost_limit,
      risk_warnings: risks,
      constraint_match: constraint,
      target_metrics: task.target_metrics,
    });

    return {
      predicted_metrics: metrics,
      estimated_cost: cost,
      carbon_estimate: carbon,
      risk_warnings: risks,
      constraint_match: constraint,
      composite_score: composite,
      score_breakdown: breakdown,
      confidence: Math.round(confidence * 1000) / 1000,
    };
  }

  private async requireTaskAndCandidate(
    taskId: string,
    candidateId: string
  ): Promise<{ task: RecommendationTaskRow; candidate: CandidateResult }> {
    if (!this.repository) {
      throw new ConflictError('Database not available — recalculation requires a persisted task');
    }
    const task = await this.repository.findTaskById(taskId);
    if (!task) throw new NotFoundError('Recommendation task');
    const candidate = await this.repository.findCandidateById(candidateId);
    if (!candidate || candidate.task_id !== task.id) {
      throw new NotFoundError('Candidate not in task');
    }
    return { task, candidate };
  }

  private async materialiseTask(
    task_id: string,
    code: string,
    taskInput: ReturnType<typeof buildInsertTaskInput>,
    ctx: { trace_id: string; user_id: string | null },
    duration_ms: number,
    summary: ScoredCandidate extends never ? never : RecommendationTaskRow['summary'],
    status: RecommendationTaskRow['status']
  ): Promise<RecommendationTaskRow> {
    if (this.repository) {
      const persisted = await this.repository.findTaskById(task_id);
      if (persisted) return persisted;
    }
    // Memory-only fallback (when no DB is wired) — synthesise a row.
    return {
      id: task_id,
      code,
      product_category: taskInput.product_category,
      application_scene: taskInput.application_scene,
      strategy: taskInput.strategy,
      target_metrics: taskInput.target_metrics,
      cost_limit: taskInput.cost_limit,
      carbon_limit: taskInput.carbon_limit,
      inventory_constraints: taskInput.inventory_constraints,
      material_pool: taskInput.material_pool,
      replacement_pool: taskInput.replacement_pool,
      locked_materials: taskInput.locked_materials,
      process_constraints: taskInput.process_constraints,
      n_candidates: taskInput.n_candidates,
      random_seed: taskInput.random_seed,
      model_code: taskInput.model_code,
      model_version: taskInput.model_version,
      predictor_mode: taskInput.predictor_mode,
      status,
      error_class: null,
      error_message: null,
      duration_ms,
      summary,
      trace_id: ctx.trace_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: ctx.user_id,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Auto-detect the strategy from the request shape when caller didn't set one.
 * Rules:
 *   • base_bom + replacement_pool present → 'material_replacement'
 *   • cost_limit provided                  → 'cost_priority'
 *   • else                                 → 'new_product'
 */
export function resolveStrategy(req: GenerateRequest): RecommendationStrategy {
  if (req.strategy) return req.strategy;
  if (
    req.base_bom &&
    req.base_bom.length > 0 &&
    req.replacement_pool &&
    req.replacement_pool.length > 0
  ) {
    return 'material_replacement';
  }
  if (req.cost_limit !== undefined && req.cost_limit !== null) return 'cost_priority';
  return 'new_product';
}

export function applyModifications(
  bom: BomItem[],
  mods: NonNullable<RecalculateRequest['modifications']>
): BomItem[] {
  const map = new Map(mods.map((m) => [m.material_code, m.new_ratio]));
  const updated = bom.map((it) => {
    const r = map.get(it.material_code);
    return r === undefined ? it : { ...it, ratio: r };
  });
  // Re-normalise so totals stay close to 1.
  const total = updated.reduce((s, it) => s + it.ratio, 0);
  if (total <= 0) return updated;
  return updated.map((it) => ({ ...it, ratio: Math.round((it.ratio / total) * 10000) / 10000 }));
}

function nameFor(strategy: RecommendationStrategy, c: ScoredCandidate): string {
  const tag =
    strategy === 'cost_priority'
      ? '成本优先'
      : strategy === 'material_replacement'
        ? '原料替代'
        : '新品方案';
  return `候选 #${c.rank} · ${tag}`;
}

function headlineFor(c: {
  estimated_cost: number | null;
  composite_score: number;
  risk_warnings: CandidateResult['risk_warnings'];
}): string {
  const parts: string[] = [];
  if (c.estimated_cost !== null) parts.push(`成本 ${c.estimated_cost.toFixed(2)}`);
  parts.push(`综合分 ${(c.composite_score * 100).toFixed(0)}`);
  const critical = c.risk_warnings.filter((r) => r.level === 'critical').length;
  if (critical > 0) parts.push(`${critical} 项关键风险`);
  return parts.join(' · ');
}

function buildInsertTaskInput(
  req: GenerateRequest,
  strategy: RecommendationStrategy,
  random_seed: number,
  modelInfo: { code: string; version: string; mode: 'mock' | 'real' },
  code: string,
  meta: {
    status: 'processing' | 'succeeded' | 'partial' | 'failed';
    error_class: string | null;
    error_message: string | null;
    duration_ms: number;
    summary: { generated: number; passed_filters: number; evaluated: number; ranked: number };
    trace_id: string;
    created_by: string | null;
  }
): import('./repository.js').InsertTaskInput {
  return {
    code,
    product_category: req.product_category,
    application_scene: req.application_scene ?? null,
    strategy,
    target_metrics: req.target_metrics,
    cost_limit: req.cost_limit ?? null,
    carbon_limit: req.carbon_limit ?? null,
    inventory_constraints: req.inventory_constraints ?? [],
    material_pool: req.material_pool ?? [],
    replacement_pool: req.replacement_pool ?? [],
    locked_materials: req.locked_materials ?? [],
    process_constraints: req.process_constraints ?? {},
    n_candidates: req.n_candidates ?? 5,
    random_seed,
    model_code: modelInfo.code,
    model_version: modelInfo.version,
    predictor_mode: modelInfo.mode,
    status: meta.status,
    error_class: meta.error_class,
    error_message: meta.error_message,
    duration_ms: meta.duration_ms,
    summary: meta.summary,
    trace_id: meta.trace_id,
    created_by: meta.created_by,
  };
}
