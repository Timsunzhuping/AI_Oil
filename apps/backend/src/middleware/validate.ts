import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError, ZodSchema } from 'zod';
import { ValidationError } from '../lib/errors.js';
import type { FieldError } from '../lib/response.js';

export interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
  headers?: ZodSchema;
}

function zodErrorToFieldErrors(prefix: string, err: ZodError): FieldError[] {
  return err.errors.map((e) => ({
    field: prefix ? `${prefix}.${e.path.join('.')}` : e.path.join('.'),
    message: e.message,
    code: e.code,
  }));
}

/**
 * Returns an Express middleware that validates and replaces parsed
 * `body`/`query`/`params`/`headers` on the request.
 *
 * On any failure, accumulates ALL field errors across all sources and
 * forwards a single ValidationError to the global exception handler —
 * keeping the unified response shape and trace_id intact.
 *
 * @example
 *   const schema = {
 *     body: z.object({ name: z.string().min(1) }),
 *     query: z.object({ page: z.coerce.number().default(1) }),
 *   };
 *   router.post('/items', validate(schema), handler);
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const errors: FieldError[] = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) {
        req.body = result.data;
      } else {
        errors.push(...zodErrorToFieldErrors('body', result.error));
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) {
        Object.assign(req.query, result.data);
      } else {
        errors.push(...zodErrorToFieldErrors('query', result.error));
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) {
        Object.assign(req.params, result.data);
      } else {
        errors.push(...zodErrorToFieldErrors('params', result.error));
      }
    }

    if (schemas.headers) {
      const result = schemas.headers.safeParse(req.headers);
      if (!result.success) {
        errors.push(...zodErrorToFieldErrors('headers', result.error));
      }
    }

    if (errors.length > 0) {
      next(new ValidationError(errors));
      return;
    }

    next();
  };
}
