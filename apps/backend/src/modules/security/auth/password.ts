/**
 * Password-based auth adapter.
 *
 * Verifies the supplied credential against `users.password_hash`. We use
 * a constant-time comparison and SHA-256 + salt as a stand-in for bcrypt /
 * argon2id (the existing schema declares `password_algo` so production
 * deployments can swap in a real KDF without altering the contract).
 *
 * Real production deployments should:
 *   1. Replace `hashPassword()` with @node-rs/argon2 / @phc/argon2 / bcrypt.
 *   2. Enforce password policies (length / blacklist / breach check) at the
 *      registration / change-password endpoint, NOT here.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { UnauthorizedError } from '../../../lib/errors.js';
import type { AuthAdapter, AuthIdentity, ResolveCredentials, ResolvedPrincipal } from './types.js';

export interface PasswordRecord {
  external_id: string; // user.id
  email: string;
  username: string;
  full_name?: string | null;
  password_hash: string;
  password_algo: 'sha256-salt' | 'argon2id' | 'bcrypt';
  is_active: boolean;
  /** Salt prefix for `sha256-salt` algorithm. */
  salt?: string;
}

export interface PasswordRecordLookup {
  /** Resolve a user by email or username; return null when not found. */
  lookup(usernameOrEmail: string): Promise<PasswordRecord | null>;
}

export interface PasswordAuthAdapterOptions {
  lookup: PasswordRecordLookup;
  /** Default algorithm for hashing newly-created passwords (caller's choice). */
  defaultAlgo?: 'sha256-salt' | 'argon2id' | 'bcrypt';
}

export class PasswordAuthAdapter implements AuthAdapter {
  constructor(private readonly opts: PasswordAuthAdapterOptions) {}

  identity(): AuthIdentity {
    return { name: 'password', version: 'v1', mode: 'password' };
  }

  async resolve(credentials: ResolveCredentials): Promise<ResolvedPrincipal> {
    const handle = (credentials.email ?? credentials.username ?? '').trim();
    if (!handle || !credentials.password) throw new UnauthorizedError('Credentials required');

    const record = await this.opts.lookup.lookup(handle);
    if (!record || !record.is_active) throw new UnauthorizedError('Invalid credentials');

    const match = await verify(record, credentials.password);
    if (!match) throw new UnauthorizedError('Invalid credentials');

    return {
      external_id: record.external_id,
      email: record.email,
      username: record.username,
      ...(record.full_name ? { full_name: record.full_name } : {}),
      claims: {},
      adapter: this.identity(),
    };
  }
}

// ─── helpers (exported for tests) ───────────────────────────────────────────

export function hashPassword(
  plain: string,
  salt: string,
  algo: PasswordRecord['password_algo'] = 'sha256-salt'
): string {
  if (algo !== 'sha256-salt') {
    throw new Error(
      `hashPassword: algo '${algo}' is not implemented in this stub; bring your own KDF.`
    );
  }
  return createHash('sha256').update(`${salt}|${plain}`).digest('hex');
}

async function verify(record: PasswordRecord, plain: string): Promise<boolean> {
  if (record.password_algo === 'sha256-salt') {
    if (!record.salt) return false;
    const h = hashPassword(plain, record.salt, 'sha256-salt');
    if (h.length !== record.password_hash.length) return false;
    return timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(record.password_hash, 'hex'));
  }
  /* Real adapters override this. */
  throw new UnauthorizedError(`Unsupported password algorithm '${record.password_algo}'`);
}
