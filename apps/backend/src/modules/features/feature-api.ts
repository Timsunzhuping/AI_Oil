import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { FeaturesRepository } from './repository.js';
import { FeatureGenerator } from './pipeline/generator.js';
import { buildFeatureSet, defaultExtractors } from './pipeline/builder.js';
import type {
  FeatureMap,
  FormulaVersionFeatureSet,
  ForwardSample,
  InverseAnchor,
} from './types.js';

/**
 * Unified Feature API — the SINGLE entry point both forward and inverse
 * model trainers should use. Adapters that need features should call this
 * and never query feature tables directly.
 *
 * Forward trainers: `getForwardSamples({ product_category_code, target_metric })`
 * Inverse trainers: `getInverseAnchors({ product_category_code })`
 * Either:           `getFormulaFeatures(formula_version_id)`  → just the X
 * Ad-hoc:           `extractFeatures(formula_version_id)`     → no DB write
 */
export class FeatureApi {
  private readonly repo: FeaturesRepository;
  private readonly generator: FeatureGenerator;

  constructor(private pool: Pool, logger: Logger) {
    this.repo = new FeaturesRepository(pool);
    this.generator = new FeatureGenerator(this.repo, logger);
  }

  /** Trigger a generation run. */
  generate = (input: Parameters<FeatureGenerator['run']>[0]) => this.generator.run(input);

  /** Cached features for one formula version. */
  async getFormulaFeatures(formulaVersionId: string, version?: string): Promise<unknown | null> {
    return this.repo.getFormulaVersionFeatures(formulaVersionId, version);
  }

  /** Compute features ad-hoc without touching the cache (useful for what-if). */
  async extractFeatures(formulaVersionId: string, featureSetVersion = 'v1.0'): Promise<FormulaVersionFeatureSet | null> {
    const versions = await this.repo.listFormulaVersionInputs({ formula_ids: [] });
    const all = await this.repo.listFormulaVersionInputs({}); // simple — limit by id below
    const target = all.find((v) => v.formula_version_id === formulaVersionId)
      ?? versions.find((v) => v.formula_version_id === formulaVersionId);
    if (!target) return null;
    return buildFeatureSet(target, featureSetVersion, defaultExtractors());
  }

  /** Forward training set (X, y). */
  async getForwardSamples(filter: {
    feature_set_version?: string;
    product_category_code?: string;
    target_metric?: string;
    is_complete?: boolean;
    formula_version_id?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: ForwardSample[]; total: number }> {
    const result = await this.repo.listForwardSamples(filter);
    return {
      items: result.items as ForwardSample[],
      total: result.total,
    };
  }

  /** Inverse anchor catalog. */
  async getInverseAnchors(filter: {
    feature_set_version?: string;
    product_category_code?: string;
    status?: string;
    formula_version_id?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: InverseAnchor[]; total: number }> {
    const result = await this.repo.listInverseAnchors(filter);
    return {
      items: result.items as InverseAnchor[],
      total: result.total,
    };
  }

  /** Feature dictionary doc (for UI / data team). */
  getDictionary(version?: string): Promise<unknown[]> {
    return this.repo.getFeatureDictionary(version);
  }

  /**
   * Convenience: compose an X (vector form) for a list of feature names.
   * Returns `{ feature_names, X: number[][] }` — ready to feed to a model.
   * Boolean features are coerced to 0/1; nulls become NaN (model-side imputation).
   */
  async getForwardMatrix(filter: {
    feature_set_version?: string;
    product_category_code?: string;
    target_metric: string;       // required — single-target matrix
    feature_names: string[];     // explicit ordering
    is_complete?: boolean;
    limit?: number;
  }): Promise<{
    feature_names: string[];
    X: number[][];
    y: number[];
    weights: number[];
    formula_version_ids: string[];
    batch_codes: Array<string | null>;
  }> {
    const samples = await this.getForwardSamples({
      ...filter,
      target_metric: filter.target_metric,
      limit: filter.limit ?? 5000,
    });
    const X: number[][] = [];
    const y: number[] = [];
    const weights: number[] = [];
    const formula_version_ids: string[] = [];
    const batch_codes: Array<string | null> = [];

    for (const s of samples.items as Array<{
      formula_version_id: string;
      batch_code: string | null;
      features: FeatureMap;
      target_metrics: Record<string, number>;
      weight: number;
    }>) {
      const yv = s.target_metrics[filter.target_metric];
      if (yv === undefined || yv === null || !Number.isFinite(yv)) continue;
      const row = filter.feature_names.map((name) => featureValueToNumber(s.features[name]));
      X.push(row);
      y.push(Number(yv));
      weights.push(s.weight ?? 1);
      formula_version_ids.push(s.formula_version_id);
      batch_codes.push(s.batch_code);
    }
    return { feature_names: filter.feature_names, X, y, weights, formula_version_ids, batch_codes };
  }
}

function featureValueToNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return Number.NaN;
}
