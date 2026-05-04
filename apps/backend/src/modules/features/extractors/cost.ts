import type { Extractor, ExtractorOutput, FormulaVersionInputs } from '../types.js';

/**
 * Cost-and-inventory features.
 *
 *   total_cost      = Σ (amount_i × unit_cost_i)
 *                     (item.unit_cost wins; falls back to material.default_unit_cost)
 *   cost_per_kg     = total_cost / batch_size
 *   top_cost_share  = max(item_cost) / total_cost   — single-ingredient concentration
 *   currency        = formula's cost_currency (denormalized for the hot column)
 */
export class CostExtractor implements Extractor {
  readonly group = 'cost' as const;
  readonly name = 'cost';

  extract(inputs: FormulaVersionInputs): ExtractorOutput {
    const items = inputs.items;
    const missing: string[] = [];

    const itemCosts: number[] = [];
    let total = 0;
    let counted = 0;

    for (const i of items) {
      const unit = i.unit_cost ?? i.material_default_unit_cost ?? null;
      const amount = i.amount ?? 0;
      if (typeof unit === 'number' && Number.isFinite(unit) && amount > 0) {
        const cost = unit * amount;
        itemCosts.push(cost);
        total += cost;
        counted++;
      }
    }
    const skipped = items.length - counted;
    if (skipped > 0) missing.push(`cost: ${skipped} items missing unit_cost`);

    const totalCost = counted > 0 ? round(total, 4) : null;
    const batchSize = inputs.batch_size && inputs.batch_size > 0 ? inputs.batch_size : null;
    const costPerKg = totalCost !== null && batchSize !== null ? round(totalCost / batchSize, 4) : null;
    const topShare =
      itemCosts.length > 0 && total > 0
        ? round(Math.max(...itemCosts) / total, 4)
        : null;

    return {
      features: {
        total_cost: totalCost,
        cost_per_kg: costPerKg,
        top_cost_share: topShare,
      },
      ...(missing.length > 0 ? { missing_inputs: missing } : {}),
    };
  }
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
