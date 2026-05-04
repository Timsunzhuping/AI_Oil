import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Layered environment loading.
 *
 * Load order (later files OVERRIDE earlier ones):
 *   1. .env                       — base defaults shared across environments
 *   2. .env.{NODE_ENV}            — environment-specific (local|test|prod)
 *   3. .env.{NODE_ENV}.local      — personal/secret overrides (gitignored)
 *
 * In production deployments, prefer real secret stores (K8s Secret, Vault,
 * AWS Secrets Manager) over .env files. The schema below is the contract.
 */
const NODE_ENV = process.env.NODE_ENV ?? 'local';

const envFiles = ['.env', `.env.${NODE_ENV}`, `.env.${NODE_ENV}.local`];

for (const file of envFiles) {
  const filePath = resolve(process.cwd(), file);
  if (existsSync(filePath)) {
    dotenvConfig({ path: filePath, override: true });
  }
}

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : v.toLowerCase() === 'true'));

export const envSchema = z.object({
  NODE_ENV: z.enum(['local', 'test', 'prod', 'development', 'production']).default('local'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  SERVICE_NAME: z.string().default('fluidmind-backend'),
  SERVICE_VERSION: z.string().default('0.0.1'),

  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  API_PREFIX: z.string().default('/api'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),

  ENABLE_SWAGGER: booleanFromString.default(true),
  ENABLE_REQUEST_LOGGING: booleanFromString.default(true),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('❌ Invalid environment configuration:');
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
    process.exit(1);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}

export const validateEnv = loadEnv;

export const isProduction = (): boolean => {
  const e = loadEnv().NODE_ENV;
  return e === 'prod' || e === 'production';
};

export const isTest = (): boolean => loadEnv().NODE_ENV === 'test';

export const isLocal = (): boolean => {
  const e = loadEnv().NODE_ENV;
  return e === 'local' || e === 'development';
};
