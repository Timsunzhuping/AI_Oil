import { Router, Request } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { ConflictError, NotFoundError } from '../../../lib/errors.js';
import { validate } from '../../../middleware/validate.js';
import { success, paginated } from '../../../lib/response.js';
import { paginationClause, buildUpdateSet, normalizeAlias } from '../../../lib/sql.js';

const MetricCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name_std: z.string().min(1).max(255),
  name_short: z.string().optional().nullable(),
  category: z.enum(['physical','chemical','microbiological','sensory','rheological','thermal','electrical','optical','other']).default('physical'),
  data_type: z.enum(['numeric','text','boolean','spectrum','image','attachment']).default('numeric'),
  default_unit_id: z.string().uuid().optional().nullable(),
  expected_min: z.number().optional().nullable(),
  expected_max: z.number().optional().nullable(),
  description: z.string().optional().nullable(),
  test_method: z.string().optional().nullable(),
  references: z.unknown().optional(),
  precision_decimals: z.number().int().min(0).max(10).optional().nullable(),
  is_active: z.boolean().optional(),
  display_order: z.number().int().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});
const MetricUpdateSchema = MetricCreateSchema.partial().extend({
  expected_version: z.number().int().nonnegative(),
});
const MetricListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().optional(),
  category: z.string().optional(),
  data_type: z.string().optional(),
  is_active: z.coerce.boolean().optional(),
  orderBy: z.enum(['code','name_std','category','created_at']).default('code'),
  orderDir: z.enum(['asc','desc']).default('asc'),
});
const IdParam = z.object({ id: z.string().uuid() });
const ResolveQuery = z.object({ q: z.string().min(1) });
const AliasCreateSchema = z.object({
  alias: z.string().min(1),
  language: z.string().optional(),
  source: z.enum(['manual','import','auto_suggested']).optional(),
});

