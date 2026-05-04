import { StructureExtractor } from '../extractors/structure.js';
import { WeightedPropertyExtractor } from '../extractors/weighted.js';
import { LogMixViscosityExtractor } from '../extractors/log-mix.js';
import { ComplexityExtractor } from '../extractors/complexity.js';
import { CostExtractor } from '../extractors/cost.js';
import { FunctionalExtractor } from '../extractors/functional.js';
import type {
  Extractor,
  FeatureMap,
  FormulaVersionFeatureSet,
  FormulaVersionInputs,
} from '../types.js';

/**
 * The default extractor stack for feature_set_version `v1.0`.
 * Adding a new feature: extend this array (or its replacement) and register
 * the row(s) in `feature_definitions` under the next version label.
 */
export function defaultExtractors(): Extractor[] {
  return [
    new StructureExtractor(),
    new WeightedPropertyExtractor(),
    new LogMixViscosityExtractor(),
    new ComplexityExtractor(),
    new CostExtractor(),
    new FunctionalExtractor(),
  ];
}

/**
 * Run every extractor over an inputs snapshot and assemble the feature set.
 * Pure function — no DB, no logging — fully unit-testable.
 */
export function buildFeatureSet(
  inputs: FormulaVersionInputs,
  feature_set_version: string,
  extractors: Extractor[] = defaultExtractors()
): FormulaVersionFeatureSet {
  const features: FeatureMap = {};
  const missing: string[] = [];

  for (const ex of extractors) {
    try {
      const out = ex.extract(inputs);
      Object.assign(features, out.features);
      if (out.missing_inputs && out.missing_inputs.length > 0) {
        missing.push(...out.missing_inputs);
      }
    } catch (err) {
      missing.push(`${ex.name}: ${(err as Error).message}`);
    }
  }

  // Pull denormalized "hot" columns from the wide map
  const hot = {
    num_items:               toNumOrNull(features.num_items),
    num_phases:              toNumOrNull(features.num_phases),
    num_active:              toNumOrNull(features.num_active),
    total_active_pct:        toNumOrNull(features.pct_active),
    weighted_density:        toNumOrNull(features.weighted_density),
    weighted_viscosity_log:  toNumOrNull(features.weighted_viscosity_log),
    blended_viscosity_cst:   toNumOrNull(features.blended_viscosity_cst),
    total_cost:              toNumOrNull(features.total_cost),
    cost_currency:           inputs.cost_currency,
    complexity_entropy:      toNumOrNull(features.complexity_entropy),
  };

  return {
    formula_version_id: inputs.formula_version_id,
    feature_set_version,
    features,
    hot,
    has_missing_inputs: missing.length > 0,
    missing_inputs: missing,
  };
}

function toNumOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}
