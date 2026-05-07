/**
 * Auth adapter registry.
 *
 *   const registry = buildAuthRegistry({
 *     password: passwordAdapter,
 *     providers: { 'oidc:azure': azureAdapter, 'mock-sso': new MockSsoAdapter() },
 *   });
 *
 *   await registry.resolve(credentials);     // selects per `provider` hint
 */
import { UnauthorizedError } from '../../../lib/errors.js';
import { MockSsoAdapter } from './sso.js';
import type { AuthAdapter, ResolveCredentials, ResolvedPrincipal } from './types.js';

export interface AuthRegistryOptions {
  /** Default password adapter; required for password-mode logins. */
  password?: AuthAdapter;
  /** Map of named SSO providers; selected by `credentials.provider`. */
  providers?: Record<string, AuthAdapter>;
  /** Fallback adapter used when no provider hint is given AND no password is supplied. */
  defaultSso?: AuthAdapter;
}

export class AuthRegistry {
  constructor(private readonly opts: AuthRegistryOptions) {}

  async resolve(credentials: ResolveCredentials): Promise<ResolvedPrincipal> {
    if (credentials.password) {
      if (!this.opts.password) throw new UnauthorizedError('Password authentication is disabled');
      return this.opts.password.resolve(credentials);
    }
    if (credentials.sso_token) {
      const adapter = this.pickSso(credentials.provider);
      return adapter.resolve(credentials);
    }
    throw new UnauthorizedError('No credentials supplied');
  }

  list(): Array<{ kind: string; name: string }> {
    const out: Array<{ kind: string; name: string }> = [];
    if (this.opts.password)
      out.push({ kind: 'password', name: this.opts.password.identity().name });
    for (const [hint, a] of Object.entries(this.opts.providers ?? {})) {
      out.push({ kind: 'sso', name: `${hint}:${a.identity().name}` });
    }
    if (this.opts.defaultSso) {
      out.push({ kind: 'sso', name: `default:${this.opts.defaultSso.identity().name}` });
    }
    return out;
  }

  private pickSso(provider: string | undefined): AuthAdapter {
    if (provider && this.opts.providers?.[provider]) return this.opts.providers[provider]!;
    if (this.opts.defaultSso) return this.opts.defaultSso;
    throw new UnauthorizedError(
      provider ? `Unknown SSO provider '${provider}'` : 'No default SSO adapter registered'
    );
  }
}

export function buildAuthRegistry(opts: AuthRegistryOptions = {}): AuthRegistry {
  if (!opts.password && !opts.defaultSso && !opts.providers) {
    /* Sensible default: a mock SSO adapter so the platform isn't completely
     * unauthenticatable in DB-less smoke tests. Production wiring REQUIRES
     * an explicit password adapter. */
    return new AuthRegistry({ defaultSso: new MockSsoAdapter() });
  }
  return new AuthRegistry(opts);
}

export { PasswordAuthAdapter, hashPassword } from './password.js';
export { MockSsoAdapter, parseMockToken } from './sso.js';
export type { AuthAdapter, AuthIdentity, ResolveCredentials, ResolvedPrincipal } from './types.js';
