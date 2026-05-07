/**
 * Zod schemas for the ERP integration HTTP layer.
 */
import { z } from 'zod';

const Cursor = z.record(z.unknown()).optional();
const Metadata = z.record(z.unknown()).optional();
const MaybeUuid = z.string().uuid().nullable().optional();

export const SapSyncSchema = z.object({
  mode: z.enum(['full', 'incremental']).optional(),
  cursor: Cursor,
  limit: z.number().int().min(1).max(1000).optional(),
  max_attempts: z.number().int().min(1).max(8).optional(),
  metadata: Metadata,
});

export const CreateLimsTaskSchema = z.object({
  internal_experiment_id: MaybeUuid,
  related_formula_id: MaybeUuid,
  related_formula_version_id: MaybeUuid,
  test_method: z.string().min(1).max(64),
  sample_count: z.number().int().min(1).max(50).optional(),
  due_date: z.string().min(8).max(40).nullable().optional(),
  notes: z.string().max(2000).optional(),
  max_attempts: z.number().int().min(1).max(8).optional(),
  metadata: Metadata,
});

export const PullLimsResultSchema = z.object({
  /** Optional override; defaults to link.external_lims_task_id. */
  external_lims_task_id: z.string().min(1).max(120).optional(),
  max_attempts: z.number().int().min(1).max(8).optional(),
});

export const ListLimsLinksQuerySchema = z.object({
  status: z
    .enum(['created', 'submitted', 'in_progress', 'completed', 'failed', 'cancelled'])
    .optional(),
  test_method: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export const CarbonFormulaSchema = z.object({
  product_category: z.string().max(64).optional(),
  bom: z
    .array(
      z.object({
        material_code: z.string().min(1).max(64),
        ratio: z.number().positive().max(1),
      })
    )
    .min(1)
    .max(64)
    .superRefine((bom, ctx) => {
      const total = bom.reduce((s, it) => s + it.ratio, 0);
      if (total > 1.001) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `BOM ratio total ${total.toFixed(4)} exceeds 1`,
        });
      }
    }),
});

export const IdParamSchema = z.object({ id: z.string().uuid() });
export const LimsLinkIdParamSchema = z.object({ linkId: z.string().uuid() });
export const MaterialCodeParamSchema = z.object({
  material_code: z.string().min(1).max(64),
});

export const ListJobsQuerySchema = z.object({
  source_system: z.enum(['sap', 'lims', 'carbon']).optional(),
  operation: z.string().max(64).optional(),
  status: z
    .enum(['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled', 'timeout'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export type ParsedSapSyncRequest = z.infer<typeof SapSyncSchema>;
export type ParsedCreateLimsTaskRequest = z.infer<typeof CreateLimsTaskSchema>;
export type ParsedPullLimsResultRequest = z.infer<typeof PullLimsResultSchema>;
export type ParsedCarbonFormulaRequest = z.infer<typeof CarbonFormulaSchema>;
