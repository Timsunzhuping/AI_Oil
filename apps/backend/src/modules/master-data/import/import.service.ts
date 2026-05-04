import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../../lib/db.js';
import { normalizeAlias } from '../../../lib/sql.js';
import { parseByFormat, type ParsedRow } from './parsers.js';
import {
  SCHEMA_BY_TARGET,
  validateAll,
  type FieldError,
  type MaterialImportRow,
  type ProductImportRow,
  type MetricImportRow,
  type UnitImportRow,
  type MaterialAliasImportRow,
  type MetricAliasImportRow,
  type UnitAliasImportRow,
} from './validators.js';

export type ImportTarget = keyof typeof SCHEMA_BY_TARGET;

export interface ImportRequest {
  target: ImportTarget;
  format: 'csv' | 'xlsx';
  buffer: Buffer;
  filename?: string;
  mode?: 'insert' | 'update' | 'upsert' | 'dry_run';
  userId?: string;
}

export interface ImportReport {
  job_id: string;
  target: ImportTarget;
  source_filename?: string;
  source_format: 'csv' | 'xlsx';
  mode: 'insert' | 'update' | 'upsert' | 'dry_run';
  total_rows: number;
  success_count: number;
  error_count: number;
  warning_count: number;
  skipped_count: number;
  duration_ms: number;
  errors: FieldError[];
  warnings: Array<{ row: number; message: string }>;
  status: 'completed' | 'partial' | 'failed';
}

export class ImportService {
  constructor(private pool: Pool) {}

  async run(req: ImportRequest): Promise<ImportReport> {
    const startedAt = Date.now();
    const mode = req.mode ?? 'upsert';
    const schema = SCHEMA_BY_TARGET[req.target];
    if (!schema) {
      throw new Error(`Unsupported import target: ${req.target}`);
    }

    // 1. Parse
    let parsed: ParsedRow[];
    try {
      parsed = parseByFormat(req.buffer, req.format);
    } catch (e) {
      const job = await this.createJob(req, 0, 0, 0, [], [{ row: 0, message: (e as Error).message }], 'failed', 0);
      return this.toReport(job.id, req, 0, 0, 0, 0, 0, 0, [], [{ row: 0, message: (e as Error).message }], 'failed');
    }

    // 2. Validate
    const { valid, invalid } = validateAll(parsed, schema);
    const errors: FieldError[] = invalid.flatMap((r) => r.errors);
    const warnings: Array<{ row: number; message: string }> = [];

    // Detect duplicate codes within the file
    const codeKey = this.codeKeyForTarget(req.target);
    if (codeKey) {
      const seen = new Set<string>();
      for (const v of valid) {
        const code = (v.data as Record<string, unknown>)[codeKey] as string;
        if (code && seen.has(code)) {
          warnings.push({ row: v.rowIndex, message: `Duplicate ${codeKey} '${code}' within file (last wins)` });
        }
        seen.add(code);
      }
    }

    // 3. Apply (skip in dry_run)
    let successCount = 0;
    let skippedCount = 0;
    if (mode !== 'dry_run' && valid.length > 0) {
      try {
        await withTransaction(async (client) => {
          for (const v of valid) {
            try {
              await this.applyOne(client, req.target, v.data, mode, req.userId);
              successCount++;
            } catch (e) {
              skippedCount++;
              errors.push({
                row: v.rowIndex,
                field: '_row',
                value: undefined,
                message: (e as Error).message,
                code: 'apply_error',
              });
            }
          }
        });
      } catch (e) {
        // Whole transaction rolled back
        const job = await this.createJob(
          req,
          parsed.length,
          0,
          errors.length + valid.length,
          [],
          [...errors, { row: 0, field: '_tx', value: undefined, message: (e as Error).message, code: 'transaction_rolled_back' }],
          'failed',
          Date.now() - startedAt
        );
        return this.toReport(
          job.id,
          req,
          parsed.length,
          0,
          errors.length + valid.length,
          0,
          valid.length,
          Date.now() - startedAt,
          [],
          [...errors, { row: 0, field: '_tx', value: undefined, message: (e as Error).message, code: 'transaction_rolled_back' }],
          'failed'
        );
      }
    }

    const status = errors.length === 0 ? 'completed' : successCount > 0 ? 'partial' : 'failed';
    const job = await this.createJob(
      req,
      parsed.length,
      successCount,
      errors.length,
      warnings,
      errors,
      status,
      Date.now() - startedAt,
      skippedCount
    );

    return this.toReport(
      job.id,
      req,
      parsed.length,
      successCount,
      errors.length,
      warnings.length,
      skippedCount,
      Date.now() - startedAt,
      warnings,
      errors,
      status
    );
  }

