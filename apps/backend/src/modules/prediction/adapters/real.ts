/**
 * Real-model adapter scaffold.
 *
 * Concrete strategy is intentionally OUT-OF-SCOPE for this round — drop in
 * a sklearn / xgboost / pytorch loader, or a gRPC client to a dedicated
 * inference service. The class below stays as a typed extension point so
 * the wiring (`buildPredictor()`) can be flipped from `mock` → `real` via
 * a single env var without touching anything else.
 */
import { UpstreamError } from '../../../lib/errors.js';
import type {
  ExplainInput,
  ExplainOutput,
  PredictInput,
  PredictOutput,
  PredictorAdapter,
} from './types.js';
import type { ModelVersionInfo, SupportedMetric } from '../types.js';

export interface RealPredictorOptions {
  /** Stable code reported in `info()`. */
  code?: string;
  version: string;
  framework?: string;
  /** Date the model was trained, ISO-8601. */
  trained_at?: string;
  feature_set_version?: string | null;
  /** Endpoint URL when calling out to a remote inference service. */
  endpoint?: string;
  /** Authentication header / token (NEVER logged). */
  auth_token?: string;
  /** What metrics this real model is trained to produce. */
  supported_metrics: SupportedMetric[];
}

/**
 * Placeholder real adapter — every call throws `UpstreamError` until a
 * concrete implementation is provided. The error surfaces as 503 + code
 * 50300 in the unified envelope, so callers immediately see the model
 * isn't wired in.
 */
export class RealPredictorScaffold implements PredictorAdapter {
  constructor(private readonly opts: RealPredictorOptions) {}

  info(): ModelVersionInfo {
    return {
      code: this.opts.code ?? 'forward-predictor',
      version: this.opts.version,
      mode: 'real',
      framework: this.opts.framework ?? 'unknown',
      trained_at: this.opts.trained_at ?? null,
      feature_set_version: this.opts.feature_set_version ?? null,
      supported_metrics: this.opts.supported_metrics,
      notes: 'Real predictor scaffold — wire a concrete loader / RPC client before using.',
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async predict(_input: PredictInput): Promise<PredictOutput> {
    throw new UpstreamError(
      `Real predictor (${this.opts.version}) not implemented yet — set PREDICTOR_MODE=mock or wire in a real adapter.`
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async explain(_input: ExplainInput): Promise<ExplainOutput> {
    throw new UpstreamError(
      `Explain not supported by RealPredictorScaffold (${this.opts.version}). Override explain() in a subclass.`
    );
  }
}
