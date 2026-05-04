/**
 * Cleaning pipeline shared types.
 *
 * The pipeline is a composition of `Stage`s. Each stage receives a
 * `WorkingRow` (the in-flight, partially-normalized record) and either
 * mutates its `normalized` fields or appends `Issue`s to it.
 *
 * Crucial invariant: stages NEVER drop rows. Bad data is FLAGGED
 * via `Issue`s and persisted, so a human can audit and remediate.
 */

import type { Logger } from 'pino';

export type IssueSeverity = 'info' | 'warning' | 'error' | 'critical';

export type IssueType =
  | 'missing_value'
  | 'unresolved_material'
  | 'unresolved_metric'
  | 'unresolved_unit'
  | 'outlier'
  | 'spec_violation'
  | 'unit_mismatch'
  | 'duplicate'
  | 'invalid_format'
  | 'missing_required_field'
  | 'linkage_failed'
  | 'rule_violation';

export interface Issue {
  type: IssueType;
  severity: IssueSeverity;
  field?: string;
  rule_code?: string;
  raw_value?: unknown;
  expected_value?: unknown;
  message: string;
}

/**
 * Resolution attempt outcome from MasterDataLookup.
 */
export interface ResolveResult<T> {
  matched: T | null;
  method: 'code' | 'alias' | 'fuzzy' | null;
  confidence: number; // 0..1
}

export interface MasterMetric {
  id: string;
  code: string;
  name_std: string;
  default_unit_id: string | null;
  expected_min: number | null;
  expected_max: number | null;
}

export interface MasterUnit {
  id: string;
  code: string;
  symbol: string | null;
  dimension: string;
  base_unit_code: string | null;
}

export interface MasterMaterial {
  id: string;
  code: string;
  name: string;
}

/**
 * The raw test_results row coming out of the integration layer.
 * Defined narrowly — adapters should always populate at least these.
 */
export interface RawTestResultRow {
  id: string;
  test_code: string;
  test_name: string | null;
  measured_value: number | string | null;
  unit_of_measure: string | null;
  expected_min: number | null;
  expected_max: number | null;
  pass: boolean | null;
  measured_at: Date | null;
  measured_by: string | null;
  sample_code: string | null;
  batch_code: string | null;
  formula_version_id: string | null;
  product_id: string | null;
  raw_material_id: string | null;
  experiment_id: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Mutable per-record working state passed through the stage chain.
 */
export interface WorkingRow {
  raw: RawTestResultRow;

  // Resolution outputs
  metric: MasterMetric | null;
  metric_resolution: ResolveResult<MasterMetric> | null;

  raw_unit_obj: MasterUnit | null;
  target_unit: MasterUnit | null;

  // Normalized values
  normalized_value: number | null;
  normalized_unit: string | null;
  conversion_applied: boolean;
  conversion_factor: number | null;
  conversion_offset: number | null;

  // Quality flags
  is_missing: boolean;
  is_unresolved: boolean;
  is_outlier: boolean;
  outlier_methods: string[];
  outlier_score: number | null;
  pass: boolean | null;

  // Linking outputs
  formula_id: string | null;
  formula_version_id: string | null;
  product_id: string | null;
  raw_material_id: string | null;
  experiment_id: string | null;
  sample_code: string | null;
  batch_code: string | null;

  // Issues collected during processing
  issues: Issue[];
}

/**
 * Per-run context passed to every stage.
 */
export interface CleaningContext {
  runId: string;
  traceId: string;
  triggeredBy?: string;
  scope: { entity_type: 'test_results' | 'materials' | 'metrics' | 'all'; since?: Date };
  logger: Logger;
}

/**
 * A pipeline stage. Stages should be pure-ish: mutate the WorkingRow
 * (or only its `issues`/normalized fields), do not throw for per-row
 * problems — emit Issues instead.
 */
export interface Stage {
  readonly name: string;
  process(row: WorkingRow, ctx: CleaningContext): Promise<void>;
}

/**
 * Final summary returned by a pipeline run.
 */
export interface CleaningRunSummary {
  run_id: string;
  trace_id: string;
  status: 'succeeded' | 'partial' | 'failed';
  records_processed: number;
  records_normalized: number;
  records_skipped: number;
  issues_found: number;
  outliers_found: number;
  unresolved_found: number;
  missing_found: number;
  duration_ms: number;
  error?: string;
}

/**
 * Quality report shape — what GET /runs/:id/report returns.
 */
export interface QualityReport {
  run_id: string;
  generated_at: string;

  totals: {
    records_processed: number;
    records_normalized: number;
    records_with_issues: number;
    issues_total: number;
  };

  by_severity: Record<IssueSeverity, number>;
  by_type: Record<string, number>;

  outliers: {
    count: number;
    by_method: Record<string, number>;
    top_metrics: Array<{ metric_code: string; count: number }>;
  };

  unresolved: {
    count: number;
    by_field: Record<string, number>;
    samples: Array<{ source_test_result_id: string; raw_value: unknown }>;
  };

  missing: {
    count: number;
    by_field: Record<string, number>;
  };

  spec_violations: {
    count: number;
    top_metrics: Array<{ metric_code: string; count: number }>;
  };

  recent_issues: Array<{
    id: string;
    issue_type: string;
    severity: string;
    field: string | null;
    message: string;
    created_at: string;
  }>;
}
