import type { Extractor, ExtractorOutput, FormulaVersionInputs } from '../types.js';

/**
 * Viscosity blending features.
 *
 * 1) `weighted_viscosity_log` — naive log-weighted average:
 *      Σ (pct_i × ln(ν_i)) / Σ pct_i  (over items with viscosity)
 *    Useful as a coarse rheology signal even when inputs are partial.
 *
 * 2) `blended_viscosity_cst` — Refutas equation (industry standard):
 *      VBN_i      = 14.534 × ln(ln(ν_i + 0.8)) + 10.975
 *      VBN_blend  = Σ (x_i × VBN_i)             where x_i = pct_i / Σ pct_i
 *      ν_blend    = exp(exp((VBN_blend − 10.975) / 14.534)) − 0.8
 *
 *    Refutas requires `pct_i` and `ν_i` for EVERY item to produce a true blend
 *    — partial mixes return null and a missing-input note. Industry typically
 *    uses MASS fraction; our `percentage` is mass fraction by convention.
 */
export class LogMixViscosityExtractor implements Extractor {
  readonly group = 'log_mix' as const;
  readonly name = 'log_mix_viscosity';

  extract(inputs: FormulaVersionInputs): ExtractorOutput {
    const missing: string[] = [];
    const items = inputs.items;

    // Naive log-weighted (degrades gracefully with missing items)
    const weighted_viscosity_log = naiveLogWeighted(items);

    // Refutas — strict on completeness
    const refutas = refutasBlend(items);
    if (!refutas.complete) missing.push(`refutas: ${refutas.missing_count} items missing viscosity`);

    return {
      features: {
        weighted_viscosity_log,
        blended_viscosity_cst: refutas.value,
      },
      ...(missing.length > 0 ? { missing_inputs: missing } : {}),
    };
  }
}

export function naiveLogWeighted(items: ReadonlyArray<{ percentage: number | null; material_viscosity_cst: number | null }>): number | null {
  let num = 0;
  let den = 0;
  for (const i of items) {
    const v = i.material_viscosity_cst;
    const w = i.percentage ?? 0;
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || w <= 0) continue;
    num += w * Math.log(v);
    den += w;
  }
  if (den <= 0) return null;
  return round(num / den, 6);
}

/**
 * Refutas blend — pure math, exported for unit testing.
 * `value` is null when fewer than 2 items have viscosity data, or when
 * the resulting math is non-finite.
 */
export function refutasBlend(
  items: ReadonlyArray<{ percentage: number | null; material_viscosity_cst: number | null }>
): { value: number | null; complete: boolean; missing_count: number } {
  const eligible = items.filter((i) =>
    typeof i.material_viscosity_cst === 'number' &&
    Number.isFinite(i.material_viscosity_cst) &&
    (i.material_viscosity_cst as number) > 0 &&
    typeof i.percentage === 'number' &&
    (i.percentage as number) > 0
  );
  const missing_count = items.length - eligible.length;
  if (eligible.length < 2) return { value: null, complete: false, missing_count };

  const totalPct = eligible.reduce((s, i) => s + (i.percentage ?? 0), 0);
  if (totalPct <= 0) return { value: null, complete: false, missing_count };

  const VBN = (v: number) => 14.534 * Math.log(Math.log(v + 0.8)) + 10.975;

  let vbnBlend = 0;
  for (const i of eligible) {
    const x = (i.percentage ?? 0) / totalPct;        // mass fraction
    const v = i.material_viscosity_cst as number;
    const vbn = VBN(v);
    if (!Number.isFinite(vbn)) return { value: null, complete: false, missing_count };
    vbnBlend += x * vbn;
  }

  const inner = (vbnBlend - 10.975) / 14.534;
  const blended = Math.exp(Math.exp(inner)) - 0.8;
  if (!Number.isFinite(blended) || blended <= 0) {
    return { value: null, complete: false, missing_count };
  }
  return { value: round(blended, 4), complete: missing_count === 0, missing_count };
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
