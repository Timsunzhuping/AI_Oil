/**
 * Seeded pseudo-random number generators for deterministic recommendation runs.
 *
 * `mulberry32` is a 32-bit-state PRNG with very fast period and good
 * distribution; sufficient for sampling BOM compositions during candidate
 * generation. The same seed always yields the same stream, so a saved task's
 * outputs are perfectly replayable.
 */

export interface Rng {
  /** Returns the next pseudo-random number in [0, 1). */
  next(): number;
  /** Integer in [lo, hi). */
  nextInt(lo: number, hi: number): number;
  /** Float in [lo, hi). */
  nextFloat(lo: number, hi: number): number;
  /** Pick one element from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates shuffle returning a new array. */
  shuffle<T>(items: readonly T[]): T[];
}

/** Build a deterministic RNG from a numeric seed. */
export function createRng(seed: number): Rng {
  let s = seed >>> 0 || 1;
  const next = (): number => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    nextInt(lo: number, hi: number): number {
      if (hi <= lo) throw new Error('nextInt requires hi > lo');
      return lo + Math.floor(next() * (hi - lo));
    },
    nextFloat(lo: number, hi: number): number {
      if (hi <= lo) throw new Error('nextFloat requires hi > lo');
      return lo + next() * (hi - lo);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('pick(): empty array');
      return items[Math.floor(next() * items.length)] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i] as T;
        out[i] = out[j] as T;
        out[j] = tmp;
      }
      return out;
    },
  };
}

/** Generate a fresh seed from the current high-resolution time + Math.random. */
export function fallbackSeed(): number {
  const t = Date.now() & 0xffffffff;
  const r = Math.floor(Math.random() * 0xffffffff);
  return (t ^ r) >>> 0;
}
