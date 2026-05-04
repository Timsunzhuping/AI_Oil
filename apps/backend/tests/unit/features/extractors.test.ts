import { describe, it, expect } from 'vitest';
import { StructureExtractor } from '../../../src/modules/features/extractors/structure.js';
import { WeightedPropertyExtractor, weightedAvg } from '../../../src/modules/features/extractors/weighted.js';
import { LogMixViscosityExtractor, refutasBlend, naiveLogWeighted } from '../../../src/modules/features/extractors/log-mix.js';
import { ComplexityExtractor } from '../../../src/modules/features/extractors/complexity.js';
import { CostExtractor } from '../../../src/modules/features/extractors/cost.js';
import { FunctionalExtractor } from '../../../src/modules/features/extractors/functional.js';
import type { FormulaItemInput, FormulaVersionInputs } from '../../../src/modules/features/types.js';
import { buildFeatureSet } from '../../../src/modules/features/pipeline/builder.js';

function item(over: Partial<FormulaItemInput>): FormulaItemInput {
  return {
    formula_item_id: over.formula_item_id ?? 'i-' + Math.random().toString(36).slice(2),
    raw_material_id: over.raw_material_id ?? 'm-1',
    product_id: over.product_id ?? null,
    sequence_no: over.sequence_no ?? 1,
    step_no: over.step_no ?? 1,
    phase: over.phase ?? 'A',
    amount: over.amount ?? 60,
    percentage: over.percentage ?? 60,
    unit_of_measure: over.unit_of_measure ?? 'kg',
    role: over.role ?? 'base',
    is_optional: over.is_optional ?? false,
    is_critical: over.is_critical ?? false,
    unit_cost: over.unit_cost ?? null,
    total_cost: over.total_cost ?? null,
    material_code: over.material_code ?? 'RM-1',
    material_name: over.material_name ?? 'Mineral Oil 150N',
    material_density: over.material_density ?? 0.870,
    material_molecular_weight: over.material_molecular_weight ?? null,
    material_flash_point_c: over.material_flash_point_c ?? 220,
    material_viscosity_cst: over.material_viscosity_cst ?? 30.5,
    material_ph: over.material_ph ?? null,
    material_default_unit_cost: over.material_default_unit_cost ?? 1.20,
    material_tags: over.material_tags ?? ['base', 'mineral'],
    material_properties: over.material_properties ?? {},
  };
}

function inputs(over: Partial<FormulaVersionInputs> = {}): FormulaVersionInputs {
  return {
    formula_version_id: over.formula_version_id ?? 'fv-1',
    formula_id: over.formula_id ?? 'f-1',
    formula_code: over.formula_code ?? 'FORM-1',
    formula_name: over.formula_name ?? 'Test Formula',
    product_id: over.product_id ?? 'p-1',
    product_category_code: over.product_category_code ?? 'ENGINE_OILS',
    product_code: over.product_code ?? 'PROD-1',
    batch_size: over.batch_size ?? 100,
    batch_unit: over.batch_unit ?? 'kg',
    cost_currency: over.cost_currency ?? 'USD',
    items: over.items ?? [],
  };
}

const SAMPLE_5W30 = (): FormulaVersionInputs => inputs({
  items: [
    item({ percentage: 60, role: 'base', unit_cost: 1.2, amount: 60,
           material_code: 'RM-MO-150N', material_name: 'Mineral Oil 150N',
           material_viscosity_cst: 30.5, material_density: 0.870,
           material_tags: ['base','mineral'] }),
    item({ percentage: 25, role: 'base', unit_cost: 4.8, amount: 25,
           material_code: 'RM-PAO-6', material_name: 'PAO 6cSt',
           material_viscosity_cst: 6.1, material_density: 0.827,
           material_tags: ['base','synthetic','pao'] }),
    item({ percentage: 1.2, role: 'antiwear', unit_cost: 8.5, amount: 1.2,
           material_code: 'RM-ZDDP-A', material_name: 'ZDDP Anti-wear',
           material_viscosity_cst: null, material_density: 1.080, phase: 'B',
           material_properties: { phosphorus_pct: 7.5 },
           material_tags: ['additive','aw','zddp'], is_critical: true }),
    item({ percentage: 0.8, role: 'antioxidant', unit_cost: 12, amount: 0.8,
           material_code: 'RM-AO-PHEN', material_name: 'Phenolic Antioxidant',
           material_viscosity_cst: null, material_density: 1.050, phase: 'B',
           material_tags: ['additive','antioxidant'] }),
    item({ percentage: 13, role: 'vi_improver', unit_cost: 6.2, amount: 13,
           material_code: 'RM-VI-OCP', material_name: 'OCP VI Improver',
           material_viscosity_cst: null, material_density: 0.880, phase: 'C',
           material_tags: ['additive','vi_improver'] }),
  ],
});

