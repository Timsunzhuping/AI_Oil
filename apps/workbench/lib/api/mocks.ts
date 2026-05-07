/**
 * Mock fixtures for offline / no-backend dev mode. The shapes match
 * `lib/api/types.ts` exactly so the adapter can substitute these in for
 * real API responses with no schema drift.
 */
import type {
  ComparisonPayload,
  FormulaTemplate,
  FormulaVersionDiffPayload,
  ForwardPredictionPayload,
  InverseRecommendationPayload,
  KnowledgeQaPayload,
  PaginatedData,
  TaskDetail,
  TaskSummary,
} from './types';

const NOW = '2026-05-07T09:30:00Z';

export const MOCK_TASKS: TaskSummary[] = [
  {
    id: 't-1001', code: 'AI-2026-0001', task_type: 'forward_prediction',
    title: '5W-30 全合成机油 — 100℃ 运动黏度预测',
    status: 'completed', priority: 'high',
    submitted_at: '2026-05-06T08:12:00Z', completed_at: '2026-05-06T08:13:42Z',
    created_at: '2026-05-06T08:11:00Z', updated_at: '2026-05-06T08:13:42Z',
    confidence_score: 0.87,
  },
  {
    id: 't-1002', code: 'AI-2026-0002', task_type: 'cost_optimization',
    title: '工业齿轮油 — 在 ISO VG 220 规格下优化成本 5%',
    status: 'processing', priority: 'medium',
    submitted_at: '2026-05-07T03:01:00Z', completed_at: null,
    created_at: '2026-05-07T02:55:00Z', updated_at: '2026-05-07T03:01:00Z',
    confidence_score: null,
  },
  {
    id: 't-1003', code: 'AI-2026-0003', task_type: 'material_replacement',
    title: 'PIB 增稠剂替代候选 — 控制 VI 衰减 ≤ 2%',
    status: 'submitted', priority: 'medium',
    submitted_at: '2026-05-07T05:00:00Z', completed_at: null,
    created_at: '2026-05-07T04:55:00Z', updated_at: '2026-05-07T05:00:00Z',
    confidence_score: null,
  },
  {
    id: 't-1004', code: 'AI-2026-0004', task_type: 'knowledge_qa',
    title: 'API SP 标准对磷含量的最新限值是多少？',
    status: 'completed', priority: 'low',
    submitted_at: '2026-05-05T10:21:00Z', completed_at: '2026-05-05T10:21:11Z',
    created_at: '2026-05-05T10:20:00Z', updated_at: '2026-05-05T10:21:11Z',
    confidence_score: 0.92,
  },
  {
    id: 't-1005', code: 'AI-2026-0005', task_type: 'new_product_generation',
    title: '电动车用低粘度 0W-16 — 满足节能与磨损双指标',
    status: 'failed', priority: 'urgent',
    submitted_at: '2026-05-04T14:00:00Z', completed_at: null,
    created_at: '2026-05-04T13:55:00Z', updated_at: '2026-05-04T14:01:30Z',
    confidence_score: null,
  },
];

export const MOCK_TASK_DETAIL: TaskDetail = {
  ...MOCK_TASKS[0],
  description: '基于现有 5W-30 配方版本 fv-1023，预测 100℃ 运动黏度并给出风险提示。',
  summary: '预测结果落在规格区间内，置信度较高，主要风险为低温启动黏度接近上限。',
  trace_id: 'aabbccdd-1111-2222-3333-444455556666',
  handler_version: 'mock-v1',
  related_formula_version_id: 'fv-1023',
  metadata: { source: 'mock' },
  inputs: [
    {
      id: 'i-1', task_id: 't-1001', input_type: 'structured',
      payload: { formula_version_id: 'fv-1023', target_metric: 'KV_100C' },
      raw_text: null, is_primary: true, created_at: NOW,
    },
  ],
  outputs: [
    {
      id: 'o-1', task_id: 't-1001', output_type: 'prediction',
      payload: { formula_version_id: 'fv-1023' }, is_primary: true, created_at: NOW,
    },
  ],
};

