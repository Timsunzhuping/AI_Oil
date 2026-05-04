import { Router, Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { ConflictError, NotFoundError } from '../../../lib/errors.js';
import { validate } from '../../../middleware/validate.js';
import { success, paginated } from '../../../lib/response.js';
import { paginationClause, buildUpdateSet } from '../../../lib/sql.js';

const SupplierCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  contact_email: z.string().email().optional().nullable(),
  contact_phone: z.string().optional().nullable(),
  contact_person: z.string().optional().nullable(),
  country_code: z.string().length(2).optional().nullable(),
  address: z.string().optional().nullable(),
  website: z.string().url().optional().nullable(),
  qualification_status: z.enum(['pending','qualified','provisional','disqualified']).default('pending'),
  qualified_until: z.string().date().optional().nullable(),
  rating: z.number().min(0).max(5).optional().nullable(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});
const SupplierUpdateSchema = SupplierCreateSchema.partial().extend({
  expected_version: z.number().int().nonnegative(),
});
const SupplierListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().optional(),
  qualification_status: z.string().optional(),
  country_code: z.string().length(2).optional(),
  orderBy: z.enum(['code','name','created_at','rating']).default('created_at'),
  orderDir: z.enum(['asc','desc']).default('desc'),
});
const IdParam = z.object({ id: z.string().uuid() });

export function buildSuppliersRouter(pool: Pool): Router {
  const router = Router();

  router.get('/', validate({ query: SupplierListQuery }), async (req, res) => {
    const q = req.query as unknown as z.infer<typeof SupplierListQuery>;
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (q.q) { where.push(`(code ILIKE $${i} OR name ILIKE $${i})`); params.push(`%${q.q}%`); i++; }
    if (q.qualification_status) { where.push(`qualification_status = $${i}`); params.push(q.qualification_status); i++; }
    if (q.country_code) { where.push(`country_code = $${i}`); params.push(q.country_code.toUpperCase()); i++; }

    const total = parseInt(
      (await pool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM suppliers WHERE ${where.join(' AND ')}`, params)).rows[0]?.c ?? '0',
      10
    );
    const pg = paginationClause(q, ['created_at','code','name','rating'], params.length);
    const rows = (await pool.query(
      `SELECT * FROM suppliers WHERE ${where.join(' AND ')} ${pg.sql}`,
      [...params, ...pg.params]
    )).rows;
    res.json(paginated(rows, total, pg.page, pg.pageSize));
  });

  router.get('/:id', validate({ params: IdParam }), async (req, res) => {
    const r = await pool.query(`SELECT * FROM suppliers WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (!r.rows[0]) throw new NotFoundError('Supplier');
    res.json(success(r.rows[0]));
  });

  router.post('/', validate({ body: SupplierCreateSchema }), async (req, res) => {
    const input = req.body;
    const dup = await pool.query(`SELECT id FROM suppliers WHERE code = $1 AND deleted_at IS NULL`, [input.code]);
    if (dup.rows[0]) throw new ConflictError(`Supplier with code '${input.code}' already exists`);
    const r = await pool.query(
      `INSERT INTO suppliers (code, name, contact_email, contact_phone, contact_person, country_code,
                              address, website, qualification_status, qualified_until, rating, is_active,
                              metadata, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
       RETURNING *`,
      [
        input.code, input.name, input.contact_email ?? null, input.contact_phone ?? null,
        input.contact_person ?? null, input.country_code?.toUpperCase() ?? null,
        input.address ?? null, input.website ?? null, input.qualification_status,
        input.qualified_until ?? null, input.rating ?? null, input.is_active ?? true,
        input.metadata ?? {}, (req as Request & { userId?: string }).userId ?? null,
      ]
    );
    res.status(201).json(success(r.rows[0], 'Supplier created'));
  });

  router.patch('/:id', validate({ params: IdParam, body: SupplierUpdateSchema }), async (req, res) => {
    const { expected_version, ...rest } = req.body;
    if (rest.country_code) rest.country_code = rest.country_code.toUpperCase();
    const set = buildUpdateSet({ ...rest, updated_by: (req as Request & { userId?: string }).userId ?? null });
    if (set.params.length === 0) {
      const cur = await pool.query(`SELECT * FROM suppliers WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
      if (!cur.rows[0]) throw new NotFoundError('Supplier');
      return res.json(success(cur.rows[0]));
    }
    const r = await pool.query(
      `UPDATE suppliers SET ${set.sql}
        WHERE id = $${set.nextIndex} AND version = $${set.nextIndex + 1} AND deleted_at IS NULL
        RETURNING *`,
      [...set.params, req.params.id, expected_version]
    );
    if (!r.rows[0]) {
      const cur = await pool.query(`SELECT version FROM suppliers WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
      if (!cur.rows[0]) throw new NotFoundError('Supplier');
      throw new ConflictError(`Version mismatch — current is ${cur.rows[0].version}`);
    }
    res.json(success(r.rows[0], 'Supplier updated'));
  });

  router.delete('/:id', validate({ params: IdParam }), async (req, res) => {
    const r = await pool.query(
      `UPDATE suppliers SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if ((r.rowCount ?? 0) === 0) throw new NotFoundError('Supplier');
    res.status(204).end();
  });

  return router;
}
