import { Router, Request } from 'express';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { success, paginated } from '../../lib/response.js';
import { FeatureApi } from './feature-api.js';

const RunTrigger = z.object({
  feature_set_version: z.string().default('v1.0'),
  scope: z.object({
    formula_ids: z.array(z.string().uuid()).optional(),
    product_category_code: z.string().optional(),
    only_approved: z.boolean().optional(),
  }).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
}).default({});

const ListQuery = z.object({
  feature_set_version: z.string().optional(),
  product_category_code: z.string().optional(),
  target_metric: z.string().optional(),
  status: z.string().optional(),
  is_complete: z.coerce.boolean().optional(),
  formula_version_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(5000).default(50),
});

const MatrixQuery = z.object({
  feature_set_version: z.string().default('v1.0'),
  product_category_code: z.string().optional(),
  target_metric: z.string().min(1),
  feature_names: z.string().min(1),                // CSV
  is_complete: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(20000).default(5000),
});

const IdParam = z.object({ id: z.string().uuid() });

export function buildFeaturesRouter(pool: Pool, logger: Logger): Router {
  const router = Router();
  const api = new FeatureApi(pool, logger);
  const userId = (req: Request) => (req as Request & { userId?: string }).userId;

  // -------------------------- runs --------------------------

  router.post('/runs', validate({ body: RunTrigger }), async (req, res) => {
    const body = req.body as z.infer<typeof RunTrigger>;
    const summary = await api.generate({
      feature_set_version: body.feature_set_version,
      triggerType: 'api',
      ...(userId(req) !== undefined ? { triggeredBy: userId(req) } : {}),
      ...(req.traceId !== undefined ? { traceId: req.traceId } : {}),
      ...(body.scope ? { scope: body.scope } : {}),
      ...(body.limit !== undefined ? { limit: body.limit } : {}),
    });
    const httpStatus = summary.status === 'succeeded' ? 200 : summary.status === 'partial' ? 207 : 422;
    res.status(httpStatus).json(success(summary, `Feature generation ${summary.status}`));
  });

  router.get('/runs', async (req, res) => {
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize ?? '20'), 10)));
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    // Quick local query (avoids extending FeatureApi with another method)
    const { rows } = await pool.query(
      `SELECT * FROM feature_generation_runs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, (page - 1) * limit]
    );
    const totalRow = await pool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM feature_generation_runs`);
    res.json(paginated(rows, parseInt(totalRow.rows[0]?.c ?? '0', 10), page, limit));
  });

  router.get('/runs/:id', validate({ params: IdParam }), async (req, res) => {
    const r = await pool.query(`SELECT * FROM feature_generation_runs WHERE id = $1`, [req.params.id]);
    if (!r.rows[0]) throw new NotFoundError('Feature generation run');
    res.json(success(r.rows[0]));
  });

  // -------------------------- dictionary --------------------------

  router.get('/dictionary', async (req, res) => {
    const v = req.query.version ? String(req.query.version) : undefined;
    const rows = await api.getDictionary(v);

    // Group by feature_group for readability
    const grouped: Record<string, unknown[]> = {};
    for (const r of rows as Array<{ feature_group: string }>) {
      const g = r.feature_group;
      grouped[g] = grouped[g] ?? [];
      grouped[g].push(r);
    }
    res.json(success({ version: v ?? 'all', grouped, flat: rows }));
  });

  // -------------------------- mart queries --------------------------

  router.get('/forward-samples', validate({ query: ListQuery }), async (req, res) => {
    const q = req.query as unknown as z.infer<typeof ListQuery>;
    const result = await api.getForwardSamples({
      ...(q.feature_set_version ? { feature_set_version: q.feature_set_version } : {}),
      ...(q.product_category_code ? { product_category_code: q.product_category_code } : {}),
      ...(q.target_metric ? { target_metric: q.target_metric } : {}),
      ...(q.is_complete !== undefined ? { is_complete: q.is_complete } : {}),
      ...(q.formula_version_id ? { formula_version_id: q.formula_version_id } : {}),
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    res.json(paginated(result.items, result.total, q.page, q.pageSize));
  });

  router.get('/inverse-base', validate({ query: ListQuery }), async (req, res) => {
    const q = req.query as unknown as z.infer<typeof ListQuery>;
    const result = await api.getInverseAnchors({
      ...(q.feature_set_version ? { feature_set_version: q.feature_set_version } : {}),
      ...(q.product_category_code ? { product_category_code: q.product_category_code } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.formula_version_id ? { formula_version_id: q.formula_version_id } : {}),
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    res.json(paginated(result.items, result.total, q.page, q.pageSize));
  });

  router.get('/forward-matrix', validate({ query: MatrixQuery }), async (req, res) => {
    const q = req.query as unknown as z.infer<typeof MatrixQuery>;
    const featureNames = q.feature_names.split(',').map((s) => s.trim()).filter(Boolean);
    const matrix = await api.getForwardMatrix({
      feature_set_version: q.feature_set_version,
      ...(q.product_category_code ? { product_category_code: q.product_category_code } : {}),
      target_metric: q.target_metric,
      feature_names: featureNames,
      ...(q.is_complete !== undefined ? { is_complete: q.is_complete } : {}),
      limit: q.limit,
    });
    res.json(success({
      feature_names: matrix.feature_names,
      shape: { rows: matrix.X.length, cols: matrix.feature_names.length },
      X: matrix.X,
      y: matrix.y,
      weights: matrix.weights,
      formula_version_ids: matrix.formula_version_ids,
      batch_codes: matrix.batch_codes,
    }));
  });

  router.get('/formula-version/:id', validate({ params: IdParam }), async (req, res) => {
    const v = req.query.version ? String(req.query.version) : undefined;
    const cached = await api.getFormulaFeatures(req.params.id, v);
    if (!cached) throw new NotFoundError('Features for that formula_version');
    res.json(success(cached));
  });

  return router;
}
