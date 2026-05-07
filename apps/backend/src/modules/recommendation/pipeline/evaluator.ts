/**
 * Surrogate evaluator.
 *
 * Wraps a `PredictorAdapter` (the same interface used by /predict/single,
 * /predict/batch, etc.) so the recommendation pipeline can call the
 * forward predictor IN-PROCESS — no HTTP roundtrip, full reproducibility,
 * and tests can swap in a mock adapter for free.
 */
import type { PredictorAdapter } from '../../prediction/adapters/types.js';
import type { BomItem, PredictedMetric } from '../../prediction/types.js';
import type { GenerateRequest } from '../types.js';

export interface SurrogateEvaluator {
  evaluate(bom: BomItem[], req: GenerateRequest): Promise<PredictedMetric[]>;
  /** Identity of the underlying adapter, surfaced into task / candidate rows. */
  modelInfo(): { code: string; version: string; mode: 'mock' | 'real' };
}

export class PredictorBackedEvaluator implements SurrogateEvaluator {
  constructor(private readonly adapter: PredictorAdapter) {}

  async evaluate(bom: BomItem[], req: GenerateRequest): Promise<PredictedMetric[]> {
    const out = await this.adapter.predict({
      product_category: req.product_category,
      bom_items: bom,
      target_metrics: req.target_metrics.map((t) => t.name),
    });
    return out.metrics;
  }

  modelInfo(): { code: string; version: string; mode: 'mock' | 'real' } {
    const i = this.adapter.info();
    return { code: i.code, version: i.version, mode: i.mode };
  }
}
