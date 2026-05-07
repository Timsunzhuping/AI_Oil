/**
 * Forward Prediction Service — shared types.
 *
 * The "service" predicts physico-chemical performance metrics (KV100, VI,
 * Pour Point, Flash Point, Noack, …) given a formula's BOM (Bill of
 * Materials). It deliberately decouples I/O concerns (HTTP routes, DB
 * audit logs) from the actual model invocation, which is hidden behind
 * a `PredictorAdapter` interface so the backend can be plugged into
 * mock-, sklearn-, pytorch- or remote-RPC predictors without code churn
 * elsewhere.
 */

export const REQUEST_TYPES = ['single', 'batch', 'explain'] as const;
export type PredictionRequestType = (typeof REQUEST_TYPES)[number];

export const PREDICTION_STATUSES = ['success', 'partial', 'failed'] as const;
export type PredictionStatus = (typeof PREDICTION_STATUSES)[number];

export const PREDICTOR_MODES = ['mock', 'real'] as const;
export type PredictorMode = (typeof PREDICTOR_MODES)[number];

/** A line item in a formula's bill-of-materials. */
export interface BomItem {
  material_code: string;
  material_name: string;
  /** Mass-fraction of this component, in the range (0, 1] (e.g. 0.42 for 42 %). */
  ratio: number;
  /** Functional role: 'base_oil', 'vii', 'pour_depressant', 'detergent', … */
  role: string;
  /** Optional supplier code, free-text. */
  supplier_code?: string;
  /** Optional batch / lot identifier. */
  lot_code?: string;
}

/**
 * One predicted physico-chemical metric.
 *
 * `confidence` is a 0..1 score returned by the underlying model; coarse
 * thresholds (>=0.8 high / >=0.6 medium / else low) are applied at the
 * UI layer, not here. `in_spec` is computed in the service from the spec
 * window when one is available.
 */
export interface PredictedMetric {
  name: string;
  display_name?: string;
  unit: string | null;
  predicted_value: number;
  spec_low: number | null;
  spec_high: number | null;
  in_spec: boolean | null;
  confidence: number;
}

export interface RiskWarning {
  level: 'info' | 'warning' | 'critical';
  code: string;
  message: string;
  metric?: string;
}

/** Model registry-friendly identity used by `/predict/model-version`. */
export interface ModelVersionInfo {
  /** Stable code, e.g. 'forward-predictor'. */
  code: string;
  version: string;
  /** Mode in effect for the running process. */
  mode: PredictorMode;
  framework?: string;
  trained_at?: string | null;
  feature_set_version?: string | null;
  /** Metrics this model can return; consumers can use it to pre-validate target lists. */
  supported_metrics: SupportedMetric[];
  /** Free-text changelog summary or registry pointer. */
  notes?: string;
}

export interface SupportedMetric {
  name: string;
  display_name: string;
  unit: string | null;
  spec_low: number | null;
  spec_high: number | null;
  /** Direction-of-good: higher / lower / window. */
  better: 'higher' | 'lower' | 'window';
}

// ─────────────────────────────────────────────────────────────────────────────
// Request / response DTOs (also produced by zod schemas below)
// ─────────────────────────────────────────────────────────────────────────────

export interface SinglePredictRequest {
  product_category: string;
  formula_version_id?: string | null;
  bom_items: BomItem[];
  target_metrics?: string[];
}

export interface BatchPredictRequest {
  product_category: string;
  /** N formulas; each item carries its own optional formula_version_id and BOM. */
  formulas: Array<{
    formula_version_id?: string | null;
    label?: string;
    bom_items: BomItem[];
  }>;
  target_metrics?: string[];
  /** Max parallelism for the in-process worker pool; defaults to 4. */
  concurrency?: number;
}

export interface ExplainPredictRequest extends SinglePredictRequest {
  /** Which metric to explain. Defaults to the first target_metric (or the model's default). */
  metric: string;
  /** Maximum number of feature contributions to return. */
  top_k?: number;
}

/** Single-call response — used directly by /predict/single and /predict/explain. */
export interface PredictionResponse {
  metrics: PredictedMetric[];
  risk_warnings: RiskWarning[];
  model_version: string;
  model_code: string;
  predictor_mode: PredictorMode;
  trace_id: string;
  /** Set on /predict/explain only. */
  explanations?: FeatureContribution[];
  /** Per-call latency in milliseconds. */
  duration_ms: number;
}

export interface BatchPredictionResponse {
  batch_id: string;
  results: Array<{
    index: number;
    label?: string;
    formula_version_id?: string | null;
    /** Either `metrics` or `error` is populated, never both. */
    metrics?: PredictedMetric[];
    risk_warnings?: RiskWarning[];
    error?: { code: string; message: string };
  }>;
  model_version: string;
  model_code: string;
  predictor_mode: PredictorMode;
  trace_id: string;
  total_duration_ms: number;
  /** Aggregate counts for quick UI consumption. */
  counts: { total: number; success: number; failed: number };
}

export interface FeatureContribution {
  feature: string;
  contribution: number; // signed influence (e.g. SHAP value)
  description?: string;
}
