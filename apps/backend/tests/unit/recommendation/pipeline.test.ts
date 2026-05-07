import { describe, it, expect } from 'vitest';
import { DefaultCandidateGenerator } from '../../../src/modules/recommendation/pipeline/generator.js';
import {
  DefaultConstraintFilter,
  CONSTRAINT_CODES,
  estimateBomCarbon,
  estimateBomCost,
} from '../../../src/modules/recommendation/pipeline/filter.js';
import {
  WeightedSumRanker,
  computeTargetScore,
  computeCostScore,
  computeConfidenceScore,
  computeRiskPenalty,
  DEFAULT_WEIGHTS,
} from '../../../src/modules/recommendation/pipeline/ranker.js';
import { RecommendationPipeline } from '../../../src/modules/recommendation/pipeline/index.js';
import { PredictorBackedEvaluator } from '../../../src/modules/recommendation/pipeline/evaluator.js';
import { MockPredictor } from '../../../src/modules/prediction/adapters/mock.js';
import { createRng } from '../../../src/modules/recommendation/random.js';
import type {
  GenerateRequest,
  MaterialPoolEntry,
  RecommendationStrategy,
} from '../../../src/modules/recommendation/types.js';
import type {
  BomItem,
  PredictedMetric,
  RiskWarning,
} from '../../../src/modules/prediction/types.js';

// ─── shared fixtures ────────────────────────────────────────────────────────

const POOL: MaterialPoolEntry[] = [
  {
    material_code: 'PAO-6',
    material_name: 'PAO-6',
    role: 'base_oil',
    unit_cost: 22,
    carbon_per_kg: 1.8,
    min_ratio: 0.3,
    max_ratio: 0.6,
  },
  {
    material_code: 'GIII-4cSt',
    material_name: 'Group III 4cSt',
    role: 'base_oil',
    unit_cost: 14,
    carbon_per_kg: 1.2,
    min_ratio: 0.3,
    max_ratio: 0.55,
  },
  {
    material_code: 'OCP',
    material_name: 'OCP VII',
    role: 'vii',
    unit_cost: 9,
    carbon_per_kg: 0.9,
    min_ratio: 0.05,
    max_ratio: 0.1,
  },
  {
    material_code: 'PKG-A',
    material_name: 'Detergent pkg',
    role: 'detergent',
    unit_cost: 30,
    carbon_per_kg: 2.0,
    min_ratio: 0.08,
    max_ratio: 0.15,
  },
  {
    material_code: 'AO-PHEN',
    material_name: 'Phenolic AO',
    role: 'antioxidant',
    unit_cost: 18,
    carbon_per_kg: 1.0,
    min_ratio: 0.005,
    max_ratio: 0.02,
  },
];

const COST_REQUEST: GenerateRequest = {
  product_category: 'engine_oil_pcmo',
  target_metrics: [{ name: 'KV_100C', target: 11, lower_bound: 9.3, upper_bound: 12.5, weight: 2 }],
  cost_limit: 30,
  material_pool: POOL,
  n_candidates: 5,
};

// ─── DefaultCandidateGenerator ──────────────────────────────────────────────

