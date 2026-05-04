import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Env } from '../config/env.js';
import { RateLimitError } from '../lib/errors.js';

export function securityMiddleware() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    crossOriginEmbedderPolicy: false,
  });
}

/**
 * Rate limiter. The handler funnels into the global error pipeline so
 * a 429 still uses the unified envelope and carries the trace_id.
 */
export function rateLimitMiddleware(env: Env) {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.path === '/health',
    handler: (_req, _res, next) => next(new RateLimitError()),
  });
}
