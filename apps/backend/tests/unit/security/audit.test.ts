import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { AuditRecorder, computeChanges } from '../../../src/modules/security/audit.js';
import { FakeSecurityRepository } from './_fakes.js';
import type { SecurityRepository } from '../../../src/modules/security/repository.js';

const logger = pino({ level: 'silent' });

describe('computeChanges', () => {
  it('returns null when both sides are null', () => {
    expect(computeChanges(null, null)).toBeNull();
  });
  it('detects changed scalar fields', () => {
    const r = computeChanges({ a: 1, b: 2 }, { a: 1, b: 3 });
    expect(r).toEqual({ b: { from: 2, to: 3 } });
  });
  it('detects added fields', () => {
    const r = computeChanges({ a: 1 }, { a: 1, c: 5 });
    expect(r).toEqual({ c: { from: null, to: 5 } });
  });
  it('returns null when no changes', () => {
    expect(computeChanges({ a: 1 }, { a: 1 })).toBeNull();
  });
  it('compares nested objects via JSON stringify', () => {
    expect(computeChanges({ x: { a: 1 } }, { x: { a: 1 } })).toBeNull();
    expect(computeChanges({ x: { a: 1 } }, { x: { a: 2 } })).toEqual({
      x: { from: { a: 1 }, to: { a: 2 } },
    });
  });
});

describe('AuditRecorder', () => {
  it('writes a row with the diff computed', async () => {
    const repo = new FakeSecurityRepository();
    const audit = new AuditRecorder(repo as unknown as SecurityRepository, logger);
    await audit.record({
      action: 'formula_modification',
      resource_type: 'formula',
      resource_id: 'f-1',
      resource_label: '5W-30 baseline',
      before_state: { v: 1 },
      after_state: { v: 2 },
      ctx: { trace_id: 't-1', user_id: 'u-1' },
    });
    expect(repo.audit).toHaveLength(1);
    expect(repo.audit[0]!.action).toBe('formula_modification');
    expect(repo.audit[0]!.changes).toEqual({ v: { from: 1, to: 2 } });
  });

  it('event() shortcut writes role-less events', async () => {
    const repo = new FakeSecurityRepository();
    const audit = new AuditRecorder(repo as unknown as SecurityRepository, logger);
    await audit.event('login', { trace_id: 't-1', user_id: 'u-1' }, { resource_type: 'session' });
    expect(repo.audit[0]!.action).toBe('login');
  });

  it('survives DB failures (returns null instead of throwing)', async () => {
    const repo = new FakeSecurityRepository();
    repo.insertAudit = (async () => {
      throw new Error('db down');
    }) as never;
    const audit = new AuditRecorder(repo as unknown as SecurityRepository, logger);
    const r = await audit.record({
      action: 'login',
      resource_type: 'session',
      ctx: { trace_id: 't-1', user_id: 'u-1' },
    });
    expect(r).toBeNull();
  });
});
