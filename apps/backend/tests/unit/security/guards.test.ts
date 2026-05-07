import { describe, it, expect } from 'vitest';
import {
  hasPermission,
  hasRole,
  scopeAllows,
} from '../../../src/modules/security/middleware/guards.js';
import {
  assertPermission,
  assertRole,
  assertDataScope,
} from '../../../src/modules/security/decorators.js';
import type { AuthContext } from '../../../src/modules/security/types.js';

const baseCtx: AuthContext = {
  user_id: 'u-1',
  username: 'alice',
  email: 'alice@example.com',
  roles: ['researcher'],
  permissions: ['formula:read', 'formula:write', 'predict:execute'],
  data_scopes: [{ scope_type: 'product_category', scope_value: 'engine_oil_pcmo' }],
  claims: {},
};

describe('hasPermission / hasRole', () => {
  it('returns true when permission is granted', () => {
    expect(hasPermission(baseCtx, 'formula:read')).toBe(true);
  });
  it('returns false when not granted', () => {
    expect(hasPermission(baseCtx, 'ml:release')).toBe(false);
  });
  it('super_admin short-circuits to true', () => {
    expect(hasPermission({ ...baseCtx, roles: ['super_admin'] }, 'ml:release')).toBe(true);
  });
  it('hasRole accepts super_admin as a satisfier', () => {
    expect(hasRole({ ...baseCtx, roles: ['super_admin'] }, 'researcher')).toBe(true);
  });
});

describe('scopeAllows', () => {
  it('allows when no grants of that type (allow_unrestricted default)', () => {
    expect(scopeAllows([], 'product_category', 'pcmo')).toBe(true);
  });
  it('allows when value matches', () => {
    expect(scopeAllows(baseCtx.data_scopes, 'product_category', 'engine_oil_pcmo')).toBe(true);
  });
  it('rejects when value mismatches and grants exist', () => {
    expect(scopeAllows(baseCtx.data_scopes, 'product_category', 'industrial_gear')).toBe(false);
  });
  it('wildcard "*" matches anything', () => {
    expect(scopeAllows([{ scope_type: 'team', scope_value: '*' }], 'team', 'lubricants')).toBe(
      true
    );
  });
});

describe('decorators', () => {
  it('assertPermission throws Forbidden when missing', () => {
    expect(() => assertPermission(baseCtx, 'ml:release')).toThrow();
  });
  it('assertPermission passes for super_admin', () => {
    expect(() =>
      assertPermission({ ...baseCtx, roles: ['super_admin'] }, 'ml:release')
    ).not.toThrow();
  });
  it('assertRole rejects when role missing', () => {
    expect(() => assertRole(baseCtx, 'model_admin')).toThrow();
  });
  it('assertDataScope blocks unscoped access when grants exist', () => {
    expect(() => assertDataScope(baseCtx, 'product_category', 'industrial_gear')).toThrow();
  });
  it('assertDataScope allows when grants are absent (opt-in)', () => {
    expect(() => assertDataScope(baseCtx, 'team', 'anything')).not.toThrow();
  });
});
