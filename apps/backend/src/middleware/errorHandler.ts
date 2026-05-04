import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { failure, type FieldError } from '../lib/response.js';
import { isProduction } from '../config/env.js';

/**
 * Global exception handler — the single place where every error becomes a
 * unified API error response. Always returns the standard envelope and
 * the active trace_id so clients can correlate failures with server logs.
 *
 * Recognized error shapes:
 *   - AppError subclasses → use embedded code/statusCode/errors
 *   - ZodError            → flatten to field errors, 400
 *   - Generic Error       → 500, message hidden in production
 *
 * 404 (not found) for unmatched routes is handled by `notFoundHandler` below
 * so it goes through the same response path.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const log = (req as Request & { log?: { error: (obj: unknown, msg?: string) => void } }).log;

  if (err instanceof AppError) {
    log?.error({ err, code: err.code, statusCode: err.statusCode }, 'AppError');
    res.status(err.statusCode).json(failure(err.code, err.message, err.errors));
    return;
  }

  if (err instanceof ZodError) {
    const fieldErrors: FieldError[] = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
      code: e.code,
    }));
    log?.error({ err: fieldErrors }, 'ZodError');
    res.status(400).json(failure(ErrorCodes.VALIDATION_FAILED, 'Validation failed', fieldErrors));
    return;
  }

  log?.error({ err }, 'UnhandledError');

  res.status(500).json(
    failure(
      ErrorCodes.INTERNAL,
      isProduction() ? 'Internal server error' : err.message || 'Internal server error'
    )
  );
}

/**
 * 404 fallback. Mounted AFTER all routes; forwards a NotFoundError to
 * the global handler so the response shape stays unified.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json(failure(ErrorCodes.NOT_FOUND, `Route ${req.method} ${req.path} not found`));
}