describe('DefaultCandidateGenerator', () => {
  const gen = new DefaultCandidateGenerator();

  it('cost_priority: produces oversampled candidates whose ratios sum to ~1', () => {
    const cands = gen.generate(COST_REQUEST, 'cost_priority', createRng(1));
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      const total = c.bom.reduce((s, it) => s + it.ratio, 0);
      expect(Math.abs(total - 1)).toBeLessThan(0.02);
    }
  });

  it('produces deterministic output for the same seed', () => {
    const a = gen.generate(COST_REQUEST, 'cost_priority', createRng(123));
    const b = gen.generate(COST_REQUEST, 'cost_priority', createRng(123));
    expect(a).toEqual(b);
  });

  it('honours locked materials by including them in every candidate', () => {
    const req: GenerateRequest = {
      ...COST_REQUEST,
      locked_materials: [{ material_code: 'PKG-A', ratio: 0.1 }],
    };
    const cands = gen.generate(req, 'cost_priority', createRng(1));
    for (const c of cands) {
      const pkg = c.bom.find((it) => it.material_code === 'PKG-A');
      expect(pkg).toBeDefined();
      expect(pkg!.ratio).toBeCloseTo(0.1, 3);
    }
  });

  it('material_replacement: emits one candidate per replacement entry', () => {
    const req: GenerateRequest = {
      product_category: 'engine_oil_pcmo',
      target_metrics: COST_REQUEST.target_metrics,
      material_pool: POOL,
      base_bom: [
        { material_code: 'PAO-6', material_name: 'PAO-6', role: 'base_oil', ratio: 0.5 },
        { material_code: 'OCP', material_name: 'OCP VII', role: 'vii', ratio: 0.1 },
        { material_code: 'PKG-A', material_name: 'Detergent pkg', role: 'detergent', ratio: 0.4 },
      ],
      replacement_pool: [{ replace_material_code: 'PAO-6', with_material_code: 'GIII-4cSt' }],
      n_candidates: 5,
    };
    const cands = gen.generate(req, 'material_replacement', createRng(1));
    expect(cands.length).toBe(1);
    const swapped = cands[0]!.bom.find((it) => it.material_code === 'GIII-4cSt');
    expect(swapped).toBeDefined();
    expect(cands[0]!.bom.find((it) => it.material_code === 'PAO-6')).toBeUndefined();
  });

  it('new_product: generates BOMs even without locked materials', () => {
    const cands = gen.generate(
      { ...COST_REQUEST, locked_materials: [] },
      'new_product',
      createRng(7)
    );
    expect(cands.length).toBeGreaterThan(0);
  });
});

// ─── DefaultConstraintFilter ────────────────────────────────────────────────

describe('DefaultConstraintFilter', () => {
  const filter = new DefaultConstraintFilter();

  function bom(over: Partial<BomItem>[] = []): BomItem[] {
    const base: BomItem[] = [
      { material_code: 'PAO-6', material_name: 'PAO-6', role: 'base_oil', ratio: 0.5 },
      { material_code: 'OCP', material_name: 'OCP VII', role: 'vii', ratio: 0.1 },
      { material_code: 'PKG-A', material_name: 'Detergent pkg', role: 'detergent', ratio: 0.4 },
    ];
    return base.map((b, i) => ({ ...b, ...(over[i] ?? {}) }));
  }

  it('passes a well-formed BOM', () => {
    const m = filter.evaluate(bom(), COST_REQUEST);
    expect(m.failed).toEqual([]);
    expect(filter.passes(m)).toBe(true);
  });

  it('fails when BOM total drifts more than tolerance', () => {
    const m = filter.evaluate(bom([{ ratio: 0.7 }]), COST_REQUEST);
    expect(m.failed.some((f) => f.code === CONSTRAINT_CODES.BOM_TOTAL)).toBe(true);
  });

  it('fails when locked material is missing', () => {
    const req = { ...COST_REQUEST, locked_materials: [{ material_code: 'AO-PHEN' }] };
    const m = filter.evaluate(bom(), req);
    expect(m.failed.some((f) => f.code === CONSTRAINT_CODES.LOCKED_MISSING)).toBe(true);
  });

  it('fails when role coverage is incomplete', () => {
    const m = filter.evaluate(
      [{ material_code: 'OCP', material_name: 'OCP VII', role: 'vii', ratio: 1 }],
      COST_REQUEST
    );
    expect(m.failed.some((f) => f.code === CONSTRAINT_CODES.ROLE_COVERAGE)).toBe(true);
  });

  it('fails when inventory is insufficient', () => {
    const req = {
      ...COST_REQUEST,
      inventory_constraints: [{ material_code: 'PAO-6', available_kg: 100, batch_size_kg: 1000 }],
    };
    const m = filter.evaluate(bom(), req); // PAO-6 ratio 0.5 × 1000 = 500 kg, only 100 kg available
    expect(m.failed.some((f) => f.code === CONSTRAINT_CODES.INVENTORY)).toBe(true);
  });

  it('fails when cost limit is exceeded', () => {
    const req = { ...COST_REQUEST, cost_limit: 5 }; // unrealistically low
    const m = filter.evaluate(bom(), req);
    expect(m.failed.some((f) => f.code === CONSTRAINT_CODES.COST_LIMIT)).toBe(true);
  });
});

