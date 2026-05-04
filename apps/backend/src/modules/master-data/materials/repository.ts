import type { Pool, PoolClient } from 'pg';
import type { MaterialCreateInput, MaterialUpdateInput, MaterialListQuery } from './schemas.js';
import { paginationClause, buildUpdateSet, normalizeAlias } from '../../../lib/sql.js';

export interface MaterialRow {
  id: string;
  code: string;
  name: string;
  cas_number: string | null;
  category_id: string | null;
  status: string;
  unit_of_measure: string;
  default_supplier_id: string | null;
  density: number | null;
  viscosity_cst: number | null;
  flash_point_c: number | null;
  is_active: boolean;
  properties: Record<string, unknown>;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  version: number;
  deleted_at: Date | null;
}

export class MaterialsRepository {
  constructor(private pool: Pool) {}

  private exec(client: Pool | PoolClient = this.pool) {
    return client;
  }

  async findById(id: string, client?: PoolClient): Promise<MaterialRow | null> {
    const r = await this.exec(client).query<MaterialRow>(
      `SELECT * FROM raw_materials WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return r.rows[0] ?? null;
  }

  async findByCode(code: string, client?: PoolClient): Promise<MaterialRow | null> {
    const r = await this.exec(client).query<MaterialRow>(
      `SELECT * FROM raw_materials WHERE code = $1 AND deleted_at IS NULL`,
      [code]
    );
    return r.rows[0] ?? null;
  }

  async list(query: MaterialListQuery): Promise<{ items: MaterialRow[]; total: number; page: number; pageSize: number }> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;

    if (query.q) {
      where.push(`(code ILIKE $${i} OR name ILIKE $${i})`);
      params.push(`%${query.q}%`);
      i++;
    }
    if (query.category_id) {
      where.push(`category_id = $${i}`);
      params.push(query.category_id);
      i++;
    }
    if (query.status) {
      where.push(`status = $${i}`);
      params.push(query.status);
      i++;
    }
    if (query.tag) {
      where.push(`tags @> ARRAY[$${i}]::text[]`);
      params.push(query.tag);
      i++;
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM raw_materials ${whereClause}`,
      params
    );
    const total = parseInt(totalRes.rows[0]?.count ?? '0', 10);

    const pg = paginationClause(query, ['created_at', 'updated_at', 'code', 'name'], params.length);
    const rowsRes = await this.pool.query<MaterialRow>(
      `SELECT * FROM raw_materials ${whereClause} ${pg.sql}`,
      [...params, ...pg.params]
    );

    return { items: rowsRes.rows, total, page: pg.page, pageSize: pg.pageSize };
  }

  async insert(
    input: MaterialCreateInput,
    actor: { userId?: string },
    client?: PoolClient
  ): Promise<MaterialRow> {
    const cols: string[] = [];
    const placeholders: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const push = (col: string, val: unknown) => {
      cols.push(col);
      placeholders.push(`$${i++}`);
      params.push(val);
    };
    push('code', input.code);
    push('name', input.name);
    push('cas_number', input.cas_number ?? null);
    push('einecs_number', input.einecs_number ?? null);
    push('hs_code', input.hs_code ?? null);
    push('category_id', input.category_id ?? null);
    push('description', input.description ?? null);
    push('physical_state', input.physical_state ?? null);
    push('density', input.density ?? null);
    push('molecular_weight', input.molecular_weight ?? null);
    push('melting_point_c', input.melting_point_c ?? null);
    push('boiling_point_c', input.boiling_point_c ?? null);
    push('flash_point_c', input.flash_point_c ?? null);
    push('viscosity_cst', input.viscosity_cst ?? null);
    push('ph_value', input.ph_value ?? null);
    push('unit_of_measure', input.unit_of_measure ?? 'kg');
    push('default_supplier_id', input.default_supplier_id ?? null);
    push('default_unit_cost', input.default_unit_cost ?? null);
    push('cost_currency', input.cost_currency ?? 'USD');
    push('shelf_life_days', input.shelf_life_days ?? null);
    push('storage_conditions', input.storage_conditions ?? null);
    push('hazard_class', input.hazard_class ?? null);
    push('ghs_codes', input.ghs_codes ?? []);
    push('is_restricted', input.is_restricted ?? false);
    push('is_controlled', input.is_controlled ?? false);
    push('status', input.status ?? 'active');
    push('alternate_names', input.alternate_names ?? []);
    push('properties', input.properties ?? {});
    push('tags', input.tags ?? []);
    push('metadata', input.metadata ?? {});
    push('created_by', actor.userId ?? null);
    push('updated_by', actor.userId ?? null);

    const r = await this.exec(client).query<MaterialRow>(
      `INSERT INTO raw_materials (${cols.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`,
      params
    );
    return r.rows[0]!;
  }

