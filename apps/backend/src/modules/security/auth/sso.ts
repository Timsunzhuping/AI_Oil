/**
 * SSO adapter scaffold.
 *
 * Concrete implementations bind to a vendor protocol (OIDC / SAML /
 * OAuth2 / corporate JWT / LDAP). Each implementation:
 *
 *   1. Verifies the supplied `sso_token` against the IdP (signature,
 *      audience, issuer, expiry, nonce / kid where applicable).
 *   2. Maps IdP claims → `ResolvedPrincipal` (email, username, full_name,
 *      asserted_roles).
 *
 * This file ships a `MockSsoAdapter` for tests and demos that:
 *   • accepts tokens shaped like `sso:<email>:<role1,role2>`
 *   • returns a deterministic principal derived from the token contents
 *
 * Real production deployments register their actual provider:
 *
 *   buildSecurityModule(pool, logger, {
 *     auth: { providers: { 'oidc:azure': new OidcAdapter({ … }) } }
 *   });
 */
import { UnauthorizedError } from '../../../lib/errors.js';
import type { AuthAdapter, AuthIdentity, ResolveCredentials, ResolvedPrincipal } from './types.js';

export interface MockSsoAdapterOptions {
  name?: string;
  version?: string;
  /** Force resolve() to throw — used to simulate IdP outages in tests. */
  failureCounter?: { remaining: number };
}

export class MockSsoAdapter implements AuthAdapter {
  private readonly opts: Required<Omit<MockSsoAdapterOptions, 'failureCounter'>> & {
    failureCounter?: { remaining: number };
  };

  constructor(opts: MockSsoAdapterOptions = {}) {
    this.opts = {
      name: opts.name ?? 'sso:mock',
      version: opts.version ?? 'v1',
      ...(opts.failureCounter ? { failureCounter: opts.failureCounter } : {}),
    };
  }

  identity(): AuthIdentity {
    return { name: this.opts.name, version: this.opts.version, mode: 'sso' };
  }

  async resolve(credentials: ResolveCredentials): Promise<ResolvedPrincipal> {
    const fc = this.opts.failureCounter;
    if (fc && fc.remaining > 0) {
      fc.remaining -= 1;
      throw new UnauthorizedError('mock SSO transient failure');
    }
    if (!credentials.sso_token) throw new UnauthorizedError('sso_token required');
    const parsed = parseMockToken(credentials.sso_token);
    return {
      external_id: parsed.email,
      email: parsed.email,
      username: parsed.email.split('@')[0] ?? parsed.email,
      claims: { token: credentials.sso_token, mode: 'mock-sso' },
      asserted_roles: parsed.roles,
      adapter: this.identity(),
    };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

interface ParsedToken {
  email: string;
  roles: string[];
}

/** Format: `sso:<email>[:role1,role2,...]`. */
export function parseMockToken(token: string): ParsedToken {
  if (!token.startsWith('sso:')) throw new UnauthorizedError('Malformed mock SSO token');
  const [, email, rolesPart] = token.split(':');
  if (!email || !email.includes('@')) throw new UnauthorizedError('Mock SSO token missing email');
  const roles = (rolesPart ?? '').split(',').filter(Boolean);
  return { email, roles };
}
