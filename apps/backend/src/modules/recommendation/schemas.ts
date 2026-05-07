/**
 * Zod schemas for the Reverse Recommendation Service.
 *
 * Validate at the controller boundary; accept the parsed shape into the
 * service layer. Constraints worth highlighting:
 *
 *   • At least one target metric is required.
 *   • Either `material_pool` (cost_priority / new_product) or
 *     `base_bom + replacement_pool` (material_replacement) must be present
 *     — the auto-detect rule lives in the service so the controller only
 *     guards shape, not semantics.
 *   • `random_seed` is optional; service auto-generates and persists if missing.
 */
import { z } from 'zod';
import { BomItemSchema } from '../prediction/schemas.js';

// ── Building blocks ─────────────────────────────────────────────────────────

export const TargetMetricSchema = z
  .object({
    name: z.string().min(1).max(64),
    display_name: z.string().max(128).optional(),
    target: z.number().optional(),
    unit: z.string().max(32).optional(),
    lower_bound: z.number().optional(),
    upper_bound: z.number().optional(),
    weight: z.number().positive().max(10).optional(),
  })
  .superRefine((v, ctx) => {
    if (
      v.lower_bound !== undefined &&
      v.upper_bound !== undefined &&
      v.lower_bound > v.upper_bound
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'lower_bound must be ≤ upper_bound' });
    }
  });

export const MaterialPoolEntrySchema = z
  .object({
    material_code: z.string().min(1).max(64),
    material_name: z.string().min(1).max(255),
    role: z.string().min(1).max(64),
    unit_cost: z.number().nonnegative().optional(),
    carbon_per_kg: z.number().nonnegative().optional(),
    min_ratio: z.number().nonnegative().max(1).optional(),
    max_ratio: z.number().positive().max(1).optional(),
    supplier_code: z.string().max(64).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.min_ratio !== undefined && v.max_ratio !== undefined && v.min_ratio > v.max_ratio) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'min_ratio must be ≤ max_ratio' });
    }
  });

export const LockedMaterialSchema = z.object({
  material_code: z.string().min(1).max(64),
  material_name: z.string().min(1).max(255).optional(),
  role: z.string().max(64).optional(),
  ratio: z.number().positive().max(1).optional(),
});

export const InventoryConstraintSchema = z.object({
  material_code: z.string().min(1).max(64),
  available_kg: z.number().nonnegative(),
  batch_size_kg: z.number().positive().optional(),
});

export const ReplacementCandidateSchema = z.object({
  replace_material_code: z.string().min(1).max(64),
  with_material_code: z.string().min(1).max(64),
  fixed_ratio: z.number().positive().max(1).optional(),
});

export const ProcessConstraintsSchema = z.object({
  blending_temperature_c: z
    .object({ min: z.number().optional(), max: z.number().optional() })
    .optional(),
  blending_time_min: z
    .object({ min: z.number().optional(), max: z.number().optional() })
    .optional(),
  filtration_micron: z.object({ max: z.number().optional() }).optional(),
  storage_max_temperature_c: z.number().optional(),
  notes: z.string().max(1000).optional(),
});

// ── Top-level request schemas ───────────────────────────────────────────────

export const GenerateRequestSchema = z.object({
  product_category: z.string().min(1).max(64),
  application_scene: z.string().max(255).optional(),
  strategy: z.enum(['cost_priority', 'material_replacement', 'new_product']).optional(),
  target_metrics: z
    .array(TargetMetricSchema)
    .min(1, 'At least one target_metric is required')
    .max(32),
  cost_limit: z.number().positive().optional(),
  carbon_limit: z.number().nonnegative().nullable().optional(),
  inventory_constraints: z.array(InventoryConstraintSchema).max(64).optional(),
  material_pool: z.array(MaterialPoolEntrySchema).max(128).optional(),
  base_bom: z.array(BomItemSchema).max(64).optional(),
  replacement_pool: z.array(ReplacementCandidateSchema).max(64).optional(),
  locked_materials: z.array(LockedMaterialSchema).max(20).optional(),
  process_constraints: ProcessConstraintsSchema.optional(),
  n_candidates: z.number().int().min(1).max(10).optional(),
  random_seed: z.number().int().nonnegative().optional(),
  title: z.string().max(255).optional(),
});

export const RecalculateRequestSchema = z
  .object({
    task_id: z.string().uuid(),
    candidate_id: z.string().uuid(),
    modifications: z
      .array(
        z.object({
          material_code: z.string().min(1).max(64),
          new_ratio: z.number().nonnegative().max(1),
        })
      )
      .max(64)
      .optional(),
    full_bom: z.array(BomItemSchema).max(64).optional(),
    persist: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.modifications && !v.full_bom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'either `modifications` or `full_bom` must be provided',
      });
    }
  });

export const ReplaceMaterialRequestSchema = z.object({
  task_id: z.string().uuid(),
  candidate_id: z.string().uuid(),
  swap: z.object({
    from_material_code: z.string().min(1).max(64),
    to_material_code: z.string().min(1).max(64),
    new_ratio: z.number().nonnegative().max(1).optional(),
  }),
  persist: z.boolean().optional(),
});

export const TaskIdParamSchema = z.object({
  taskId: z.string().uuid(),
});

export type ParsedGenerateRequest = z.infer<typeof GenerateRequestSchema>;
export type ParsedRecalculateRequest = z.infer<typeof RecalculateRequestSchema>;
export type ParsedReplaceMaterialRequest = z.infer<typeof ReplaceMaterialRequestSchema>;
