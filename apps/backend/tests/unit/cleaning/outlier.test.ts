import { describe, it, expect } from 'vitest';
import { checkSpec, quartiles, iqrFence, checkIqr } from '../../../src/modules/cleaning/rules/outlier.js';

describe('checkSpec', () => {
  it('passes a value inside spec', () => {
    expect(checkSpec({ value: 5, min: 0, max: 10 }).violated).toBe(false);
  });
  it('flags below min', () => {
    const r = checkSpec({ value: -1, min: 0, max: 10 });
    expect(r.violated).toBe(true);
    expect(r.reason).toContain('below min');
  });
  it('flags above max', () => {
    const r = checkSpec({ value: 11, min: 0, max: 10 });
    expect(r.violated).toBe(true);
    expect(r.reason).toContain('above max');
  });
  it('returns false when value is non-numeric', () => {
    expect(checkSpec({ value: NaN, min: 0, max: 10 }).violated).toBe(false);
  });
  it('passes when min/max are null', () => {
    expect(checkSpec({ value: 1e9, min: null, max: null }).violated).toBe(false);
  });
});

describe('quartiles', () => {
  it('returns null for empty', () => {
    expect(quartiles([])).toBeNull();
  });
  it('matches numpy/scipy linear interpolation', () => {
    // For 1..9 → q1=3, median=5, q3=7
    const q = quartiles([1, 2, 3, 4, 5, 6, 7, 8, 9])!;
    expect(q.q1).toBe(3);
    expect(q.q2).toBe(5);
    expect(q.q3).toBe(7);
  });
});

describe('iqrFence', () => {
  it('returns null when sample is too small', () => {
    expect(iqrFence([1, 2, 3])).toBeNull();
    expect(iqrFence([1, 2, 3, 4, 5, 6, 7, 8, 9], { minSamples: 10 })).toBeNull();
  });

  it('computes a 1.5x fence by default', () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const f = iqrFence(samples)!;
    // q1 ~ 3.25, q3 ~ 7.75, IQR = 4.5, lower = -3.5, upper = 14.5
    expect(f.q1).toBeCloseTo(3.25);
    expect(f.q3).toBeCloseTo(7.75);
    expect(f.iqr).toBeCloseTo(4.5);
    expect(f.lower).toBeCloseTo(-3.5);
    expect(f.upper).toBeCloseTo(14.5);
  });
});

describe('checkIqr', () => {
  const history = Array.from({ length: 50 }, (_, i) => i + 1); // 1..50

  it('does not flag values inside the fence', () => {
    expect(checkIqr(25, history).is_outlier).toBe(false);
  });

  it('flags values above the upper fence', () => {
    const r = checkIqr(1000, history);
    expect(r.is_outlier).toBe(true);
    expect(r.score).toBeGreaterThan(0);
    expect(r.reason).toContain('upper fence');
  });

  it('flags values below the lower fence', () => {
    const r = checkIqr(-500, history);
    expect(r.is_outlier).toBe(true);
    expect(r.reason).toContain('lower fence');
  });

  it('returns is_outlier=false when sample is too small (no fence)', () => {
    const r = checkIqr(99999, [1, 2, 3]);
    expect(r.is_outlier).toBe(false);
    expect(r.fence).toBeNull();
  });

  it('handles non-numeric value gracefully', () => {
    const r = checkIqr(NaN, history);
    expect(r.is_outlier).toBe(false);
    expect(r.score).toBeNull();
  });
});
