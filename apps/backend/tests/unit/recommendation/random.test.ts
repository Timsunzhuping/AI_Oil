import { describe, it, expect } from 'vitest';
import { createRng, fallbackSeed } from '../../../src/modules/recommendation/random.js';

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = [a.next(), a.next(), a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(42);
    const b = createRng(43);
    expect(a.next()).not.toEqual(b.next());
  });

  it('all values are in [0, 1)', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt(lo, hi) returns values in [lo, hi)', () => {
    const r = createRng(99);
    for (let i = 0; i < 200; i++) {
      const v = r.nextInt(5, 12);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(12);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('nextFloat(lo, hi) is bounded', () => {
    const r = createRng(2);
    for (let i = 0; i < 100; i++) {
      const v = r.nextFloat(-3.5, 4.5);
      expect(v).toBeGreaterThanOrEqual(-3.5);
      expect(v).toBeLessThan(4.5);
    }
  });

  it('shuffle returns a permutation deterministic for the seed', () => {
    const items = [1, 2, 3, 4, 5];
    const a = createRng(11).shuffle(items);
    const b = createRng(11).shuffle(items);
    expect(a).toEqual(b);
    expect(a.slice().sort()).toEqual(items);
    // Doesn't mutate input
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });

  it('pick returns an element from the array', () => {
    const r = createRng(3);
    const picked = r.pick(['a', 'b', 'c']);
    expect(['a', 'b', 'c']).toContain(picked);
  });

  it('fallbackSeed returns a non-negative 32-bit integer', () => {
    const s = fallbackSeed();
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(2 ** 32);
  });
});
