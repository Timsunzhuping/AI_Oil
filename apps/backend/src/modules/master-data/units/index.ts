import { Router, Request } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { BadRequestError, ConflictError, NotFoundError } from '../../../lib/errors.js';
import { validate } from '../../../middleware/validate.js';
import { success, paginated } from '../../../lib/response.js';
import { paginationClause, buildUpdateSet, normalizeAlias } from '../../../lib/sql.js';

const UnitCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  symbol: z.string().optional().nullable(),
  dimension: z.string().min(1).max(64),
  base_unit_code: z.string().optional().nullable(),
  is_si: z.boolean().optional(),
  is_active: z.boolean().optional(),
  display_order: z.number().int().optional(),
  description: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});
const UnitUpdateSchema = UnitCreateSchema.partial().extend({
  expected_version: z.number().int().nonnegative(),
});
const UnitListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().optional(),
  dimension: z.string().optional(),
  is_active: z.coerce.boolean().optional(),
  orderBy: z.enum(['code','name','dimension','display_order']).default('display_order'),
  orderDir: z.enum(['asc','desc']).default('asc'),
});
const ConvertQuery = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  value: z.coerce.number(),
});
const IdParam = z.object({ id: z.string().uuid() });
const AliasCreate = z.object({
  alias: z.string().min(1),
  language: z.string().optional(),
  source: z.enum(['manual','import','auto_suggested']).optional(),
});

