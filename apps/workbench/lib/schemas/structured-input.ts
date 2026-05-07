/**
 * Zod schemas for the 6-section structured requirement form.
 *
 * Each section maps to a `<fieldset>` in `components/tasks/structured-form.tsx`.
 * Most numeric ranges are optional — the form lets the user fill what they
 * know and leaves the rest to model defaults.
 */
import { z } from 'zod';

// ────────────────────────────────────────────────────────────────────────────
// Reusable primitives
// ────────────────────────────────────────────────────────────────────────────
const optionalNumber = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined || v === '') return undefined;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  })
  .pipe(z.number().optional());

const optionalString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (v === null || v === undefined || v === '' ? undefined : String(v).trim()))
  .pipe(z.string().min(1).optional());

// ────────────────────────────────────────────────────────────────────────────
// Sections
// ────────────────────────────────────────────────────────────────────────────

/** 1. 产品场景 — what kind of product, what use case. */
export const productScenarioSchema = z.object({
  product_category: z.enum([
    'engine_oil_pcmo',     // 乘用车机油
    'engine_oil_hdeo',     // 商用车机油
    'industrial_gear',     // 工业齿轮油
    'turbine',             // 汽轮机油
    'hydraulic',           // 液压油
    'compressor',          // 压缩机油
    'metalworking',        // 金属加工液
    'grease',              // 润滑脂
    'specialty',           // 特种润滑油
  ]),
  application_scenario: z.string().min(2, '请描述应用场景').max(500),
  service_temperature_min_c: optionalNumber,
  service_temperature_max_c: optionalNumber,
  region: optionalString,
});

/** 2. 目标性能 — quantitative metric targets. */
export const performanceTargetsSchema = z.object({
  kv_100c: optionalNumber,
  kv_40c: optionalNumber,
  viscosity_index_min: optionalNumber,
  pour_point_max_c: optionalNumber,
  flash_point_min_c: optionalNumber,
  ccs_temperature_c: optionalNumber,
  ccs_max_mpa_s: optionalNumber,
  noack_max_pct: optionalNumber,
  notes: optionalString,
});

/** 3. 成本约束 — budget constraints. */
export const costConstraintSchema = z.object({
  target_cost_cny_per_kg: optionalNumber,
  max_cost_cny_per_kg: optionalNumber,
  /** 0..1 — how much we can deviate from the cost target. */
  cost_tolerance_pct: optionalNumber,
});

/** 4. 原料约束 — raw materials we are required / forbidden to use. */
export const rawMaterialConstraintSchema = z.object({
  required_materials: z.array(z.string().min(1)).max(20).optional().default([]),
  forbidden_materials: z.array(z.string().min(1)).max(20).optional().default([]),
  preferred_base_oil_groups: z.array(z.enum(['I', 'II', 'III', 'IV', 'V'])).optional().default([]),
});

/** 5. 环保 / 法规约束. */
export const regulatoryConstraintSchema = z.object({
  api_grade: optionalString, // e.g. 'SP', 'CK-4'
  ilsac_grade: optionalString, // e.g. 'GF-6A'
  acea_grades: z.array(z.string().min(1)).max(10).optional().default([]),
  oem_specs: z.array(z.string().min(1)).max(10).optional().default([]),
  reach_compliant: z.boolean().optional().default(true),
  rohs_compliant: z.boolean().optional().default(true),
  max_p_pct: optionalNumber,
  max_s_pct: optionalNumber,
  max_sulfated_ash_pct: optionalNumber,
});

/** 6. 工艺约束 — manufacturing constraints. */
export const processConstraintSchema = z.object({
  blending_temperature_c: optionalNumber,
  blending_time_min: optionalNumber,
  filtration_micron: optionalNumber,
  package_size_l: optionalNumber,
  storage_max_temperature_c: optionalNumber,
  notes: optionalString,
});

// ────────────────────────────────────────────────────────────────────────────
// Top-level form
// ────────────────────────────────────────────────────────────────────────────
export const structuredInputSchema = z.object({
  title: z.string().min(2, '请填写需求标题').max(120),
  description: z.string().max(1000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  task_type: z.enum([
    'forward_prediction',
    'cost_optimization',
    'material_replacement',
    'new_product_generation',
  ]),
  product_scenario: productScenarioSchema,
  performance_targets: performanceTargetsSchema,
  cost_constraint: costConstraintSchema,
  raw_material_constraint: rawMaterialConstraintSchema,
  regulatory_constraint: regulatoryConstraintSchema,
  process_constraint: processConstraintSchema,
  template_id: z.string().optional(),
});

export type StructuredInputValues = z.infer<typeof structuredInputSchema>;

/** Defaults used when initialising the form. */
export const structuredInputDefaults: StructuredInputValues = {
  title: '',
  description: '',
  priority: 'medium',
  task_type: 'forward_prediction',
  product_scenario: {
    product_category: 'engine_oil_pcmo',
    application_scenario: '',
    service_temperature_min_c: undefined,
    service_temperature_max_c: undefined,
    region: undefined,
  },
  performance_targets: {
    kv_100c: undefined,
    kv_40c: undefined,
    viscosity_index_min: undefined,
    pour_point_max_c: undefined,
    flash_point_min_c: undefined,
    ccs_temperature_c: undefined,
    ccs_max_mpa_s: undefined,
    noack_max_pct: undefined,
    notes: undefined,
  },
  cost_constraint: {
    target_cost_cny_per_kg: undefined,
    max_cost_cny_per_kg: undefined,
    cost_tolerance_pct: undefined,
  },
  raw_material_constraint: {
    required_materials: [],
    forbidden_materials: [],
    preferred_base_oil_groups: [],
  },
  regulatory_constraint: {
    api_grade: undefined,
    ilsac_grade: undefined,
    acea_grades: [],
    oem_specs: [],
    reach_compliant: true,
    rohs_compliant: true,
    max_p_pct: undefined,
    max_s_pct: undefined,
    max_sulfated_ash_pct: undefined,
  },
  process_constraint: {
    blending_temperature_c: undefined,
    blending_time_min: undefined,
    filtration_micron: undefined,
    package_size_l: undefined,
    storage_max_temperature_c: undefined,
    notes: undefined,
  },
};

/** NL prompt schema — much simpler. */
export const nlPromptSchema = z.object({
  title: z.string().min(2, '请填写需求标题').max(120),
  prompt: z.string().min(8, '描述请至少 8 个字').max(2000),
  task_type: z.enum([
    'forward_prediction',
    'cost_optimization',
    'material_replacement',
    'new_product_generation',
    'knowledge_qa',
  ]).default('forward_prediction'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
});

export type NlPromptValues = z.infer<typeof nlPromptSchema>;