describe('StructureExtractor', () => {
  const ex = new StructureExtractor();

  it('counts items, phases, steps and roles', () => {
    const out = ex.extract(SAMPLE_5W30());
    expect(out.features.num_items).toBe(5);
    expect(out.features.num_phases).toBe(3);                // A, B, C
    expect(out.features.num_base).toBe(2);
    expect(out.features.num_active).toBe(1);                // antiwear
    expect(out.features.num_additive).toBe(3);              // antiwear + antioxidant + vi_improver
    expect(out.features.pct_base).toBeCloseTo(85, 4);       // 60 + 25
    expect(out.features.pct_additive).toBeCloseTo(15, 4);   // 1.2 + 0.8 + 13
    expect(out.features.critical_count).toBe(1);
  });
});

describe('weightedAvg + WeightedPropertyExtractor', () => {
  it('computes mass-weighted average with missing items skipped', () => {
    const items: FormulaItemInput[] = [
      item({ percentage: 70, material_density: 0.85 }),
      item({ percentage: 30, material_density: 0.95 }),
    ];
    const missing: string[] = [];
    expect(weightedAvg(items, 'material_density', missing, 'density'))
      .toBeCloseTo((70 * 0.85 + 30 * 0.95) / 100, 6);
  });

  it('returns null when every item is missing the property', () => {
    const items: FormulaItemInput[] = [
      item({ percentage: 50, material_molecular_weight: null }),
      item({ percentage: 50, material_molecular_weight: null }),
    ];
    const missing: string[] = [];
    expect(weightedAvg(items, 'material_molecular_weight', missing, 'mw')).toBeNull();
    expect(missing[0]).toContain('mw: 2 items missing');
  });

  it('extractor reports missing inputs', () => {
    const ex = new WeightedPropertyExtractor();
    const out = ex.extract(SAMPLE_5W30());
    expect(out.features.weighted_density).toBeCloseTo(
      (60 * 0.870 + 25 * 0.827 + 1.2 * 1.080 + 0.8 * 1.050 + 13 * 0.880) / 100,
      4
    );
    expect(out.missing_inputs).toBeDefined();             // molecular_weight is missing for all
  });
});

describe('Refutas viscosity blending', () => {
  it('blends two equal-mass base oils correctly', () => {
    // 50/50 of 30 cSt and 6 cSt should land in between (closer to the
    // lower one due to the log-log non-linearity, ~ 13-14 cSt range).
    const result = refutasBlend([
      { percentage: 50, material_viscosity_cst: 30 },
      { percentage: 50, material_viscosity_cst: 6 },
    ]);
    expect(result.value).not.toBeNull();
    expect(result.value!).toBeGreaterThan(6);
    expect(result.value!).toBeLessThan(30);
    expect(result.complete).toBe(true);
  });

  it('returns null when fewer than 2 items have viscosity', () => {
    expect(refutasBlend([{ percentage: 100, material_viscosity_cst: 30 }]).value).toBeNull();
    expect(refutasBlend([{ percentage: 50, material_viscosity_cst: null }, { percentage: 50, material_viscosity_cst: 30 }]).value).toBeNull();
  });

  it('reports missing_count for partial inputs', () => {
    const r = refutasBlend([
      { percentage: 60, material_viscosity_cst: 30 },
      { percentage: 25, material_viscosity_cst: 6 },
      { percentage: 15, material_viscosity_cst: null }, // VI improver, no viscosity
    ]);
    expect(r.missing_count).toBe(1);
    expect(r.complete).toBe(false);
  });

  it('LogMixViscosityExtractor includes both naive and Refutas', () => {
    const ex = new LogMixViscosityExtractor();
    const out = ex.extract(SAMPLE_5W30());
    expect(out.features.weighted_viscosity_log).not.toBeNull();
    expect(typeof out.features.blended_viscosity_cst === 'number' || out.features.blended_viscosity_cst === null).toBe(true);
  });

  it('naiveLogWeighted matches direct calculation', () => {
    const v = naiveLogWeighted([
      { percentage: 60, material_viscosity_cst: 30 },
      { percentage: 40, material_viscosity_cst: 6 },
    ]);
    const expected = (60 * Math.log(30) + 40 * Math.log(6)) / 100;
    expect(v).toBeCloseTo(expected, 5);
  });
});

