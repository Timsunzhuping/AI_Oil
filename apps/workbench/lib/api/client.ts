/**
 * Thin HTTP client that:
 *   1. Posts/gets JSON against the backend's /api/v1 prefix
 *   2. Unwraps the unified envelope { code, message, data, traceId, timestamp }
 *   3. Surfaces non-zero `code` values as typed `ApiError`
 *
 * The base URL defaults to a relative `/api/v1` so Next.js' rewrites (see
 * `next.config.js`) proxy to the backend in dev. An explicit
 * `NEXT_PUBLIC_API_BASE` overrides it for SSR / preview deployments.
 */
import type { ApiEnvelope } from './types';

const BASE = (process.env.NEXT_PUBLIC_API_BASE ?? '/api/v1').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public code: number, message: string, public traceId?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Abort signal for React Query cancellation. */
  signal?: AbortSignal;
}

function buildUrl(path: string, query: RequestOptions['query']): string {
  const url = new URL(`${BASE}${path}`, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.append(k, String(v));
    }
  }
  // Strip the synthetic origin for relative requests so SSR uses absolute, browser uses relative.
  const isAbsolute = BASE.startsWith('http');
  return isAbsolute ? url.toString() : `${url.pathname}${url.search}`;
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = buildUrl(path, opts.query);
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    credentials: 'include',
  });

  // Network / HTTP error before envelope can be parsed
  if (!res.ok && res.status >= 500) {
    throw new ApiError(res.status, `Server error ${res.status}`);
  }

  const env = (await res.json()) as ApiEnvelope<T>;
  if (env.code !== 0) {
    throw new ApiError(env.code, env.message ?? 'API error', env.traceId);
  }
  return env.data;
}

export const apiClient = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'DELETE' }),
};
