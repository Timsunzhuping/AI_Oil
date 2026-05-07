import { describe, it, expect } from 'vitest';
import {
  BatchPredictRequestSchema,
  ExplainPredictRequestSchema,
  SinglePredictRequestSchema,
} from '../../../src/modules/prediction/schemas.js';

const goodBom = [
  { material_code: 'PAO-6', material_name: 'PAO-6', ratio: 0.42, role: 'base_oil' },
  { material_code: 'GIII', material_name: 'Group III 4 cSt', ratio: 0.58, role: 'base_oil' },
];

describe('SinglePredictRequestSchema', () => {
  it('accepts a minimal valid payload', () => {
    const r = SinglePredictRequestSchema.safeParse({
      product_category: 'engine_oil_pcmo',
      bom_items: goodBom,
    });
    expect(r.success).toBe(true);
  });

  it('rejects an empty BOM', () => {
    const r = SinglePredictRequestSchema.safeParse({
      product_category: 'engine_oil_pcmo',
      bom_items: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects a BOM with ratio totalling > 1', () => {
    const r = SinglePredictRequestSchema.safeParse({
      product_category: 'engine_oil_pcmo',
      bom_items: [
        { material_code: 'A', material_name: 'A', ratio: 0.6, role: 'base_oil' },
        { material_code: 'B', material_name: 'B', ratio: 0.6, role: 'base_oil' },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rejects a single ratio outside (0, 1]', () => {
    const r = SinglePredictRequestSchema.safeParse({
      product_category: 'engine_oil_pcmo',
      bom_items: [{ material_code: 'A', material_name: 'A', ratio: 0, role: 'base_oil' }],
    });
    expect(r.success).toBe(false);
  });

  it('accepts target_metrics when present and shapes them as string[]', () => {
    const r = SinglePredictRequestSchema.safeParse({
      product_category: 'engine_oil_pcmo',
      bom_items: goodBom,
      target_metrics: ['KV_100C', 'VI'],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.target_metrics).toEqual(['KV_100C', 'VI']);
  });
});

describe('BatchPredictRequestSchema', () => {
  it('requires at least 1 formula', () => {
    const r = BatchPredictRequestSchema.safeParse({
      product_category: 'engine_oil_pcmo',
      formulas: [],
    });
    expect(r.success).toBe(false);
  });

  it('caps the batch at 50', () => {
    const formulas = Array.from({ length: 51 }, () => ({ bom_items: goodBom }));
    const r = BatchPredictRequestSchema.safeParse({
      product_category: 'engine_oil_pcmo',
      formulas,
    });
    expect(r.success).toBe(false);
  });

  it('clamps concurrency into [1,16]', () => {
    expect(
      BatchPredictRequestSchema.safeParse({
        product_category: 'engine_oil_pcmo',
        formulas: [{ bom_items: goodBom }],
        concurrency: 0,
      }).success
    ).toBe(false);
    expect(
      BatchPredictRequestSchema.safeParse({
        product_category: 'engine_oil_pcmo',
        formulas: [{ bom_items: goodBom }],
        concurrency: 64,
      }).success
    ).toBe(false);
  });
});

describe('ExplainPredictRequestSchema', () => {
  it('requires `metric`', () => {
    const r = ExplainPredictRequestSchema.safeParse({
      product_category: 'engine_oil_pcmo',
      bom_items: goodBom,
    });
    expect(r.success).toBe(false);
  });

  it('accepts a typical explain payload', () => {
    const r = ExplainPredictRequestSchema.safeParse({
      product_category: 'engine_oil_pcmo',
      bom_items: goodBom,
      metric: 'KV_100C',
      top_k: 5,
    });
    expect(r.success).toBe(true);
  });
});
