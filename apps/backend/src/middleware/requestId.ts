import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requestContext } from '../lib/context.js';

declare module 'express-serve-static-core' {
  interface Request {
    traceId: string;
  }
}

const TRACE_HEADERS = ['x-trace-id', 'x-request-id', 'traceparent'] as const;

function extractTraceId(req: Request): string {
  for (const header of TRACE_HEADERS) {
    const value = req.headers[header];
    if (typeof value === 'string' && value.length > 0) {
      if (header === 'traceparent') {
        const parts = value.split('-');
        if (parts.length >= 2 && parts[1]) return parts[1];
      } else {
        return value;
      }
    }
  }
  return uuidv4();
}

/**
 * Establishes a request context with a trace_id for the entire request lifecycle.
 *
 * - Reads x-trace-id, x-request-id, or W3C traceparent from incoming headers
 * - Falls back to a freshly minted UUID v4
 * - Echoes the trace_id back as the x-trace-id response header
 * - Stores it in AsyncLocalStorage so logs/errors pick it up automatically
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId = extractTraceId(req);

  req.traceId = traceId;
  res.setHeader('x-trace-id', traceId);

  requestContext.run({ traceId, startTime: Date.now() }, () => {
    next();
  });
}
