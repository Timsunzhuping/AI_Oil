/**
 * Zod schemas for the evaluation HTTP layer.
 *
 * Test-set creation does NOT validate the inner `cases` shape — that's
 * the runner's job (it errors per-case and surfaces the failure on the
 * report). This keeps the API permissive enough for users to upload
 * messy datasets and still get a useful diagnostic.
 */
import { z } from 'zod';
import { TEST_TYPES, TEST_SET_STATUSES, TRIGGER_TYPES } from './types.js';

const Json = z.record(z.unknown());
const Strings = z.array(z.string().min(1).max(64)).max(50).optional();

export const CreateTestSetSchema = z.object({
  code: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  test_type: z.enum(TEST_TYPES),
  product_category: z.string().max(64).optional(),
  cases: z.array(Json).max(2000),
  default_tolerance: Json.optional(),
  source_dataset_id: z.string().uuid().nullable().optional(),
  status: z.enum(TEST_SET_STATUSES).optional(),
  metadata: Json.optional(),
  tags: Strings,
});

export const ListTestSetsQuerySchema = z.object({
  test_type: z.enum(TEST_TYPES).optional(),
  status: z.enum(TEST_SET_STATUSES).optional(),
  q: z.string().max(255).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export const RunRequestSchema = z.object({
  test_set_id: z.string().uuid(),
  trigger_type: z.enum(TRIGGER_TYPES).optional(),
  config: z
    .object({
      tolerance: z
        .object({
          max_relative_error: z.number().nonnegative().max(10).optional(),
          max_absolute_error: z.number().nonnegative().optional(),
          min_metric_pass_rate: z.number().min(0).max(1).optional(),
        })
        .optional(),
      stability_tolerance: z
        .object({
          min_pairwise_cosine: z.number().min(-1).max(1).optional(),
          max_cv: z.number().nonnegative().optional(),
        })
        .optional(),
      case_ids: z.array(z.string().min(1).max(255)).max(2000).optional(),
      default_runs: z.number().int().min(2).max(50).optional(),
    })
    .optional(),
  metadata: Json.optional(),
});

export const ListRunsQuerySchema = z.object({
  test_set_id: z.string().uuid().optional(),
  test_type: z.enum(TEST_TYPES).optional(),
  status: z.enum(['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export const ExportFormatQuerySchema = z.object({
  format: z.enum(['json', 'markdown']).default('json'),
});

export const IdParamSchema = z.object({ id: z.string().uuid() });

export type ParsedCreateTestSet = z.infer<typeof CreateTestSetSchema>;
export type ParsedRunRequest = z.infer<typeof RunRequestSchema>;
