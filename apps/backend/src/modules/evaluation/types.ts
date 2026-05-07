/**
 * Test & acceptance support module — shared types.
 *
 * Three orthogonal acceptance flavours:
 *   • forward    — predict-then-compare against expected metric values
 *   • inverse    — recommend-then-check candidate feasibility / constraints
 *   • stability  — same input × N runs; check similarity / volatility
 *
 * Each test set carries an array of `cases`; each case is shaped per
 * `test_type` (the runner validates required fields at execution time).
 *
 * Aggregate results are persisted on `acceptance_runs.summary` as a
 * frontend-ready JSON structure — the workbench reads it directly to draw
 * dashboards, no separate transformation layer needed.
 */
import type { BomItem } from '../prediction/types.js';

// ─── Enumerations ──────────────────────────────────────────────────────────

export const TEST_TYPES = ['forward', 'inverse', 'stability'] as const;
export type TestType = (typeof TEST_TYPES)[number];

export const RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TRIGGER_TYPES = ['manual', 'api', 'scheduled', 'ci', 'uat'] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const TEST_SET_STATUSES = ['draft', 'published', 'archived'] as const;
export type TestSetStatus = (typeof TEST_SET_STATUSES)[number];

// ─── Test cases (per test_type) ────────────────────────────────────────────

export interface ForwardCase {
  id: string;
  category?: string;
  bom: BomItem[];
  /** Expected metric values, keyed by metric code (KV_100C / VI / …). */
  expected_metrics: Record<string, number>;
  /** Per-case override of run-level tolerance. */
  tolerance?: Tolerance;
  /** Free-form notes (carried into the report). */
  notes?: string;
}

export interface InverseCase {
  id: string;
  category?: string;
  /** Pass-through to the recommendation pipeline (matches GenerateRequest). */
  request: {
    product_category: string;
    target_metrics: Array<{
      name: string;
      target?: number;
      lower_bound?: number;
      upper_bound?: number;
      weight?: number;
    }>;
    cost_limit?: number;
    material_pool?: Array<Record<string, unknown>>;
    base_bom?: BomItem[];
    replacement_pool?: Array<Record<string, unknown>>;
    n_candidates?: number;
    random_seed?: number;
  };
  /** Acceptance expectations for the produced candidates. */
  expectations: {
    min_passed_candidates?: number; // at least N candidates clear the filter
    top1_must_have_materials?: string[]; // top-1 BOM must contain these codes
    top1_max_cost?: number; // top-1 cost ≤ this
    top1_min_confidence?: number; // top-1 confidence ≥ this
    /** Top-K positions (1-based) that must show no critical risks. */
    no_critical_risks_top?: number;
  };
  notes?: string;
}

export interface StabilityCase {
  id: string;
  category?: string;
  mode: 'predict' | 'recommend';
  payload: Record<string, unknown>;
  /** Number of repeat runs (default 5; max 20 in schemas). */
  runs?: number;
  /** Per-case stability thresholds. */
  tolerance?: StabilityTolerance;
  notes?: string;
}

export type TestCase = ForwardCase | InverseCase | StabilityCase;

// ─── Tolerances ────────────────────────────────────────────────────────────

export interface Tolerance {
  /** Relative error allowed before a metric is "off"; 0.10 = 10 %. */
  max_relative_error?: number;
  /** Absolute error fallback (used when expected==0 or |expected|<eps). */
  max_absolute_error?: number;
  /** Minimum fraction of metrics that must pass per case (default 0.8). */
  min_metric_pass_rate?: number;
}

export interface StabilityTolerance {
  /** Minimum pairwise cosine similarity (predict mode). */
  min_pairwise_cosine?: number;
  /** Maximum coefficient of variation per metric. */
  max_cv?: number;
}

// ─── Test set DTO + row shape ──────────────────────────────────────────────

export interface TestSetInput {
  code?: string;
  name: string;
  description?: string;
  test_type: TestType;
  product_category?: string;
  cases: TestCase[];
  default_tolerance?: Tolerance | StabilityTolerance;
  source_dataset_id?: string | null;
  status?: TestSetStatus;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface TestSetRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  test_type: TestType;
  product_category: string | null;
  cases: TestCase[];
  default_tolerance: Tolerance | StabilityTolerance;
  source_dataset_id: string | null;
  status: TestSetStatus;
  metadata: Record<string, unknown>;
  tags: string[];
  trace_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  version: number;
}

// ─── Run DTO + row shape ──────────────────────────────────────────────────

export interface RunRequest {
  test_set_id: string;
  trigger_type?: TriggerType;
  /** Run-time config overrides; merged with test-set defaults. */
  config?: RunConfig;
  metadata?: Record<string, unknown>;
}

export interface RunConfig {
  /** Forward-specific: tolerance overrides applied to every case. */
  tolerance?: Tolerance;
  /** Stability-specific. */
  stability_tolerance?: StabilityTolerance;
  /** When set, only run cases whose ids are in this list. */
  case_ids?: string[];
  /** Override `runs` for stability cases without rewriting the test set. */
  default_runs?: number;
}