  // ---------------------- Apply per-target ----------------------

  private async applyOne(
    client: PoolClient,
    target: ImportTarget,
    data: unknown,
    mode: 'insert' | 'update' | 'upsert' | 'dry_run',
    userId?: string
  ): Promise<void> {
    if (mode === 'dry_run') return;
    switch (target) {
      case 'materials':         return this.applyMaterial(client, data as MaterialImportRow, mode, userId);
      case 'products':          return this.applyProduct(client, data as ProductImportRow, mode, userId);
      case 'metrics':           return this.applyMetric(client, data as MetricImportRow, mode, userId);
      case 'units':             return this.applyUnit(client, data as UnitImportRow, mode, userId);
      case 'material_aliases':  return this.applyMaterialAlias(client, data as MaterialAliasImportRow, userId);
      case 'metric_aliases':    return this.applyMetricAlias(client, data as MetricAliasImportRow, userId);
      case 'unit_aliases':      return this.applyUnitAlias(client, data as UnitAliasImportRow, userId);
    }
  }

  private async applyMaterial(client: PoolClient, row: MaterialImportRow, mode: string, userId?: string): Promise<void> {
    let categoryId: string | null = null;
    if (row.category_code) {
      const r = await client.query<{ id: string }>(
        `SELECT id FROM material_categories WHERE code = $1 AND deleted_at IS NULL`,
        [row.category_code]
      );
      if (!r.rows[0]) throw new Error(`Unknown category_code '${row.category_code}'`);
      categoryId = r.rows[0].id;
    }
    let supplierId: string | null = null;
    if (row.default_supplier_code) {
      const r = await client.query<{ id: string }>(
        `SELECT id FROM suppliers WHERE code = $1 AND deleted_at IS NULL`,
        [row.default_supplier_code]
      );
      if (!r.rows[0]) throw new Error(`Unknown supplier code '${row.default_supplier_code}'`);
      supplierId = r.rows[0].id;
    }

    const existing = await client.query<{ id: string; version: number }>(
      `SELECT id, version FROM raw_materials WHERE code = $1 AND deleted_at IS NULL`,
      [row.code]
    );

    if (existing.rows[0]) {
      if (mode === 'insert') throw new Error(`Material '${row.code}' already exists`);
      await client.query(
        `UPDATE raw_materials SET
            name = $2, cas_number = $3, category_id = $4, physical_state = $5,
            density = $6, viscosity_cst = $7, flash_point_c = $8, ph_value = $9,
            unit_of_measure = $10, default_supplier_id = $11, default_unit_cost = $12,
            hazard_class = $13, is_restricted = $14, status = $15, tags = $16,
            updated_by = $17
          WHERE id = $1`,
        [
          existing.rows[0].id, row.name, row.cas_number ?? null, categoryId, row.physical_state ?? null,
          row.density ?? null, row.viscosity_cst ?? null, row.flash_point_c ?? null, row.ph_value ?? null,
          row.unit_of_measure ?? 'kg', supplierId, row.default_unit_cost ?? null,
          row.hazard_class ?? null, row.is_restricted ?? false, row.status ?? 'active',
          row.tags ?? [], userId ?? null,
        ]
      );
    } else {
      if (mode === 'update') throw new Error(`Material '${row.code}' does not exist`);
      await client.query(
        `INSERT INTO raw_materials (
            code, name, cas_number, category_id, physical_state,
            density, viscosity_cst, flash_point_c, ph_value,
            unit_of_measure, default_supplier_id, default_unit_cost,
            hazard_class, is_restricted, status, tags, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)`,
        [
          row.code, row.name, row.cas_number ?? null, categoryId, row.physical_state ?? null,
          row.density ?? null, row.viscosity_cst ?? null, row.flash_point_c ?? null, row.ph_value ?? null,
          row.unit_of_measure ?? 'kg', supplierId, row.default_unit_cost ?? null,
          row.hazard_class ?? null, row.is_restricted ?? false, row.status ?? 'active',
          row.tags ?? [], userId ?? null,
        ]
      );
    }
  }

