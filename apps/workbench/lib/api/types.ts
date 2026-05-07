/**
 * API contract types for the FluidMind workbench frontend.
 *
 * Mirrors the backend's unified envelope ({ code, message, data, traceId,
 * timestamp }) and the resource shapes returned by /api/v1/tasks, formulas,
 * templates, etc. Field names match the backend so the adapter layer is a
 * thin pass-through; mock data conforms to the same shape.
 */

// ────────────────────────────────────────────────────────────────────────────
// Envelope
// ────────────────────────────────────────────────────────────────────────────
export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  traceId?: string;
  timestamp?: string;
}

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Task center
// ────────────────────────────────────────────────────────────────────────────
export type TaskStatus =
  | 'draft'
  | 'submitted'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'archived';

export type TaskType =
  | 'forward_prediction'
  | 'batch_prediction'
  | 'cost_optimization'
  | 'material_replacement'
  | 'new_product_generation'
  | 'knowledge_qa';

export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface TaskSummary {
  id: string;
  code: string;
  task_type: TaskType;
  title: string;
  status: TaskStatus;
  priority: Priority;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  /** Optional confidence score returned by handlers (0..1). */
  confidence_score?: number | null;
}

export interface TaskDetail extends TaskSummary {
  description: string | null;
  summary: string | null;
  trace_id: string | null;
  handler_version: string | null;
  /** When present, indicates a formula context to compare/diff against. */
  related_formula_version_id?: string | null;
  metadata: Record<string, unknown>;
  inputs: TaskInput[];
  outputs: TaskOutput[];
}

export interface TaskInput {
  id: string;
  task_id: string;
  input_type: 'structured' | 'natural_language' | 'attachment';
  payload: Record<string, unknown>;
  raw_text: string | null;
  is_primary: boolean;
  created_at: string;
}

export interface TaskOutput {
  id: string;
  task_id: string;
  output_type: 'prediction' | 'recommendation' | 'report' | 'citation' | 'comparison';
  payload: Record<string, unknown>;
  is_primary: boolean;
  created_at: string;
}

export interface CreateTaskInput {
  task_type: TaskType;
  title: string;
  description?: string;
  priority?: Priority;
  template_id?: string | null;
  /** When provided, frontend constructed a structured payload. */
  structured_payload?: Record<string, unknown>;
  /** When provided, frontend captured a natural-language prompt. */
  raw_text?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Forward / inverse result payloads (output_type-specific shapes)
// ────────────────────────────────────────────────────────────────────────────
export interface PredictionRow {
  metric: string;
  display_name: string;
  unit: string | null;
  point_estimate: number;
  ci_low: number;
  ci_high: number;
  /** 0..1 — handler confidence in the prediction. */
  confidence: number;
  spec_low?: number | null;
  spec_high?: number | null;
  /** "ok" | "warn" | "fail" — pre-computed gating status vs. spec. */
  status: 'ok' | 'warn' | 'fail';
}

export interface ForwardPredictionPayload {
  formula_version_id: string;
  rows: PredictionRow[];
  risks: RiskFlag[];
  sources: SourceCitation[];
}

export interface InverseCandidate {
  id: string;
  rank: number;
  name: string;
  /** Brief one-line rationale shown on the card. */
  headline: string;
  predicted_metrics: PredictionRow[];
  estimated_cost: number;
  cost_unit: string;
  composition: Array<{
    raw_material_id: string;
    raw_material_name: string;
    percentage: number;
  }>;
  confidence: number;
  risks: RiskFlag[];
  sources: SourceCitation[];
}

export interface InverseRecommendationPayload {
  candidates: InverseCandidate[];
}

export interface RiskFlag {
  level: 'info' | 'warning' | 'critical';
  code: string;
  message: string;
  /** Optional reference to a metric/spec the risk relates to. */
  metric?: string;
}

export interface SourceCitation {
  id: string;
  source_type: 'literature' | 'experiment' | 'model' | 'standard';
  title: string;
  /** Free-text identifier — DOI, batch code, model name + version, etc. */
  reference: string;
  /** 0..1 — relevance score returned by retrieval. */
  relevance: number;
  /** Optional URL when available (e.g., internal report). */
  url?: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Comparison & version diff
// ────────────────────────────────────────────────────────────────────────────
export interface ComparisonScheme {
  id: string;
  name: string;
  metrics: Record<string, number>;
  composition: Array<{ raw_material_name: string; percentage: number }>;
  estimated_cost: number;
  confidence: number;
}

export interface ComparisonPayload {
  scenarios: ComparisonScheme[];
  metric_axes: Array<{ key: string; display_name: string; unit: string | null; better: 'higher' | 'lower' }>;
  risks: RiskFlag[];
  sources: SourceCitation[];
}

export interface FormulaVersionDiffEntry {
  raw_material_name: string;
  before: number | null;
  after: number | null;
  change: 'added' | 'removed' | 'increased' | 'decreased' | 'unchanged';
  delta: number | null;
}

export interface FormulaVersionDiffPayload {
  base: { id: string; version_label: string };
  target: { id: string; version_label: string };
  entries: FormulaVersionDiffEntry[];
  /** Whole-formula metric deltas (e.g., KV_100C: +0.4). */
  metric_deltas: Array<{ metric: string; display_name: string; before: number; after: number; delta: number }>;
}

// ────────────────────────────────────────────────────────────────────────────
// Templates (历史配方模板)
// ────────────────────────────────────────────────────────────────────────────
export interface FormulaTemplate {
  id: string;
  code: string;
  name: string;
  product_category: string;
  description: string | null;
  /** Year of last revision. */
  last_revised_year: number;
  popularity: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Knowledge QA
// ────────────────────────────────────────────────────────────────────────────
export interface KnowledgeQaPayload {
  answer: string;
  sources: SourceCitation[];
  confidence: number;
}
