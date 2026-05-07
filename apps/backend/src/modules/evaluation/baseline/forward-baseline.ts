/**
 * Bundled forward-prediction baseline test cases.
 *
 * These cases are calibrated against the bundled `MockPredictor` so a
 * fresh deployment can run an acceptance run on day 1 and prove the
 * pipeline is wired correctly. They're not a substitute for real
 * production datasets — once you have those, register them via
 * `POST /evaluation/test-sets`.
 */
import type { ForwardCase, TestSetInput } from '../types.js';

const ENGINE_OIL_PCMO_BOM = [
  { material_code: 'PAO-6', material_name: 'PAO-6', role: 'base_oil', ratio: 0.42 },
  { material_code: 'GIII-4cSt', material_name: 'Group III 4cSt', role: 'base_oil', ratio: 0.38 },
  { material_code: 'OCP', material_name: 'OCP VII', role: 'vii', ratio: 0.085 },
  { material_code: 'PKG-A', material_name: 'Detergent pkg', role: 'detergent', ratio: 0.115 },
];

export const FORWARD_BASELINE_CASES: ForwardCase[] = [
  {
    id: 'fwd-pcmo-001',
    category: 'engine_oil_pcmo',
    bom: ENGINE_OIL_PCMO_BOM,
    expected_metrics: { KV_100C: 11.0, VI: 165, NOACK: 11.0 },
    notes: '5W-30 全合成主流配方',
  },
  {
    id: 'fwd-pcmo-002',
    category: 'engine_oil_pcmo',
    bom: ENGINE_OIL_PCMO_BOM.map((it, i) =>
      i === 0 ? { ...it, ratio: 0.5 } : { ...it, ratio: it.ratio * 0.92 }
    ),
    expected_metrics: { KV_100C: 11.6, VI: 167, FLASH: 235 },
    notes: 'PAO 比例调高的变体',
    tolerance: { max_relative_error: 0.15 },
  },
  {
    id: 'fwd-hdeo-001',
    category: 'engine_oil_hdeo',
    bom: [
      { material_code: 'MO-220', material_name: 'Mineral 220N', role: 'base_oil', ratio: 0.78 },
      { material_code: 'PMA', material_name: 'PMA VI improver', role: 'vii', ratio: 0.07 },
      {
        material_code: 'PKG-HD',
        material_name: 'HD detergent pkg',
        role: 'detergent',
        ratio: 0.15,
      },
    ],
    expected_metrics: { KV_100C: 14.0, VI: 130, POUR: -30 },
    notes: '15W-40 商用车主流配方',
  },
  {
    id: 'fwd-industrial-001',
    category: 'industrial_gear',
    bom: [
      { material_code: 'PAO-6', material_name: 'PAO-6', role: 'base_oil', ratio: 0.85 },
      { material_code: 'EP', material_name: 'EP additive', role: 'antiwear', ratio: 0.1 },
      { material_code: 'AO', material_name: 'Phenolic AO', role: 'antioxidant', ratio: 0.05 },
    ],
    expected_metrics: { KV_100C: 22.0, VI: 150 },
    notes: 'ISO VG 220 工业齿轮油',
  },
];

export const FORWARD_BASELINE: TestSetInput = {
  code: 'TS-2026-FWD-BASELINE',
  name: 'Forward 基线验收集',
  description: '与 MockPredictor 对齐的最小验收用例集，用于上线 D1 烟雾测试。',
  test_type: 'forward',
  product_category: 'mixed',
  cases: FORWARD_BASELINE_CASES,
  default_tolerance: { max_relative_error: 0.2, min_metric_pass_rate: 0.5 },
  status: 'published',
  tags: ['baseline', 'smoke'],
  metadata: { generated_by: 'baseline/forward-baseline.ts' },
};
