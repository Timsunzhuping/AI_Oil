/**
 * Unified API response envelope.
 *
 * EVERY API endpoint must return this shape — including errors.
 *
 *   { code, message, data?, errors?, traceId, timestamp }
 *
 * Convention:
 *   code === 0          → success
 *   code  >  0          → business / HTTP error (see errors.ts for code map)
 *
 * `data` is present on success only.
 * `errors` is present on validation/aggregate failures only.
 */
import { getTraceId } from './context.js';

export interface ApiSuccessResponse<T> {
  code: 0;
  message: string;
  data: T;
  traceId: string;
  timestamp: string;
}

export interface FieldError {
  field?: string;
  message: string;
  code?: string;
}

export interface ApiErrorResponse {
  code: number;
  message: string;
  errors?: FieldError[];
  traceId: string;
  timestamp: string;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function resolveTraceId(explicit?: string): string {
  return explicit ?? getTraceId() ?? 'no-trace';
}

export function success<T>(data: T, message = 'success', traceId?: string): ApiSuccessResponse<T> {
  return {
    code: 0,
    message,
    data,
    traceId: resolveTraceId(traceId),
    timestamp: nowIso(),
  };
}

export function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
  traceId?: string
): ApiSuccessResponse<PaginatedData<T>> {
  return success({ items, total, page, pageSize }, 'success', traceId);
}

export function failure(
  code: number,
  message: string,
  errors?: FieldError[],
  traceId?: string
): ApiErrorResponse {
  return {
    code,
    message,
    ...(errors && errors.length > 0 ? { errors } : {}),
    traceId: resolveTraceId(traceId),
    timestamp: nowIso(),
  };
}