export function buildMetricsRouter(pool: Pool): Router {
  const router = Router();
  const userId = (req: Request) => (req as Request & { userId?: string }).userId ?? null;

  router.get('/', validate({ query: MetricListQuery }), async (req, res) => {
    const q = req.query as unknown as z.infer<typeof MetricListQuery>;
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (q.q)         { where.push(`(code ILIKE $${i} OR name_std ILIKE $${i} OR name_short ILIKE $${i})`); params.push(`%${q.q}%`); i++; }
    if (q.category)  { where.push(`category = $${i}`); params.push(q.category); i++; }
    if (q.data_type) { where.push(`data_type = $${i}`); params.push(q.data_type); i++; }
    if (q.is_active !== undefined) { where.push(`is_active = $${i}`); params.push(q.is_active); i++; }

    const total = parseInt(
      (await pool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM metrics WHERE ${where.join(' AND ')}`, params)).rows[0]?.c ?? '0',
      10
    );
    const pg = paginationClause(q, ['code','name_std','category','created_at'], params.length);
    const rows = (await pool.query(
      `SELECT * FROM metrics WHERE ${where.join(' AND ')} ${pg.sql}`,
      [...params, ...pg.params]
    )).rows;
    res.json(paginated(rows, total, pg.page, pg.pageSize));
  });

  // Resolve a free-form metric name to a standard metric.
  router.get('/resolve', validate({ query: ResolveQuery }), async (req, res) => {
    const { q } = req.query as unknown as z.infer<typeof ResolveQuery>;
    const norm = normalizeAlias(q);

    // 1. exact code
    const byCode = await pool.query(
      `SELECT * FROM metrics WHERE LOWER(code) = $1 AND deleted_at IS NULL LIMIT 1`,
      [norm]
    );
    if (byCode.rows[0]) {
      return res.json(success({ query: q, matched: true, matched_by: 'code', confidence: 1, metric: byCode.rows[0] }));
    }

    // 2. governed alias
    const byAlias = await pool.query(
      `SELECT m.*, a.confidence::float8 AS alias_confidence
         FROM metric_aliases a
         JOIN metrics m ON m.id = a.metric_id
        WHERE a.alias_normalized = $1 AND a.is_active = TRUE AND a.deleted_at IS NULL AND m.deleted_at IS NULL
        LIMIT 1`,
      [norm]
    );
    if (byAlias.rows[0]) {
      const { alias_confidence, ...metric } = byAlias.rows[0];
      return res.json(success({ query: q, matched: true, matched_by: 'alias', confidence: Number(alias_confidence), metric }));
    }

    // 3. fuzzy
    const fuzzy = await pool.query(
      `SELECT *, similarity(name_std, $1) AS sim
         FROM metrics
        WHERE deleted_at IS NULL AND name_std % $1
        ORDER BY sim DESC LIMIT 1`,
      [q]
    );
    if (fuzzy.rows[0] && fuzzy.rows[0].sim > 0.4) {
      const { sim, ...metric } = fuzzy.rows[0];
      return res.json(success({ query: q, matched: true, matched_by: 'fuzzy', confidence: Number(sim), metric }));
    }

    res.json(success({ query: q, matched: false, matched_by: null, confidence: 0, metric: null }));
  });

  router.get('/:id', validate({ params: IdParam }), async (req, res) => {
    const r = await pool.query(`SELECT * FROM metrics WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (!r.rows[0]) throw new NotFoundError('Metric');
    const aliases = await pool.query(
      `SELECT id, alias, language, confidence::float8 AS confidence, is_active
         FROM metric_aliases WHERE metric_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(success({ ...r.rows[0], aliases: aliases.rows }));
  });

  router.post('/', validate({ body: MetricCreateSchema }), async (req, res) => {
    const input = req.body;
    const dup = await pool.query(`SELECT id FROM metrics WHERE code = $1 AND deleted_at IS NULL`, [input.code]);
    if (dup.rows[0]) throw new ConflictError(`Metric with code '${input.code}' already exists`);
    const r = await pool.query(
      `INSERT INTO metrics (
         code, name_std, name_short, category, data_type, default_unit_id,
         expected_min, expected_max, description, test_method, "references",
         precision_decimals, is_active, display_order, tags, metadata, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
       RETURNING *`,
      [
        input.code, input.name_std, input.name_short ?? null, input.category, input.data_type,
        input.default_unit_id ?? null, input.expected_min ?? null, input.expected_max ?? null,
        input.description ?? null, input.test_method ?? null, input.references ?? null,
        input.precision_decimals ?? null, input.is_active ?? true, input.display_order ?? 0,
        input.tags ?? [], input.metadata ?? {}, userId(req),
      ]
    );
    res.status(201).json(success(r.rows[0], 'Metric created'));
  });

  router.patch('/:id', validate({ params: IdParam, body: MetricUpdateSchema }), async (req, res) => {
    const { expected_version, ...rest } = req.body;
    // Quote 'references' since it's a SQL keyword
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) safe[k === 'references' ? '"references"' : k] = v;
    safe.updated_by = userId(req);
    const set = buildUpdateSet(safe);
    if (set.params.length === 0) {
      const cur = await pool.query(`SELECT * FROM metrics WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
      if (!cur.rows[0]) throw new NotFoundError('Metric');
      return res.json(success(cur.rows[0]));
    }
    const r = await pool.query(
      `UPDATE metrics SET ${set.sql}
        WHERE id = $${set.nextIndex} AND version = $${set.nextIndex + 1} AND deleted_at IS NULL
        RETURNING *`,
      [...set.params, req.params.id, expected_version]
    );
    if (!r.rows[0]) {
      const cur = await pool.query(`SELECT version FROM metrics WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
      if (!cur.rows[0]) throw new NotFoundError('Metric');
      throw new ConflictError(`Version mismatch — current is ${cur.rows[0].version}`);
    }
    res.json(success(r.rows[0], 'Metric updated'));
  });

  router.delete('/:id', validate({ params: IdParam }), async (req, res) => {
    const r = await pool.query(
      `UPDATE metrics SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if ((r.rowCount ?? 0) === 0) throw new NotFoundError('Metric');
    res.status(204).end();
  });

  // Aliases
  router.get('/:id/aliases', validate({ params: IdParam }), async (req, res) => {
    const r = await pool.query(
      `SELECT id, alias, language, confidence::float8 AS confidence, is_active
         FROM metric_aliases WHERE metric_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(success(r.rows));
  });

  router.post('/:id/aliases', validate({ params: IdParam, body: AliasCreateSchema }), async (req, res) => {
    const exists = await pool.query(`SELECT id FROM metrics WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (!exists.rows[0]) throw new NotFoundError('Metric');
    const r = await pool.query(
      `INSERT INTO metric_aliases (metric_id, alias, alias_normalized, language, source, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (metric_id, alias_normalized) DO UPDATE SET is_active = TRUE
       RETURNING id, alias, alias_normalized`,
      [
        req.params.id, req.body.alias, normalizeAlias(req.body.alias),
        req.body.language ?? null, req.body.source ?? 'manual', userId(req),
      ]
    );
    res.status(201).json(success(r.rows[0], 'Alias created'));
  });

  return router;
}
