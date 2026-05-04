import type { MasterDataLookup } from '../../lookup.js';
import type { CleaningContext, Stage, WorkingRow } from '../../types.js';

/**
 * Convert raw_measured_value into the metric's standard unit.
 *
 * Priority:
 *   1. raw_unit and target_unit known + same dimension → linear convert
 *   2. raw_unit unknown but raw value present → carry value through
 *      with normalized_unit = raw_unit_string (best-effort)
 *   3. value missing → leave normalized_value null, no issue (handled by validate)
 *
 * The factor + offset used are stored on the row so a human can audit.
 */
export class ConvertStage implements Stage {
  readonly name = 'convert';
  constructor(private lookup: MasterDataLookup) {}

  async process(row: WorkingRow, _ctx: CleaningContext): Promise<void> {
    const rawValue = toNumber(row.raw.measured_value);
    if (rawValue === null) {
      // Value missing — convert is a no-op
      row.normalized_value = null;
      row.normalized_unit = row.target_unit?.code ?? row.raw.unit_of_measure ?? null;
      return;
    }

    // No target unit defined for the metric — keep raw unit / value
    if (!row.target_unit) {
      row.normalized_value = rawValue;
      row.normalized_unit = row.raw_unit_obj?.code ?? row.raw.unit_of_measure ?? null;
      return;
    }

    // No raw unit resolved — assume value already in target units (best effort)
    if (!row.raw_unit_obj) {
      row.normalized_value = rawValue;
      row.normalized_unit = row.target_unit.code;
      return;
    }

    // Same unit — no conversion needed
    if (row.raw_unit_obj.id === row.target_unit.id) {
      row.normalized_value = rawValue;
      row.normalized_unit = row.target_unit.code;
      return;
    }

    // Different dimensions — flag and keep raw
    if (row.raw_unit_obj.dimension !== row.target_unit.dimension) {
      row.issues.push({
        type: 'unit_mismatch',
        severity: 'error',
        field: 'unit_of_measure',
        raw_value: row.raw_unit_obj.code,
        expected_value: row.target_unit.code,
        message: `Unit '${row.raw_unit_obj.code}' (${row.raw_unit_obj.dimension}) cannot convert to '${row.target_unit.code}' (${row.target_unit.dimension})`,
      });
      row.normalized_value = rawValue;
      row.normalized_unit = row.raw_unit_obj.code;
      return;
    }

    // Linear conversion via master-data
    const conv = await this.lookup.convertValue(rawValue, row.raw_unit_obj, row.target_unit);
    if (!conv) {
      row.issues.push({
        type: 'unit_mismatch',
        severity: 'warning',
        field: 'unit_of_measure',
        raw_value: row.raw_unit_obj.code,
        expected_value: row.target_unit.code,
        message: `No conversion rule from '${row.raw_unit_obj.code}' to '${row.target_unit.code}'`,
      });
      row.normalized_value = rawValue;
      row.normalized_unit = row.raw_unit_obj.code;
      return;
    }

    row.normalized_value = conv.value;
    row.normalized_unit = row.target_unit.code;
    row.conversion_applied = true;
    row.conversion_factor = conv.factor;
    row.conversion_offset = conv.offset;
  }
}

function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
