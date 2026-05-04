import { describe, it, expect } from 'vitest';
import {
  requestContext,
  getContext,
  getTraceId,
  getUserId,
  withContext,
  setContextValue,
} from '../../src/lib/context.js';

describe('AsyncLocalStorage request context', () => {
  it('returns undefined outside any context', () => {
    expect(getContext()).toBeUndefined();
    expect(getTraceId()).toBeUndefined();
    expect(getUserId()).toBeUndefined();
  });

  it('exposes ctx values inside withContext()', () => {
    withContext({ traceId: 'abc', startTime: 1, userId: 'u1' }, () => {
      expect(getTraceId()).toBe('abc');
      expect(getUserId()).toBe('u1');
      expect(getContext()?.startTime).toBe(1);
    });
  });

  it('isolates contexts between concurrent runs', async () => {
    const results: string[] = [];

    await Promise.all([
      requestContext.run({ traceId: 'A', startTime: 0 }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        results.push(getTraceId() ?? '?');
      }),
      requestContext.run({ traceId: 'B', startTime: 0 }, async () => {
        await new Promise((r) => setTimeout(r, 1));
        results.push(getTraceId() ?? '?');
      }),
    ]);

    expect(results.sort()).toEqual(['A', 'B']);
  });

  it('setContextValue mutates the active store', () => {
    withContext({ traceId: 't', startTime: 0 }, () => {
      setContextValue('userId', 'u-42');
      expect(getUserId()).toBe('u-42');
    });
  });
});
