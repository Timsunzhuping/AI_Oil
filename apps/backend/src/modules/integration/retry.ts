/**
 * Retry / backoff strategy.
 *
 * Exponential backoff with full jitter:
 *   attempt 1 → fail → wait baseMs ± jitter
 *   attempt 2 → fail → wait baseMs * 2 ± jitter
 *   attempt 3 → fail → wait baseMs * 4 ± jitter
 *   ...
 *
 * Capped at `maxBackoffMs` (default 1 hour) so a stuck source can't push
 * its next retry to infinity.
 */
export interface BackoffOptions {
  baseMs: number;        // first retry delay (default 30 000)
  maxBackoffMs?: number; // upper bound (default 3 600 000 = 1 hour)
  jitterRatio?: number;  // 0..1; 0.2 = ±20%
}

export function computeBackoffMs(attemptNumber: number, opts: BackoffOptions): number {
  const base = Math.max(0, opts.baseMs);
  const max = opts.maxBackoffMs ?? 60 * 60 * 1000;
  const jitter = opts.jitterRatio ?? 0.2;

  const exponent = Math.max(0, attemptNumber - 1);
  const raw = base * Math.pow(2, exponent);
  const capped = Math.min(raw, max);

  // Symmetric jitter
  const delta = capped * jitter;
  const min = Math.max(0, capped - delta);
  return Math.round(min + Math.random() * (capped - min) * 2);
}

export function nextRetryAt(now: Date, attemptNumber: number, opts: BackoffOptions): Date {
  return new Date(now.getTime() + computeBackoffMs(attemptNumber, opts));
}

export function shouldRetry(attemptNumber: number, maxAttempts: number): boolean {
  return attemptNumber < maxAttempts;
}
