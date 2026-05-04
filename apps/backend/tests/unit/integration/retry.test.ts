import { describe, it, expect } from 'vitest';
import {
  computeBackoffMs,
  nextRetryAt,
  shouldRetry,
} from '../../../src/modules/integration/retry.js';

describe('computeBackoffMs', () => {
  it('returns roughly base for attempt 1', () => {
    const ms = computeBackoffMs(1, { baseMs: 1000, jitterRatio: 0 });
    expect(ms).toBe(1000);
  });

  it('doubles per attempt up to the cap', () => {
    expect(computeBackoffMs(1, { baseMs: 1000, jitterRatio: 0 })).toBe(1000);
    expect(computeBackoffMs(2, { baseMs: 1000, jitterRatio: 0 })).toBe(2000);
    expect(computeBackoffMs(3, { baseMs: 1000, jitterRatio: 0 })).toBe(4000);
    expect(computeBackoffMs(4, { baseMs: 1000, jitterRatio: 0 })).toBe(8000);
  });

  it('caps at maxBackoffMs', () => {
    expect(computeBackoffMs(20, { baseMs: 1000, maxBackoffMs: 10_000, jitterRatio: 0 })).toBe(10_000);
  });

  it('jitter spreads across the range', () => {
    const samples = Array.from({ length: 50 }, () =>
      computeBackoffMs(2, { baseMs: 1000, jitterRatio: 0.5 })
    );
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(min).toBeLessThan(2000);
    expect(max).toBeGreaterThan(2000);
  });
});

describe('nextRetryAt', () => {
  it('returns a Date in the future', () => {
    const now = new Date();
    const next = nextRetryAt(now, 1, { baseMs: 60_000, jitterRatio: 0 });
    expect(next.getTime()).toBe(now.getTime() + 60_000);
  });
});

describe('shouldRetry', () => {
  it.each([
    [1, 3, true],
    [2, 3, true],
    [3, 3, false],
    [4, 3, false],
  ])('attempt %s of %s → %s', (attempt, max, expected) => {
    expect(shouldRetry(attempt, max)).toBe(expected);
  });
});
