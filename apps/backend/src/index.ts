import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { validateEnv } from './config/env.js';
import { createLogger, createRequestLogger } from './config/logger.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { securityMiddleware, rateLimitMiddleware } from './middleware/security.js';
import { errorHandler } from './middleware/errorHandler.js';
import { setupGracefulShutdown } from './lib/gracefulShutdown.js';

async function main() {
  const env = validateEnv();
  const logger = createLogger(env);
  const app = express();

  // Middleware
  app.use(createRequestLogger(logger));
  app.use(securityMiddleware());
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use(rateLimitMiddleware(env));

  // Health check (before rate limit)
  app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  // API Routes
  app.get(`${env.API_PREFIX}/`, (req, res) => {
    res.json({
      message: 'FluidMind Backend API',
      version: '0.0.1',
      status: 'running',
      requestId: req.id,
    });
  });

  app.get(`${env.API_PREFIX}/health`, (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      requestId: req.id,
    });
  });

  // Swagger UI (development only)
  if (env.NODE_ENV === 'development') {
    const swaggerSpec = {
      openapi: '3.0.0',
      info: {
        title: 'FluidMind API',
        version: '0.0.1',
      },
      paths: {
        '/health': {
          get: {
            summary: 'Health check',
            responses: { 200: { description: 'Service is healthy' } },
          },
        },
      },
    };
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  }

  // Error handling
  app.use(errorHandler);

  const server = app.listen(env.PORT, () => {
    logger.info(`Server running on port ${env.PORT}`);
  });

  setupGracefulShutdown(server, logger);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
