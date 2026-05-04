import type { Extractor, ExtractorOutput, FormulaVersionInputs } from '../types.js';

const ACTIVE_ROLES = new Set(['active', 'antiwear', 'detergent', 'dispersant']);
const BASE_ROLES = new Set(['base']);
const ADDITIVE_ROLES = new Set([
  'antiwear', 'antioxidant', 'vi_improver', 'detergent', 'dispersant',
  'preservative', 'pour_point_depressant', 'corrosion_inhibitor', 'extreme_pressure',
]);

export class StructureExtractor implements Extractor {
  readonly group = 'structure' as const;
  readonly name = 'structure';

  extract(inputs: FormulaVersionInputs): ExtractorOutput {
    const items = inputs.items;
    const phases = new Set(items.map((i) => i.phase).filter((p): p is string => !!p));
    const steps = new Set(items.map((i) => i.step_no).filter((s): s is number => s !== null));

    const sumPctWhere = (pred: (role: string | null) => boolean) =>
      items
        .filter((i) => pred(i.role))
        .reduce((acc, i) => acc + (i.percentage ?? 0), 0);

    return {
      features: {
        num_items: items.length,
        num_phases: phases.size,
        num_steps: steps.size,
        num_active:    items.filter((i) => ACTIVE_ROLES.has(i.role ?? '')).length,
        num_base:      items.filter((i) => BASE_ROLES.has(i.role ?? '')).length,
        num_additive:  items.filter((i) => ADDITIVE_ROLES.has(i.role ?? '')).length,
        pct_active:    round(sumPctWhere((r) => ACTIVE_ROLES.has(r ?? '')), 4),
        pct_base:      round(sumPctWhere((r) => BASE_ROLES.has(r ?? '')), 4),
        pct_additive:  round(sumPctWhere((r) => ADDITIVE_ROLES.has(r ?? '')), 4),
        critical_count: items.filter((i) => i.is_critical).length,
        optional_count: items.filter((i) => i.is_optional).length,
      },
    };
  }
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