// ─── estimateBomCost / estimateBomCarbon ────────────────────────────────────

describe('estimateBomCost / estimateBomCarbon', () => {
  it('uses pool unit_cost values to compute cost', () => {
    const cost = estimateBomCost(
      [
        { material_code: 'PAO-6', material_name: 'PAO-6', role: 'base_oil', ratio: 0.5 },
        {
          material_code: 'GIII-4cSt',
          material_name: 'Group III 4cSt',
          role: 'base_oil',
          ratio: 0.5,
        },
      ],
      POOL
    );
    expect(cost).toBeCloseTo(0.5 * 22 + 0.5 * 14, 2);
  });

  it('returns null when no priced material in BOM', () => {
    const cost = estimateBomCost(
      [{ material_code: 'UNKNOWN', material_name: 'UNKNOWN', role: 'base_oil', ratio: 1 }],
      POOL
    );
    expect(cost).toBeNull();
  });

  it('estimates carbon footprint when carbon_per_kg present', () => {
    const c = estimateBomCarbon(
      [
        { material_code: 'PAO-6', material_name: 'PAO-6', role: 'base_oil', ratio: 0.5 },
        {
          material_code: 'GIII-4cSt',
          material_name: 'Group III 4cSt',
          role: 'base_oil',
          ratio: 0.5,
        },
      ],
      POOL
    );
    expect(c).toBeCloseTo(0.5 * 1.8 + 0.5 * 1.2, 2);
  });
});

// ─── WeightedSumRanker (and its helpers) ────────────────────────────────────

describe('WeightedSumRanker', () => {
  const ranker = new WeightedSumRanker();

  function metric(o: Partial<PredictedMetric>): PredictedMetric {
    return {
      name: 'KV_100C',
      display_name: '100℃ 黏度',
      unit: 'mm²/s',
      predicted_value: 11,
      spec_low: 9.3,
      spec_high: 12.5,
      in_spec: true,
      confidence: 0.85,
      ...o,
    };
  }

  it('rewards target hit + low cost + clean risks', () => {
    const { composite, breakdown } = ranker.score({
      predicted_metrics: [metric({ predicted_value: 11.0, confidence: 0.9 })],
      estimated_cost: 10,
      cost_limit: 25,
      risk_warnings: [],
      constraint_match: { passed: ['BOM_TOTAL', 'COST_OK'], failed: [], score: 1 },
      target_metrics: [{ name: 'KV_100C', target: 11, lower_bound: 9.3, upper_bound: 12.5 }],
    });
    expect(composite).toBeGreaterThan(0.7);
    expect(breakdown.target_score).toBeGreaterThan(0.9);
    expect(breakdown.cost_score).toBeGreaterThan(0.7);
    expect(breakdown.confidence_score).toBeCloseTo(0.9, 2);
  });

  it('penalises critical risks', () => {
    const risks: RiskWarning[] = [
      { level: 'critical', code: 'SPEC_FAIL', message: 'fail' },
      { level: 'critical', code: 'OOSPEC', message: 'fail' },
    ];
    const { breakdown } = ranker.score({
      predicted_metrics: [metric({})],
      estimated_cost: 10,
      cost_limit: 25,
      risk_warnings: risks,
      constraint_match: { passed: [], failed: [], score: 1 },
      target_metrics: [{ name: 'KV_100C', target: 11 }],
    });
    expect(breakdown.risk_penalty).toBeGreaterThanOrEqual(0.3);
  });

  it('keeps composite in [0, 1]', () => {
    const r = ranker.score({
      predicted_metrics: [],
      estimated_cost: 10000,
      cost_limit: 1,
      risk_warnings: [
        { level: 'critical', code: 'X', message: 'x' },
        { level: 'critical', code: 'Y', message: 'y' },
        { level: 'critical', code: 'Z', message: 'z' },
      ],
      constraint_match: { passed: [], failed: [{ code: 'X', reason: 'r' }], score: 0 },
      target_metrics: [{ name: 'KV_100C', target: 11, lower_bound: 9.3, upper_bound: 12.5 }],
    });
    expect(r.composite).toBeGreaterThanOrEqual(0);
    expect(r.composite).toBeLessThanOrEqual(1);
  });

  it('computeCostScore is 0.5 when cost is unknown', () => {
    expect(computeCostScore(null, 20)).toBe(0.5);
  });

  it('computeConfidenceScore averages metric confidence', () => {
    const m: PredictedMetric[] = [metric({ confidence: 0.6 }), metric({ confidence: 0.8 })];
    expect(computeConfidenceScore(m)).toBeCloseTo(0.7, 5);
  });

  it('computeRiskPenalty caps at the supplied weight', () => {
    const risks: RiskWarning[] = Array.from({ length: 50 }, () => ({
      level: 'critical' as const,
      code: 'X',
      message: 'x',
    }));
    expect(computeRiskPenalty(risks, 0.3)).toBe(0.3);
  });

  it('computeTargetScore = 1 when no targets', () => {
    expect(computeTargetScore([], [])).toBe(1);
  });

  it('DEFAULT_WEIGHTS values are bounded', () => {
    for (const v of Object.values(DEFAULT_WEIGHTS)) expect(v).toBeGreaterThanOrEqual(0);
  });
});

