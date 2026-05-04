import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { validate } from '../../src/middleware/validate.js';
import { ValidationError } from '../../src/lib/errors.js';

function makeReq(overrides: Partial<Request>): Request {
  return { body: {}, query: {}, params: {}, headers: {}, ...overrides } as unknown as Request;
}

describe('validate middleware', () => {
  it('replaces req.body with parsed data on success', () => {
    const schema = { body: z.object({ name: z.string().min(1) }) };
    const req = makeReq({ body: { name: 'Alice' } });
    const next = vi.fn();

    validate(schema)(req, {} as Response, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({ name: 'Alice' });
  });

  it('coerces query types via the schema', () => {
    const schema = { query: z.object({ page: z.coerce.number().default(1) }) };
    const req = makeReq({ query: { page: '7' } as Request['query'] });
    const next = vi.fn();

    validate(schema)(req, {} as Response, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledWith();
    expect(req.query.page).toBe(7);
  });

  it('forwards a ValidationError aggregating all sources on failure', () => {
    const schema = {
      body: z.object({ email: z.string().email() }),
      query: z.object({ page: z.coerce.number().int() }),
    };
    const req = makeReq({ body: { email: 'not-an-email' }, query: { page: 'abc' } as Request['query'] });
    const next = vi.fn();

    validate(schema)(req, {} as Response, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.errors.length).toBeGreaterThanOrEqual(2);
    const fields = err.errors.map((e: { field?: string }) => e.field);
    expect(fields.some((f: string | undefined) => f?.startsWith('body.'))).toBe(true);
    expect(fields.some((f: string | undefined) => f?.startsWith('query.'))).toBe(true);
  });
});
