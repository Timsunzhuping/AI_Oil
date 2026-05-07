import { describe, it, expect } from 'vitest';
import {
  AuthRegistry,
  buildAuthRegistry,
  hashPassword,
  MockSsoAdapter,
  parseMockToken,
  PasswordAuthAdapter,
} from '../../../src/modules/security/auth/index.js';
import type {
  PasswordRecord,
  PasswordRecordLookup,
} from '../../../src/modules/security/auth/password.js';
import { UnauthorizedError } from '../../../src/lib/errors.js';

class StaticLookup implements PasswordRecordLookup {
  constructor(private readonly records: PasswordRecord[]) {}
  async lookup(handle: string): Promise<PasswordRecord | null> {
    return (
      this.records.find(
        (r) =>
          r.email.toLowerCase() === handle.toLowerCase() ||
          r.username.toLowerCase() === handle.toLowerCase()
      ) ?? null
    );
  }
}

function record(input: {
  email: string;
  username: string;
  password: string;
  active?: boolean;
}): PasswordRecord {
  const salt = 'static-salt';
  const hash = hashPassword(input.password, salt, 'sha256-salt');
  return {
    external_id: `id-${input.email}`,
    email: input.email,
    username: input.username,
    password_hash: hash,
    password_algo: 'sha256-salt',
    is_active: input.active ?? true,
    salt,
  };
}

describe('PasswordAuthAdapter', () => {
  const lookup = new StaticLookup([
    record({ email: 'alice@example.com', username: 'alice', password: 's3cret' }),
  ]);
  const adapter = new PasswordAuthAdapter({ lookup });

  it('reports identity', () => {
    const i = adapter.identity();
    expect(i.mode).toBe('password');
    expect(i.name).toBe('password');
  });

  it('resolves correct credentials', async () => {
    const r = await adapter.resolve({ username: 'alice', password: 's3cret' });
    expect(r.email).toBe('alice@example.com');
    expect(r.adapter.mode).toBe('password');
  });

  it('rejects bad password', async () => {
    await expect(adapter.resolve({ username: 'alice', password: 'wrong' })).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });

  it('rejects unknown user', async () => {
    await expect(adapter.resolve({ username: 'bob', password: 'anything' })).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });

  it('rejects inactive accounts', async () => {
    const blocked = new PasswordAuthAdapter({
      lookup: new StaticLookup([
        record({ email: 'x@e.com', username: 'x', password: 'x', active: false }),
      ]),
    });
    await expect(blocked.resolve({ username: 'x', password: 'x' })).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });

  it('rejects empty credentials', async () => {
    await expect(adapter.resolve({})).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('MockSsoAdapter', () => {
  const adapter = new MockSsoAdapter();

  it('parses tokens of the form sso:<email>:<roles>', async () => {
    const r = await adapter.resolve({ sso_token: 'sso:alice@example.com:researcher,viewer' });
    expect(r.email).toBe('alice@example.com');
    expect(r.asserted_roles).toEqual(['researcher', 'viewer']);
    expect(r.adapter.mode).toBe('sso');
  });

  it('rejects malformed tokens', async () => {
    await expect(adapter.resolve({ sso_token: 'not-a-token' })).rejects.toThrow();
    await expect(adapter.resolve({ sso_token: 'sso:no-at' })).rejects.toThrow();
  });

  it('throws on demand for IdP-failure tests', async () => {
    const a = new MockSsoAdapter({ failureCounter: { remaining: 1 } });
    await expect(a.resolve({ sso_token: 'sso:alice@example.com' })).rejects.toThrow();
    const ok = await a.resolve({ sso_token: 'sso:alice@example.com' });
    expect(ok.email).toBe('alice@example.com');
  });

  it('parseMockToken splits roles cleanly', () => {
    expect(parseMockToken('sso:bob@example.com:role1,role2').roles).toEqual(['role1', 'role2']);
    expect(parseMockToken('sso:bob@example.com').roles).toEqual([]);
  });
});

describe('AuthRegistry', () => {
  const lookup = new StaticLookup([
    record({ email: 'alice@example.com', username: 'alice', password: 's3cret' }),
  ]);
  const password = new PasswordAuthAdapter({ lookup });
  const sso = new MockSsoAdapter({ name: 'sso:azure' });

  it('routes password credentials to the password adapter', async () => {
    const reg = new AuthRegistry({ password });
    const r = await reg.resolve({ username: 'alice', password: 's3cret' });
    expect(r.adapter.mode).toBe('password');
  });

  it('routes sso_token to the matching provider', async () => {
    const reg = new AuthRegistry({ password, providers: { 'sso:azure': sso } });
    const r = await reg.resolve({ sso_token: 'sso:bob@example.com', provider: 'sso:azure' });
    expect(r.adapter.mode).toBe('sso');
    expect(r.adapter.name).toBe('sso:azure');
  });

  it('falls back to defaultSso when no provider hint is supplied', async () => {
    const reg = new AuthRegistry({ password, defaultSso: sso });
    const r = await reg.resolve({ sso_token: 'sso:bob@example.com' });
    expect(r.adapter.mode).toBe('sso');
  });

  it('rejects when no credentials', async () => {
    const reg = new AuthRegistry({ password });
    await expect(reg.resolve({})).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects unknown provider hint', async () => {
    const reg = new AuthRegistry({ password });
    await expect(
      reg.resolve({ sso_token: 'sso:x@y.com', provider: 'ghost' })
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('list() reports registered adapters', () => {
    const reg = buildAuthRegistry({ password, providers: { 'sso:azure': sso } });
    const list = reg.list();
    expect(list.some((x) => x.kind === 'password')).toBe(true);
    expect(list.some((x) => x.kind === 'sso')).toBe(true);
  });
});
