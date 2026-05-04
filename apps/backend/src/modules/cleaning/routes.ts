import { Router, Request } from 'express';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { success, paginated } from '../../lib/response.js';
import { CleaningRepository } from './repository.js';
import { CleaningPipeline } from './pipeline/pipeline.js';
import { generateQualityReport } from './reports.js';

const RunTriggerSchema = z.object({
  entity_type: z.enum(['test_results']).default('test_results'),
  since: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(10_000).optional(),
}).default({});

const IssueListQuery = z.object({
  run_id: z.string().uuid().optional(),
  issue_type: z.string().optional(),
  severity: z.enum(['info','warning','error','critical']).optional(),
  status: z.enum(['open','acknowledged','fixed','wont_fix','duplicate']).optional(),
  entity_type: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

const NormalizedListQuery = z.object({
  metric_code: z.string().optional(),
  is_outlier: z.coerce.boolean().optional(),
  has_quality_issues: z.coerce.boolean().optional(),
  formula_version_id: z.string().uuid().optional(),
  batch_code: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

const ResolveIssueSchema = z.object({
  status: z.enum(['acknowledged','fixed','wont_fix']),
  notes: z.string().optional(),
});

const RuleUpsertSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  rule_type: z.enum(['standardization','validation','outlier','linkage','enrichment']),
  scope: z.enum(['material','metric','unit','test_result','formula_item','global']),
  severity: z.enum(['info','warning','error','critical']).default('warning'),
  condition_expr: z.unknown(),
  action_expr: z.unknown(),
  priority: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

const IdParam = z.object({ id: z.string().uuid() });

export function buildCleaningRouter(pool: Pool, logger: Logger): Router {
  const router = Router();
  const repo = new CleaningRepository(pool);
  const pipeline = new CleaningPipeline(pool, repo, logger);
  const userId = (req: Request) => (req as Request & { userId?: string }).userId;

  // -------------------------- runs --------------------------

  router.post('/runs', validate({ body: RunTriggerSchema }), async (req, res) => {
    const body = req.body as z.infer<typeof RunTriggerSchema>;
    const summary = await pipeline.run({
      triggerType: 'api',
      ...(userId(req) !== undefined ? { triggeredBy: userId(req) } : {}),
      ...(req.traceId !== undefined ? { traceId: req.traceId } : {}),
      entityType: body.entity_type,
      ...(body.since ? { scope: { since: new Date(body.since) } } : {}),
      ...(body.limit !== undefined ? { limit: body.limit } : {}),
    });
    const httpStatus = summary.status === 'succeeded' ? 200 : summary.status === 'partial' ? 207 : 422;
    res.status(httpStatus).json(success(summary, `Cleaning ${summary.status}`));
  });

  router.get('/runs', async (req, res) => {
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize ?? '20'), 10)));
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const result = await repo.listRuns({
      ...(req.query.status ? { status: String(req.query.status) } : {}),
      limit,
      offset: (page - 1) * limit,
    });
    res.json(paginated(result.items, result.total, page, limit));
  });

  router.get('/runs/:id', validate({ params: IdParam }), async (req, res) => {
    const run = await repo.findRun(req.params.id);
    if (!run) throw new NotFoundError('Cleaning run');
    res.json(success(run));
  });

  router.get('/runs/:id/report', validate({ params: IdParam }), async (req, res) => {
    const report = await generateQualityReport(pool, req.params.id);
    if (!report) throw new NotFoundError('Cleaning run');
    res.json(success(report));
  });

  // -------------------------- issues --------------------------

  router.get('/issues', validate({ query: IssueListQuery }), async (req, res) => {
    const q = req.query as unknown as z.infer<typeof IssueListQuery>;
    const result = await repo.listIssues({
      ...(q.run_id ? { run_id: q.run_id } : {}),
      ...(q.issue_type ? { issue_type: q.issue_type } : {}),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.entity_type ? { entity_type: q.entity_type } : {}),
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    res.json(paginated(result.items, result.total, q.page, q.pageSize));
  });

  router.patch('/issues/:id/resolve', validate({ params: IdParam, body: ResolveIssueSchema }), async (req, res) => {
    const ok = await repo.resolveIssue(req.params.id, {
      status: req.body.status,
      notes: req.body.notes,
      ...(userId(req) !== undefined ? { user_id: userId(req) } : {}),
    });
    if (!ok) throw new NotFoundError('Open issue with that id');
    res.json(success({ id: req.params.id, status: req.body.status }, 'Issue resolved'));
  });

  // -------------------------- normalized data --------------------------

  router.get('/normalized/test-results', validate({ query: NormalizedListQuery }), async (req, res) => {
    const q = req.query as unknown as z.infer<typeof NormalizedListQuery>;
    const result = await repo.listNormalizedTestResults({
      ...(q.metric_code ? { metric_code: q.metric_code } : {}),
      ...(q.is_outlier !== undefined ? { is_outlier: q.is_outlier } : {}),
      ...(q.has_quality_issues !== undefined ? { has_quality_issues: q.has_quality_issues } : {}),
      ...(q.formula_version_id ? { formula_version_id: q.formula_version_id } : {}),
      ...(q.batch_code ? { batch_code: q.batch_code } : {}),
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    res.json(paginated(result.items, result.total, q.page, q.pageSize));
  });

  // -------------------------- rules --------------------------

  router.get('/rules', async (req, res) => {
    const scope = req.query.scope ? String(req.query.scope) : undefined;
    const items = await repo.listActiveRules(scope);
    res.json(success(items));
  });

  router.post('/rules', validate({ body: RuleUpsertSchema }), async (req, res) => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO cleaning_rules
         (code, name, description, rule_type, scope, severity, condition_expr, action_expr, priority, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name,
             description = EXCLUDED.description,
             rule_type = EXCLUDED.rule_type,
             scope = EXCLUDED.scope,
             severity = EXCLUDED.severity,
             condition_expr = EXCLUDED.condition_expr,
             action_expr = EXCLUDED.action_expr,
             priority = EXCLUDED.priority,
             is_active = EXCLUDED.is_active,
             updated_by = EXCLUDED.updated_by
       RETURNING id`,
      [
        req.body.code, req.body.name, req.body.description ?? null,
        req.body.rule_type, req.body.scope, req.body.severity ?? 'warning',
        req.body.condition_expr, req.body.action_expr,
        req.body.priority ?? 0, req.body.is_active ?? true,
        userId(req) ?? null,
      ]
    );
    res.status(201).json(success(r.rows[0], 'Rule saved'));
  });

  router.delete('/rules/:id', validate({ params: IdParam }), async (req, res) => {
    const r = await pool.query(
      `UPDATE cleaning_rules SET deleted_at = NOW(), is_active = FALSE WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if ((r.rowCount ?? 0) === 0) throw new NotFoundError('Rule');
    res.status(204).end();
  });

  return router;
}
