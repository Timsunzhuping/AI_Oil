/**
 * Action-level / role-level / data-scope guards.
 *
 *   router.post('/predict/single', requirePermission('predict:execute'), …);
 *   router.post('/ml/release',     requireAnyRole(['model_admin', 'super_admin']), …);
 *
 * `requireDataScope` drops list endpoints into a per-user scope sieve — the
 * route hands a callback that filters the result rows once the request
 * reaches the repository.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ForbiddenError, UnauthorizedError } from '../../../lib/errors.js';
import {
  type AuthContext,
  type DataScopeGrant,
  type PermissionCode,
  type RoleCode,
} from '../types.js';

export function requirePermission(...codes: (PermissionCode | string)[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const ctx = requireUser(req);
    if (ctx.roles.includes('super_admin')) return next();
    const granted = new Set(ctx.permissions);
    const missing = codes.filter((c) => !granted.has(c as PermissionCode));
    if (missing.length > 0) {
      return next(new ForbiddenError(`Missing permission(s): ${missing.join(', ')}`));
    }
    next();
  };
}

export function requireAnyPermission(...codes: (PermissionCode | string)[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const ctx = requireUser(req);
    if (ctx.roles.includes('super_admin')) return next();
    const granted = new Set(ctx.permissions);
    if (codes.some((c) => granted.has(c as PermissionCode))) return next();
    next(new ForbiddenError(`Requires any of: ${codes.join(', ')}`));
  };
}

export function requireRole(role: RoleCode): RequestHandler {
  return (req, _res, next) => {
    const ctx = requireUser(req);
    if (ctx.roles.includes(role) || ctx.roles.includes('super_admin')) return next();
    next(new ForbiddenError(`Requires role: ${role}`));
  };
}

export function requireAnyRole(roles: RoleCode[]): RequestHandler {
  return (req, _res, next) => {
    const ctx = requireUser(req);
    if (ctx.roles.includes('super_admin')) return next();
    if (roles.some((r) => ctx.roles.includes(r))) return next();
    next(new ForbiddenError(`Requires any of roles: ${roles.join(', ')}`));
  };
}

/**
 * Data-scope guard. Each user's data_scopes list is matched against the
 * request — the caller supplies an extractor function that pulls the
 * `(scope_type, scope_value)` from the request and a strategy:
 *   • 'allow_unrestricted' (default): users with NO scope grants of this type
 *     get access to ALL values (i.e. scope is opt-in)
 *   • 'deny_unrestricted': users without an explicit grant are blocked
 */
export interface DataScopeGuardOptions {
  scope_type: string;
  /** Pull the requested scope_value from the request (query, body, params). */
  extract: (req: Request) => string | null | undefined;
  strategy?: 'allow_unrestricted' | 'deny_unrestricted';
}

export function requireDataScope(opts: DataScopeGuardOptions): RequestHandler {
  return (req, _res, next) => {
    const ctx = requireUser(req);
    if (ctx.roles.includes('super_admin')) return next();
    const requested = opts.extract(req);
    if (requested === null || requested === undefined || requested === '') return next();
    const grants = ctx.data_scopes.filter((g) => g.scope_type === opts.scope_type);
    if (grants.length === 0) {
      if (opts.strategy === 'deny_unrestricted') {
        return next(
          new ForbiddenError(`Data scope '${opts.scope_type}' requires an explicit grant`)
        );
      }
      return next();
    }
    if (grants.some((g) => g.scope_value === '*' || g.scope_value === requested)) return next();
    next(new ForbiddenError(`Data scope '${opts.scope_type}=${requested}' not granted`));
  };
}

// ─── Pure helpers (exported for tests) ──────────────────────────────────────

export function hasPermission(ctx: AuthContext, perm: PermissionCode | string): boolean {
  if (ctx.roles.includes('super_admin')) return true;
  return ctx.permissions.includes(perm as PermissionCode);
}

export function hasRole(ctx: AuthContext, role: RoleCode): boolean {
  return ctx.roles.includes(role) || ctx.roles.includes('super_admin');
}

export function scopeAllows(
  scopes: DataScopeGrant[],
  scope_type: string,
  scope_value: string
): boolean {
  const grants = scopes.filter((g) => g.scope_type === scope_type);
  if (grants.length === 0) return true; // allow_unrestricted default
  return grants.some((g) => g.scope_value === '*' || g.scope_value === scope_value);
}

function requireUser(req: Request): AuthContext {
  if (!req.user) throw new UnauthorizedError('Authentication required');
  return req.user;
}
