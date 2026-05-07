/**
 * Authentication adapter contract.
 *
 * The platform supports three authentication paths today:
 *   • password — username/email + password (default)
 *   • sso     — vendor-issued bearer / id_token; verified by an SsoAdapter
 *   • impersonation — admin-only endpoint (not implemented in MVP)
 *
 * Each adapter resolves a request into a `ResolvedPrincipal`. The service
 * layer takes that and:
 *   1. ensures a `users` row exists (creates / links on SSO first-touch)
 *   2. issues a session and writes an audit row
 *
 * Concrete SSO providers (OIDC / SAML / OAuth2 / LDAP / corporate JWT)
 * implement `AuthAdapter` and register themselves with the factory; the
 * service simply asks `registry.resolve(provider)`.
 */

export interface AuthIdentity {
  /** Stable adapter name (`'password' | 'oidc:azure-ad' | 'saml:keycloak' | …`). */
  name: string;
  version: string;
  mode: 'password' | 'sso' | 'impersonation' | 'system';
}

export interface ResolveCredentials {
  username?: string;
  email?: string;
  password?: string;
  sso_token?: string;
  /** Provider hint when multiple SSO adapters are registered. */
  provider?: string;
  /** Forwarded for auditing. */
  ip_address?: string;
  user_agent?: string;
  trace_id?: string;
}

export interface ResolvedPrincipal {
  /** Stable external identifier (email by default; SSO sub claim otherwise). */
  external_id: string;
  email: string;
  username: string;
  full_name?: string;
  /** Roles asserted by the IdP — additive on top of DB role assignments. */
  asserted_roles?: string[];
  /** Free-form passthrough; persisted into qa_sessions.metadata when the
   * session is created and into audit_logs.metadata. */
  claims?: Record<string, unknown>;
  /** Adapter identity used for audit. */
  adapter: AuthIdentity;
}

export interface AuthAdapter {
  identity(): AuthIdentity;
  /** Resolve a login attempt. THROWS on bad credentials / invalid token. */
  resolve(credentials: ResolveCredentials): Promise<ResolvedPrincipal>;
}
