import { describe, it, expect } from 'vitest';
import {
  AppError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  UpstreamError,
  ErrorCodes,
} from '../../src/lib/errors.js';

describe('error hierarchy', () => {
  it('AppError captures code, statusCode, message', () => {
    const err = new AppError(99999, 'boom', 418);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(99999);
    expect(err.statusCode).toBe(418);
    expect(err.message).toBe('boom');
    expect(err.name).toBe('AppError');
    expect(err.stack).toBeDefined();
  });

  it.each([
    [BadRequestError, ErrorCodes.BAD_REQUEST, 400],
    [UnauthorizedError, ErrorCodes.UNAUTHORIZED, 401],
    [ForbiddenError, ErrorCodes.FORBIDDEN, 403],
    [ConflictError, ErrorCodes.CONFLICT, 409],
    [RateLimitError, ErrorCodes.TOO_MANY_REQUESTS, 429],
  ] as const)('%s maps to code %s and HTTP %s', (Cls, code, status) => {
    const err = new Cls();
    expect(err.code).toBe(code);
    expect(err.statusCode).toBe(status);
    expect(err).toBeInstanceOf(AppError);
  });

  it('NotFoundError formats message with resource name', () => {
    const err = new NotFoundError('Formula');
    expect(err.message).toBe('Formula not found');
    expect(err.statusCode).toBe(404);
  });

  it('ValidationError preserves field errors', () => {
    const err = new ValidationError([
      { field: 'body.email', message: 'Required' },
      { field: 'body.name', message: 'Too short' },
    ]);
    expect(err.errors).toHaveLength(2);
    expect(err.code).toBe(ErrorCodes.VALIDATION_FAILED);
    expect(err.statusCode).toBe(400);
  });

  it('UpstreamError preserves cause', () => {
    const cause = new Error('connection refused');
    const err = new UpstreamError('OpenAI down', cause);
    expect(err.cause).toBe(cause);
    expect(err.statusCode).toBe(503);
  });
});