export const MOCK_FORWARD: ForwardPredictionPayload = {
  formula_version_id: 'fv-1023',
  rows: [
    {
      metric: 'KV_100C', display_name: '100℃ 运动黏度', unit: 'mm²/s',
      point_estimate: 11.42, ci_low: 11.05, ci_high: 11.81, confidence: 0.88,
      spec_low: 9.3, spec_high: 12.5, status: 'ok',
    },
    {
      metric: 'KV_40C', display_name: '40℃ 运动黏度', unit: 'mm²/s',
      point_estimate: 67.4, ci_low: 64.9, ci_high: 70.1, confidence: 0.81,
      spec_low: 60, spec_high: 80, status: 'ok',
    },
    {
      metric: 'VI', display_name: '黏度指数', unit: null,
      point_estimate: 168, ci_low: 162, ci_high: 173, confidence: 0.84,
      spec_low: 160, spec_high: null, status: 'ok',
    },
    {
      metric: 'CCS_-30C', display_name: '-30℃ 冷启动黏度', unit: 'mPa·s',
      point_estimate: 5980, ci_low: 5710, ci_high: 6280, confidence: 0.71,
      spec_low: null, spec_high: 6200, status: 'warn',
    },
    {
      metric: 'P_PCT', display_name: '磷含量', unit: 'wt%',
      point_estimate: 0.082, ci_low: 0.078, ci_high: 0.086, confidence: 0.95,
      spec_low: null, spec_high: 0.08, status: 'fail',
    },
  ],
  risks: [
    { level: 'critical', code: 'SPEC_FAIL', message: '磷含量 0.082 wt% 高于 API SP 限值 0.08 wt%。', metric: 'P_PCT' },
    { level: 'warning', code: 'CCS_BORDERLINE', message: '-30℃ 冷启动黏度接近规格上限，建议复核基础油配比。', metric: 'CCS_-30C' },
    { level: 'info', code: 'MODEL_REGION', message: '当前样本落在模型可信区域内（密度=12 个邻近样本）。' },
  ],
  sources: [
    {
      id: 's-1', source_type: 'experiment', title: '试验批次 EXP-2025-441 平行样', reference: 'EXP-2025-441',
      relevance: 0.92, url: null,
    },
    {
      id: 's-2', source_type: 'model', title: '黏度回归模型 v3.1', reference: 'kv-regressor@3.1',
      relevance: 0.88, url: null,
    },
    {
      id: 's-3', source_type: 'standard', title: 'API SP / ILSAC GF-6 规格表', reference: 'API SP-2020',
      relevance: 0.74, url: null,
    },
  ],
};