export interface RunRow {
  id: string;
  code: string;
  test_set_id: string;
  test_type: TestType;
  status: RunStatus;
  model_code: string;
  model_version: string;
  predictor_mode: 'mock' | 'real';
  config: RunConfig;
  summary: AcceptanceReport;
  cases_total: number;
  cases_passed: number;
  cases_failed: number;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number;
  trigger_type: TriggerType;
  triggered_by: string | null;
  trace_id: string | null;
  metadata: Record<string, unknown>;
  error_class: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface ResultRow {
  id: string;
  run_id: string;
  case_id: string;
  case_index: number;
  category: string | null;
  passed: boolean;
  metrics: Record<string, unknown>;
  expected: unknown;
  predicted: unknown;
  raw_payload: unknown;
  failure_reason: string | null;
  duration_ms: number;
  created_at: string;
}

// ─── Aggregate report shapes (persisted as `runs.summary`) ────────────────

export interface ReportEnvelopeBase {
  run_id: string;
  code: string;
  test_set_id: string;
  test_type: TestType;
  model: { code: string; version: string; mode: 'mock' | 'real' };
  status: RunStatus;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number;
  totals: {
    cases_total: number;
    cases_passed: number;
    cases_failed: number;
    pass_rate: number;
  };
  trace_id: string | null;
  generated_at: string;
}

export interface ForwardReport extends ReportEnvelopeBase {
  test_type: 'forward';
  overall_metrics: ForwardAggregate;
  by_category: Array<{ category: string; n: number; passed: number } & ForwardAggregate>;
  by_metric: Array<{ metric: string; n: number } & ForwardAggregate>;
  /** Category × metric matrix for heat-map rendering. */
  matrix: Array<{ category: string; metric: string; n: number } & ForwardAggregate>;
  case_results: ForwardCaseResult[];
}

export interface ForwardAggregate {
  mape: number; // mean absolute percentage error
  mae: number; // mean absolute error
  rmse: number; // root-mean-square error
  hit_rate: number; // fraction of metric values within tolerance
}

export interface ForwardCaseResult {
  case_id: string;
  category: string | null;
  passed: boolean;
  metrics: ForwardAggregate;
  per_metric: Array<{
    metric: string;
    expected: number;
    predicted: number | null;
    abs_error: number | null;
    rel_error: number | null;
    hit: boolean;
  }>;
  failure_reason: string | null;
}

export interface InverseReport extends ReportEnvelopeBase {
  test_type: 'inverse';
  overall_metrics: InverseAggregate;
  by_category: Array<{ category: string; n: number; passed: number } & InverseAggregate>;
  case_results: InverseCaseResult[];
}

export interface InverseAggregate {
  feasibility_rate: number; // % of cases where ≥ min_passed_candidates pass
  top1_feasibility_rate: number; // % of cases whose top-1 satisfies expectations
  avg_passed_candidates: number;
  avg_top1_cost: number | null;
  avg_top1_confidence: number;
}

export interface InverseCaseResult {
  case_id: string;
  category: string | null;
  passed: boolean;
  metrics: {
    passed_candidates: number;
    top1_cost: number | null;
    top1_confidence: number;
    top1_must_have_satisfied: boolean;
    top1_no_critical_risks: boolean;
  };
  failure_reason: string | null;
}

export interface StabilityReport extends ReportEnvelopeBase {
  test_type: 'stability';
  overall_metrics: StabilityAggregate;
  by_metric: Array<{ metric: string; n_cases: number; mean_cv: number; max_cv: number }>;
  case_results: StabilityCaseResult[];
}

export interface StabilityAggregate {
  /** Average pairwise cosine similarity across runs (predict mode). */
  avg_pairwise_cosine: number;
  /** Average coefficient of variation across all metrics × cases. */
  avg_cv: number;
  /** Max CV observed (worst metric × case). */
  max_cv: number;
  /** Fraction of cases that pass their stability thresholds. */
  stability_rate: number;
}

export interface StabilityCaseResult {
  case_id: string;
  category: string | null;
  passed: boolean;
  runs_n: number;
  metrics: {
    pairwise_cosine_avg: number;
    pairwise_cosine_min: number;
    cv_avg: number;
    max_cv: number;
    /** Per-metric CV (predict mode only). */
    per_metric_cv?: Record<string, number>;
  };
  failure_reason: string | null;
}

export type AcceptanceReport = ForwardReport | InverseReport | StabilityReport | EmptyReport;

export interface EmptyReport extends ReportEnvelopeBase {
  test_type: TestType;
  overall_metrics: Record<string, unknown>;
  /** Fallback shape used when a run errors before producing per-case data. */
  empty: true;
}

// ─── Service-layer DTOs ────────────────────────────────────────────────────

export interface RunResponse {
  run: RunRow;
  results: ResultRow[];
}

export interface ExportResponse {
  filename: string;
  content_type: string;
  body: string;
}
