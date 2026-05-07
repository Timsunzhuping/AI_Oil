import { describe, it, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';
import {
  RecommendationService,
  applyModifications,
  resolveStrategy,
} from '../../../src/modules/recommendation/service.js';
import { RecommendationPipeline } from '../../../src/modules/recommendation/pipeline/index.js';
import { PredictorBackedEvaluator } from '../../../src/modules/recommendation/pipeline/evaluator.js';
import { MockPredictor } from '../../../src/modules/prediction/adapters/mock.js';
import type {
  GenerateRequest,
  CandidateResult,
  MaterialPoolEntry,
  RecommendationTaskRow,
} from '../../../src/modules/recommendation/types.js';
import type {
  InsertTaskInput,
  InsertCandidateInput,
  RecommendationRepository,
} from '../../../src/modules/recommendation/repository.js';

const TRACE = '11111111-2222-3333-4444-555555555555';
const logger = pino({ level: 'silent' });

const POOL: MaterialPoolEntry[] = [
  {
    material_code: 'PAO-6',
    material_name: 'PAO-6',
    role: 'base_oil',
    unit_cost: 22,
    min_ratio: 0.3,
    max_ratio: 0.6,
  },
  {
    material_code: 'GIII-4cSt',
    material_name: 'Group III 4cSt',
    role: 'base_oil',
    unit_cost: 14,
    min_ratio: 0.3,
    max_ratio: 0.55,
  },
  {
    material_code: 'OCP',
    material_name: 'OCP VII',
    role: 'vii',
    unit_cost: 9,
    min_ratio: 0.05,
    max_ratio: 0.1,
  },
  {
    material_code: 'PKG-A',
    material_name: 'Detergent pkg',
    role: 'detergent',
    unit_cost: 30,
    min_ratio: 0.08,
    max_ratio: 0.15,
  },
];

function baseRequest(over: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    product_category: 'engine_oil_pcmo',
    target_metrics: [
      { name: 'KV_100C', target: 11, lower_bound: 9.3, upper_bound: 12.5, weight: 2 },
    ],
    cost_limit: 25,
    material_pool: POOL,
    n_candidates: 4,
    random_seed: 42,
    ...over,
  };
}

// ─── In-memory repository fake ──────────────────────────────────────────────

interface TaskRow {
  id: string;
  code: string;
  task: InsertTaskInput;
  created_at: Date;
}

class InMemoryRepo {
  private tasks = new Map<string, TaskRow>();
  private candidates = new Map<string, InsertCandidateInput & { id: string; created_at: Date }>();
  private codeCounter = 1;

  nextTaskCode = vi.fn(async () => `REC-2026-${String(this.codeCounter++).padStart(4, '0')}`);

