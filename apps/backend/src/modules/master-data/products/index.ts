import { Router, Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { ConflictError, NotFoundError } from '../../../lib/errors.js';
import { validate } from '../../../middleware/validate.js';
import { success, paginated } from '../../../lib/response.js';
import { paginationClause, buildUpdateSet } from '../../../lib/sql.js';

const ProductCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  product_type: z.enum(['finished','semi_finished','intermediate','sample']).default('finished'),
  category_id: z.string().uuid().optional().nullable(),
  description: z.string().optional().nullable(),
  status: z.enum(['development','testing','approved','production','discontinued','archived']).default('development'),
  lifecycle_stage: z.string().optional().nullable(),
  target_specifications: z.record(z.unknown()).optional(),
  intended_use: z.string().optional().nullable(),
  market_segment: z.string().optional().nullable(),
  unit_of_measure: z.string().default('kg'),
  package_size: z.number().nonnegative().optional().nullable(),
  package_unit: z.string().optional().nullable(),
  list_price: z.number().nonnegative().optional().nullable(),
  price_currency: z.string().length(3).optional(),
  regulatory_codes: z.array(z.string()).optional(),
  certifications: z.array(z.string()).optional(),
  properties: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});
const ProductUpdateSchema = ProductCreateSchema.partial().extend({
  expected_version: z.number().int().nonnegative(),
});
const ProductListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().optional(),
  status: z.string().optional(),
  product_type: z.string().optional(),
  category_id: z.string().uuid().optional(),
  tag: z.string().optional(),
  orderBy: z.enum(['code','name','created_at']).default('created_at'),
  orderDir: z.enum(['asc','desc']).default('desc'),
});
const IdParam = z.object({ id: z.string().uuid() });
const SpecCreateSchema = z.object({
  spec_code: z.string().min(1).max(64),
  spec_name: z.string().min(1).max(255),
  test_method: z.string().optional().nullable(),
  unit_of_measure: z.string().optional().nullable(),
  target_value: z.number().optional().nullable(),
  min_value: z.number().optional().nullable(),
  max_value: z.number().optional().nullable(),
  tolerance_pct: z.number().optional().nullable(),
  is_critical: z.boolean().optional(),
});

