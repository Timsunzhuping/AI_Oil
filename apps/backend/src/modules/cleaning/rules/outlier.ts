/**
 * Outlier detection helpers — pure math, no I/O, fully testable.
 *
 * Three methods:
 *   1. spec — value outside metric.expected_min / expected_max
 *   2. rule — declarative rules from cleaning_rules (via the rule engine)
 *   3. iqr  — Tukey IQR fence (Q1 - k*IQR, Q3 + k*IQR), k default 1.5
 *
 * The runner combines results from all three; a value is an outlier if
 * ANY method flags it.
 */

export interface OutlierResult {
  is_outlier: boolean;
  methods: string[];
  score: number | null;
  reasons: string[];
}

export interface SpecCheck {
  value: number;
  min: number | null | undefined;
  max: number | null | undefined;
}

/**
 * Spec-based check: outside [min, max].
 */
export function checkSpec({ value, min, max }: SpecCheck): { violated: boolean; reason?: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { violated: false };
  if (typeof min === 'number' && value < min) {
    return { violated: true, reason: `value ${value} below min ${min}` };
  }
  if (typeof max === 'number' && value > max) {
    return { violated: true, reason: `value ${value} above max ${max}` };
  }
  return { violated: false };
}

/**
 * Compute Q1, median, Q3 via the linear-interpolation method (the same
 * one numpy and most stats packages use). Returns nulls when the sample
 * is empty.
 */
export function quartiles(values: number[]): { q1: number; q2: number; q3: number } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p: number) => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  return { q1: pick(0.25), q2: pick(0.5), q3: pick(0.75) };
}

export interface IqrFence {
  lower: number;
  upper: number;
  q1: number;
  q3: number;
  iqr: number;
}

/**
 * Tukey fence with a configurable multiplier.
 * Returns null if the sample is too small (< minSamples) — in that case
 * IQR is statistically unreliable and we should skip the test.
 */
export function iqrFence(values: number[], opts: { multiplier?: number; minSamples?: number } = {}): IqrFence | null {
  const k = opts.multiplier ?? 1.5;
  const minSamples = opts.minSamples ?? 10;
  if (values.length < minSamples) return null;
  const q = quartiles(values);
  if (!q) return null;
  const iqr = q.q3 - q.q1;
  return {
    lower: q.q1 - k * iqr,
    upper: q.q3 + k * iqr,
    q1: q.q1,
    q3: q.q3,
    iqr,
  };
}

/**
 * Run the IQR check on a single value.
 * Returns is_outlier=false when the fence couldn't be computed (small sample).
 */
export function checkIqr(value: number, history: number[], opts?: { multiplier?: number; minSamples?: number }): {
  is_outlier: boolean;
  fence: IqrFence | null;
  score: number | null;     // |value - median| / IQR (rough magnitude)
  reason?: string;
} {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { is_outlier: false, fence: null, score: null };
  }
  const fence = iqrFence(history, opts);
  if (!fence) return { is_outlier: false, fence: null, score: null };
  const score = fence.iqr === 0 ? null : Math.abs(value - (fence.q1 + fence.q3) / 2) / fence.iqr;
  if (value < fence.lower) {
    return { is_outlier: true, fence, score, reason: `value ${value} < lower fence ${fence.lower.toFixed(2)}` };
  }
  if (value > fence.upper) {
    return { is_outlier: true, fence, score, reason: `value ${value} > upper fence ${fence.upper.toFixed(2)}` };
  }
  return { is_outlier: false, fence, score };
}
