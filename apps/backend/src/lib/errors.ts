import type { FieldError } from './response.js';

/**
 * Application error codes.
 *
 * Convention: 5-digit codes where the first 3 digits mirror the HTTP status,
 * and the last 2 distinguish concrete error categories within that status.
 *
 *   40001 — generic 400 (bad request)
 *   40002 — request validation failed
 *   40100 — unauthenticated
 *   40300 — forbidden
 *   40400 — resource not found
 *   40900 — resource conflict
 *   42900 — rate limit exceeded
 *   50000 — generic 500 (internal server error)
 *   50300 — upstream service unavailable
 *   50400 — upstream timeout
 */
export const ErrorCodes = {
  BAD_REQUEST: 40001,
  VALIDATION_FAILED: 40002,
  UNAUTHORIZED: 40100,
  FORBIDDEN: 40300,
  NOT_FOUND: 40400,
  CONFLICT: 40900,
  TOO_MANY_REQUESTS: 42900,
  INTERNAL: 50000,
  UPSTREAM_UNAVAILABLE: 50300,
  UPSTREAM_TIMEOUT: 50400,
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Base class for any error that should be translated into a structured
 * client response. Anything else thrown becomes a generic 500.
 */
export class AppError extends Error {
  public readonly code: number;
  public readonly statusCode: number;
  public readonly errors?: FieldError[];
  public readonly cause?: unknown;

  constructor(
    code: number,
    message: string,
    statusCode: number,
    options?: { errors?: FieldError[]; cause?: unknown }
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    if (options?.errors !== undefined) this.errors = options.errors;
    if (options?.cause !== undefined) this.cause = options.cause;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', errors?: FieldError[]) {
    super(ErrorCodes.BAD_REQUEST, message, 400, errors ? { errors } : undefined);
  }
}

export class ValidationError extends AppError {
  constructor(errors: FieldError[], message = 'Validation failed') {
    super(ErrorCodes.VALIDATION_FAILED, message, 400, { errors });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(ErrorCodes.UNAUTHORIZED, message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(ErrorCodes.FORBIDDEN, message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(ErrorCodes.NOT_FOUND, `${resource} not found`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(ErrorCodes.CONFLICT, message, 409);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(ErrorCodes.TOO_MANY_REQUESTS, message, 429);
  }
}

export class UpstreamError extends AppError {
  constructor(message = 'Upstream service unavailable', cause?: unknown) {
    super(ErrorCodes.UPSTREAM_UNAVAILABLE, message, 503, cause ? { cause } : undefined);
  }
}