export function buildUnitsRouter(pool: Pool): Router {
  const router = Router();
  const userId = (req: Request) => (req as Request & { userId?: string }).userId ?? null;

  router.get('/', validate({ query: UnitListQuery }), async (req, res) => {
    const q = req.query as unknown as z.infer<typeof UnitListQuery>;
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (q.q)         { where.push(`(code ILIKE $${i} OR name ILIKE $${i} OR symbol ILIKE $${i})`); params.push(`%${q.q}%`); i++; }
    if (q.dimension) { where.push(`dimension = $${i}`); params.push(q.dimension); i++; }
    if (q.is_active !== undefined) { where.push(`is_active = $${i}`); params.push(q.is_active); i++; }

    const total = parseInt(
      (await pool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM units WHERE ${where.join(' AND ')}`, params)).rows[0]?.c ?? '0',
      10
    );
    const pg = paginationClause(q, ['display_order','code','name','dimension'], params.length);
    const rows = (await pool.query(
      `SELECT * FROM units WHERE ${where.join(' AND ')} ${pg.sql}`,
      [...params, ...pg.params]
    )).rows;
    res.json(paginated(rows, total, pg.page, pg.pageSize));
  });

  // Resolve a free-form unit string to a standard unit
  router.get('/resolve', validate({ query: z.object({ q: z.string().min(1) }) }), async (req, res) => {
    const q = String(req.query.q);
    const norm = normalizeAlias(q);

    const byCode = await pool.query(
      `SELECT * FROM units WHERE LOWER(code) = $1 AND deleted_at IS NULL LIMIT 1`,
      [norm]
    );
    if (byCode.rows[0]) return res.json(success({ query: q, matched: true, matched_by: 'code', confidence: 1, unit: byCode.rows[0] }));

    const byAlias = await pool.query(
      `SELECT u.*, a.confidence::float8 AS alias_confidence
         FROM unit_aliases a
         JOIN units u ON u.id = a.unit_id
        WHERE a.alias_normalized = $1 AND a.is_active = TRUE AND a.deleted_at IS NULL AND u.deleted_at IS NULL
        LIMIT 1`,
      [norm]
    );
    if (byAlias.rows[0]) {
      const { alias_confidence, ...unit } = byAlias.rows[0];
      return res.json(success({ query: q, matched: true, matched_by: 'alias', confidence: Number(alias_confidence), unit }));
    }

    return res.json(success({ query: q, matched: false, matched_by: null, confidence: 0, unit: null }));
  });

  /**
   * Convert a value from one unit to another.
   * Resolves unit strings via aliases first, then applies the linear factor + offset.
   * For target = source * factor + offset.
   */
  router.get('/convert', validate({ query: ConvertQuery }), async (req, res) => {
    const { from, to, value } = req.query as unknown as z.infer<typeof ConvertQuery>;

    const resolveOne = async (alias: string) => {
      const norm = normalizeAlias(alias);
      const byCode = await pool.query<{ id: string; code: string; dimension: string }>(
        `SELECT id, code, dimension FROM units WHERE LOWER(code) = $1 AND deleted_at IS NULL LIMIT 1`,
        [norm]
      );
      if (byCode.rows[0]) return byCode.rows[0];
      const byAlias = await pool.query<{ id: string; code: string; dimension: string }>(
        `SELECT u.id, u.code, u.dimension
           FROM unit_aliases a JOIN units u ON u.id = a.unit_id
          WHERE a.alias_normalized = $1 AND a.is_active AND a.deleted_at IS NULL AND u.deleted_at IS NULL
          LIMIT 1`,
        [norm]
      );
      return byAlias.rows[0] ?? null;
    };

    const fromUnit = await resolveOne(from);
    const toUnit = await resolveOne(to);
    if (!fromUnit) throw new BadRequestError(`Unknown unit: '${from}'`);
    if (!toUnit) throw new BadRequestError(`Unknown unit: '${to}'`);

    if (fromUnit.id === toUnit.id) {
      return res.json(success({ value, from: fromUnit.code, to: toUnit.code, factor: 1, offset: 0 }));
    }

    if (fromUnit.dimension !== toUnit.dimension) {
      throw new BadRequestError(
        `Cannot convert across dimensions: ${fromUnit.dimension} → ${toUnit.dimension}`
      );
    }

    // Direct conversion
    const direct = await pool.query<{ factor: string; offset_value: string; formula: string | null }>(
      `SELECT factor, offset_value, formula FROM unit_conversions
        WHERE from_unit_id = $1 AND to_unit_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [fromUnit.id, toUnit.id]
    );
    if (direct.rows[0]) {
      const factor = Number(direct.rows[0].factor);
      const offset = Number(direct.rows[0].offset_value);
      return res.json(
        success({
          value: value * factor + offset,
          from: fromUnit.code,
          to: toUnit.code,
          factor,
          offset,
          formula: direct.rows[0].formula,
        })
      );
    }

    // Try indirect: from → base → to
    const fromToBase = await pool.query<{ factor: string; offset_value: string; to_id: string }>(
      `SELECT uc.factor, uc.offset_value, uc.to_unit_id AS to_id
         FROM unit_conversions uc JOIN units b ON b.id = uc.to_unit_id
        WHERE uc.from_unit_id = $1 AND b.code = (SELECT base_unit_code FROM units WHERE id = $1)
        LIMIT 1`,
      [fromUnit.id]
    );
    const baseToTo = await pool.query<{ factor: string; offset_value: string }>(
      `SELECT uc.factor, uc.offset_value
         FROM unit_conversions uc JOIN units b ON b.id = uc.from_unit_id
        WHERE uc.to_unit_id = $1 AND b.code = (SELECT base_unit_code FROM units WHERE id = $1)
        LIMIT 1`,
      [toUnit.id]
    );
    if (fromToBase.rows[0] && baseToTo.rows[0]) {
      const f1 = Number(fromToBase.rows[0].factor);
      const o1 = Number(fromToBase.rows[0].offset_value);
      const f2 = Number(baseToTo.rows[0].factor);
      const o2 = Number(baseToTo.rows[0].offset_value);
      const intermediate = value * f1 + o1;
      const final = intermediate * f2 + o2;
      return res.json(
        success({
          value: final,
          from: fromUnit.code,
          to: toUnit.code,
          via_base: true,
          chain: [{ factor: f1, offset: o1 }, { factor: f2, offset: o2 }],
        })
      );
    }

    throw new BadRequestError(
      `No conversion rule found from '${fromUnit.code}' to '${toUnit.code}'`
    );
  });

  router.get('/:id', validate({ params: IdParam }), async (req, res) => {
    const r = await pool.query(`SELECT * FROM units WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (!r.rows[0]) throw new NotFoundError('Unit');
    const aliases = await pool.query(
      `SELECT id, alias, language, confidence::float8 AS confidence, is_active
         FROM unit_aliases WHERE unit_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(success({ ...r.rows[0], aliases: aliases.rows }));
  });

  router.post('/', validate({ body: UnitCreateSchema }), async (req, res) => {
    const input = req.body;
    const dup = await pool.query(`SELECT id FROM units WHERE code = $1 AND deleted_at IS NULL`, [input.code]);
    if (dup.rows[0]) throw new ConflictError(`Unit with code '${input.code}' already exists`);
    const r = await pool.query(
      `INSERT INTO units (code, name, symbol, dimension, base_unit_code, is_si, is_active, display_order, description, metadata, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       RETURNING *`,
      [
        input.code, input.name, input.symbol ?? null, input.dimension,
        input.base_unit_code ?? null, input.is_si ?? false, input.is_active ?? true,
        input.display_order ?? 0, input.description ?? null, input.metadata ?? {},
        userId(req),
      ]
    );
    res.status(201).json(success(r.rows[0], 'Unit created'));
  });

  router.patch('/:id', validate({ params: IdParam, body: UnitUpdateSchema }), async (req, res) => {
    const { expected_version, ...rest } = req.body;
    const set = buildUpdateSet({ ...rest, updated_by: userId(req) });
    if (set.params.length === 0) {
      const cur = await pool.query(`SELECT * FROM units WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
      if (!cur.rows[0]) throw new NotFoundError('Unit');
      return res.json(success(cur.rows[0]));
    }
    const r = await pool.query(
      `UPDATE units SET ${set.sql}
        WHERE id = $${set.nextIndex} AND version = $${set.nextIndex + 1} AND deleted_at IS NULL
        RETURNING *`,
      [...set.params, req.params.id, expected_version]
    );
    if (!r.rows[0]) {
      const cur = await pool.query(`SELECT version FROM units WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
      if (!cur.rows[0]) throw new NotFoundError('Unit');
      throw new ConflictError(`Version mismatch — current is ${cur.rows[0].version}`);
    }
    res.json(success(r.rows[0], 'Unit updated'));
  });

  router.delete('/:id', validate({ params: IdParam }), async (req, res) => {
    const r = await pool.query(
      `UPDATE units SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if ((r.rowCount ?? 0) === 0) throw new NotFoundError('Unit');
    res.status(204).end();
  });

  router.post('/:id/aliases', validate({ params: IdParam, body: AliasCreate }), async (req, res) => {
    const exists = await pool.query(`SELECT id FROM units WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (!exists.rows[0]) throw new NotFoundError('Unit');
    const r = await pool.query(
      `INSERT INTO unit_aliases (unit_id, alias, alias_normalized, language, source, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (unit_id, alias_normalized) DO UPDATE SET is_active = TRUE
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
