/**
 * Zod schemas for the Security / RBAC HTTP layer.
 */
import { z } from 'zod';
import { ASSET_TYPES, CLASSIFICATIONS, EXPORT_FORMATS, ROLE_CODES } from './types.js';

const Json = z.record(z.unknown());
const Strings = z.array(z.string().min(1).max(64)).max(50).optional();

export const LoginSchema = z
  .object({
    username: z.string().min(1).max(120).optional(),
    email: z.string().email().max(200).optional(),
    password: z.string().min(1).max(200).optional(),
    sso_token: z.string().min(1).max(8000).optional(),
    provider: z.string().min(1).max(64).optional(),
    metadata: Json.optional(),
  })
  .superRefine((v, ctx) => {
    const hasIdentity = v.username || v.email || v.sso_token;
    if (!hasIdentity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either { username|email + password } or sso_token',
      });
    }
    if (v.password && v.sso_token) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Pass either password or sso_token, not both',
      });
    }
  });

export const LogoutSchema = z.object({});

export const ExportRequestSchema = z.object({
  resource_type: z.string().min(1).max(64),
  resource_id: z.string().uuid().optional(),
  resource_label: z.string().max(255).optional(),
  format: z.enum(EXPORT_FORMATS),
  classification: z.enum(CLASSIFICATIONS).optional(),
  reason: z.string().max(1000).optional(),
  watermark_required: z.boolean().optional(),
  watermark_text: z.string().max(255).optional(),
  metadata: Json.optional(),
});

export const ExportApprovalSchema = z.object({
  approve: z.boolean(),
  rejected_reason: z.string().max(1000).optional(),
  output_expires_in_minutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 30)
    .optional(),
});

export const ListExportsQuerySchema = z.object({
  user_id: z.string().uuid().optional(),
  approval_status: z
    .enum(['pending', 'approved', 'rejected', 'expired', 'cancelled', 'auto_approved'])
    .optional(),
  resource_type: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export const AssignRolesSchema = z.object({
  user_id: z.string().uuid(),
  role_codes: z.array(z.enum(ROLE_CODES)).min(0).max(10),
  reason: z.string().max(500).optional(),
});

export const DataScopeGrantSchema = z.object({
  user_id: z.string().uuid(),
  scope_type: z.string().min(1).max(64),
  scope_value: z.string().min(1).max(255),
  expires_at: z.string().optional(),
  metadata: Json.optional(),
});

export const ListAuditQuerySchema = z.object({
  user_id: z.string().uuid().optional(),
  action: z.string().max(64).optional(),
  resource_type: z.string().max(64).optional(),
  resource_id: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

export const CreateModelAssetSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  asset_type: z.enum(ASSET_TYPES),
  ml_model_version_id: z.string().uuid().nullable().optional(),
  ml_dataset_id: z.string().uuid().nullable().optional(),
  storage_url: z.string().min(1).max(500),
  storage_provider: z.enum(['local', 's3', 'gcs', 'azure', 'memory', 'external']).optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  checksum_sha256: z.string().max(128).optional(),
  framework: z.string().max(64).optional(),
  format: z.string().max(32).optional(),
  classification: z.enum(CLASSIFICATIONS).optional(),
  owner_id: z.string().uuid().nullable().optional(),
  owning_team: z.string().max(64).optional(),
  allowed_role_codes: z.array(z.enum(ROLE_CODES)).max(20).optional(),
  watermark_required: z.boolean().optional(),
  tags: Strings,
  metadata: Json.optional(),
});

export const UpdateModelAssetSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['staged', 'active', 'retired', 'revoked']).optional(),
  classification: z.enum(CLASSIFICATIONS).optional(),
  allowed_role_codes: z.array(z.string().min(1).max(64)).max(20).optional(),
  watermark_required: z.boolean().optional(),
  tags: Strings,
  metadata: Json.optional(),
});

export const IdParamSchema = z.object({ id: z.string().uuid() });

export type ParsedLoginRequest = z.infer<typeof LoginSchema>;
export type ParsedExportRequest = z.infer<typeof ExportRequestSchema>;
export type ParsedExportApproval = z.infer<typeof ExportApprovalSchema>;
