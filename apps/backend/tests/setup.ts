import { beforeAll } from 'vitest';

/**
 * Global test setup — runs once before any test file.
 *
 * Forces NODE_ENV=test so the env loader pulls .env.test and disables
 * pretty logging / swagger that would otherwise produce noise in CI.
 */
beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.ENABLE_REQUEST_LOGGING = 'false';
  process.env.ENABLE_SWAGGER = 'false';
  process.env.PORT = '0';
  process.env.RATE_LIMIT_MAX_REQUESTS = '100000';
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379/1';
});
