import { describe, it, expect, beforeAll } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { requestIdMiddleware } from '../../src/middleware/requestId.js';
import { errorHandler, notFoundHandler } from '../../src/middleware/errorHandler.js';
import { validate } from '../../src/middleware/validate.js';
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from '../../src/lib/errors.js';

function buildTestApp(): Express {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json());

  app.get('/throw/app', (_req, _res, next) => next(new BadRequestError('bad')));
  app.get('/throw/auth', (_req, _res, next) => next(new UnauthorizedError()));
  app.get('/throw/notfound', (_req, _res, next) => next(new NotFoundError('User')));
  app.get('/throw/unknown', (_req, _res, next) => next(new Error('boom')));
  app.get('/throw/zod', (_req, _res, next) => {
    try {
      z.object({ x: z.number() }).parse({ x: 'nope' });
    } catch (e) {
      next(e);
    }
  });
  app.post(
    '/validate',
    validate({ body: z.object({ email: z.string().email(), age: z.number().int().min(0) }) }),
    (_req: Request, res: Response) => res.json({ ok: true })
  );
  app.get('/throw/async', async (_req, _res, next) => {
    try {
      await Promise.reject(new BadRequestError('async-bad'));
    } catch (e) {
      next(e as Error);
    }
  });

  app.use(notFoundHandler);
  app.use((err: Error, req: Request, res: Response, next: NextFunction) =>
    errorHandler(err, req, res, next)
  );

  return app;
}

describe('error handler (integration)', () => {
  let app: Express;

  beforeAll(() => {
    app = buildTestApp();
  });

  it('AppError → unified envelope with code/statusCode/trace_id', async () => {
    const res = await request(app).get('/throw/app').set('x-trace-id', 'tA');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(40001);
    expect(res.body.message).toBe('bad');
    expect(res.body.traceId).toBe('tA');
  });

  it('UnauthorizedError → 401 + 40100', async () => {
    const res = await request(app).get('/throw/auth');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(40100);
  });

  it('NotFoundError → 404 + resource name in message', async () => {
    const res = await request(app).get('/throw/notfound');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(40400);
    expect(res.body.message).toBe('User not found');
  });

  it('Generic Error → 500 with unified shape', async () => {
    const res = await request(app).get('/throw/unknown');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe(50000);
    expect(res.body.traceId).toBeDefined();
  });

  it('ZodError thrown manually → 400 + flattened field errors', async () => {
    const res = await request(app).get('/throw/zod');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(40002);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors[0].field).toBe('x');
  });

  it('validate() failure → ValidationError with multi-field errors', async () => {
    const res = await request(app).post('/validate').send({ email: 'bad', age: -1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(40002);
    expect(res.body.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('async errors propagate to the global handler', async () => {
    const res = await request(app).get('/throw/async');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(40001);
    expect(res.body.message).toBe('async-bad');
  });

  it('unmatched route → notFoundHandler with unified envelope', async () => {
    const res = await request(app).get('/no/such/path');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(40400);
    expect(res.body.traceId).toBeDefined();
  });
});
