import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context carried through the async call chain.
 *
 * Anything we add to the store here becomes accessible from any async
 * descendant of the request handler — controllers, services, repositories,
 * the logger mixin — without explicit plumbing.
 *
 * Standard fields:
 *   traceId   — correlation ID, propagated to logs and downstream services
 *   startTime — high-resolution timestamp for latency metrics
 *   userId    — authenticated principal (populated by auth middleware)
 */
export interface RequestContext {
  traceId: string;
  startTime: number;
  userId?: string;
  [key: string]: unknown;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getContext(): RequestContext | undefined {
  return requestContext.getStore();
}

export function getTraceId(): string | undefined {
  return requestContext.getStore()?.traceId;
}

export function getUserId(): string | undefined {
  return requestContext.getStore()?.userId;
}

export function withContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContext.run(ctx, fn);
}

export function setContextValue<K extends keyof RequestContext>(
  key: K,
  value: RequestContext[K]
): void {
  const store = requestContext.getStore();
  if (store) {
    store[key] = value;
  }
}
