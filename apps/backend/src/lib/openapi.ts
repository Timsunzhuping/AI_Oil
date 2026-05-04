import type { Env } from '../config/env.js';

/**
 * OpenAPI 3.1 specification for the FluidMind backend.
 *
 * Kept hand-authored (vs auto-generated from zod) for readability and
 * stable client codegen. Add new endpoints under `paths`, and any reusable
 * schemas under `components.schemas`.
 *
 * The unified envelope (`ApiSuccess` / `ApiError`) is the canonical response
 * shape — every endpoint MUST reference it.
 */
export function buildOpenApiSpec(env: Env): Record<string, unknown> {
  const baseUrl = `http://localhost:${env.PORT}${env.API_PREFIX}`;

  return {
    openapi: '3.1.0',
    info: {
      title: 'FluidMind Backend API',
      version: env.SERVICE_VERSION,
      description:
        'FluidMind — Product Formula Development AI Platform. ' +
        'All responses use the unified envelope (code, message, data?, errors?, traceId, timestamp).',
      contact: { name: 'FluidMind Team', email: 'dev@fluidmind.local' },
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
    },
    servers: [
      { url: baseUrl, description: env.NODE_ENV },
      { url: 'https://api.fluidmind.example.com/api', description: 'Production' },
    ],
    tags: [
      { name: 'Health', description: 'Service liveness and readiness probes' },
      { name: 'V1', description: 'Version 1 API endpoints' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Liveness probe',
          description: 'Returns 200 OK while the process is running. Used by k8s liveness probe.',
          responses: {
            '200': {
              description: 'Service is alive',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthResponse' },
                },
              },
            },
          },
        },
      },
      '/v1/health': {
        get: {
          tags: ['Health', 'V1'],
          summary: 'Readiness probe',
          description: 'Returns service health with dependency checks (db, redis).',
          responses: {
            '200': {
              description: 'Service is ready',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthResponse' },
                },
              },
            },
            '503': {
              description: 'Service is degraded',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ApiError' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        ApiSuccess: {
          type: 'object',
          required: ['code', 'message', 'data', 'traceId', 'timestamp'],
          properties: {
            code: { type: 'integer', enum: [0], description: 'Always 0 for success' },
            message: { type: 'string', example: 'success' },
            data: {},
            traceId: { type: 'string', format: 'uuid' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        ApiError: {
          type: 'object',
          required: ['code', 'message', 'traceId', 'timestamp'],
          properties: {
            code: {
              type: 'integer',
              description: 'Business error code (5-digit)',
              example: 40002,
            },
            message: { type: 'string', example: 'Validation failed' },
            errors: {
              type: 'array',
              items: { $ref: '#/components/schemas/FieldError' },
            },
            traceId: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        FieldError: {
          type: 'object',
          required: ['message'],
          properties: {
            field: { type: 'string', example: 'body.email' },
            message: { type: 'string', example: 'Invalid email format' },
            code: { type: 'string', example: 'invalid_string' },
          },
        },
        HealthData: {
          type: 'object',
          required: ['status', 'timestamp', 'service', 'version', 'uptime'],
          properties: {
            status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
            timestamp: { type: 'string', format: 'date-time' },
            service: { type: 'string' },
            version: { type: 'string' },
            uptime: { type: 'number', description: 'Process uptime in seconds' },
            checks: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  latencyMs: { type: 'number' },
                },
              },
            },
          },
        },
        HealthResponse: {
          allOf: [
            { $ref: '#/components/schemas/ApiSuccess' },
            {
              type: 'object',
              properties: { data: { $ref: '#/components/schemas/HealthData' } },
            },
          ],
        },
      },
      parameters: {
        TraceId: {
          name: 'x-trace-id',
          in: 'header',
          description: 'Optional client-supplied trace ID. Echoed in response for correlation.',
          required: false,
          schema: { type: 'string' },
        },
      },
      responses: {
        BadRequest: {
          description: 'Invalid request',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        Unauthorized: {
          description: 'Authentication required',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        NotFound: {
          description: 'Resource not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        InternalError: {
          description: 'Internal server error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
      },
      securitySchemes: {
        BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
  };
}