  private async applyProduct(client: PoolClient, row: ProductImportRow, mode: string, userId?: string): Promise<void> {
    let categoryId: string | null = null;
    if (row.category_code) {
      const r = await client.query<{ id: string }>(
        `SELECT id FROM product_categories WHERE code = $1 AND deleted_at IS NULL`,
        [row.category_code]
      );
      if (!r.rows[0]) throw new Error(`Unknown product category_code '${row.category_code}'`);
      categoryId = r.rows[0].id;
    }
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM products WHERE code = $1 AND deleted_at IS NULL`,
      [row.code]
    );
    if (existing.rows[0]) {
      if (mode === 'insert') throw new Error(`Product '${row.code}' already exists`);
      await client.query(
        `UPDATE products SET name = $2, product_type = $3, category_id = $4, status = $5,
                              unit_of_measure = $6, intended_use = $7, list_price = $8, tags = $9,
                              updated_by = $10
          WHERE id = $1`,
        [
          existing.rows[0].id, row.name, row.product_type, categoryId, row.status,
          row.unit_of_measure ?? 'kg', row.intended_use ?? null, row.list_price ?? null,
          row.tags ?? [], userId ?? null,
        ]
      );
    } else {
      if (mode === 'update') throw new Error(`Product '${row.code}' does not exist`);
      await client.query(
        `INSERT INTO products (
            code, name, product_type, category_id, status,
            unit_of_measure, intended_use, list_price, tags, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
        [
          row.code, row.name, row.product_type, categoryId, row.status,
          row.unit_of_measure ?? 'kg', row.intended_use ?? null, row.list_price ?? null,
          row.tags ?? [], userId ?? null,
        ]
      );
    }
  }

  private async applyMetric(client: PoolClient, row: MetricImportRow, mode: string, userId?: string): Promise<void> {
    let unitId: string | null = null;
    if (row.unit_code) {
      const r = await client.query<{ id: string }>(
        `SELECT id FROM units WHERE code = $1 AND deleted_at IS NULL`,
        [row.unit_code]
      );
      if (!r.rows[0]) throw new Error(`Unknown unit_code '${row.unit_code}'`);
      unitId = r.rows[0].id;
    }
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM metrics WHERE code = $1 AND deleted_at IS NULL`,
      [row.code]
    );
    if (existing.rows[0]) {
      if (mode === 'insert') throw new Error(`Metric '${row.code}' already exists`);
      await client.query(
        `UPDATE metrics SET name_std = $2, name_short = $3, category = $4, data_type = $5,
                             default_unit_id = $6, expected_min = $7, expected_max = $8,
                             test_method = $9, description = $10, updated_by = $11
          WHERE id = $1`,
        [
          existing.rows[0].id, row.name_std, row.name_short ?? null, row.category, row.data_type,
          unitId, row.expected_min ?? null, row.expected_max ?? null,
          row.test_method ?? null, row.description ?? null, userId ?? null,
        ]
      );
    } else {
      if (mode === 'update') throw new Error(`Metric '${row.code}' does not exist`);
      await client.query(
        `INSERT INTO metrics (
            code, name_std, name_short, category, data_type, default_unit_id,
            expected_min, expected_max, test_method, description, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
        [
          row.code, row.name_std, row.name_short ?? null, row.category, row.data_type, unitId,
          row.expected_min ?? null, row.expected_max ?? null, row.test_method ?? null,
          row.description ?? null, userId ?? null,
        ]
      );
    }
  }

  private async applyUnit(client: PoolClient, row: UnitImportRow, mode: string, userId?: string): Promise<void> {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM units WHERE code = $1 AND deleted_at IS NULL`,
      [row.code]
    );
    if (existing.rows[0]) {
      if (mode === 'insert') throw new Error(`Unit '${row.code}' already exists`);
      await client.query(
        `UPDATE units SET name = $2, symbol = $3, dimension = $4, base_unit_code = $5,
                          is_si = $6, updated_by = $7
          WHERE id = $1`,
        [
          existing.rows[0].id, row.name, row.symbol ?? null, row.dimension,
          row.base_unit_code ?? null, row.is_si ?? false, userId ?? null,
        ]
      );
    } else {
      if (mode === 'update') throw new Error(`Unit '${row.code}' does not exist`);
      await client.query(
        `INSERT INTO units (code, name, symbol, dimension, base_unit_code, is_si, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
        [row.code, row.name, row.symbol ?? null, row.dimension, row.base_unit_code ?? null, row.is_si ?? false, userId ?? null]
      );
    }
  }

  private async applyMaterialAlias(client: PoolClient, row: MaterialAliasImportRow, userId?: string): Promise<void> {
    const m = await client.query<{ id: string }>(
      `SELECT id FROM raw_materials WHERE code = $1 AND deleted_at IS NULL`,
      [row.material_code]
    );
    if (!m.rows[0]) throw new Error(`Material '${row.material_code}' not found`);
    await client.query(
      `INSERT INTO raw_material_aliases (raw_material_id, alias, alias_normalized, alias_type, language, source, mapped_by, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, 'import', $6, $6, $6)
       ON CONFLICT (raw_material_id, alias_normalized) DO UPDATE SET is_active = TRUE`,
      [m.rows[0].id, row.alias, normalizeAlias(row.alias), row.alias_type, row.language ?? null, userId ?? null]
    );
  }

  private async applyMetricAlias(client: PoolClient, row: MetricAliasImportRow, userId?: string): Promise<void> {
    const m = await client.query<{ id: string }>(
      `SELECT id FROM metrics WHERE code = $1 AND deleted_at IS NULL`,
      [row.metric_code]
    );
    if (!m.rows[0]) throw new Error(`Metric '${row.metric_code}' not found`);
    await client.query(
      `INSERT INTO metric_aliases (metric_id, alias, alias_normalized, language, source, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'import', $5, $5)
       ON CONFLICT (metric_id, alias_normalized) DO UPDATE SET is_active = TRUE`,
      [m.rows[0].id, row.alias, normalizeAlias(row.alias), row.language ?? null, userId ?? null]
    );
  }

  private async applyUnitAlias(client: PoolClient, row: UnitAliasImportRow, userId?: string): Promise<void> {
    const u = await client.query<{ id: string }>(
      `SELECT id FROM units WHERE code = $1 AND deleted_at IS NULL`,
      [row.unit_code]
    );
    if (!u.rows[0]) throw new Error(`Unit '${row.unit_code}' not found`);
    await client.query(
      `INSERT INTO unit_aliases (unit_id, alias, alias_normalized, language, source, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'import', $5, $5)
       ON CONFLICT (unit_id, alias_normalized) DO UPDATE SET is_active = TRUE`,
      [u.rows[0].id, row.alias, normalizeAlias(row.alias), row.language ?? null, userId ?? null]
    );
  }

  // ---------------------- Job ledger ----------------------

  private async createJob(
    req: ImportRequest,
    totalRows: number,
    successCount: number,
    errorCount: number,
    warnings: Array<{ row: number; message: string }>,
    errors: FieldError[],
    status: 'completed' | 'partial' | 'failed',
    durationMs: number,
    skippedCount = 0
  ): Promise<{ id: string }> {
    const r = await this.pool.query<{ id: string }>(
      `INSERT INTO import_jobs (
          target, source_filename, source_format, source_size_bytes,
          total_rows, success_count, error_count, warning_count, skipped_count,
          status, mode, error_report, warnings, imported_by,
          started_at, completed_at, duration_ms
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW() - ($15 || ' milliseconds')::interval, NOW(), $15)
       RETURNING id`,
      [
        req.target, req.filename ?? null, req.format, req.buffer.byteLength,
        totalRows, successCount, errorCount, warnings.length, skippedCount,
        status, req.mode ?? 'upsert',
        JSON.stringify(errors), JSON.stringify(warnings),
        req.userId ?? null, durationMs,
      ]
    );
    return r.rows[0]!;
  }

  private toReport(
    jobId: string,
    req: ImportRequest,
    totalRows: number,
    successCount: number,
    errorCount: number,
    warningCount: number,
    skippedCount: number,
    durationMs: number,
    warnings: Array<{ row: number; message: string }>,
    errors: FieldError[],
    status: 'completed' | 'partial' | 'failed'
  ): ImportReport {
    return {
      job_id: jobId,
      target: req.target,
      source_filename: req.filename,
      source_format: req.format,
      mode: req.mode ?? 'upsert',
      total_rows: totalRows,
      success_count: successCount,
      error_count: errorCount,
      warning_count: warningCount,
      skipped_count: skippedCount,
      duration_ms: durationMs,
      errors,
      warnings,
      status,
    };
  }

  private codeKeyForTarget(target: ImportTarget): string | null {
    switch (target) {
      case 'materials':         return 'code';
      case 'products':          return 'code';
      case 'metrics':           return 'code';
      case 'units':             return 'code';
      case 'material_aliases':  return null;
      case 'metric_aliases':    return null;
      case 'unit_aliases':      return null;
      default:                  return null;
    }
  }
}
