/**
 * Service-layer authorization helpers.
 *
 * Express middleware guards routes BEFORE they hit the service. These
 * helpers cover the case where service code is invoked from non-HTTP paths
 * (background runners, cron, RPC) and still needs to enforce RBAC.
 *
 *   class FormulaService {
 *     async update(id: string, patch: …, ctx: AuthContext) {
 *       assertPermission(ctx, 'formula:write');
 *       …
 *     }
 *   }
 *
 *   // Or as a function decorator on builders:
 *   const upgrade = withPermission('ml:release', async (ctx, ...) => { … });
 */
import { ForbiddenError, UnauthorizedError } from '../../lib/errors.js';
import type { AuthContext, PermissionCode, RoleCode } from './types.js';
import { hasPermission, hasRole, scopeAllows } from './middleware/guards.js';

export function assertAuthenticated(
  ctx: AuthContext | null | undefined
): asserts ctx is AuthContext {
  if (!ctx) throw new UnauthorizedError('Authentication required');
}

export function assertPermission(
  ctx: AuthContext | null | undefined,
  ...perms: (PermissionCode | string)[]
): void {
  assertAuthenticated(ctx);
  for (const p of perms) {
    if (!hasPermission(ctx, p)) throw new ForbiddenError(`Missing permission: ${p}`);
  }
}

export function assertAnyPermission(
  ctx: AuthContext | null | undefined,
  perms: (PermissionCode | string)[]
): void {
  assertAuthenticated(ctx);
  if (!perms.some((p) => hasPermission(ctx, p))) {
    throw new ForbiddenError(`Requires any of: ${perms.join(', ')}`);
  }
}

export function assertRole(ctx: AuthContext | null | undefined, role: RoleCode): void {
  assertAuthenticated(ctx);
  if (!hasRole(ctx, role)) throw new ForbiddenError(`Requires role: ${role}`);
}

export function assertDataScope(
  ctx: AuthContext | null | undefined,
  scope_type: string,
  scope_value: string
): void {
  assertAuthenticated(ctx);
  if (ctx.roles.includes('super_admin')) return;
  if (!scopeAllows(ctx.data_scopes, scope_type, scope_value)) {
    throw new ForbiddenError(`Data scope '${scope_type}=${scope_value}' not granted`);
  }
}

/** Wrap an async function so it asserts a permission on its first arg (an AuthContext). */
export function withPermission<TArgs extends [AuthContext, ...unknown[]], R>(
  perm: PermissionCode | string,
  fn: (...args: TArgs) => Promise<R>
): (...args: TArgs) => Promise<R> {
  return async (...args: TArgs) => {
    assertPermission(args[0], perm);
    return fn(...args);
  };
}

export function withRole<TArgs extends [AuthContext, ...unknown[]], R>(
  role: RoleCode,
  fn: (...args: TArgs) => Promise<R>
): (...args: TArgs) => Promise<R> {
  return async (...args: TArgs) => {
    assertRole(args[0], role);
    return fn(...args);
  };
}
