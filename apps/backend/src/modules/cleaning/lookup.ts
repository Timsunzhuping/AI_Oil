import type { Pool } from 'pg';
import type {
  MasterMaterial,
  MasterMetric,
  MasterUnit,
  ResolveResult,
} from './types.js';

/**
 * MasterDataLookup — read-only adapter over the master-data tables.
 *
 * Cached per-run via lazy maps so a 10K-row pipeline doesn't issue
 * 30K+ alias lookups against the DB.
 */
export class MasterDataLookup {
  private metricCache = new Map<string, ResolveResult<MasterMetric>>();
  private unitCache = new Map<string, ResolveResult<MasterUnit>>();
  private materialCache = new Map<string, ResolveResult<MasterMaterial>>();
  private conversionCache = new Map<string, { factor: number; offset: number } | null>();

  constructor(private pool: Pool) {}

  // -------------------------- metric --------------------------

  async resolveMetric(query: string | null | undefined): Promise<ResolveResult<MasterMetric>> {
    if (!query) return { matched: null, method: null, confidence: 0 };
    const key = query.trim().toLowerCase();
    if (this.metricCache.has(key)) return this.metricCache.get(key)!;

    // 1. exact code
    const byCode = await this.pool.query<MasterMetric>(
      `SELECT id, code, name_std, default_unit_id,
              expected_min::float8 AS expected_min, expected_max::float8 AS expected_max
         FROM metrics
        WHERE LOWER(code) = $1 AND deleted_at IS NULL LIMIT 1`,
      [key]
    );
    if (byCode.rows[0]) {
      const result: ResolveResult<MasterMetric> = { matched: byCode.rows[0], method: 'code', confidence: 1 };
      this.metricCache.set(key, result);
      return result;
    }

    // 2. governed alias
    const byAlias = await this.pool.query<MasterMetric & { confidence: string }>(
      `SELECT m.id, m.code, m.name_std, m.default_unit_id,
              m.expected_min::float8 AS expected_min, m.expected_max::float8 AS expected_max,
              a.confidence::text AS confidence
         FROM metric_aliases a
         JOIN metrics m ON m.id = a.metric_id
        WHERE a.alias_normalized = $1 AND a.is_active AND a.deleted_at IS NULL
          AND m.deleted_at IS NULL LIMIT 1`,
      [key]
    );
    if (byAlias.rows[0]) {
      const { confidence, ...metric } = byAlias.rows[0];
      const result: ResolveResult<MasterMetric> = {
        matched: metric as MasterMetric,
        method: 'alias',
        confidence: Number(confidence),
      };
      this.metricCache.set(key, result);
      return result;
    }

    // 3. fuzzy trigram
    const fuzzy = await this.pool.query<MasterMetric & { sim: string }>(
      `SELECT id, code, name_std, default_unit_id,
              expected_min::float8 AS expected_min, expected_max::float8 AS expected_max,
              similarity(name_std, $1)::text AS sim
         FROM metrics
        WHERE deleted_at IS NULL AND name_std % $1
        ORDER BY sim DESC LIMIT 1`,
      [query]
    );
    if (fuzzy.rows[0] && Number(fuzzy.rows[0].sim) > 0.4) {
      const { sim, ...metric } = fuzzy.rows[0];
      const result: ResolveResult<MasterMetric> = {
        matched: metric as MasterMetric,
        method: 'fuzzy',
        confidence: Number(sim),
      };
      this.metricCache.set(key, result);
      return result;
    }

    const empty: ResolveResult<MasterMetric> = { matched: null, method: null, confidence: 0 };
    this.metricCache.set(key, empty);
    return empty;
  }

  // -------------------------- unit --------------------------