export const MOCK_INVERSE: InverseRecommendationPayload = {
  candidates: [
    {
      id: 'cand-1', rank: 1, name: '方案 A — PAO 主导高 VI', headline: '最佳综合：成本中等，VI 高，挥发损失低',
      predicted_metrics: MOCK_FORWARD.rows.slice(0, 3),
      estimated_cost: 18.42, cost_unit: 'CNY/kg',
      composition: [
        { raw_material_id: 'rm-pao6', raw_material_name: 'PAO-6', percentage: 42 },
        { raw_material_id: 'rm-grpiii', raw_material_name: 'Group III 4cSt', percentage: 38 },
        { raw_material_id: 'rm-vii', raw_material_name: 'OCP 增稠剂', percentage: 8.5 },
        { raw_material_id: 'rm-pkg', raw_material_name: '复合添加剂包', percentage: 11.5 },
      ],
      confidence: 0.86,
      risks: [{ level: 'warning', code: 'COST_HIGH', message: 'PAO 价格波动较大，需关注采购合同。' }],
      sources: MOCK_FORWARD.sources.slice(0, 2),
    },
    {
      id: 'cand-2', rank: 2, name: '方案 B — Group III 主导', headline: '成本最优：低 5.6%，但 -30℃ 性能边际',
      predicted_metrics: MOCK_FORWARD.rows.slice(0, 3),
      estimated_cost: 15.21, cost_unit: 'CNY/kg',
      composition: [
        { raw_material_id: 'rm-grpiii', raw_material_name: 'Group III 4cSt', percentage: 70 },
        { raw_material_id: 'rm-pao4', raw_material_name: 'PAO-4', percentage: 12 },
        { raw_material_id: 'rm-vii', raw_material_name: 'OCP 增稠剂', percentage: 7 },
        { raw_material_id: 'rm-pkg', raw_material_name: '复合添加剂包', percentage: 11 },
      ],
      confidence: 0.78,
      risks: [{ level: 'warning', code: 'CCS_BORDERLINE', message: '-30℃ 冷启动黏度接近规格上限。', metric: 'CCS_-30C' }],
      sources: MOCK_FORWARD.sources.slice(1, 3),
    },
    {
      id: 'cand-3', rank: 3, name: '方案 C — 半合成混合', headline: '保守：基于现有量产配方微调',
      predicted_metrics: MOCK_FORWARD.rows.slice(0, 3),
      estimated_cost: 13.95, cost_unit: 'CNY/kg',
      composition: [
        { raw_material_id: 'rm-grpii', raw_material_name: 'Group II 4cSt', percentage: 35 },
        { raw_material_id: 'rm-grpiii', raw_material_name: 'Group III 4cSt', percentage: 35 },
        { raw_material_id: 'rm-pao6', raw_material_name: 'PAO-6', percentage: 10 },
        { raw_material_id: 'rm-vii', raw_material_name: 'OCP 增稠剂', percentage: 8 },
        { raw_material_id: 'rm-pkg', raw_material_name: '复合添加剂包', percentage: 12 },
      ],
      confidence: 0.7,
      risks: [{ level: 'info', code: 'VI_LOW', message: '黏度指数仅 158，临界规格下限。' }],
      sources: MOCK_FORWARD.sources,
    },
    {
      id: 'cand-4', rank: 4, name: '方案 D — 试验性低粘度', headline: '探索：节能潜力高，需试验验证',
      predicted_metrics: MOCK_FORWARD.rows.slice(0, 3),
      estimated_cost: 17.10, cost_unit: 'CNY/kg',
      composition: [
        { raw_material_id: 'rm-grpiii', raw_material_name: 'Group III 4cSt', percentage: 55 },
        { raw_material_id: 'rm-pao4', raw_material_name: 'PAO-4', percentage: 22 },
        { raw_material_id: 'rm-vii-star', raw_material_name: '星型 SBR 增稠剂', percentage: 6 },
        { raw_material_id: 'rm-pkg', raw_material_name: '复合添加剂包', percentage: 17 },
      ],
      confidence: 0.62,
      risks: [
        { level: 'critical', code: 'NEAR_BOUNDARY', message: '配方位于训练样本边界外，预测置信度受限。' },
      ],
      sources: MOCK_FORWARD.sources,
    },
  ],
};

export const MOCK_COMPARISON: ComparisonPayload = {
  scenarios: [
    {
      id: 'cand-1', name: '方案 A',
      metrics: { KV_100C: 11.42, KV_40C: 67.4, VI: 168, CCS_-30C: 5980, P_PCT: 0.082 },
      composition: [
        { raw_material_name: 'PAO-6', percentage: 42 },
        { raw_material_name: 'Group III 4cSt', percentage: 38 },
        { raw_material_name: 'OCP 增稠剂', percentage: 8.5 },
        { raw_material_name: '复合添加剂包', percentage: 11.5 },
      ],
      estimated_cost: 18.42, confidence: 0.86,
    },
    {
      id: 'cand-2', name: '方案 B',
      metrics: { KV_100C: 11.05, KV_40C: 64.9, VI: 162, CCS_-30C: 6280, P_PCT: 0.078 },
      composition: [
        { raw_material_name: 'Group III 4cSt', percentage: 70 },
        { raw_material_name: 'PAO-4', percentage: 12 },
        { raw_material_name: 'OCP 增稠剂', percentage: 7 },
        { raw_material_name: '复合添加剂包', percentage: 11 },
      ],
      estimated_cost: 15.21, confidence: 0.78,
    },
    {
      id: 'cand-3', name: '方案 C',
      metrics: { KV_100C: 11.81, KV_40C: 70.1, VI: 158, CCS_-30C: 6190, P_PCT: 0.080 },
      composition: [
        { raw_material_name: 'Group II 4cSt', percentage: 35 },
        { raw_material_name: 'Group III 4cSt', percentage: 35 },
        { raw_material_name: 'PAO-6', percentage: 10 },
        { raw_material_name: 'OCP 增稠剂', percentage: 8 },
        { raw_material_name: '复合添加剂包', percentage: 12 },
      ],
      estimated_cost: 13.95, confidence: 0.70,
    },
  ],
  metric_axes: [
    { key: 'KV_100C', display_name: '100℃ 运动黏度', unit: 'mm²/s', better: 'higher' },
    { key: 'VI', display_name: '黏度指数', unit: null, better: 'higher' },
    { key: 'CCS_-30C', display_name: '-30℃ CCS', unit: 'mPa·s', better: 'lower' },
    { key: 'P_PCT', display_name: '磷含量', unit: 'wt%', better: 'lower' },
    { key: 'estimated_cost', display_name: '估算成本', unit: 'CNY/kg', better: 'lower' },
  ],
  risks: MOCK_FORWARD.risks,
  sources: MOCK_FORWARD.sources,
};