  createTaskWithCandidates = vi.fn(
    async (task: InsertTaskInput, candidates: InsertCandidateInput[]) => {
      const taskId = `task-${this.tasks.size + 1}`;
      this.tasks.set(taskId, { id: taskId, code: task.code, task, created_at: new Date() });
      const ids: string[] = [];
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i] as InsertCandidateInput;
        const id = `cand-${taskId}-${i + 1}`;
        this.candidates.set(id, { ...c, task_id: taskId, id, created_at: new Date() });
        ids.push(id);
      }
      return { task_id: taskId, candidate_ids: ids };
    }
  );

  insertCandidate = vi.fn(async (c: InsertCandidateInput) => {
    const id = `cand-recalc-${this.candidates.size + 1}`;
    this.candidates.set(id, { ...c, id, created_at: new Date() });
    return { id };
  });

  findTaskById = vi.fn(async (id: string): Promise<RecommendationTaskRow | null> => {
    const row = this.tasks.get(id);
    if (!row) return null;
    return {
      id,
      code: row.code,
      product_category: row.task.product_category,
      application_scene: row.task.application_scene,
      strategy: row.task.strategy,
      target_metrics: row.task.target_metrics,
      cost_limit: row.task.cost_limit,
      carbon_limit: row.task.carbon_limit,
      inventory_constraints: row.task.inventory_constraints,
      material_pool: row.task.material_pool,
      replacement_pool: row.task.replacement_pool,
      locked_materials: row.task.locked_materials,
      process_constraints: row.task.process_constraints,
      n_candidates: row.task.n_candidates,
      random_seed: row.task.random_seed,
      model_code: row.task.model_code,
      model_version: row.task.model_version,
      predictor_mode: row.task.predictor_mode,
      status: row.task.status,
      error_class: row.task.error_class,
      error_message: row.task.error_message,
      duration_ms: row.task.duration_ms,
      summary: row.task.summary,
      trace_id: row.task.trace_id,
      created_at: row.created_at.toISOString(),
      updated_at: row.created_at.toISOString(),
      created_by: row.task.created_by,
    };
  });

  findCandidateById = vi.fn(async (id: string): Promise<CandidateResult | null> => {
    const row = this.candidates.get(id);
    if (!row) return null;
    return {
      id,
      task_id: row.task_id,
      rank: row.rank,
      name: row.name,
      headline: row.headline ?? '',
      origin: row.origin,
      parent_candidate_id: row.parent_candidate_id,
      bom: row.bom,
      predicted_metrics: row.predicted_metrics,
      estimated_cost: row.estimated_cost,
      cost_unit: row.cost_unit,
      carbon_estimate: row.carbon_estimate,
      risk_warnings: row.risk_warnings,
      constraint_match: row.constraint_match,
      composite_score: row.composite_score,
      score_breakdown: row.score_breakdown,
      confidence: row.confidence,
      metadata: row.metadata,
      created_at: row.created_at.toISOString(),
    };
  });

  listCandidatesByTask = vi.fn(async (taskId: string): Promise<CandidateResult[]> => {
    const rows = [...this.candidates.values()].filter((c) => c.task_id === taskId);
    rows.sort((a, b) => a.rank - b.rank);
    return Promise.all(rows.map((r) => this.findCandidateById(r.id))).then(
      (arr) => arr.filter(Boolean) as CandidateResult[]
    );
  });

  maxRankForTask = vi.fn(async (taskId: string): Promise<number> => {
    const rows = [...this.candidates.values()].filter((c) => c.task_id === taskId);
    return rows.reduce((m, r) => Math.max(m, r.rank), 0);
  });

  size() {
    return { tasks: this.tasks.size, candidates: this.candidates.size };
  }
}