export function buildProductsRouter(pool: Pool): Router {
  const router = Router();
  const userId = (req: Request) => (req as Request & { userId?: string }).userId ?? null;

  router.get('/', validate({ query: ProductListQuery }), async (req, res) => {
    const q = req.query as unknown as z.infer<typeof ProductListQuery>;
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (q.q)             { where.push(`(code ILIKE $${i} OR name ILIKE $${i})`); params.push(`%${q.q}%`); i++; }
    if (q.status)        { where.push(`status = $${i}`); params.push(q.status); i++; }
    if (q.product_type)  { where.push(`product_type = $${i}`); params.push(q.product_type); i++; }
    if (q.category_id)   { where.push(`category_id = $${i}`); params.push(q.category_id); i++; }
    if (q.tag)           { where.push(`tags @> ARRAY[$${i}]::text[]`); params.push(q.tag); i++; }

    const total = parseInt(
      (await pool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM products WHERE ${where.join(' AND ')}`, params)).rows[0]?.c ?? '0',
      10
    );
    const pg = paginationClause(q, ['created_at','code','name'], params.length);
    const rows = (await pool.query(
      `SELECT * FROM products WHERE ${where.join(' AND ')} ${pg.sql}`,
      [...params, ...pg.params]
    )).rows;
    res.json(paginated(rows, total, pg.page, pg.pageSize));
  });

  router.get('/:id', validate({ params: IdParam }), async (req, res) => {
    const r = await pool.query(`SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (!r.rows[0]) throw new NotFoundError('Product');
    const specs = await pool.query(
      `SELECT * FROM product_specifications WHERE product_id = $1 AND deleted_at IS NULL ORDER BY display_order, spec_code`,
      [req.params.id]
    );
    res.json(success({ ...r.rows[0], specifications: specs.rows }));
  });

  router.post('/', validate({ body: ProductCreateSchema }), async (req, res) => {
    const input = req.body;
    const dup = await pool.query(`SELECT id FROM products WHERE code = $1 AND deleted_at IS NULL`, [input.code]);
    if (dup.rows[0]) throw new ConflictError(`Product with code '${input.code}' already exists`);
    const r = await pool.query(
      `INSERT INTO products (
         code, name, product_type, category_id, description, status, lifecycle_stage,
         target_specifications, intended_use, market_segment, unit_of_measure, package_size, package_unit,
         list_price, price_currency, regulatory_codes, certifications, properties, tags, metadata,
         created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21)
       RETURNING *`,
      [
        input.code, input.name, input.product_type, input.category_id ?? null, input.description ?? null,
        input.status, input.lifecycle_stage ?? null, input.target_specifications ?? {},
        input.intended_use ?? null, input.market_segment ?? null, input.unit_of_measure ?? 'kg',
        input.package_size ?? null, input.package_unit ?? null, input.list_price ?? null,
        input.price_currency ?? 'USD', input.regulatory_codes ?? [], input.certifications ?? [],
        input.properties ?? {}, input.tags ?? [], input.metadata ?? {}, userId(req),
      ]
    );
    res.status(201).json(success(r.rows[0], 'Product created'));
  });

  router.patch('/:id', validate({ params: IdParam, body: ProductUpdateSchema }), async (req, res) => {
    const { expected_version, ...rest } = req.body;
    const set = buildUpdateSet({ ...rest, updated_by: userId(req) });
    if (set.params.length === 0) {
      const cur = await pool.query(`SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
      if (!cur.rows[0]) throw new NotFoundError('Product');
      return res.json(success(cur.rows[0]));
    }
    const r = await pool.query(
      `UPDATE products SET ${set.sql}
        WHERE id = $${set.nextIndex} AND version = $${set.nextIndex + 1} AND deleted_at IS NULL
        RETURNING *`,
      [...set.params, req.params.id, expected_version]
    );
    if (!r.rows[0]) {
      const cur = await pool.query(`SELECT version FROM products WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
      if (!cur.rows[0]) throw new NotFoundError('Product');
      throw new ConflictError(`Version mismatch — current is ${cur.rows[0].version}`);
    }
    res.json(success(r.rows[0], 'Product updated'));
  });

  router.delete('/:id', validate({ params: IdParam }), async (req, res) => {
    const r = await pool.query(
      `UPDATE products SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if ((r.rowCount ?? 0) === 0) throw new NotFoundError('Product');
    res.status(204).end();
  });

  // Nested: product specifications
  router.get('/:id/specifications', validate({ params: IdParam }), async (req, res) => {
    const r = await pool.query(
      `SELECT * FROM product_specifications WHERE product_id = $1 AND deleted_at IS NULL ORDER BY display_order, spec_code`,
      [req.params.id]
    );
    res.json(success(r.rows));
  });

  router.post('/:id/specifications', validate({ params: IdParam, body: SpecCreateSchema }), async (req, res) => {
    const exists = await pool.query(`SELECT id FROM products WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (!exists.rows[0]) throw new NotFoundError('Product');
    const input = req.body;
    const r = await pool.query(
      `INSERT INTO product_specifications
         (product_id, spec_code, spec_name, test_method, unit_of_measure, target_value, min_value, max_value, tolerance_pct, is_critical, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       ON CONFLICT (product_id, spec_code) DO UPDATE
         SET spec_name = EXCLUDED.spec_name,
             test_method = EXCLUDED.test_method,
             unit_of_measure = EXCLUDED.unit_of_measure,
             target_value = EXCLUDED.target_value,
             min_value = EXCLUDED.min_value,
             max_value = EXCLUDED.max_value,
             tolerance_pct = EXCLUDED.tolerance_pct,
             is_critical = EXCLUDED.is_critical,
             updated_by = EXCLUDED.updated_by
       RETURNING *`,
      [
        req.params.id, input.spec_code, input.spec_name, input.test_method ?? null,
        input.unit_of_measure ?? null, input.target_value ?? null, input.min_value ?? null,
        input.max_value ?? null, input.tolerance_pct ?? null, input.is_critical ?? false,
        userId(req),
      ]
    );
    res.status(201).json(success(r.rows[0], 'Specification saved'));
  });

  return router;
}