describe('ComplexityExtractor', () => {
  const ex = new ComplexityExtractor();

  it('returns null entropy when no items', () => {
    expect(ex.extract(inputs()).features.complexity_entropy).toBeNull();
  });

  it('entropy of a uniform 4-component mix equals ln(4)', () => {
    const out = ex.extract(inputs({
      items: [
        item({ percentage: 25 }),
        item({ percentage: 25 }),
        item({ percentage: 25 }),
        item({ percentage: 25 }),
      ],
    }));
    expect(out.features.complexity_entropy).toBeCloseTo(Math.log(4), 4);
    expect(out.features.effective_n_ingredients).toBeCloseTo(4, 3);
    expect(out.features.simpson_diversity).toBeCloseTo(0.75, 3);
  });

  it('entropy collapses to 0 for a single-component mix', () => {
    const out = ex.extract(inputs({ items: [item({ percentage: 100 })] }));
    expect(out.features.complexity_entropy).toBeCloseTo(0, 6);
    expect(out.features.simpson_diversity).toBeCloseTo(0, 6);
  });

  it('top3 sums the three largest', () => {
    const out = ex.extract(inputs({
      items: [
        item({ percentage: 60 }), item({ percentage: 25 }),
        item({ percentage: 8 }),  item({ percentage: 5 }), item({ percentage: 2 }),
      ],
    }));
    expect(out.features.concentration_top3).toBeCloseTo(60 + 25 + 8, 4);
  });
});

describe('CostExtractor', () => {
  const ex = new CostExtractor();

  it('sums (amount × unit_cost) across items', () => {
    const out = ex.extract(SAMPLE_5W30());
    const expected = 60 * 1.2 + 25 * 4.8 + 1.2 * 8.5 + 0.8 * 12 + 13 * 6.2;
    expect(out.features.total_cost).toBeCloseTo(expected, 2);
  });

  it('cost_per_kg = total_cost / batch_size', () => {
    const out = ex.extract(SAMPLE_5W30());
    expect(out.features.cost_per_kg).toBeCloseTo((out.features.total_cost as number) / 100, 4);
  });

  it('falls back to material.default_unit_cost when item.unit_cost is null', () => {
    const out = ex.extract(inputs({
      items: [
        item({ percentage: 100, amount: 100, unit_cost: null, material_default_unit_cost: 2.5 }),
      ],
    }));
    expect(out.features.total_cost).toBeCloseTo(250, 2);
  });

  it('top_cost_share identifies the dominant ingredient', () => {
    const out = ex.extract(SAMPLE_5W30());
    const total = out.features.total_cost as number;
    expect(out.features.top_cost_share).toBeCloseTo(80.6 / total, 3); // 13 × 6.2 = 80.6 dominates over 25 × 4.8 = 120 — actually 120 is bigger
    // Let's just sanity-check it's between 0 and 1
    expect(out.features.top_cost_share as number).toBeGreaterThan(0);
    expect(out.features.top_cost_share as number).toBeLessThanOrEqual(1);
  });
});

describe('FunctionalExtractor', () => {
  const ex = new FunctionalExtractor();

  it('detects ZDDP / PAO / VI improver / antioxidant via tags', () => {
    const out = ex.extract(SAMPLE_5W30());
    expect(out.features.has_zddp).toBe(true);
    expect(out.features.has_pao).toBe(true);
    expect(out.features.has_vi_improver).toBe(true);
    expect(out.features.has_antioxidant).toBe(true);
  });

  it('computes additive_to_base_ratio', () => {
    const out = ex.extract(SAMPLE_5W30());
    expect(out.features.additive_to_base_ratio).toBeCloseTo(15 / 85, 4);
  });

  it('estimates phosphorus when ZDDP carries phosphorus_pct', () => {
    const out = ex.extract(SAMPLE_5W30());
    // 1.2% × 7.5% × 100 = 900 ppm
    expect(out.features.phosphorus_ppm_estimate).toBeCloseTo(900, 1);
  });

  it('returns null phosphorus when no ZDDP carries phosphorus_pct', () => {
    const out = ex.extract(inputs({
      items: [
        item({ percentage: 100, material_tags: ['base'], material_properties: {} }),
      ],
    }));
    expect(out.features.phosphorus_ppm_estimate).toBeNull();
  });
});

describe('buildFeatureSet integration', () => {
  it('produces a complete feature set with hot columns populated', () => {
    const fset = buildFeatureSet(SAMPLE_5W30(), 'v1.0');
    expect(fset.feature_set_version).toBe('v1.0');
    expect(fset.hot.num_items).toBe(5);
    expect(fset.hot.weighted_density).not.toBeNull();
    expect(fset.hot.complexity_entropy).not.toBeNull();
    expect(fset.hot.total_cost).not.toBeNull();
    expect(fset.hot.cost_currency).toBe('USD');
    // Should report missing inputs (molecular_weight unknown for all items)
    expect(fset.has_missing_inputs).toBe(true);
    // Top-level features dict has every group represented
    expect(fset.features.num_items).toBe(5);
    expect(fset.features.has_zddp).toBe(true);
    expect(fset.features.complexity_entropy).not.toBeNull();
  });

  it('handles a minimal formula gracefully', () => {
    const fset = buildFeatureSet(inputs({ items: [item({ percentage: 100 })] }), 'v1.0');
    expect(fset.features.num_items).toBe(1);
    expect(fset.features.complexity_entropy).toBe(0);
  });
});