function buildService(repo: InMemoryRepo | null = new InMemoryRepo()) {
  const adapter = new MockPredictor();
  const evaluator = new PredictorBackedEvaluator(adapter);
  const pipeline = new RecommendationPipeline({ evaluator });
  const service = new RecommendationService({
    pipeline,
    evaluator,
    repository: (repo as unknown as RecommendationRepository) ?? null,
    logger,
  });
  return { service, repo, adapter };
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

describe('resolveStrategy', () => {
  it('honours an explicit strategy', () => {
    expect(resolveStrategy({ ...baseRequest(), strategy: 'new_product' })).toBe('new_product');
  });
  it('detects material_replacement from base_bom + replacement_pool', () => {
    expect(
      resolveStrategy({
        ...baseRequest(),
        strategy: undefined,
        base_bom: [{ material_code: 'PAO-6', material_name: 'PAO-6', role: 'base_oil', ratio: 1 }],
        replacement_pool: [{ replace_material_code: 'PAO-6', with_material_code: 'GIII-4cSt' }],
      })
    ).toBe('material_replacement');
  });
  it('falls back to cost_priority when only cost_limit is set', () => {
    expect(resolveStrategy({ ...baseRequest(), strategy: undefined })).toBe('cost_priority');
  });
  it('falls back to new_product when nothing else applies', () => {
    expect(
      resolveStrategy({
        product_category: 'p',
        target_metrics: [{ name: 'KV_100C' }],
      })
    ).toBe('new_product');
  });
});

describe('applyModifications', () => {
  it('renormalises ratios after applying overrides', () => {
    const out = applyModifications(
      [
        { material_code: 'A', material_name: 'A', role: 'base_oil', ratio: 0.5 },
        { material_code: 'B', material_name: 'B', role: 'detergent', ratio: 0.5 },
      ],
      [{ material_code: 'A', new_ratio: 0.8 }]
    );
    const sum = out.reduce((s, it) => s + it.ratio, 0);
    expect(sum).toBeCloseTo(1, 3);
    // The override is preserved proportionally — A should still dominate.
    const a = out.find((it) => it.material_code === 'A')!;
    expect(a.ratio).toBeGreaterThan(0.5);
  });
});

// ─── /generate ───────────────────────────────────────────────────────────────

describe('RecommendationService.generate', () => {
  it('produces candidates and persists task + candidates', async () => {
    const { service, repo } = buildService();
    const r = await service.generate(baseRequest(), { trace_id: TRACE, user_id: null });
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.length).toBeLessThanOrEqual(4);
    expect(r.task.code).toMatch(/^REC-2026-\d{4}$/);
    expect(r.task.strategy).toBe('cost_priority');
    expect(r.task.random_seed).toBe(42);
    expect(repo!.size().candidates).toBe(r.candidates.length);
  });

  it('is deterministic for the same random_seed', async () => {
    const { service: s1 } = buildService();
    const { service: s2 } = buildService();
    const a = await s1.generate(baseRequest({ random_seed: 555 }), {
      trace_id: TRACE,
      user_id: null,
    });
    const b = await s2.generate(baseRequest({ random_seed: 555 }), {
      trace_id: TRACE,
      user_id: null,
    });
    expect(a.candidates.map((c) => c.bom)).toEqual(b.candidates.map((c) => c.bom));
    expect(a.candidates.map((c) => c.composite_score)).toEqual(
      b.candidates.map((c) => c.composite_score)
    );
  });

  it('auto-detects material_replacement strategy from inputs', async () => {
    const { service } = buildService();
    const req: GenerateRequest = {
      product_category: 'engine_oil_pcmo',
      target_metrics: baseRequest().target_metrics,
      material_pool: POOL,
      base_bom: [
        { material_code: 'PAO-6', material_name: 'PAO-6', role: 'base_oil', ratio: 0.5 },
        { material_code: 'OCP', material_name: 'OCP VII', role: 'vii', ratio: 0.1 },
        { material_code: 'PKG-A', material_name: 'Detergent pkg', role: 'detergent', ratio: 0.4 },
      ],
      replacement_pool: [{ replace_material_code: 'PAO-6', with_material_code: 'GIII-4cSt' }],
      n_candidates: 3,
      random_seed: 7,
    };
    const r = await service.generate(req, { trace_id: TRACE, user_id: null });
    expect(r.task.strategy).toBe('material_replacement');
    expect(r.candidates.length).toBe(1);
  });
});

// ─── /recalculate ────────────────────────────────────────────────────────────

describe('RecommendationService.recalculate', () => {
  let svc: RecommendationService;
  let repo: InMemoryRepo;
  let initial: Awaited<ReturnType<RecommendationService['generate']>>;

  beforeEach(async () => {
    const built = buildService();
    svc = built.service;
    repo = built.repo!;
    initial = await svc.generate(baseRequest({ random_seed: 1234 }), {
      trace_id: TRACE,
      user_id: null,
    });
  });

  it('applies modifications, persists a new candidate row', async () => {
    const seed = initial.candidates[0]!;
    const r = await svc.recalculate(
      {
        task_id: initial.task.id,
        candidate_id: seed.id,
        modifications: [
          {
            material_code: seed.bom[0]!.material_code,
            new_ratio: Math.min(0.6, seed.bom[0]!.ratio + 0.05),
          },
        ],
      },
      { trace_id: TRACE }
    );

    expect(r.candidate.parent_candidate_id).toBe(seed.id);
    expect(r.candidate.origin).toBe('recalculated');
    // a new candidate was persisted
    expect(repo.insertCandidate).toHaveBeenCalledTimes(1);
  });

  it('persist=false skips writing a row', async () => {
    const seed = initial.candidates[0]!;
    await svc.recalculate(
      {
        task_id: initial.task.id,
        candidate_id: seed.id,
        modifications: [{ material_code: seed.bom[0]!.material_code, new_ratio: 0.4 }],
        persist: false,
      },
      { trace_id: TRACE }
    );
    expect(repo.insertCandidate).not.toHaveBeenCalled();
  });

  it('rejects unknown candidates', async () => {
    await expect(
      svc.recalculate(
        {
          task_id: initial.task.id,
          candidate_id: '00000000-0000-0000-0000-000000000999',
          modifications: [{ material_code: 'X', new_ratio: 0.5 }],
        },
        { trace_id: TRACE }
      )
    ).rejects.toThrow();
  });
});

