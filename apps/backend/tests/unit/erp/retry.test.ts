import { describe, it, expect, vi } from 'vitest';
import { computeBackoffMs, withRetry } from '../../../src/modules/erp/retry.js';

describe('computeBackoffMs', () => {
  it('grows exponentially before the cap', () => {
    const a = computeBackoffMs(1, { baseMs: 100, jitterRatio: 0 });
    const b = computeBackoffMs(2, { baseMs: 100, jitterRatio: 0 });
    const c = computeBackoffMs(3, { baseMs: 100, jitterRatio: 0 });
    expect(a).toBe(100);
    expect(b).toBe(200);
    expect(c).toBe(400);
  });

  it('respects the upper bound', () => {
    const v = computeBackoffMs(20, { baseMs: 100, maxBackoffMs: 1000, jitterRatio: 0 });
    expect(v).toBe(1000);
  });

  it('applies symmetric jitter inside ±jitterRatio', () => {
    for (let i = 0; i < 50; i++) {
      const v = computeBackoffMs(2, { baseMs: 1000, jitterRatio: 0.2 });
      expect(v).toBeGreaterThanOrEqual(1600);
      expect(v).toBeLessThanOrEqual(2400);
    }
  });
});

describe('withRetry', () => {
  it('succeeds on the first attempt when fn does', async () => {
    const fn = vi.fn(async () => 42);
    const r = await withRetry(fn);
    expect(r).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure up to maxAttempts', async () => {
    let calls = 0;
    const sleep = vi.fn(async () => {});
    const r = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('flaky');
        return 'ok';
      },
      { maxAttempts: 3, sleep }
    );
    expect(r).toBe('ok');
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('throws the last error when all attempts fail', async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error(`err-${calls}`);
        },
        { maxAttempts: 3, sleep }
      )
    ).rejects.toThrow(/err-3/);
    expect(calls).toBe(3);
  });

  it('invokes onAttempt and onFailure hooks', async () => {
    const onAttempt = vi.fn();
    const onFailure = vi.fn();
    const sleep = vi.fn(async () => {});
    let calls = 0;
    await withRetry(
      async () => {
        calls += 1;
        if (calls < 2) throw new Error('once');
        return 'ok';
      },
      { maxAttempts: 3, sleep, hooks: { onAttempt, onFailure } }
    );
    expect(onAttempt).toHaveBeenCalledTimes(2);
    expect(onAttempt).toHaveBeenNthCalledWith(1, 1);
    expect(onAttempt).toHaveBeenNthCalledWith(2, 2);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]![2]).toBe(true); // willRetry
  });
});
