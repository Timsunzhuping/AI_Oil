import { describe, it, expect } from 'vitest';
import {
  CarbonFormulaSchema,
  CreateLimsTaskSchema,
  PullLimsResultSchema,
  SapSyncSchema,
  ListLimsLinksQuerySchema,
} from '../../../src/modules/erp/schemas.js';

describe('SapSyncSchema', () => {
  it('accepts a minimal payload', () => {
    expect(SapSyncSchema.safeParse({}).success).toBe(true);
  });
  it('rejects unknown mode', () => {
    expect(SapSyncSchema.safeParse({ mode: 'banana' }).success).toBe(false);
  });
  it('rejects out-of-range limit', () => {
    expect(SapSyncSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(SapSyncSchema.safeParse({ limit: 5000 }).success).toBe(false);
  });
});

describe('CreateLimsTaskSchema', () => {
  it('requires test_method', () => {
    expect(CreateLimsTaskSchema.safeParse({}).success).toBe(false);
  });
  it('accepts a typical payload', () => {
    expect(
      CreateLimsTaskSchema.safeParse({ test_method: 'KV_100C', sample_count: 3 }).success
    ).toBe(true);
  });
});

describe('PullLimsResultSchema', () => {
  it('accepts an empty body (defaults to empty object)', () => {
    expect(PullLimsResultSchema.safeParse({}).success).toBe(true);
  });
  it('rejects max_attempts above the cap', () => {
    expect(PullLimsResultSchema.safeParse({ max_attempts: 9 }).success).toBe(false);
  });
});

describe('CarbonFormulaSchema', () => {
  it('rejects empty bom', () => {
    expect(CarbonFormulaSchema.safeParse({ bom: [] }).success).toBe(false);
  });
  it('rejects bom totalling > 1.001', () => {
    expect(
      CarbonFormulaSchema.safeParse({
        bom: [
          { material_code: 'A', ratio: 0.6 },
          { material_code: 'B', ratio: 0.6 },
        ],
      }).success
    ).toBe(false);
  });
  it('accepts a typical payload', () => {
    expect(
      CarbonFormulaSchema.safeParse({
        bom: [
          { material_code: 'A', ratio: 0.5 },
          { material_code: 'B', ratio: 0.5 },
        ],
      }).success
    ).toBe(true);
  });
});

describe('ListLimsLinksQuerySchema', () => {
  it('coerces page / pageSize to integers with defaults', () => {
    const r = ListLimsLinksQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
      expect(r.data.pageSize).toBe(20);
    }
  });
});
