import { Router, Request, Response } from 'express';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { z } from 'zod';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { success, paginated } from '../../lib/response.js';
import { IntegrationRepository } from './repository.js';
import { JobRunner } from './job-runner.js';
import { AdapterRegistry } from './adapters/registry.js';
import { makeLoaderResolver } from './loaders.js';
import type { JobType, SourceType } from './types.js';

const SourceCreate = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  source_type: z.enum(['sap','lims','file']),
  description: z.string().optional().nullable(),
  config: z.record(z.unknown()).optional(),
  secret_ref: z.string().optional().nullable(),
  supported_entities: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
});

const SyncTrigger = z.object({
  source_id: z.string().uuid().optional(),
  source_code: z.string().optional(),
  entity_type: z.string().min(1),
  job_type: z.enum(['full_sync','incremental_sync','manual','test']).default('incremental_sync'),
  max_attempts: z.number().int().min(1).max(10).optional(),
}).refine((d) => d.source_id || d.source_code, {
  message: 'Either source_id or source_code is required',
});

const JobListQuery = z.object({
  source_id: z.string().uuid().optional(),
  entity_type: z.string().optional(),
  status: z.enum(['queued','running','succeeded','failed','partial','cancelled','timeout']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

const ScheduleCreate = z.object({
  source_id: z.string().uuid(),
  entity_type: z.string().min(1),
  job_type: z.enum(['full_sync','incremental_sync']).default('incremental_sync'),
  cron_expr: z.string().optional().nullable(),
  interval_minutes: z.number().int().min(1).optional().nullable(),
  is_active: z.boolean().optional(),
}).refine((d) => d.cron_expr || d.interval_minutes, {
  message: 'Either cron_expr or interval_minutes is required',
});

const IdParam = z.object({ id: z.string().uuid() });

export function buildIntegrationRouter(
  pool: Pool,
  logger: Logger,
  registry: AdapterRegistry
): Router {
  const router = Router();
  const repo = new IntegrationRepository(pool);
  const runner = new JobRunner(repo, registry, logger);
  const loaderResolver = makeLoaderResolver(pool);
  const userId = (req: Request) => (req as Request & { userId?: string }).userId;

  // -------------------------- sources --------------------------

  router.get('/sources', async (req, res) => {
    const sourceType = req.query.source_type as SourceType | undefined;
    const isActive = req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined;
    const items = await repo.listSources({ source_type: sourceType, is_active: isActive });
    res.json(success(items));
  });

  router.post('/sources', validate({ body: SourceCreate }), async (req, res) => {
    const result = await repo.upsertSource({ ...req.body, user_id: userId(req) });
    res.status(201).json(success(result, 'Source registered'));
  });

  router.get('/sources/:id', validate({ params: IdParam }), async (req, res) => {
    const src = await repo.findSourceById(req.params.id);
    if (!src) throw new NotFoundError('Source');
    res.json(success(src));
  });

  router.delete('/sources/:id', validate({ params: IdParam }), async (req, res) => {
    const ok = await repo.softDeleteSource(req.params.id, userId(req));
    if (!ok) throw new NotFoundError('Source');
    res.status(204).end();
  });

  router.post('/sources/:id/test-connection', validate({ params: IdParam }), async (req, res) => {
    const src = await repo.findSourceById(req.params.id);
    if (!src) throw new NotFoundError('Source');
    const adapter = registry.resolve(src.source_type);
    const result = await adapter.testConnection(src);
    res.json(success(result));
  });

  router.get('/adapters', (_req, res) => {
    res.json(success(registry.list()));
  });

  // -------------------------- jobs --------------------------

  router.get('/jobs', validate({ query: JobListQuery }), async (req, res) => {
    const q = req.query as unknown as z.infer<typeof JobListQuery>;
    const result = await repo.listJobs({
      sourceId: q.source_id,
      entityType: q.entity_type,
      status: q.status,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    res.json(paginated(result.items, result.total, q.page, q.pageSize));
  });

  router.get('/jobs/:id', validate({ params: IdParam }), async (req, res) => {
    const job = await repo.findJobById(req.params.id);
    if (!job) throw new NotFoundError('Job');
    const logs = await repo.listJobLogs(req.params.id, { limit: 50 });
    res.json(success({ ...job, recent_logs: logs.items }));
  });

  router.get('/jobs/:id/logs', validate({ params: IdParam }), async (req, res) => {
    const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? '200'), 10)));
    const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10));
    const result = await repo.listJobLogs(req.params.id, { limit, offset });
    res.json(success(result));
  });

  router.post('/jobs/:id/retry', validate({ params: IdParam }), async (req, res) => {
    const job = await repo.findJobById(req.params.id);
    if (!job) throw new NotFoundError('Job');
    const source = await repo.findSourceById(job.source_id as string);
    if (!source) throw new NotFoundError('Source for job');
    const result = await runner.run({
      source,
      entityType: job.entity_type as string,
      jobType: (job.job_type ?? 'incremental_sync') as JobType,
      triggerType: 'retry',
      triggeredBy: userId(req),
      parentJobId: job.id as string,
      attemptNumber: ((job.attempt_number as number) ?? 1) + 1,
      maxAttempts: (job.max_attempts as number) ?? 3,
      loader: loaderResolver(job.entity_type as string),
    });
    res.json(success(result, 'Retry triggered'));
  });

  // -------------------------- sync trigger --------------------------

  router.post('/sync', validate({ body: SyncTrigger }), async (req, res) => {
    const body = req.body as z.infer<typeof SyncTrigger>;
    const source = body.source_id
      ? await repo.findSourceById(body.source_id)
      : await repo.findSourceByCode(body.source_code!);
    if (!source) throw new NotFoundError('Source');
    if (!source.is_active) throw new BadRequestError(`Source '${source.code}' is inactive`);
    if (source.supported_entities.length > 0 && !source.supported_entities.includes(body.entity_type)) {
      throw new BadRequestError(
        `Source '${source.code}' does not support entity '${body.entity_type}'. ` +
        `Supported: ${source.supported_entities.join(', ')}`
      );
    }

    const result = await runner.run({
      source,
      entityType: body.entity_type,
      jobType: body.job_type,
      triggerType: 'api',
      triggeredBy: userId(req),
      maxAttempts: body.max_attempts ?? source.default_retry_max,
      loader: loaderResolver(body.entity_type),
      traceId: req.traceId,
    });
    res.status(202).json(success(result, 'Sync triggered'));
  });

  // -------------------------- snapshots --------------------------

  router.get('/snapshots', async (req, res) => {
    const sourceId = req.query.source_id as string | undefined;
    const items = await repo.listSnapshots(sourceId);
    res.json(success(items));
  });

  // -------------------------- schedules --------------------------

  router.get('/schedules', async (req, res) => {
    const isActive = req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined;
    const items = await repo.listSchedules({ is_active: isActive });
    res.json(success(items));
  });

  router.post('/schedules', validate({ body: ScheduleCreate }), async (req, res) => {
    const result = await repo.upsertSchedule({ ...req.body, user_id: userId(req) });
    res.status(201).json(success(result, 'Schedule saved'));
  });

  router.delete('/schedules/:id', validate({ params: IdParam }), async (req, res) => {
    const ok = await repo.softDeleteSchedule(req.params.id, userId(req));
    if (!ok) throw new NotFoundError('Schedule');
    res.status(204).end();
  });

  return router;
}
