import type { Extractor, ExtractorOutput, FormulaVersionInputs } from '../types.js';

/**
 * Complexity / diversity features over the percentage distribution.
 *
 *   complexity_entropy        = −Σ p_i × ln(p_i)         where p_i = pct_i / 100
 *   simpson_diversity         = 1 − Σ p_i²
 *   concentration_top3        = sum of three largest pcts
 *   effective_n_ingredients   = exp(entropy) — Hill number of order 1
 */
export class ComplexityExtractor implements Extractor {
  readonly group = 'complexity' as const;
  readonly name = 'complexity';

  extract(inputs: FormulaVersionInputs): ExtractorOutput {
    const pcts = inputs.items
      .map((i) => i.percentage ?? 0)
      .filter((p) => p > 0);

    if (pcts.length === 0) {
      return {
        features: {
          complexity_entropy: null,
          simpson_diversity: null,
          concentration_top3: null,
          effective_n_ingredients: null,
        },
      };
    }

    const total = pcts.reduce((s, p) => s + p, 0);
    if (total <= 0) {
      return {
        features: {
          complexity_entropy: 0,
          simpson_diversity: 0,
          concentration_top3: 0,
          effective_n_ingredients: 0,
        },
      };
    }
    const fractions = pcts.map((p) => p / total);

    const entropy = -fractions.reduce((s, p) => s + (p > 0 ? p * Math.log(p) : 0), 0);
    const simpson = 1 - fractions.reduce((s, p) => s + p * p, 0);
    const sortedDesc = [...pcts].sort((a, b) => b - a);
    const top3 = sortedDesc.slice(0, 3).reduce((s, p) => s + p, 0);

    return {
      features: {
        complexity_entropy: round(entropy, 5),
        simpson_diversity: round(simpson, 5),
        concentration_top3: round(top3, 4),
        effective_n_ingredients: round(Math.exp(entropy), 4),
      },
    };
  }
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
