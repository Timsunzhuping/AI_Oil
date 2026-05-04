import { describe, it, expect } from 'vitest';
import {
  MaterialImportSchema,
  MetricImportSchema,
  UnitImportSchema,
  validateAll,
  validateRow,
} from '../../../src/modules/master-data/import/validators.js';

describe('MaterialImportSchema', () => {
  it('accepts a minimal valid row', () => {
    const r = MaterialImportSchema.safeParse({ code: 'RM-1', name: 'Test' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.code).toBe('RM-1');
      expect(r.data.unit_of_measure).toBe('kg');
      expect(r.data.status).toBe('active');
    }
  });

  it('coerces numeric fields from strings', () => {
    const r = MaterialImportSchema.safeParse({
      code: 'RM-1',
      name: 'Test',
      density: '0.87',
      viscosity_cst: '42.5',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.density).toBe(0.87);
      expect(r.data.viscosity_cst).toBe(42.5);
    }
  });

  it('parses tag list from semicolon/comma/pipe-separated string', () => {
    const r = MaterialImportSchema.safeParse({
      code: 'RM-1', name: 'Test',
      tags: 'base|mineral|group_i',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tags).toEqual(['base','mineral','group_i']);
  });

  it('parses booleans from yes/no/true/false', () => {
    expect(MaterialImportSchema.safeParse({ code: 'A', name: 'A', is_restricted: 'YES' }).success).toBe(true);
    expect(MaterialImportSchema.safeParse({ code: 'A', name: 'A', is_restricted: '0'   }).success).toBe(true);
    expect(MaterialImportSchema.safeParse({ code: 'A', name: 'A', is_restricted: 'maybe'}).success).toBe(false);
  });

  it('rejects rows with non-numeric density', () => {
    const r = MaterialImportSchema.safeParse({ code: 'RM-1', name: 'Test', density: 'abc' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.errors.some((e) => e.path[0] === 'density')).toBe(true);
  });

  it('rejects unknown physical_state', () => {
    const r = MaterialImportSchema.safeParse({ code: 'A', name: 'B', physical_state: 'gel' });
    expect(r.success).toBe(false);
  });

  it('rejects empty code', () => {
    const r = MaterialImportSchema.safeParse({ code: '', name: 'Foo' });
    expect(r.success).toBe(false);
  });
});

describe('MetricImportSchema', () => {
  it('coerces expected_min/max', () => {
    const r = MetricImportSchema.safeParse({
      code: 'KV40', name_std: 'Viscosity @ 40C',
      expected_min: '0', expected_max: '500',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.expected_min).toBe(0);
  });
});

describe('UnitImportSchema', () => {
  it('requires code, name, dimension', () => {
    expect(UnitImportSchema.safeParse({ code: 'kg', name: 'Kilogram', dimension: 'mass' }).success).toBe(true);
    expect(UnitImportSchema.safeParse({ code: 'kg', name: 'Kilogram' }).success).toBe(false);
  });
});

describe('validateAll', () => {
  it('partitions rows and produces per-row error reports', () => {
    const rows = [
      { rowIndex: 1, data: { code: 'A', name: 'OK' } },
      { rowIndex: 2, data: { code: '', name: 'BAD code' } },
      { rowIndex: 3, data: { code: 'B', name: 'OK', density: 'not-a-number' } },
    ];
    const { valid, invalid } = validateAll(rows, MaterialImportSchema);
    expect(valid).toHaveLength(1);
    expect(valid[0].rowIndex).toBe(1);
    expect(invalid).toHaveLength(2);
    expect(invalid[0].rowIndex).toBe(2);
    expect(invalid[0].errors[0].field).toBe('code');
    expect(invalid[1].rowIndex).toBe(3);
    expect(invalid[1].errors.some((e) => e.field === 'density')).toBe(true);
  });
});

describe('validateRow', () => {
  it('returns ok=true with typed data when valid', () => {
    const r = validateRow({ rowIndex: 5, data: { code: 'A', name: 'B' } }, MaterialImportSchema);
    expect(r.ok).toBe(true);
    expect(r.rowIndex).toBe(5);
  });

  it('returns ok=false with per-field errors when invalid', () => {
    const r = validateRow({ rowIndex: 7, data: { name: 'NoCode' } }, MaterialImportSchema);
    expect(r.ok).toBe(false);
    expect(r.errors?.[0].row).toBe(7);
    expect(r.errors?.[0].field).toBe('code');
  });
});