  async resolveUnit(query: string | null | undefined): Promise<ResolveResult<MasterUnit>> {
    if (!query) return { matched: null, method: null, confidence: 0 };
    const key = query.trim().toLowerCase();
    if (this.unitCache.has(key)) return this.unitCache.get(key)!;

    const byCode = await this.pool.query<MasterUnit>(
      `SELECT id, code, symbol, dimension, base_unit_code
         FROM units
        WHERE LOWER(code) = $1 AND deleted_at IS NULL LIMIT 1`,
      [key]
    );
    if (byCode.rows[0]) {
      const result: ResolveResult<MasterUnit> = { matched: byCode.rows[0], method: 'code', confidence: 1 };
      this.unitCache.set(key, result);
      return result;
    }

    const byAlias = await this.pool.query<MasterUnit & { confidence: string }>(
      `SELECT u.id, u.code, u.symbol, u.dimension, u.base_unit_code,
              a.confidence::text AS confidence
         FROM unit_aliases a
         JOIN units u ON u.id = a.unit_id
        WHERE a.alias_normalized = $1 AND a.is_active AND a.deleted_at IS NULL
          AND u.deleted_at IS NULL LIMIT 1`,
      [key]
    );
    if (byAlias.rows[0]) {
      const { confidence, ...unit } = byAlias.rows[0];
      const result: ResolveResult<MasterUnit> = {
        matched: unit as MasterUnit,
        method: 'alias',
        confidence: Number(confidence),
      };
      this.unitCache.set(key, result);
      return result;
    }

    const empty: ResolveResult<MasterUnit> = { matched: null, method: null, confidence: 0 };
    this.unitCache.set(key, empty);
    return empty;
  }

  async getUnitById(id: string | null | undefined): Promise<MasterUnit | null> {
    if (!id) return null;
    const r = await this.pool.query<MasterUnit>(
      `SELECT id, code, symbol, dimension, base_unit_code
         FROM units WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id]
    );
    return r.rows[0] ?? null;
  }

  // -------------------------- material --------------------------

  async resolveMaterial(query: string | null | undefined): Promise<ResolveResult<MasterMaterial>> {
    if (!query) return { matched: null, method: null, confidence: 0 };
    const key = query.trim().toLowerCase();
    if (this.materialCache.has(key)) return this.materialCache.get(key)!;

    const byCode = await this.pool.query<MasterMaterial>(
      `SELECT id, code, name FROM raw_materials
        WHERE LOWER(code) = $1 AND deleted_at IS NULL LIMIT 1`,
      [key]
    );
    if (byCode.rows[0]) {
      const result: ResolveResult<MasterMaterial> = { matched: byCode.rows[0], method: 'code', confidence: 1 };
      this.materialCache.set(key, result);
      return result;
    }

    const byAlias = await this.pool.query<MasterMaterial & { confidence: string }>(
      `SELECT m.id, m.code, m.name, a.confidence::text AS confidence
         FROM raw_material_aliases a
         JOIN raw_materials m ON m.id = a.raw_material_id
        WHERE a.alias_normalized = $1 AND a.is_active AND a.deleted_at IS NULL
          AND m.deleted_at IS NULL LIMIT 1`,
      [key]
    );
    if (byAlias.rows[0]) {
      const { confidence, ...material } = byAlias.rows[0];
      const result: ResolveResult<MasterMaterial> = {
        matched: material as MasterMaterial,
        method: 'alias',
        confidence: Number(confidence),
      };
      this.materialCache.set(key, result);
      return result;
    }

    const empty: ResolveResult<MasterMaterial> = { matched: null, method: null, confidence: 0 };
    this.materialCache.set(key, empty);
    return empty;
  }

  // -------------------------- conversion --------------------------

  /**
   * Look up the linear conversion (target = source * factor + offset)
   * from `from` to `to`. Returns null if no rule exists.
   */
  async getConversion(fromUnitId: string, toUnitId: string): Promise<{ factor: number; offset: number } | null> {
    if (fromUnitId === toUnitId) return { factor: 1, offset: 0 };
    const cacheKey = `${fromUnitId}->${toUnitId}`;
    if (this.conversionCache.has(cacheKey)) return this.conversionCache.get(cacheKey)!;

    const r = await this.pool.query<{ factor: string; offset_value: string }>(
      `SELECT factor::text, offset_value::text FROM unit_conversions
        WHERE from_unit_id = $1 AND to_unit_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [fromUnitId, toUnitId]
    );
    if (r.rows[0]) {
      const conv = { factor: Number(r.rows[0].factor), offset: Number(r.rows[0].offset_value) };
      this.conversionCache.set(cacheKey, conv);
      return conv;
    }
    this.conversionCache.set(cacheKey, null);
    return null;
  }

  /**
   * Convert a value between two units (returns null if conversion impossible).
   * Cross-dimension returns null.
   */
  async convertValue(value: number, fromUnit: MasterUnit, toUnit: MasterUnit): Promise<{ value: number; factor: number; offset: number } | null> {
    if (fromUnit.dimension !== toUnit.dimension) return null;
    const conv = await this.getConversion(fromUnit.id, toUnit.id);
    if (!conv) return null;
    return { value: value * conv.factor + conv.offset, factor: conv.factor, offset: conv.offset };
  }
}
