import { z, ZodSchema } from 'zod';
import type { ParsedRow } from './parsers.js';

/**
 * Per-target row validators.
 *
 * Each validator takes the raw cell map (lowercased header → string),
 * coerces / cleans / validates it via zod, and returns either the typed
 * payload or a list of structured field errors.
 */

export interface FieldError {
  row: number;        // 1-based source row
  field: string;
  value: unknown;
  message: string;
  code: string;
}

export interface RowResult<T> {
  rowIndex: number;
  ok: boolean;
  data?: T;
  errors?: FieldError[];
}

const optStr = (s?: string) => (s == null || s === '' ? undefined : s.trim());
const num = z.union([z.string(), z.number()]).transform((v, ctx) => {
  if (v === '' || v == null) return undefined;
  const n = Number(v);
  if (Number.isNaN(n)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Not a number' });
    return z.NEVER;
  }
  return n;
}).optional();

const bool = z.union([z.string(), z.boolean()]).transform((v, ctx) => {
  if (v === '' || v == null) return undefined;
  if (typeof v === 'boolean') return v;
  const s = v.toLowerCase();
  if (['true','yes','y','1'].includes(s)) return true;
  if (['false','no','n','0'].includes(s)) return false;
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Not a boolean (use true/false/yes/no/1/0)' });
  return z.NEVER;
}).optional();

const csvList = z.union([z.string(), z.array(z.string())]).transform((v) => {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  return v.split(/[;,|]/).map((s) => s.trim()).filter(Boolean);
}).optional();

// ============================================================================
// Materials
// ============================================================================
export const MaterialImportSchema = z.object({
  code:               z.string().min(1).max(64),
  name:               z.string().min(1).max(255),
  cas_number:         z.string().max(32).optional().transform(optStr),
  category_code:      z.string().optional().transform(optStr),
  physical_state:     z.enum(['solid','liquid','gas','paste','powder','granule']).optional(),
  density:            num,
  viscosity_cst:      num,
  flash_point_c:      num,
  ph_value:           num,
  unit_of_measure:    z.string().optional().transform((s) => optStr(s) ?? 'kg'),
  default_supplier_code: z.string().optional().transform(optStr),
  default_unit_cost:  num,
  hazard_class:       z.string().optional().transform(optStr),
  is_restricted:      bool,
  status:             z.enum(['active','phased_out','obsolete','blocked']).default('active'),
  tags:               csvList,
});
export type MaterialImportRow = z.infer<typeof MaterialImportSchema>;

// ============================================================================
// Products
// ============================================================================
export const ProductImportSchema = z.object({
  code:           z.string().min(1).max(64),
  name:           z.string().min(1).max(255),
  product_type:   z.enum(['finished','semi_finished','intermediate','sample']).default('finished'),
  category_code:  z.string().optional().transform(optStr),
  status:         z.enum(['development','testing','approved','production','discontinued','archived']).default('development'),
  unit_of_measure: z.string().optional().transform((s) => optStr(s) ?? 'kg'),
  intended_use:   z.string().optional().transform(optStr),
  list_price:     num,
  tags:           csvList,
});
export type ProductImportRow = z.infer<typeof ProductImportSchema>;

// ============================================================================
// Metrics
// ============================================================================
export const MetricImportSchema = z.object({
  code:        z.string().min(1).max(64),
  name_std:    z.string().min(1).max(255),
  name_short:  z.string().optional().transform(optStr),
  category:    z.enum(['physical','chemical','microbiological','sensory','rheological','thermal','electrical','optical','other']).default('physical'),
  data_type:   z.enum(['numeric','text','boolean','spectrum','image','attachment']).default('numeric'),
  unit_code:   z.string().optional().transform(optStr),
  expected_min: num,
  expected_max: num,
  test_method: z.string().optional().transform(optStr),
  description: z.string().optional().transform(optStr),
});
export type MetricImportRow = z.infer<typeof MetricImportSchema>;

// ============================================================================
// Units
// ============================================================================
export const UnitImportSchema = z.object({
  code:           z.string().min(1).max(64),
  name:           z.string().min(1).max(255),
  symbol:         z.string().optional().transform(optStr),
  dimension:      z.string().min(1).max(64),
  base_unit_code: z.string().optional().transform(optStr),
  is_si:          bool,
});
export type UnitImportRow = z.infer<typeof UnitImportSchema>;

// ============================================================================
// Material Aliases
// ============================================================================
export const MaterialAliasImportSchema = z.object({
  material_code:  z.string().min(1).max(64),
  alias:          z.string().min(1).max(255),
  alias_type:     z.enum(['name','abbreviation','trade_name','cas','supplier_sku','legacy_code','synonym']).default('name'),
  language:       z.string().optional().transform(optStr),
});
export type MaterialAliasImportRow = z.infer<typeof MaterialAliasImportSchema>;

// ============================================================================
// Metric Aliases
// ============================================================================
export const MetricAliasImportSchema = z.object({
  metric_code:  z.string().min(1).max(64),
  alias:        z.string().min(1).max(255),
  language:     z.string().optional().transform(optStr),
});
export type MetricAliasImportRow = z.infer<typeof MetricAliasImportSchema>;

// ============================================================================
// Unit Aliases
// ============================================================================
export const UnitAliasImportSchema = z.object({
  unit_code:  z.string().min(1).max(64),
  alias:      z.string().min(1).max(255),
  language:   z.string().optional().transform(optStr),
});
export type UnitAliasImportRow = z.infer<typeof UnitAliasImportSchema>;

// ============================================================================
// Schema registry by target
// ============================================================================
export const SCHEMA_BY_TARGET: Record<string, ZodSchema> = {
  materials:         MaterialImportSchema,
  products:          ProductImportSchema,
  metrics:           MetricImportSchema,
  units:             UnitImportSchema,
  material_aliases:  MaterialAliasImportSchema,
  metric_aliases:    MetricAliasImportSchema,
  unit_aliases:      UnitAliasImportSchema,
};

/**
 * Validate a single parsed row against a target schema.
 */
export function validateRow<T>(row: ParsedRow, schema: ZodSchema): RowResult<T> {
  const result = schema.safeParse(row.data);
  if (result.success) {
    return { rowIndex: row.rowIndex, ok: true, data: result.data as T };
  }
  return {
    rowIndex: row.rowIndex,
    ok: false,
    errors: result.error.errors.map((e) => ({
      row: row.rowIndex,
      field: e.path.join('.'),
      value: e.path.length ? (row.data as Record<string, unknown>)[e.path[0] as string] : undefined,
      message: e.message,
      code: e.code,
    })),
  };
}

/**
 * Validate every row, returning a partition of (valid, invalid).
 */
export function validateAll<T>(rows: ParsedRow[], schema: ZodSchema): {
  valid: Array<{ rowIndex: number; data: T }>;
  invalid: Array<{ rowIndex: number; errors: FieldError[] }>;
} {
  const valid: Array<{ rowIndex: number; data: T }> = [];
  const invalid: Array<{ rowIndex: number; errors: FieldError[] }> = [];
  for (const row of rows) {
    const result = validateRow<T>(row, schema);
    if (result.ok && result.data) valid.push({ rowIndex: result.rowIndex, data: result.data });
    else if (result.errors) invalid.push({ rowIndex: result.rowIndex, errors: result.errors });
  }
  return { valid, invalid };
}
