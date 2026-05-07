/**
 * Zod schemas for the Forward Prediction Service.
 *
 * These power the `validate()` middleware and serve as the runtime
 * source-of-truth for DTO shapes. The `z.infer<typeof …>` exports are
 * what controllers/services consume.
 */
import { z } from 'zod';

/** A BOM line — at least the canonical 4 fields required by the API spec. */
export const BomItemSchema = z.object({
  material_code: z.string().min(1).max(64),
  material_name: z.string().min(1).max(255),
  ratio: z.number().positive().max(1, 'ratio must be a mass fraction in (0,1]'),
  role: z.string().min(1).max(64),
  supplier_code: z.string().max(64).optional(),
  lot_code: z.string().max(64).optional(),
});

/**
 * BOM sanity: total ratio must be > 0 and ≤ 1.001 (allow tiny rounding).
 * We pull this into a refinement helper so /single, /batch and /explain
 * can share it.
 */
function bomTotalRefine(items: Array<{ ratio: number }>, ctx: z.RefinementCtx) {
  const total = items.reduce((s, it) => s + (Number.isFinite(it.ratio) ? it.ratio : 0), 0);
  if (total <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'BOM ratio total must be > 0' });
  } else if (total > 1.001) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `BOM ratio total ${total.toFixed(4)} exceeds 1 (100 %)`,
    });
  }
}

const TargetMetrics = z.array(z.string().min(1).max(64)).max(32).optional();

export const SinglePredictRequestSchema = z
  .object({
    product_category: z.string().min(1).max(64),
    formula_version_id: z.string().uuid().nullable().optional(),
    bom_items: z.array(BomItemSchema).min(1).max(64),
    target_metrics: TargetMetrics,
  })
  .superRefine((v, ctx) => bomTotalRefine(v.bom_items, ctx));

export const BatchPredictRequestSchema = z.object({
  product_category: z.string().min(1).max(64),
  formulas: z
    .array(
      z
        .object({
          formula_version_id: z.string().uuid().nullable().optional(),
          label: z.string().max(120).optional(),
          bom_items: z.array(BomItemSchema).min(1).max(64),
        })
        .superRefine((v, ctx) => bomTotalRefine(v.bom_items, ctx))
    )
    .min(1)
    .max(50, 'Batch is capped at 50 formulas; submit multiple requests if more needed.'),
  target_metrics: TargetMetrics,
  concurrency: z.number().int().min(1).max(16).optional(),
});

export const ExplainPredictRequestSchema = z
  .object({
    product_category: z.string().min(1).max(64),
    formula_version_id: z.string().uuid().nullable().optional(),
    bom_items: z.array(BomItemSchema).min(1).max(64),
    target_metrics: TargetMetrics,
    metric: z.string().min(1).max(64),
    top_k: z.number().int().min(1).max(50).optional(),
  })
  .superRefine((v, ctx) => bomTotalRefine(v.bom_items, ctx));

export type ParsedSingleRequest = z.infer<typeof SinglePredictRequestSchema>;
export type ParsedBatchRequest = z.infer<typeof BatchPredictRequestSchema>;
export type ParsedExplainRequest = z.infer<typeof ExplainPredictRequestSchema>;
