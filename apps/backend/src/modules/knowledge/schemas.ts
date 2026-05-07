/**
 * Zod schemas for the Knowledge & Document module.
 *
 * Validation is deliberately loose on textual fields (max-length only) so we
 * can ingest documents-of-record without rejecting them on stylistic grounds.
 * Hard structural constraints (mime type, file size cap, status enum) are
 * enforced.
 */
import { z } from 'zod';
import {
  ACCEPTED_MIME_TYPES,
  DOCUMENT_CATEGORIES,
  DOCUMENT_TYPES,
  KB_STATUSES,
  PARSE_TASK_TYPES,
} from './types.js';

// ── Common building blocks ─────────────────────────────────────────────────

const MaybeUuid = z.string().uuid().nullable().optional();
const Strings = z.array(z.string().min(1).max(64)).max(50).optional();
const Json = z.record(z.unknown());

// ── Raw material KB ────────────────────────────────────────────────────────

export const CreateRawMaterialKbSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.string().max(64).optional(),
  raw_material_id: MaybeUuid,
  summary: z.string().max(4000).optional(),
  technical_notes: z.string().max(8000).optional(),
  usage_guidance: z.string().max(8000).optional(),
  regulatory_notes: z.string().max(8000).optional(),
  storage_handling: z.string().max(4000).optional(),
  properties: Json.optional(),
  search_keywords: Strings,
  tags: Strings,
  status: z.enum(KB_STATUSES).optional(),
  metadata: Json.optional(),
  source_document_id: MaybeUuid,
  source_result_id: MaybeUuid,
});
export const UpdateRawMaterialKbSchema = CreateRawMaterialKbSchema.partial();

// ── Formula KB ─────────────────────────────────────────────────────────────

export const CreateFormulaKbSchema = z.object({
  title: z.string().min(1).max(255),
  product_category: z.string().max(64).optional(),
  application_scene: z.string().max(255).optional(),
  related_formula_id: MaybeUuid,
  related_formula_version_id: MaybeUuid,
  summary: z.string().max(4000).optional(),
  composition_overview: z.string().max(8000).optional(),
  performance_highlights: z.string().max(8000).optional(),
  process_notes: z.string().max(8000).optional(),
  sample_bom: z.array(Json).max(100).optional(),
  target_metrics: z.array(Json).max(50).optional(),
  search_keywords: Strings,
  tags: Strings,
  status: z.enum(KB_STATUSES).optional(),
  metadata: Json.optional(),
  source_document_id: MaybeUuid,
  source_result_id: MaybeUuid,
});
export const UpdateFormulaKbSchema = CreateFormulaKbSchema.partial();

export const KbListQuerySchema = z.object({
  status: z.enum(KB_STATUSES).optional(),
  q: z.string().max(255).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export const IdParamSchema = z.object({
  id: z.string().uuid(),
});

// ── Document upload (form-data; the file itself comes from multer) ─────────

export const UploadDocMetadataSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  doc_type: z.enum(DOCUMENT_TYPES).optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  language: z.string().max(16).optional(),
  visibility: z.enum(['private', 'team', 'public']).optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  related_raw_material_id: MaybeUuid,
  related_formula_id: MaybeUuid,
  related_supplier_id: MaybeUuid,
  metadata: z.union([z.string(), Json]).optional(),
  /** When 'true', the service immediately enqueues a parse task. */
  parse: z.union([z.string(), z.boolean()]).optional(),
});

export const ParseEnqueueSchema = z.object({
  task_type: z.enum(PARSE_TASK_TYPES).optional(),
  parser_name: z.string().max(64).optional(),
  options: Json.optional(),
  max_attempts: z.number().int().min(1).max(5).optional(),
});

export const DocumentListQuerySchema = z.object({
  status: z.string().max(32).optional(),
  doc_type: z.enum(DOCUMENT_TYPES).optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  q: z.string().max(255).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

// ── Confirmation ──────────────────────────────────────────────────────────

export const ConfirmSchema = z
  .object({
    result_id: z.string().uuid().optional(),
    action: z.enum(['approve', 'reject', 'edit']),
    reviewer_id: z.string().uuid().nullable().optional(),
    review_comment: z.string().max(2000).optional(),
    manual_edits: Json.optional(),
    promote_to_kb: z.enum(['raw_material', 'formula']).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'edit' && !v.manual_edits) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'manual_edits required when action="edit"',
      });
    }
  });

// ── Helpers exposed to the controller for parsing form-data fields ─────────

export function normaliseTags(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.filter((s) => s && s.trim().length > 0);
  // multipart often sends repeated fields as a string with commas
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normaliseMetadata(
  value: string | Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export const ACCEPTED_MIME_TYPES_SET = new Set<string>(ACCEPTED_MIME_TYPES);
