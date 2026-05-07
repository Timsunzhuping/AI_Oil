/**
 * Predictor adapter contract.
 *
 * The service layer never speaks to a model directly — it speaks to a
 * `PredictorAdapter`. Implementations can be:
 *   - in-process mock (deterministic, used in tests / dev / demos)
 *   - in-process scikit-learn / xgboost / pytorch artifact loader
 *   - remote RPC client (gRPC / HTTP) calling a dedicated inference service
 *
 * Whatever the implementation, the contract enforces:
 *   1. Stateless `predict()` — no hidden cross-request memory
 *   2. Model identity exposed via `info()` — what version, what mode, what
 *      metrics it can produce
 *   3. Optional `explain()` — feature attributions, returned in a uniform
 *      `FeatureContribution[]` shape
 */
import type { BomItem, FeatureContribution, ModelVersionInfo, PredictedMetric } from '../types.js';

export interface PredictInput {
  product_category: string;
  formula_version_id?: string | null;
  bom_items: BomItem[];
  /** Subset of metrics to predict; when empty, predict ALL supported. */
  target_metrics?: string[];
}

export interface PredictOutput {
  metrics: PredictedMetric[];
}

export interface ExplainInput extends PredictInput {
  metric: string;
  top_k?: number;
}

export interface ExplainOutput {
  metric: string;
  predicted_value: number;
  base_value: number;
  contributions: FeatureContribution[];
}

export interface PredictorAdapter {
  /** Static identity used by `/predict/model-version`. */
  info(): ModelVersionInfo;

  /** Run the model on a single BOM and return predicted metrics. */
  predict(input: PredictInput): Promise<PredictOutput>;

  /**
   * Optional explanation API. Adapters that don't support it should throw
   * an `UpstreamError` so the service can convert it into a 503 cleanly.
   */
  explain(input: ExplainInput): Promise<ExplainOutput>;
}
