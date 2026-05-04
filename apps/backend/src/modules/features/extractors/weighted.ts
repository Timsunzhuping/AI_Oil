import type { Extractor, ExtractorOutput, FormulaItemInput, FormulaVersionInputs } from '../types.js';

/**
 * Mass-weighted average property aggregations.
 *
 * For a property `p` of materials:
 *   weighted_p = Σ (pct_i × p_i) / Σ pct_i,    over items where p_i is defined
 *
 * Items missing the property are excluded from BOTH numerator and denominator
 * — so a partially-known formulation still yields a meaningful weighted
 * average, just a noisier one. We track which items were skipped.
 */
export class WeightedPropertyExtractor implements Extractor {
  readonly group = 'weighted_property' as const;
  readonly name = 'weighted_property';

  extract(inputs: FormulaVersionInputs): ExtractorOutput {
    const missing: string[] = [];

    const features: Record<string, number | null> = {
      weighted_density:          weightedAvg(inputs.items, 'material_density', missing, 'density'),
      weighted_molecular_weight: weightedAvg(inputs.items, 'material_molecular_weight', missing, 'molecular_weight'),
      weighted_flash_point:      weightedAvg(inputs.items, 'material_flash_point_c', missing, 'flash_point'),
      weighted_ph:               weightedAvg(inputs.items, 'material_ph', missing, 'ph'),
    };

    return {
      features,
      ...(missing.length > 0 ? { missing_inputs: missing } : {}),
    };
  }
}

/**
 * Weighted average of `key` across `items`, where `key` is a numeric column on
 * the joined material. Items where the key is null/undefined are skipped (and
 * recorded in `missing` for telemetry). Returns null when ALL items are missing.
 */
export function weightedAvg<K extends keyof FormulaItemInput>(
  items: FormulaItemInput[],
  key: K,
  missing: string[],
  label: string
): number | null {
  let num = 0;
  let den = 0;
  let skipped = 0;
  for (const i of items) {
    const v = i[key] as number | null | undefined;
    const w = i.percentage ?? 0;
    if (typeof v !== 'number' || !Number.isFinite(v) || w <= 0) {
      if (typeof v !== 'number' || !Number.isFinite(v)) skipped++;
      continue;
    }
    num += w * v;
    den += w;
  }
  if (skipped > 0) missing.push(`${label}: ${skipped} items missing`);
  if (den <= 0) return null;
  return round(num / den, 6);
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
