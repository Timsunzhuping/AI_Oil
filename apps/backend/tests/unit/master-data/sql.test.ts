import { describe, it, expect } from 'vitest';
import { paginationClause, buildUpdateSet, normalizeAlias } from '../../../src/lib/sql.js';

describe('normalizeAlias', () => {
  it.each([
    ['Mineral Oil', 'mineral oil'],
    ['  KG  ', 'kg'],
    ['ZDDP', 'zddp'],
    ['pH Value', 'ph value'],
  ])('normalizes %j → %j', (input, expected) => {
    expect(normalizeAlias(input)).toBe(expected);
  });
});

describe('paginationClause', () => {
  it('produces sql with safe ordering and offset/limit params', () => {
    const r = paginationClause(
      { page: 2, pageSize: 10, orderBy: 'name', orderDir: 'desc' },
      ['created_at', 'name', 'code'],
      0
    );
    expect(r.sql).toBe('ORDER BY name DESC LIMIT $1 OFFSET $2');
    expect(r.params).toEqual([10, 10]);
    expect(r.page).toBe(2);
    expect(r.pageSize).toBe(10);
  });

  it('falls back to first allowed column when orderBy is invalid', () => {
    const r = paginationClause(
      { page: 1, pageSize: 5, orderBy: 'rogue_column' },
      ['created_at', 'name'],
      0
    );
    expect(r.sql).toContain('ORDER BY created_at');
  });

  it('clamps pageSize and page', () => {
    const r = paginationClause({ page: 0, pageSize: 9999 }, ['x'], 0);
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(200);
    expect(r.params[1]).toBe(0);
  });

  it('honors paramOffset for chained where + paginate', () => {
    const r = paginationClause({ page: 1, pageSize: 5 }, ['x'], 3);
    expect(r.sql).toBe('ORDER BY x DESC LIMIT $4 OFFSET $5');
  });
});

describe('buildUpdateSet', () => {
  it('skips undefined values and indexes placeholders', () => {
    const r = buildUpdateSet({ name: 'Foo', density: undefined, status: 'active' });
    expect(r.sql).toBe('name = $1, status = $2');
    expect(r.params).toEqual(['Foo', 'active']);
    expect(r.nextIndex).toBe(3);
  });

  it('returns empty sql for an empty update', () => {
    const r = buildUpdateSet({ a: undefined, b: undefined });
    expect(r.sql).toBe('');
    expect(r.params).toEqual([]);
  });
});
