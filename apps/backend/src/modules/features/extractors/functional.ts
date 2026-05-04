import type { Extractor, ExtractorOutput, FormulaItemInput, FormulaVersionInputs } from '../types.js';

/**
 * Functional / chemistry features.
 *
 * Detection is tag-driven (raw_materials.tags) plus best-effort code/role
 * matching. Tag presence wins — the master-data layer is the source of truth.
 */
export class FunctionalExtractor implements Extractor {
  readonly group = 'functional' as const;
  readonly name = 'functional';

  extract(inputs: FormulaVersionInputs): ExtractorOutput {
    const items = inputs.items;
    const has = (test: (i: FormulaItemInput) => boolean) => items.some(test);

    // Phosphorus contribution from ZDDP-flagged items
    let phosphorusPpm = 0;
    let phosphorusKnown = false;
    for (const i of items) {
      if (!isZddp(i)) continue;
      const pPct = readNumber((i.material_properties ?? {}) as Record<string, unknown>, 'phosphorus_pct');
      const w = i.percentage ?? 0;
      if (pPct !== null && w > 0) {
        // pct is "percent of formula" (0-100). P content is "percent of additive" (0-100).
        // ppm = (pct/100) × (P_pct/100) × 1e6 = pct × P_pct × 100
        phosphorusPpm += w * pPct * 100;
        phosphorusKnown = true;
      }
    }

    const pctActive = sumPct(items, isAdditive);
    const pctBase = sumPct(items, isBase);
    const additive_to_base_ratio = pctBase > 0 ? round(pctActive / pctBase, 4) : null;

    return {
      features: {
        has_zddp:          has(isZddp),
        has_pao:           has(isPao),
        has_vi_improver:   has(isViImprover),
        has_antioxidant:   has(isAntioxidant),
        has_detergent:     has(isDetergent),
        additive_to_base_ratio,
        phosphorus_ppm_estimate: phosphorusKnown ? round(phosphorusPpm, 2) : null,
      },
    };
  }
}

function sumPct(items: FormulaItemInput[], pred: (i: FormulaItemInput) => boolean): number {
  return items.filter(pred).reduce((s, i) => s + (i.percentage ?? 0), 0);
}

function tagsHas(item: FormulaItemInput, tag: string): boolean {
  return (item.material_tags ?? []).includes(tag);
}

function nameContains(item: FormulaItemInput, needle: string): boolean {
  const n = (item.material_name ?? '').toLowerCase();
  const c = (item.material_code ?? '').toLowerCase();
  const k = needle.toLowerCase();
  return n.includes(k) || c.includes(k);
}

function isZddp(i: FormulaItemInput): boolean {
  return tagsHas(i, 'zddp') || tagsHas(i, 'aw') || nameContains(i, 'zddp') ||
         (i.role === 'antiwear');
}
function isPao(i: FormulaItemInput): boolean {
  return tagsHas(i, 'pao') || tagsHas(i, 'group_iv') || nameContains(i, 'pao');
}
function isViImprover(i: FormulaItemInput): boolean {
  return tagsHas(i, 'vi_improver') || nameContains(i, 'vi improver') || i.role === 'vi_improver';
}
function isAntioxidant(i: FormulaItemInput): boolean {
  return tagsHas(i, 'antioxidant') || nameContains(i, 'antioxidant') || i.role === 'antioxidant';
}
function isDetergent(i: FormulaItemInput): boolean {
  return tagsHas(i, 'detergent') || i.role === 'detergent';
}
function isBase(i: FormulaItemInput): boolean {
  return i.role === 'base' || tagsHas(i, 'base');
}
function isAdditive(i: FormulaItemInput): boolean {
  return !isBase(i);
}

function readNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
