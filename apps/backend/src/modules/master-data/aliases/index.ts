import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { BadRequestError, NotFoundError } from '../../../lib/errors.js';
import { validate } from '../../../middleware/validate.js';
import { success, paginated } from '../../../lib/response.js';
import { paginationClause } from '../../../lib/sql.js';

/**
 * Cross-resource alias browser:
 *   GET    /aliases?type=material|metric|unit&q=...
 *   DELETE /aliases/:type/:id
 *
 * Per-resource creation lives on the resource itself
 * (e.g. POST /materials/:id/aliases).
 */

const ListQuery = z.object({
  type: z.enum(['material','metric','unit']),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().optional(),
  is_active: z.coerce.boolean().optional(),
});

const DeleteParams = z.object({
  type: z.enum(['material','metric','unit']),
  id: z.string().uuid(),
});

const TYPE_TO_TABLE: Record<string, { table: string; targetCol: string; targetTable: string; nameCol: string }> = {
  material: {
    table: 'raw_material_aliases',
    targetCol: 'raw_material_id',
    targetTable: 'raw_materials',
    nameCol: 'name',
  },
  metric:   { table: 'metric_aliases',  targetCol: 'metric_id',   targetTable: 'metrics', nameCol: 'name_std' },
  unit:     { table: 'unit_aliases',    targetCol: 'unit_id',     targetTable: 'units',   nameCol: 'name' },
};

export function buildAliasesRouter(pool: Pool): Router {
  const router = Router();

  router.get('/', validate({ query: ListQuery }), async (req, res) => {
    const q = req.query as unknown as z.infer<typeof ListQuery>;
    const cfg = TYPE_TO_TABLE[q.type];
    if (!cfg) throw new BadRequestError(`Unknown alias type: ${q.type}`);

    const where: string[] = ['a.deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (q.q) {
      where.push(`(a.alias ILIKE $${i} OR a.alias_normalized ILIKE $${i})`);
      params.push(`%${q.q}%`);
      i++;
    }
    if (q.is_active !== undefined) {
      where.push(`a.is_active = $${i}`);
      params.push(q.is_active);
      i++;
    }

    const total = parseInt(
      (await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text c FROM ${cfg.table} a WHERE ${where.join(' AND ')}`,
        params
      )).rows[0]?.c ?? '0',
      10
    );

    const pg = paginationClause(
      { ...q, orderBy: 'a.created_at' as never },
      ['a.created_at', 'a.alias_normalized'],
      params.length
    );

    const sql = `
      SELECT a.id, a.alias, a.alias_normalized, a.${cfg.targetCol} AS target_id,
             a.confidence::float8 AS confidence, a.is_active, a.created_at,
             t.code AS target_code, t.${cfg.nameCol} AS target_name
        FROM ${cfg.table} a
        JOIN ${cfg.targetTable} t ON t.id = a.${cfg.targetCol}
       WHERE ${where.join(' AND ')}
       ${pg.sql}`;
    const rows = (await pool.query(sql, [...params, ...pg.params])).rows;

    res.json(
      paginated(
        rows.map((r) => ({ ...r, type: q.type })),
        total,
        pg.page,
        pg.pageSize
      )
    );
  });

  router.delete('/:type/:id', validate({ params: DeleteParams }), async (req, res) => {
    const cfg = TYPE_TO_TABLE[req.params.type];
    if (!cfg) throw new BadRequestError(`Unknown alias type: ${req.params.type}`);
    const r = await pool.query(
      `UPDATE ${cfg.table} SET deleted_at = NOW(), is_active = FALSE
        WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if ((r.rowCount ?? 0) === 0) throw new NotFoundError('Alias');
    res.status(204).end();
  });

  return router;
}
