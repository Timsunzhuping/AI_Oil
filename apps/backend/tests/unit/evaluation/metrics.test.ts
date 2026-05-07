import { describe, it, expect } from 'vitest';
import {
  coefficientOfVariation,
  cosineSimilarity,
  hitRate,
  isHit,
  jaccard,
  mae,
  mape,
  pairwiseCosine,
  passRate,
  rmse,
  round4,
} from '../../../src/modules/evaluation/metrics.js';

describe('mae / rmse / mape', () => {
  const pairs = [
    { expected: 10, predicted: 11 },
    { expected: 20, predicted: 18 },
    { expected: 30, predicted: 33 },
  ];
  it('mae averages absolute errors', () => {
    expect(mae(pairs)).toBeCloseTo((1 + 2 + 3) / 3, 6);
  });
  it('rmse is RMS of errors', () => {
    expect(rmse(pairs)).toBeCloseTo(Math.sqrt((1 + 4 + 9) / 3), 6);
  });
  it('mape averages relative errors', () => {
    expect(mape(pairs)).toBeCloseTo((0.1 + 0.1 + 0.1) / 3, 5);
  });
  it('skips null predictions', () => {
    const withNull = [...pairs, { expected: 5, predicted: null }];
    expect(mae(withNull)).toBeCloseTo(mae(pairs), 6);
  });
  it('mae returns 0 for empty input', () => {
    expect(mae([])).toBe(0);
    expect(rmse([])).toBe(0);
    expect(mape([])).toBe(0);
  });
});

describe('hitRate / isHit', () => {
  it('counts within relative tolerance', () => {
    const r = hitRate(
      [
        { expected: 100, predicted: 105 },
        { expected: 100, predicted: 120 },
      ],
      { relative: 0.1 }
    );
    expect(r).toBeCloseTo(0.5, 5);
  });
  it('falls back to absolute tolerance when expected≈0', () => {
    expect(isHit(0, 0.05, { relative: 0.1, absolute: 0.1 })).toBe(true);
  });
  it('counts null predictions as misses', () => {
    expect(hitRate([{ expected: 10, predicted: null }], { relative: 0.1 })).toBe(0);
  });
});

describe('cosineSimilarity / pairwiseCosine', () => {
  it('identical vectors → 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  it('orthogonal vectors → 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
  it('returns 0 for length mismatch', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
  it('pairwiseCosine returns avg + min', () => {
    const r = pairwiseCosine([
      [1, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    expect(r.avg).toBeCloseTo((1 + 0 + 0) / 3, 6);
    expect(r.min).toBe(0);
  });
  it('singleton vector list is trivially stable', () => {
    expect(pairwiseCosine([[1, 2]])).toEqual({ avg: 1, min: 1 });
  });
});

describe('coefficientOfVariation', () => {
  it('zero variance → 0', () => {
    expect(coefficientOfVariation([5, 5, 5])).toBe(0);
  });
  it('returns 0 when mean ≈ 0 to avoid blow-up', () => {
    expect(coefficientOfVariation([0, 0, 0])).toBe(0);
  });
  it('matches manual computation', () => {
    const xs = [10, 12, 8, 11, 9];
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    const variance = xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length;
    const expected = Math.sqrt(variance) / mean;
    expect(coefficientOfVariation(xs)).toBeCloseTo(expected, 6);
  });
});

describe('jaccard', () => {
  it('identical sets → 1', () => {
    expect(jaccard([1, 2, 3], [3, 2, 1])).toBe(1);
  });
  it('disjoint sets → 0', () => {
    expect(jaccard([1, 2], [3, 4])).toBe(0);
  });
  it('partial overlap', () => {
    expect(jaccard([1, 2, 3], [2, 3, 4])).toBeCloseTo(2 / 4, 6);
  });
  it('empty sets → 1', () => {
    expect(jaccard([], [])).toBe(1);
  });
});

describe('passRate / round4', () => {
  it('passRate handles zero total', () => {
    expect(passRate(0, 0)).toBe(0);
    expect(passRate(3, 4)).toBe(0.75);
  });
  it('round4 keeps four decimals', () => {
    expect(round4(0.123456)).toBe(0.1235);
    expect(round4(NaN)).toBe(0);
  });
});