export const MOCK_DIFF: FormulaVersionDiffPayload = {
  base:   { id: 'fv-1022', version_label: 'v1.0' },
  target: { id: 'fv-1023', version_label: 'v1.1' },
  entries: [
    { raw_material_name: 'PAO-6', before: 38, after: 42, change: 'increased', delta: 4 },
    { raw_material_name: 'Group III 4cSt', before: 42, after: 38, change: 'decreased', delta: -4 },
    { raw_material_name: 'OCP 增稠剂', before: 8.5, after: 8.5, change: 'unchanged', delta: 0 },
    { raw_material_name: '抗氧剂 ZDDP', before: 1.2, after: null, change: 'removed', delta: -1.2 },
    { raw_material_name: '抗氧剂 MoDTC', before: null, after: 0.5, change: 'added', delta: 0.5 },
    { raw_material_name: '复合添加剂包', before: 11.5, after: 11.5, change: 'unchanged', delta: 0 },
  ],
  metric_deltas: [
    { metric: 'KV_100C', display_name: '100℃ 运动黏度', before: 11.20, after: 11.42, delta: 0.22 },
    { metric: 'VI',      display_name: '黏度指数',       before: 162,    after: 168,   delta: 6 },
    { metric: 'CCS_-30C', display_name: '-30℃ CCS',     before: 6210,  after: 5980, delta: -230 },
    { metric: 'P_PCT',   display_name: '磷含量',         before: 0.085,  after: 0.082, delta: -0.003 },
  ],
};

export const MOCK_TEMPLATES: FormulaTemplate[] = [
  {
    id: 'tpl-001', code: 'TPL-PCMO-5W30-A',
    name: '乘用车机油 5W-30 全合成基底',
    product_category: '乘用车机油', description: '量产配方 — PAO/GroupIII 混合基底，2025 年 SP 升级',
    last_revised_year: 2025, popularity: 92,
  },
  {
    id: 'tpl-002', code: 'TPL-HDEO-15W40-B',
    name: '柴油机油 15W-40 矿物油基底',
    product_category: '商用车机油', description: '主流商用车配方，适合 CK-4 等级',
    last_revised_year: 2024, popularity: 78,
  },
  {
    id: 'tpl-003', code: 'TPL-IGO-VG220-C',
    name: '工业齿轮油 ISO VG 220',
    product_category: '工业润滑油', description: '极压型工业齿轮油参考配方',
    last_revised_year: 2024, popularity: 65,
  },
  {
    id: 'tpl-004', code: 'TPL-EV-0W16-D',
    name: '电动车专用 0W-16 配方',
    product_category: '电动车机油', description: '低粘度高燃效，电池冷却油兼容性测试通过',
    last_revised_year: 2026, popularity: 51,
  },
  {
    id: 'tpl-005', code: 'TPL-HVAC-32-E',
    name: '冷冻机油 ISO VG 32',
    product_category: '特种润滑油', description: '与 R134a/R1234yf 制冷剂兼容',
    last_revised_year: 2023, popularity: 34,
  },
];

export const MOCK_KNOWLEDGE_QA: KnowledgeQaPayload = {
  answer:
    'API SP 规范要求乘用车机油磷含量上限为 0.08 wt%（800 ppm），并要求满足 ILSAC GF-6 的硫、磷、灰分综合限制。当配方磷含量接近上限时，建议同步评估 ZDDP 类型与挥发性。',
  sources: MOCK_FORWARD.sources,
  confidence: 0.91,
};

export function paginate<T>(items: T[], page = 1, pageSize = 20): PaginatedData<T> {
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize };
}
