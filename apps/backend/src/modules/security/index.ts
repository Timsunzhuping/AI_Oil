/**
 * Security / RBAC / audit module factory.
 *
 *   const security = buildSecurityModule(pool, logger, {
 *     auth: {
 *       password: new PasswordAuthAdapter({ lookup: repo }),
 *       providers: { 'oidc:azure': new MyOidcAdapter() },
 *     },
 *     defaultWatermarkText: 'CONFIDENTIAL — FluidMind R&D',
 *   });
 *   v1.use(security.authenticateMiddleware);
 *   v1.use('/security', security.router);
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { buildAuthRegistry, type AuthRegistryOptions, type AuthAdapter } from './auth/index.js';
import { PasswordAuthAdapter } from './auth/password.js';
import { AuditRecorder } from './audit.js';
import { authenticate } from './middleware/authenticate.js';
import { SecurityRepository } from './repository.js';
import { buildSecurityRouter } from './routes.js';
import { SecurityService } from './service.js';

export interface BuildSecurityModuleOptions {
  /** Auth registry options. When omitted, an internal default is built. */
  auth?: AuthRegistryOptions;
  /** Override session TTL (default 12 h). */
  sessionTtlMs?: number;
  /** Highest classification that auto-approves (default 'internal'). */
  autoApproveBelowClassification?: 'public' | 'internal';
  /** Default watermark text applied on approved exports. */
  defaultWatermarkText?: string;
  /** Inject a fully-built audit recorder (tests). */
  audit?: AuditRecorder;
}

export function buildSecurityModule(
  pool: Pool,
  logger: Logger,
  opts: BuildSecurityModuleOptions = {}
) {
  const repository = new SecurityRepository(pool);
  /* If the caller didn't supply a password adapter we wire one against the
   * repository's lookup method automatically — turns on password login by
   * default but keeps it pluggable for SSO-only deployments. */
  const password: AuthAdapter =
    opts.auth?.password ?? new PasswordAuthAdapter({ lookup: repository });
  const authReg = buildAuthRegistry({
    password,
    ...(opts.auth?.providers !== undefined ? { providers: opts.auth.providers } : {}),
    ...(opts.auth?.defaultSso !== undefined ? { defaultSso: opts.auth.defaultSso } : {}),
  });
  const audit = opts.audit ?? new AuditRecorder(repository, logger);
  const service = new SecurityService({
    repository,
    auth: authReg,
    audit,
    logger,
    ...(opts.sessionTtlMs !== undefined ? { sessionTtlMs: opts.sessionTtlMs } : {}),
    ...(opts.autoApproveBelowClassification !== undefined
      ? { autoApproveBelowClassification: opts.autoApproveBelowClassification }
      : {}),
    ...(opts.defaultWatermarkText !== undefined
      ? { defaultWatermarkText: opts.defaultWatermarkText }
      : {}),
  });
  const router = buildSecurityRouter(service);
  const authenticateMiddleware = authenticate({
    repository,
    logger,
    allowImpersonationHeader: true,
  });
  return { repository, audit, auth: authReg, service, router, authenticateMiddleware };
}

export { SecurityService } from './service.js';
export { SecurityRepository } from './repository.js';
export { AuditRecorder, computeChanges } from './audit.js';
export {
  authenticate,
  requirePermission,
  requireAnyPermission,
  requireRole,
  requireAnyRole,
  requireDataScope,
  hasPermission,
  hasRole,
  scopeAllows,
} from './middleware/index.js';
export {
  assertAuthenticated,
  assertPermission,
  assertAnyPermission,
  assertRole,
  assertDataScope,
  withPermission,
  withRole,
} from './decorators.js';
export {
  PasswordAuthAdapter,
  MockSsoAdapter,
  buildAuthRegistry,
  hashPassword,
  parseMockToken,
} from './auth/index.js';
export type {
  AuthAdapter,
  AuthIdentity,
  ResolveCredentials,
  ResolvedPrincipal,
} from './auth/index.js';
export { buildMenu } from './menu.js';
export {
  ROLE_CODES,
  PERMISSION_CODES,
  AUDIT_ACTIONS,
  EXPORT_FORMATS,
  EXPORT_APPROVAL_STATUSES,
  CLASSIFICATIONS,
  ASSET_TYPES,
  ASSET_STATUSES,
} from './types.js';
export type * from './types.js';
