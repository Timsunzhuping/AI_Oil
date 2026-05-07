/**
 * Bundled inverse-recommendation baseline test cases.
 *
 * Each case sends a `GenerateRequest` shape directly into the recommendation
 * pipeline. Expectations are conservative so the bundled `MockPredictor` +
 * `DefaultCandidateGenerator` reliably pass — adjust per environment.
 */
import type { InverseCase, StabilityCase, TestSetInput } from '../types.js';

const STANDARD_POOL = [
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

export const INVERSE_BASELINE_CASES: InverseCase[] = [
  {
    id: 'inv-pcmo-001',
    category: 'engine_oil_pcmo',
    request: {
      product_category: 'engine_oil_pcmo',
      target_metrics: [
        { name: 'KV_100C', target: 11, lower_bound: 9.3, upper_bound: 12.5, weight: 2 },
      ],
      cost_limit: 30,
      material_pool: STANDARD_POOL,
      n_candidates: 5,
      random_seed: 42,
    },
    expectations: {
      min_passed_candidates: 1,
      top1_min_confidence: 0.5,
      no_critical_risks_top: 1,
    },
    notes: '5W-30 主流目标',
  },
  {
    id: 'inv-pcmo-002-cost',
    category: 'engine_oil_pcmo',
    request: {
      product_category: 'engine_oil_pcmo',
      target_metrics: [{ name: 'VI', lower_bound: 160, weight: 1 }],
      cost_limit: 25,
      material_pool: STANDARD_POOL,
      n_candidates: 5,
      random_seed: 7,
    },
    expectations: {
      min_passed_candidates: 1,
      top1_max_cost: 25,
    },
    notes: '成本上限 25 CNY/kg',
  },
];

export const INVERSE_BASELINE: TestSetInput = {
  code: 'TS-2026-INV-BASELINE',
  name: 'Inverse 基线验收集',
  description: '逆向推荐基线：每个用例校验候选可行性 + Top1 期望。',
  test_type: 'inverse',
  product_category: 'mixed',
  cases: INVERSE_BASELINE_CASES,
  default_tolerance: {},
  status: 'published',
  tags: ['baseline'],
  metadata: { generated_by: 'baseline/inverse-baseline.ts' },
};

// ─── stability baseline ──────────────────────────────────────────────────

export const STABILITY_BASELINE_CASES: StabilityCase[] = [
  {
    id: 'stab-predict-001',
    category: 'engine_oil_pcmo',
    mode: 'predict',
    payload: {
      product_category: 'engine_oil_pcmo',
      bom_items: [
        { material_code: 'PAO-6', material_name: 'PAO-6', role: 'base_oil', ratio: 0.42 },
        {
          material_code: 'GIII-4cSt',
          material_name: 'Group III 4cSt',
          role: 'base_oil',
          ratio: 0.38,
        },
        { material_code: 'OCP', material_name: 'OCP VII', role: 'vii', ratio: 0.085 },
        { material_code: 'PKG-A', material_name: 'Detergent pkg', role: 'detergent', ratio: 0.115 },
      ],
      target_metrics: ['KV_100C', 'VI'],
    },
    runs: 5,
    notes: '同一 BOM 重复 5 次预测，期望 100% 一致（mock 是确定性）',
  },
  {
    id: 'stab-recommend-001',
    category: 'engine_oil_pcmo',
    mode: 'recommend',
    payload: {
      request: {
        product_category: 'engine_oil_pcmo',
        target_metrics: [{ name: 'KV_100C', target: 11, lower_bound: 9.3, upper_bound: 12.5 }],
        cost_limit: 30,
        material_pool: STANDARD_POOL,
        n_candidates: 5,
        random_seed: 42,
      },
      strategy: 'cost_priority',
    },
    runs: 4,
    notes: '同一种子重复推荐，期望候选集 Jaccard 接近 1.0',
  },
];

export const STABILITY_BASELINE: TestSetInput = {
  code: 'TS-2026-STAB-BASELINE',
  name: 'Stability 基线验收集',
  description: '同输入重复运行，校验 pairwise cosine 与 CV 落在阈值内。',
  test_type: 'stability',
  cases: STABILITY_BASELINE_CASES,
  default_tolerance: { min_pairwise_cosine: 0.95, max_cv: 0.1 },
  status: 'published',
  tags: ['baseline'],
  metadata: { generated_by: 'baseline/inverse-baseline.ts' },
};
