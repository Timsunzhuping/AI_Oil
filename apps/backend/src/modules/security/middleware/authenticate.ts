/**
 * Authenticate middleware.
 *
 * Resolves the bearer token in `Authorization: Bearer <token>` (or the
 * `x-fluidmind-token` header) to a `req.user: AuthContext`. Unauthenticated
 * requests are LET THROUGH — `requirePermission` / `requireRole` actually
 * reject. This split lets routes that intentionally allow anonymous access
 * (e.g. `/health`) coexist with strict ones.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Logger } from 'pino';
import type { SecurityRepository } from '../repository.js';
import type { AuthContext, RoleCode, PermissionCode } from '../types.js';
import { setContextValue } from '../../../lib/context.js';

const TOKEN_HEADERS = ['authorization', 'x-fluidmind-token'] as const;

export interface AuthenticateOptions {
  repository: SecurityRepository;
  logger: Logger;
  /**
   * Optional impersonation header — admin tools set
   * `x-fluidmind-impersonate: <user_id>`. The actual permission check is
   * done elsewhere; this middleware just propagates the value.
   */
  allowImpersonationHeader?: boolean;
}

export function authenticate(opts: AuthenticateOptions): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = extractToken(req);
    if (!token) return next();

    try {
      const session = await opts.repository.findActiveSessionByToken(token);
      if (!session) return next();
      const user = await opts.repository.findUserById(session.user_id);
      if (!user || !user.is_active) return next();

      const [roles, permissions, scopes] = await Promise.all([
        opts.repository.listUserRoles(session.user_id),
        opts.repository.listUserPermissions(session.user_id),
        opts.repository.listScopesFor(session.user_id),
      ]);

      const roleCodes = roles.map((r) => r.code) as RoleCode[];
      const permCodes = permissions as PermissionCode[];

      const ctx: AuthContext = {
        user_id: user.id,
        username: user.username,
        email: user.email,
        roles: roleCodes,
        permissions: permCodes,
        data_scopes: scopes,
        session_id: session.id,
        ...(opts.allowImpersonationHeader && req.headers['x-fluidmind-impersonate']
          ? { impersonator_id: String(req.headers['x-fluidmind-impersonate']) }
          : {}),
        claims: {},
      };
      req.user = ctx;
      // Propagate user_id through AsyncLocalStorage so deep async callees
      // (e.g. logger mixin) automatically tag log lines.
      setContextValue('userId', user.id);
    } catch (err) {
      opts.logger.warn({ err }, 'authenticate middleware error');
    }
    next();
  };
}

function extractToken(req: Request): string | null {
  for (const h of TOKEN_HEADERS) {
    const v = req.headers[h];
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed.toLowerCase().startsWith('bearer ')) return trimmed.slice(7).trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}
