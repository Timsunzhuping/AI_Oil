import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import type { Env } from '../config/env.js';

let pool: Pool | null = null;

export function createPool(env: Env, overrides?: Partial<PoolConfig>): Pool {
  if (pool) return pool;
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL not configured');
  }
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 20,
    min: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...overrides,
  });
  pool.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('Unexpected idle pg client error', err);
  });
  return pool;
}

export function getPool(): Pool {
  if (!pool) throw new Error('Pool not initialized; call createPool(env) first');
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Run a query and return rows directly. Throws on db errors —
 * the global error handler turns them into 500 responses.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params as never);
}

/**
 * Run an arbitrary block inside a single transaction, retrying on
 * 40001 / 40P01 (serialization / deadlock) up to `maxRetries` times.
 */
export async function withTransaction<T>(
  fn: (client: import('pg').PoolClient) => Promise<T>,
  maxRetries = 3
): Promise<T> {
  const client = await getPool().connect();
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        const code = (err as { code?: string }).code;
        if ((code === '40001' || code === '40P01') && attempt < maxRetries) {
          continue;
        }
        throw err;
      }
    }
  } finally {
    client.release();
  }
}
