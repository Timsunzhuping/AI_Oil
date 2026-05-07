import { describe, it, expect } from 'vitest';
import {
  GenerateRequestSchema,
  RecalculateRequestSchema,
  ReplaceMaterialRequestSchema,
} from '../../../src/modules/recommendation/schemas.js';

const baseTargets = [
  { name: 'KV_100C', target: 11, unit: 'mm²/s', lower_bound: 9.3, upper_bound: 12.5, weight: 2 },
];

describe('GenerateRequestSchema', () => {
  it('accepts a minimal cost-priority request', () => {
    const r = GenerateRequestSchema.safeParse({
      product_category: 'engine_oil_pcmo',
      target_metrics: baseTargets,
      cost_limit: 20,
      material_pool: [{ material_code: 'PAO-6', material_name: 'PAO-6', role: 'base_oil' }],
    });
    expect(r.success).toBe(true);
  });

  it('requires at least one target metric', () => {
    const r = GenerateRequestSchema.safeParse({
      product_category: 'engine_oil_pcmo',
      target_metrics: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects target_metrics with lower_bound > upper_bound', () => {
    const r = GenerateRequestSchema.safeParse({
      product_category: 'engine_oil_pcmo',
      target_metrics: [{ name: 'KV_100C', lower_bound: 12, upper_bound: 10 }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects material pool entries with min_ratio > max_ratio', () => {
    const r = GenerateRequestSchema.safeParse({
      product_category: 'engine_oil_pcmo',
      target_metrics: baseTargets,
      material_pool: [
        {
          material_code: 'X',
          material_name: 'X',
          role: 'base_oil',
          min_ratio: 0.4,
          max_ratio: 0.2,
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('clamps n_candidates into [1,10]', () => {
    expect(
      GenerateRequestSchema.safeParse({
        product_category: 'p',
        target_metrics: baseTargets,
        n_candidates: 0,
      }).success
    ).toBe(false);
    expect(
      GenerateRequestSchema.safeParse({
        product_category: 'p',
        target_metrics: baseTargets,
        n_candidates: 11,
      }).success
    ).toBe(false);
  });
});

describe('RecalculateRequestSchema', () => {
  it('requires either modifications or full_bom', () => {
    const r = RecalculateRequestSchema.safeParse({
      task_id: '00000000-0000-0000-0000-000000000001',
      candidate_id: '00000000-0000-0000-0000-000000000002',
    });
    expect(r.success).toBe(false);
  });

  it('accepts modifications', () => {
    const r = RecalculateRequestSchema.safeParse({
      task_id: '00000000-0000-0000-0000-000000000001',
      candidate_id: '00000000-0000-0000-0000-000000000002',
      modifications: [{ material_code: 'PAO-6', new_ratio: 0.4 }],
    });
    expect(r.success).toBe(true);
  });
});

describe('ReplaceMaterialRequestSchema', () => {
  it('requires from/to material codes', () => {
    const r = ReplaceMaterialRequestSchema.safeParse({
      task_id: '00000000-0000-0000-0000-000000000001',
      candidate_id: '00000000-0000-0000-0000-000000000002',
      swap: { from_material_code: '', to_material_code: 'X' },
    });
    expect(r.success).toBe(false);
  });

  it('accepts a typical swap', () => {
    const r = ReplaceMaterialRequestSchema.safeParse({
      task_id: '00000000-0000-0000-0000-000000000001',
      candidate_id: '00000000-0000-0000-0000-000000000002',
      swap: { from_material_code: 'PAO-6', to_material_code: 'GIII', new_ratio: 0.4 },
    });
    expect(r.success).toBe(true);
  });
});
