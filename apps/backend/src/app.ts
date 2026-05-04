import express, { Express } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import type { Logger } from 'pino';
import { loadEnv, type Env } from './config/env.js';
import { createLogger, createRequestLogger } from './config/logger.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { securityMiddleware, rateLimitMiddleware } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { configureRoutes } from './routes/index.js';
import { buildOpenApiSpec } from './lib/openapi.js';

export interface CreateAppResult {
  app: Express;
  logger: Logger;
  env: Env;
}

/**
 * Builds and wires the Express application.
 *
 * Middleware order matters and is intentional:
 *   1. requestId       — establishes trace context BEFORE any logging
 *   2. requestLogger   — logs every request with the trace_id from (1)
 *   3. security        — helmet headers
 *   4. cors            — must be after security to set explicit origin
 *   5. body parsers    — populate req.body before validators see it
 *   6. rate limit      — skips /health
 *   7. routes          — feature routes
 *   8. notFoundHandler — catches unmatched paths
 *   9. errorHandler    — terminal handler, formats every error
 *
 * Exposing a pure factory (no `listen`) lets tests boot the app with
 * supertest without binding a port.
 */
export function createApp(envOverride?: Env): CreateAppResult {
  const env = envOverride ?? loadEnv();
  const logger = createLogger(env);
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestIdMiddleware);
  app.use(createRequestLogger(logger, env));
  app.use(securityMiddleware());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(rateLimitMiddleware(env));

  if (env.ENABLE_SWAGGER) {
    const spec = buildOpenApiSpec(env);
    app.use(`${env.API_PREFIX}/docs`, swaggerUi.serve, swaggerUi.setup(spec));
    app.get(`${env.API_PREFIX}/openapi.json`, (_req, res) => res.json(spec));
  }

  configureRoutes(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, logger, env };
}
