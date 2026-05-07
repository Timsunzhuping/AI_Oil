/**
 * Retry helper used by the ERP service.
 *
 * Exponential backoff with full jitter, capped at `maxBackoffMs`. Same
 * shape as `modules/integration/retry.ts` but with a smaller default base
 * (200 ms) tuned for synchronous business endpoints rather than long-haul
 * batch syncs.
 */

export interface BackoffOptions {
  baseMs?: number; // default 200
  maxBackoffMs?: number; // default 30 000
  jitterRatio?: number; // default 0.2
}

export function computeBackoffMs(attemptNumber: number, opts: BackoffOptions = {}): number {
  const base = Math.max(0, opts.baseMs ?? 200);
  const max = opts.maxBackoffMs ?? 30_000;
  const jitter = opts.jitterRatio ?? 0.2;
  const exponent = Math.max(0, attemptNumber - 1);
  const raw = base * Math.pow(2, exponent);
  const capped = Math.min(raw, max);
  const delta = capped * jitter;
  const min = Math.max(0, capped - delta);
  return Math.round(min + Math.random() * (capped - min) * 2);
}

export interface RetryHooks {
  /** Called BEFORE every attempt (including the first). */
  onAttempt?: (attempt: number) => void | Promise<void>;
  /** Called when an attempt FAILS (before backoff). */
  onFailure?: (attempt: number, err: unknown, willRetry: boolean) => void | Promise<void>;
}

export interface RetryOptions extends BackoffOptions {
  maxAttempts?: number; // default 3 (so up to 2 retries)
  hooks?: RetryHooks;
  /** Override the sleep implementation (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const max = Math.max(1, opts.maxAttempts ?? 3);
  const sleep = opts.sleep ?? defaultSleep;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= max; attempt += 1) {
    try {
      await opts.hooks?.onAttempt?.(attempt);
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const willRetry = attempt < max;
      await opts.hooks?.onFailure?.(attempt, err, willRetry);
      if (!willRetry) break;
      const delay = computeBackoffMs(attempt, opts);
      await sleep(delay);
    }
  }
  throw lastErr;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
