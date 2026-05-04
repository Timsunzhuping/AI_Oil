import type { MasterDataLookup } from '../../lookup.js';
import type { CleaningContext, Stage, WorkingRow } from '../../types.js';

/**
 * Resolve metric and raw unit from the source row's free-form names.
 *
 * - test_code → metric (via code, alias, fuzzy)
 * - unit_of_measure → unit (code or alias)
 *
 * Failures are recorded as issues; the row is NOT dropped.
 */
export class ResolveStage implements Stage {
  readonly name = 'resolve';
  constructor(private lookup: MasterDataLookup) {}

  async process(row: WorkingRow, _ctx: CleaningContext): Promise<void> {
    const { raw } = row;

    // 1. Metric resolution — try test_code first, then test_name as fallback
    const metricResult = await this.lookup.resolveMetric(raw.test_code)
      .then(async (r) => (r.matched ? r : this.lookup.resolveMetric(raw.test_name)));
    row.metric = metricResult.matched;
    row.metric_resolution = metricResult;

    if (!metricResult.matched) {
      row.is_unresolved = true;
      row.issues.push({
        type: 'unresolved_metric',
        severity: 'error',
        field: 'test_code',
        raw_value: raw.test_code,
        message: `Could not resolve test_code='${raw.test_code}' to a standard metric`,
      });
    } else if (metricResult.method === 'fuzzy' && metricResult.confidence < 0.7) {
      row.issues.push({
        type: 'rule_violation',
        severity: 'warning',
        field: 'test_code',
        raw_value: raw.test_code,
        expected_value: metricResult.matched.code,
        message: `Low-confidence fuzzy metric match (${metricResult.confidence.toFixed(2)})`,
      });
    }

    // 2. Unit resolution
    if (raw.unit_of_measure) {
      const unitResult = await this.lookup.resolveUnit(raw.unit_of_measure);
      row.raw_unit_obj = unitResult.matched;
      if (!unitResult.matched) {
        row.issues.push({
          type: 'unresolved_unit',
          severity: 'warning',
          field: 'unit_of_measure',
          raw_value: raw.unit_of_measure,
          message: `Could not resolve unit '${raw.unit_of_measure}'`,
        });
      }
    } else if (raw.measured_value !== null && raw.measured_value !== undefined && raw.measured_value !== '') {
      // value present without unit
      row.issues.push({
        type: 'missing_required_field',
        severity: 'warning',
        field: 'unit_of_measure',
        message: 'Measured value present without a unit',
      });
    }

    // 3. Target unit (the metric's default unit)
    if (row.metric?.default_unit_id) {
      row.target_unit = await this.lookup.getUnitById(row.metric.default_unit_id);
    }
  }
}