  async update(
    id: string,
    input: MaterialUpdateInput,
    actor: { userId?: string },
    client?: PoolClient
  ): Promise<MaterialRow | null> {
    const { expected_version, ...rest } = input;

    const set = buildUpdateSet({
      ...rest,
      updated_by: actor.userId ?? null,
    });
    if (set.params.length === 0) return this.findById(id, client);

    const sql = `
      UPDATE raw_materials
         SET ${set.sql}
       WHERE id = $${set.nextIndex}
         AND version = $${set.nextIndex + 1}
         AND deleted_at IS NULL
       RETURNING *`;
    const r = await this.exec(client).query<MaterialRow>(sql, [...set.params, id, expected_version]);
    return r.rows[0] ?? null;
  }

  async softDelete(id: string, actor: { userId?: string }, client?: PoolClient): Promise<boolean> {
    const r = await this.exec(client).query(
      `UPDATE raw_materials SET deleted_at = NOW(), updated_by = $2
        WHERE id = $1 AND deleted_at IS NULL`,
      [id, actor.userId ?? null]
    );
    return (r.rowCount ?? 0) > 0;
  }

  // ---------------------- alias resolution ----------------------

  async resolveByQuery(q: string, client?: PoolClient): Promise<{
    material: MaterialRow | null;
    matchedBy: 'code' | 'alias' | 'fuzzy' | null;
    aliasId?: string;
    confidence: number;
  }> {
    const exec = this.exec(client);
    const norm = normalizeAlias(q);

    // 1. exact code match
    const byCode = await exec.query<MaterialRow>(
      `SELECT * FROM raw_materials WHERE LOWER(code) = $1 AND deleted_at IS NULL LIMIT 1`,
      [norm]
    );
    if (byCode.rows[0]) return { material: byCode.rows[0], matchedBy: 'code', confidence: 1 };

    // 2. governed alias
    const byAlias = await exec.query<MaterialRow & { alias_id: string; confidence: number }>(
      `SELECT m.*, a.id AS alias_id, a.confidence
         FROM raw_material_aliases a
         JOIN raw_materials m ON m.id = a.raw_material_id
        WHERE a.alias_normalized = $1
          AND a.is_active = TRUE
          AND a.deleted_at IS NULL
          AND m.deleted_at IS NULL
        LIMIT 1`,
      [norm]
    );
    if (byAlias.rows[0]) {
      const { alias_id, confidence, ...rest } = byAlias.rows[0];
      return {
        material: rest as MaterialRow,
        matchedBy: 'alias',
        aliasId: alias_id,
        confidence: Number(confidence),
      };
    }

    // 3. fuzzy trigram match — best similarity above threshold
    const fuzzy = await exec.query<MaterialRow & { sim: number }>(
      `SELECT *, similarity(name, $1) AS sim
         FROM raw_materials
        WHERE deleted_at IS NULL AND name % $1
        ORDER BY sim DESC
        LIMIT 1`,
      [q]
    );
    if (fuzzy.rows[0] && fuzzy.rows[0].sim > 0.4) {
      const { sim, ...rest } = fuzzy.rows[0];
      return { material: rest as MaterialRow, matchedBy: 'fuzzy', confidence: Number(sim) };
    }

    return { material: null, matchedBy: null, confidence: 0 };
  }

  async findAliases(materialId: string): Promise<Array<{
    id: string;
    alias: string;
    alias_type: string;
    language: string | null;
    confidence: number;
    is_active: boolean;
  }>> {
    const r = await this.pool.query(
      `SELECT id, alias, alias_type, language, confidence::float8 AS confidence, is_active
         FROM raw_material_aliases
        WHERE raw_material_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC`,
      [materialId]
    );
    return r.rows;
  }

  async addAlias(
    materialId: string,
    input: { alias: string; alias_type?: string; language?: string; source?: string },
    actor: { userId?: string },
    client?: PoolClient
  ): Promise<{ id: string; alias: string; alias_normalized: string }> {
    const r = await this.exec(client).query(
      `INSERT INTO raw_material_aliases
         (raw_material_id, alias, alias_normalized, alias_type, language, source, mapped_by, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7)
       ON CONFLICT (raw_material_id, alias_normalized) DO UPDATE
         SET is_active = TRUE, updated_by = EXCLUDED.updated_by
       RETURNING id, alias, alias_normalized`,
      [
        materialId,
        input.alias,
        normalizeAlias(input.alias),
        input.alias_type ?? 'name',
        input.language ?? null,
        input.source ?? 'manual',
        actor.userId ?? null,
      ]
    );
    return r.rows[0];
  }
}
