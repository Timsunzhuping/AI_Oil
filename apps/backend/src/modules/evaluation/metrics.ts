/**
 * Pure metric helpers used by every runner.
 *
 * All functions are deterministic, side-effect-free, and tested by
 * `tests/unit/evaluation/metrics.test.ts`. NaN-safety: helpers skip null /
 * non-finite inputs and degrade gracefully (return 0 / null where it makes
 * sense) so the pipeline doesn't crash on missing predictions.
 */

const EPS = 1e-9;

/** Mean absolute error. */
export function mae(values: Array<{ expected: number; predicted: number | null }>): number {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v.predicted === null || !Number.isFinite(v.predicted)) continue;
    sum += Math.abs(v.predicted - v.expected);
    n += 1;
  }
  return n === 0 ? 0 : sum / n;
}

/** Root mean square error. */
export function rmse(values: Array<{ expected: number; predicted: number | null }>): number {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v.predicted === null || !Number.isFinite(v.predicted)) continue;
    const e = v.predicted - v.expected;
    sum += e * e;
    n += 1;
  }
  return n === 0 ? 0 : Math.sqrt(sum / n);
}

/**
 * Mean absolute percentage error, in 0..1 (i.e. 0.05 = 5 %). Falls back to
 * absolute error / |epsilon| when the expected value is near zero so the
 * MAPE doesn't blow up to infinity on legitimate-but-tiny targets.
 */
export function mape(values: Array<{ expected: number; predicted: number | null }>): number {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v.predicted === null || !Number.isFinite(v.predicted)) continue;
    const denom = Math.abs(v.expected);
    if (denom < EPS) continue;
    sum += Math.abs((v.predicted - v.expected) / denom);
    n += 1;
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * Hit rate: fraction of values within (relative or absolute) tolerance.
 *
 *   |predicted - expected| / |expected| ≤ relTol  OR
 *   |predicted - expected| ≤ absTol
 */
export function hitRate(
  values: Array<{ expected: number; predicted: number | null }>,
  tolerance: { relative?: number; absolute?: number } = {}
): number {
  const rel = tolerance.relative ?? 0.1;
  const abs = tolerance.absolute ?? 0;
  let hits = 0;
  let n = 0;
  for (const v of values) {
    if (v.predicted === null || !Number.isFinite(v.predicted)) {
      n += 1;
      continue;
    }
    const err = Math.abs(v.predicted - v.expected);
    const denom = Math.abs(v.expected);
    const ok = (denom > EPS && err / denom <= rel) || err <= abs;
    if (ok) hits += 1;
    n += 1;
  }
  return n === 0 ? 0 : hits / n;
}

/** Whether a single (expected, predicted) pair is within tolerance. */
export function isHit(
  expected: number,
  predicted: number | null,
  tolerance: { relative?: number; absolute?: number } = {}
): boolean {
  if (predicted === null || !Number.isFinite(predicted)) return false;
  const rel = tolerance.relative ?? 0.1;
  const abs = tolerance.absolute ?? 0;
  const err = Math.abs(predicted - expected);
  const denom = Math.abs(expected);
  return (denom > EPS && err / denom <= rel) || err <= abs;
}

// ─── Stability helpers ─────────────────────────────────────────────────────

/** Cosine similarity of two equal-length numeric vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom < EPS ? 0 : dot / denom;
}

/**
 * Mean & min pairwise cosine similarity over a stack of vectors. Returns
 * `{ avg: 1, min: 1 }` when only one vector is supplied (trivially stable).
 */
export function pairwiseCosine(vectors: number[][]): { avg: number; min: number } {
  if (vectors.length <= 1) return { avg: 1, min: 1 };
  let sum = 0;
  let count = 0;
  let min = 1;
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      const s = cosineSimilarity(vectors[i] as number[], vectors[j] as number[]);
      sum += s;
      count += 1;
      if (s < min) min = s;
    }
  }
  return count === 0 ? { avg: 1, min: 1 } : { avg: sum / count, min };
}

/** Coefficient of variation σ / μ. Returns 0 when μ ≈ 0 to avoid blow-ups. */
export function coefficientOfVariation(values: number[]): number {
  if (values.length === 0) return 0;
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return 0;
  const mean = finite.reduce((s, v) => s + v, 0) / finite.length;
  if (Math.abs(mean) < EPS) return 0;
  let variance = 0;
  for (const v of finite) variance += (v - mean) ** 2;
  variance /= finite.length;
  const sd = Math.sqrt(variance);
  return sd / Math.abs(mean);
}

/**
 * Jaccard similarity between two sets (used for inverse-recommendation
 * candidate-set stability). Both inputs are treated as sets.
 */
export function jaccard<T>(a: Iterable<T>, b: Iterable<T>): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const v of sa) if (sb.has(v)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 1 : inter / union;
}

// ─── Percentage helpers (for headline numbers) ─────────────────────────────

export function passRate(passed: number, total: number): number {
  return total === 0 ? 0 : passed / total;
}

export function round4(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}