// ─── /replace-material ───────────────────────────────────────────────────────

describe('RecommendationService.replaceMaterial', () => {
  it('swaps a material and re-evaluates the candidate', async () => {
    const { service, repo } = buildService();
    const initial = await service.generate(baseRequest({ random_seed: 8888 }), {
      trace_id: TRACE,
      user_id: null,
    });
    const seed = initial.candidates[0]!;
    // Find an in-pool material that's not currently in the BOM to swap to.
    const existingCodes = new Set(seed.bom.map((b) => b.material_code));
    const swapInto =
      POOL.find((p) => !existingCodes.has(p.material_code))?.material_code ??
      POOL.find((p) => p.material_code !== seed.bom[0]!.material_code)!.material_code;
    const r = await service.replaceMaterial(
      {
        task_id: initial.task.id,
        candidate_id: seed.id,
        swap: { from_material_code: seed.bom[0]!.material_code, to_material_code: swapInto },
      },
      { trace_id: TRACE }
    );
    expect(r.candidate.bom.find((b) => b.material_code === swapInto)).toBeDefined();
    expect(r.candidate.origin).toBe('replaced');
    expect(repo!.insertCandidate).toHaveBeenCalledTimes(1);
  });

  it('rejects swaps for materials not in the candidate', async () => {
    const { service } = buildService();
    const initial = await service.generate(baseRequest({ random_seed: 11 }), {
      trace_id: TRACE,
      user_id: null,
    });
    await expect(
      service.replaceMaterial(
        {
          task_id: initial.task.id,
          candidate_id: initial.candidates[0]!.id,
          swap: { from_material_code: 'NOT-PRESENT', to_material_code: 'PAO-6' },
        },
        { trace_id: TRACE }
      )
    ).rejects.toThrow(/does not contain material/);
  });

  it('rejects swaps to materials missing from the task material_pool', async () => {
    const { service } = buildService();
    const initial = await service.generate(baseRequest({ random_seed: 13 }), {
      trace_id: TRACE,
      user_id: null,
    });
    const seed = initial.candidates[0]!;
    await expect(
      service.replaceMaterial(
        {
          task_id: initial.task.id,
          candidate_id: seed.id,
          swap: {
            from_material_code: seed.bom[0]!.material_code,
            to_material_code: 'GHOST-MATERIAL',
          },
        },
        { trace_id: TRACE }
      )
    ).rejects.toThrow(/material_pool/);
  });
});

// ─── /history/:taskId ────────────────────────────────────────────────────────

describe('RecommendationService.history', () => {
  it('returns the task and its candidates', async () => {
    const { service } = buildService();
    const initial = await service.generate(baseRequest({ random_seed: 5 }), {
      trace_id: TRACE,
      user_id: null,
    });
    const h = await service.history(initial.task.id);
    expect(h.task.id).toBe(initial.task.id);
    expect(h.candidates.length).toBe(initial.candidates.length);
  });

  it('throws NotFound for unknown task', async () => {
    const { service } = buildService();
    await expect(service.history('00000000-0000-0000-0000-000000000000')).rejects.toThrow();
  });

  it('throws Conflict when no repository is wired', async () => {
    const { service } = buildService(null);
    await expect(service.history('any')).rejects.toThrow();
  });
});
