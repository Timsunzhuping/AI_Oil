import { describe, it, expect } from 'vitest';
import {
  CreateTestSetSchema,
  ExportFormatQuerySchema,
  IdParamSchema,
  ListRunsQuerySchema,
  ListTestSetsQuerySchema,
  RunRequestSchema,
} from '../../../src/modules/evaluation/schemas.js';

describe('CreateTestSetSchema', () => {
  it('accepts a minimal valid payload', () => {
    const r = CreateTestSetSchema.parse({
      name: 'set',
      test_type: 'forward',
      cases: [{ id: 'c-1', bom: [], expected_metrics: { KV_100C: 11 } }],
    });
    expect(r.name).toBe('set');
  });

  it('rejects invalid test_type', () => {
    expect(() => CreateTestSetSchema.parse({ name: 'x', test_type: 'bogus', cases: [] })).toThrow();
  });

  it('rejects too many cases', () => {
    expect(() =>
      CreateTestSetSchema.parse({
        name: 'x',
        test_type: 'forward',
        cases: Array.from({ length: 2001 }, (_, i) => ({ id: `c-${i}` })),
      })
    ).toThrow();
  });
});

describe('RunRequestSchema', () => {
  it('parses tolerance overrides', () => {
    const r = RunRequestSchema.parse({
      test_set_id: '11111111-1111-1111-1111-111111111111',
      config: { tolerance: { max_relative_error: 0.05, min_metric_pass_rate: 0.8 } },
    });
    expect(r.config?.tolerance?.max_relative_error).toBe(0.05);
  });

  it('parses stability tolerance overrides', () => {
    const r = RunRequestSchema.parse({
      test_set_id: '11111111-1111-1111-1111-111111111111',
      config: { stability_tolerance: { min_pairwise_cosine: 0.95, max_cv: 0.05 }, default_runs: 5 },
    });
    expect(r.config?.default_runs).toBe(5);
  });

  it('rejects invalid trigger_type', () => {
    expect(() =>
      RunRequestSchema.parse({
        test_set_id: '11111111-1111-1111-1111-111111111111',
        trigger_type: 'cron',
      })
    ).toThrow();
  });

  it('rejects out-of-range thresholds', () => {
    expect(() =>
      RunRequestSchema.parse({
        test_set_id: '11111111-1111-1111-1111-111111111111',
        config: { tolerance: { min_metric_pass_rate: 1.5 } },
      })
    ).toThrow();
  });
});

describe('list query schemas', () => {
  it('coerces page/pageSize to numbers', () => {
    const r = ListTestSetsQuerySchema.parse({ page: '2', pageSize: '50' });
    expect(r.page).toBe(2);
    expect(r.pageSize).toBe(50);
  });

  it('clamps pageSize at 200', () => {
    expect(() => ListRunsQuerySchema.parse({ pageSize: '500' })).toThrow();
  });

  it('defaults to page=1 pageSize=20', () => {
    const r = ListTestSetsQuerySchema.parse({});
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(20);
  });
});

describe('export + id schemas', () => {
  it('defaults format to json', () => {
    expect(ExportFormatQuerySchema.parse({}).format).toBe('json');
  });

  it('rejects unknown formats', () => {
    expect(() => ExportFormatQuerySchema.parse({ format: 'xlsx' })).toThrow();
  });

  it('IdParamSchema requires uuid', () => {
    expect(() => IdParamSchema.parse({ id: 'not-a-uuid' })).toThrow();
    expect(IdParamSchema.parse({ id: '11111111-1111-1111-1111-111111111111' }).id).toBeTypeOf(
      'string'
    );
  });
});
