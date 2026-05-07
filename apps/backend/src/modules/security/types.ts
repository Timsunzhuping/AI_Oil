/**
 * Security / RBAC / audit module — shared types.
 *
 * Five canonical roles and a catalogued permission registry. Permissions
 * follow the `<resource>:<action>` shape (e.g. `formula:write`,
 * `export:approve`). The migration 0022 seeds matching rows into
 * `roles` / `permissions` / `role_permissions`.
 */

// ─── Role catalogue ─────────────────────────────────────────────────────────

export const ROLE_CODES = [
  'super_admin',
  'model_admin',
  'researcher',
  'lims_user',
  'viewer',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

// ─── Permission catalogue ───────────────────────────────────────────────────

/** Stable permission codes that the migration seeds. */
export const PERMISSION_CODES = [
  // Identity / RBAC
  'user:read',
  'user:manage',
  'role:manage',
  // Master data
  'master_data:read',
  'master_data:write',
  // Formula / R&D
  'formula:read',
  'formula:write',
  'formula:approve',
  // Predict / recommend
  'predict:execute',
  'recommend:execute',
  // Task center
  'task:read',
  'task:write',
  // Knowledge / docs
  'knowledge:read',
  'knowledge:write',
  'document:upload',
  'document:review',
  // QA assistant
  'qa:ask',
  // ERP
  'erp:sap_sync',
  'erp:lims_create',
  'erp:lims_pull',
  'erp:carbon_lookup',
  // ML
  'ml:dataset_manage',
  'ml:train',
  'ml:release',
  'ml:model_read',
  // Export / audit
  'export:request',
  'export:approve',
  'export:download',
  'audit:read',
  // Asset registry
  'asset:read',
  'asset:manage',
] as const;
export type PermissionCode = (typeof PERMISSION_CODES)[number];

// ─── Audit actions ──────────────────────────────────────────────────────────

/**
 * Stable action labels persisted in audit_logs.action. The list mirrors the
 * scope listed in the security module spec — kept narrow so dashboards can
 * filter cleanly.
 */
export const AUDIT_ACTIONS = [
  'login',
  'logout',
  'login_failed',
  'demand_input',
  'formula_generation',
  'formula_modification',
  'export_request',
  'export_approve',
  'export_reject',
  'export_download',
  'model_release',
  'model_rollback',
  'retrain',
  'lims_task_create',
  'permission_change',
  'data_scope_change',
  'asset_register',
  'asset_update',
  'asset_revoke',
  'sso_link',
  'generic',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// ─── Auth context (set on req.user) ─────────────────────────────────────────

export interface AuthContext {
  user_id: string;
  username: string;
  email: string;
  roles: RoleCode[];
  permissions: PermissionCode[];
  /** Data scopes the user has explicit grants for. */
  data_scopes: DataScopeGrant[];
  /** Token / session id if known. */
  session_id?: string;
  /** When user is being impersonated by support / admin. */
  impersonator_id?: string | null;
  /** Free-form claims propagated from SSO. */
  claims: Record<string, unknown>;
}

export interface DataScopeGrant {
  scope_type: string;
  scope_value: string;
  expires_at?: string | null;
}

// ─── User / role rows ──────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  email: string;
  username: string;
  full_name: string | null;
  is_active: boolean;
  last_login_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RoleRow {
  id: string;
  code: RoleCode | string;
  name: string;
  description: string | null;
  is_system: boolean;
  metadata: Record<string, unknown>;
}

export interface PermissionRow {
  id: string;
  code: PermissionCode | string;
  resource: string;
  action: string;
  description: string | null;
}

// ─── Export workflow ────────────────────────────────────────────────────────

export const EXPORT_FORMATS = ['pdf', 'xlsx', 'csv', 'json', 'image', 'zip'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'cancelled',
  'auto_approved',
] as const;
export type ExportApprovalStatus = (typeof EXPORT_APPROVAL_STATUSES)[number];

export const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export interface ExportRequestInput {
  resource_type: string;
  resource_id?: string;
  resource_label?: string;
  format: ExportFormat;
  classification?: Classification;
  reason?: string;
  /** Override the global watermark_required default per request. */
  watermark_required?: boolean;
  watermark_text?: string;
  metadata?: Record<string, unknown>;
}

export interface ExportLogRow {
  id: string;
  code: string;
  user_id: string;
  resource_type: string;
  resource_id: string | null;
  resource_label: string | null;
  format: ExportFormat;
  approval_required: boolean;
  approval_status: ExportApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  output_url: string | null;
  output_size_bytes: number | null;
  output_checksum: string | null;
  output_expires_at: string | null;
  download_count: number;
  last_downloaded_at: string | null;
  watermark_required: boolean;
  watermark_text: string | null;
  watermark_applied: boolean;
  watermark_metadata: Record<string, unknown>;
  classification: Classification;
  trace_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface ExportApprovalInput {
  approve: boolean;
  rejected_reason?: string;
  output_expires_in_minutes?: number;
}

// ─── Model asset registry ──────────────────────────────────────────────────

export const ASSET_TYPES = [
  'model_artifact',
  'training_dataset',
  'feature_store',
  'prompt_template',
  'tokenizer',
  'embeddings',
  'other',
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_STATUSES = ['staged', 'active', 'retired', 'revoked'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export interface ModelAssetInput {
  name: string;
  description?: string;
  asset_type: AssetType;
  ml_model_version_id?: string | null;
  ml_dataset_id?: string | null;
  storage_url: string;
  storage_provider?: 'local' | 's3' | 'gcs' | 'azure' | 'memory' | 'external';
  size_bytes?: number;
  checksum_sha256?: string;
  framework?: string;
  format?: string;
  classification?: Classification;
  owner_id?: string | null;
  owning_team?: string;
  allowed_role_codes?: RoleCode[] | string[];
  watermark_required?: boolean;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ModelAssetRow {
  id: string;
  code: string;
  asset_type: AssetType;
  name: string;
  description: string | null;
  ml_model_version_id: string | null;
  ml_dataset_id: string | null;
  storage_url: string;
  storage_provider: string;
  size_bytes: number | null;
  checksum_sha256: string | null;
  framework: string | null;
  format: string | null;
  status: AssetStatus;
  classification: Classification;
  owner_id: string | null;
  owning_team: string | null;
  allowed_role_codes: string[];
  watermark_required: boolean;
  metadata: Record<string, unknown>;
  tags: string[];
  created_at: string;
  updated_at: string;
  created_by: string | null;
  version: number;
}

// ─── Service-layer DTOs ────────────────────────────────────────────────────

export interface LoginRequest {
  username?: string;
  email?: string;
  password?: string;
  /** SSO mode passes a token; password mode passes a password. */
  sso_token?: string;
  /** Adapter hint — defaults to whichever adapter is registered for this provider. */
  provider?: string;
  ip_address?: string;
  user_agent?: string;
  metadata?: Record<string, unknown>;
}

export interface LoginResponse {
  user: UserRow;
  roles: RoleCode[];
  permissions: PermissionCode[];
  session: {
    id: string;
    token: string;
    expires_at: string;
  };
}

export interface CurrentUserResponse {
  user: UserRow;
  roles: RoleCode[];
  permissions: PermissionCode[];
  data_scopes: DataScopeGrant[];
  /**
   * Resolved menu visibility — the frontend uses this to render the sidebar.
   * Each entry is `{ key, label, route, required_permissions }`.
   */
  menu: MenuEntry[];
}

export interface MenuEntry {
  key: string;
  label: string;
  route: string;
  /** All listed permissions must be present for the entry to render. */
  required_permissions: PermissionCode[];
  /** When set, requires AT LEAST one of these roles instead of perms. */
  required_roles?: RoleCode[];
  /** When false the entry is HIDDEN; otherwise it can render but actions
   * inside may still be locked by per-action checks. */
  visible: boolean;
}

export interface AuditQuery {
  user_id?: string;
  action?: string;
  resource_type?: string;
  resource_id?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditLogRow {
  id: string;
  occurred_at: string;
  trace_id: string | null;
  user_id: string | null;
  impersonator_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_code: string | null;
  resource_label: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  changes: Record<string, unknown> | null;
  request_method: string | null;
  request_path: string | null;
  status_code: number | null;
  duration_ms: number | null;
  error_code: number | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
}

// ─── Express augmentation ──────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by `authenticate()` middleware — undefined for unauthenticated routes. */
      user?: AuthContext;
    }
  }
}
