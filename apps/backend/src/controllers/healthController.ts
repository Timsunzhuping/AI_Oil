import { Request, Response } from 'express';
import { loadEnv } from '../config/env.js';
import { success } from '../lib/response.js';

export interface HealthCheck {
  status: 'pass' | 'fail';
  latencyMs?: number;
  error?: string;
}

export interface HealthData {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  service: string;
  version: string;
  uptime: number;
  checks?: Record<string, HealthCheck>;
}

/**
 * Liveness probe — minimal, always 200 if the process is up. Used by k8s
 * to decide whether to restart the pod.
 */
export function livenessHandler(_req: Request, res: Response): void {
  const env = loadEnv();
  const data: HealthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: env.SERVICE_NAME,
    version: env.SERVICE_VERSION,
    uptime: process.uptime(),
  };
  res.status(200).json(success(data));
}

/**
 * Readiness probe — runs dependency checks (db, redis, etc) and returns
 * `degraded`/`unhealthy` if anything is failing. Used by k8s to gate traffic.
 *
 * Dependency checks are stubbed for now; wire real probes here as services
 * come online.
 */
export async function readinessHandler(_req: Request, res: Response): Promise<void> {
  const env = loadEnv();

  const checks: Record<string, HealthCheck> = {
    process: { status: 'pass', latencyMs: 0 },
    // database: await checkDatabase(),
    // redis:    await checkRedis(),
  };

  const failed = Object.values(checks).filter((c) => c.status === 'fail').length;
  const status: HealthData['status'] =
    failed === 0 ? 'healthy' : failed < Object.keys(checks).length ? 'degraded' : 'unhealthy';

  const data: HealthData = {
    status,
    timestamp: new Date().toISOString(),
    service: env.SERVICE_NAME,
    version: env.SERVICE_VERSION,
    uptime: process.uptime(),
    checks,
  };

  res.status(status === 'unhealthy' ? 503 : 200).json(success(data));
}
