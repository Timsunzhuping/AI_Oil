import type { CleaningRepository } from '../../repository.js';
import type { CleaningContext, Stage, WorkingRow } from '../../types.js';
import { runRules, type CompiledRule } from '../../rules/engine.js';
import { checkSpec, checkIqr } from '../../rules/outlier.js';

/**
 * Run validation + outlier detection for a row.
 *
 * Three sources of "this is bad":
 *   1. Missing-value detection (cheap, structural)
 *   2. Spec check against metric.expected_min/max
 *   3. Declarative rules from cleaning_rules
 *   4. IQR fence over recent history (uses CleaningRepository.loadMetricHistory)
 *
 * The row is FLAGGED with `is_outlier` / `is_missing` and one Issue per
 * triggered cause is appended. Rule firings increment the rule's counter.
 */
export class ValidateStage implements Stage {
  readonly name = 'validate';

  // History cache per metric_code so we don't hit DB once per row
  private historyCache = new Map<string, number[]>();

  constructor(
    private repo: CleaningRepository,
    private rules: CompiledRule[],
    private opts: { iqrMultiplier?: number; iqrMinSamples?: number; iqrHistoryLimit?: number } = {}
  ) {}

  async process(row: WorkingRow, _ctx: CleaningContext): Promise<void> {
    const value = row.normalized_value;
    const metric = row.metric;

    // 1. Missing value
    if (value === null || value === undefined) {
      row.is_missing = true;
      row.issues.push({
        type: 'missing_value',
        severity: 'warning',
        field: 'measured_value',
        message: 'Normalized value is null',
      });
      return; // remaining checks need a numeric value
    }

    // 2. Spec check (per-row OR per-metric)
    const specResult = checkSpec({
      value,
      min: row.raw.expected_min ?? metric?.expected_min ?? null,
      max: row.raw.expected_max ?? metric?.expected_max ?? null,
    });
    row.pass = specResult.violated ? false : (row.raw.pass ?? true);
    if (specResult.violated) {
      row.is_outlier = true;
      row.outlier_methods.push('spec');
      row.issues.push({
        type: 'spec_violation',
        severity: 'warning',
        field: 'measured_value',
        raw_value: value,
        expected_value: { min: row.raw.expected_min ?? metric?.expected_min, max: row.raw.expected_max ?? metric?.expected_max },
        message: specResult.reason ?? 'Value outside spec',
      });
    }

    // 3. Declarative rules (rule engine)
    const facts = {
      value,
      raw_value: row.raw.measured_value,
      raw_unit: row.raw.unit_of_measure,
      metric: metric
        ? {
            id: metric.id,
            code: metric.code,
            name: metric.name_std,
            expected_min: metric.expected_min,
            expected_max: metric.expected_max,
          }
        : { id: null, code: row.raw.test_code, name: null, expected_min: null, expected_max: null },
    };

    const hits = runRules(this.rules, facts);
    for (const hit of hits) {
      const action = hit.action as { flag?: string; outlier_method?: string; issue_code?: string; message?: string; field?: string };
      if (action.flag === 'outlier') {
        row.is_outlier = true;
        const method = action.outlier_method ?? 'rule';
        if (!row.outlier_methods.includes(method)) row.outlier_methods.push(method);
        row.issues.push({
          type: 'outlier',
          severity: hit.severity,
          field: action.field ?? 'measured_value',
          rule_code: hit.rule_code,
          raw_value: value,
          message: action.message ?? hit.rule_name,
        });
      } else if (action.flag === 'missing_field') {
        row.issues.push({
          type: 'missing_required_field',
          severity: hit.severity,
          field: action.field,
          rule_code: hit.rule_code,
          message: action.message ?? hit.rule_name,
        });
      } else if (action.flag === 'unresolved') {
        row.is_unresolved = true;
        row.issues.push({
          type: 'unresolved_metric',
          severity: hit.severity,
          rule_code: hit.rule_code,
          message: action.message ?? hit.rule_name,
        });
      } else {
        row.issues.push({
          type: 'rule_violation',
          severity: hit.severity,
          rule_code: hit.rule_code,
          message: action.message ?? hit.rule_name,
        });
      }
      // bump rule counter (fire-and-forget — failures don't block the pipeline)
      void this.repo.incrementRuleFireCount(hit.rule_code);
    }

    // 4. IQR over recent history (only when we have a metric)
    if (metric) {
      const history = await this.getHistory(metric.code);
      const iqr = checkIqr(value, history, {
        multiplier: this.opts.iqrMultiplier,
        minSamples: this.opts.iqrMinSamples,
      });
      if (iqr.is_outlier) {
        row.is_outlier = true;
        if (!row.outlier_methods.includes('iqr')) row.outlier_methods.push('iqr');
        row.outlier_score = iqr.score;
        row.issues.push({
          type: 'outlier',
          severity: 'warning',
          field: 'measured_value',
          rule_code: 'IQR_FENCE',
          raw_value: value,
          message: iqr.reason ?? 'Value outside IQR fence',
        });
      } else if (iqr.score !== null && row.outlier_score === null) {
        row.outlier_score = iqr.score;
      }
    }
  }

  private async getHistory(metricCode: string): Promise<number[]> {
    if (this.historyCache.has(metricCode)) return this.historyCache.get(metricCode)!;
    const h = await this.repo.loadMetricHistory(metricCode, this.opts.iqrHistoryLimit ?? 200);
    this.historyCache.set(metricCode, h);
    return h;
  }
}