// ─── End-to-end pipeline run with the mock predictor ────────────────────────

describe('RecommendationPipeline (end-to-end with mock predictor)', () => {
  const adapter = new MockPredictor();
  const pipeline = new RecommendationPipeline({ evaluator: new PredictorBackedEvaluator(adapter) });

  async function runAll(strategy: RecommendationStrategy, seed = 42, request = COST_REQUEST) {
    return pipeline.run({ request, strategy, rng: createRng(seed) });
  }

  it('returns ≤ n_candidates ranked candidates', async () => {
    const r = await runAll('cost_priority');
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.length).toBeLessThanOrEqual(5);
    expect(r.candidates[0]!.composite_score).toBeGreaterThanOrEqual(
      r.candidates[r.candidates.length - 1]!.composite_score
    );
  });

  it('is deterministic for the same seed', async () => {
    const a = await runAll('cost_priority', 99);
    const b = await runAll('cost_priority', 99);
    expect(a.candidates.map((c) => c.bom)).toEqual(b.candidates.map((c) => c.bom));
    expect(a.candidates.map((c) => c.composite_score)).toEqual(
      b.candidates.map((c) => c.composite_score)
    );
  });

  it('summary counts add up sensibly', async () => {
    const r = await runAll('cost_priority');
    expect(r.summary.generated).toBeGreaterThan(0);
    expect(r.summary.passed_filters).toBeLessThanOrEqual(r.summary.generated);
    expect(r.summary.evaluated).toBeLessThanOrEqual(r.summary.passed_filters);
    expect(r.summary.ranked).toBe(r.candidates.length);
  });

  it('falls back to surface failed candidates when nothing passes', async () => {
    const impossible = {
      ...COST_REQUEST,
      cost_limit: 0.01, // forces every candidate to fail the cost filter
      n_candidates: 3,
    };
    const r = await pipeline.run({
      request: impossible,
      strategy: 'cost_priority',
      rng: createRng(1),
    });
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) expect(c.constraint_match.failed.length).toBeGreaterThan(0);
  });

  it('material_replacement strategy returns one candidate per replacement entry', async () => {
    const req: GenerateRequest = {
      ...COST_REQUEST,
      base_bom: [
        { material_code: 'PAO-6', material_name: 'PAO-6', role: 'base_oil', ratio: 0.5 },
        { material_code: 'OCP', material_name: 'OCP VII', role: 'vii', ratio: 0.1 },
        { material_code: 'PKG-A', material_name: 'Detergent pkg', role: 'detergent', ratio: 0.4 },
      ],
      replacement_pool: [{ replace_material_code: 'PAO-6', with_material_code: 'GIII-4cSt' }],
    };
    const r = await pipeline.run({
      request: req,
      strategy: 'material_replacement',
      rng: createRng(1),
    });
    expect(r.candidates.length).toBe(1);
  });
});
