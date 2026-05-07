/**
 * ERP Integration — shared types.
 *
 * Three upstream systems are wired here:
 *   • SAP    — BOM / cost / inventory pull (full + incremental)
 *   • LIMS   — push (create test task) + pull (result), with state machine
 *   • Carbon — material/formula CO₂e lookup (reserved for sustainability)
 *
 * Every business call writes one row to `erp_jobs` and 0..N rows to
 * `erp_job_logs`. LIMS create / pull additionally writes / updates a
 * `lims_task_links` row mapping the internal experiment ↔ external task.
 */

// ─── Enumerations ───────────────────────────────────────────────────────────
export const ERP_SOURCE_SYSTEMS = ['sap', 'lims', 'carbon'] as const;
export type ErpSourceSystem = (typeof ERP_SOURCE_SYSTEMS)[number];

export const ERP_OPERATIONS = [
  'sap_bom_sync',
  'sap_cost_sync',
  'sap_inventory_sync',
  'lims_create_task',
  'lims_pull_result',
  'lims_list_tasks',
  'carbon_material_lookup',
  'carbon_formula_estimate',
] as const;
export type ErpOperation = (typeof ERP_OPERATIONS)[number];

export const ERP_JOB_MODES = ['full', 'incremental', 'manual'] as const;
export type ErpJobMode = (typeof ERP_JOB_MODES)[number];

export const ERP_JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
  'timeout',
] as const;
export type ErpJobStatus = (typeof ERP_JOB_STATUSES)[number];

export const ERP_TRIGGER_TYPES = ['manual', 'scheduled', 'event', 'retry', 'api'] as const;
export type ErpTriggerType = (typeof ERP_TRIGGER_TYPES)[number];

export const ADAPTER_MODES = ['mock', 'real'] as const;
export type AdapterMode = (typeof ADAPTER_MODES)[number];

export const LIMS_TASK_STATUSES = [
  'created',
  'submitted',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
] as const;
export type LimsTaskStatus = (typeof LIMS_TASK_STATUSES)[number];

// ─── SAP DTOs ───────────────────────────────────────────────────────────────

export interface SapBomLine {
  external_id: string; // SAP-internal BOM line id
  parent_material_code: string; // formula / product code
  child_material_code: string; // raw material code
  ratio: number; // mass fraction in (0, 1]
  uom: string; // 'kg', 'ton', etc.
  effective_from?: string;
  effective_to?: string | null;
  external_updated_at?: string;
  metadata?: Record<string, unknown>;
}

export interface SapCostRecord {
  external_id: string;
  material_code: string;
  unit_cost: number;
  currency: string; // 'CNY', 'USD', 'EUR'
  uom: string;
  effective_date: string;
  external_updated_at?: string;
  metadata?: Record<string, unknown>;
}

export interface SapInventoryRecord {
  external_id: string;
  material_code: string;
  plant: string;
  available_qty: number;
  reserved_qty: number;
  uom: string;
  external_updated_at?: string;
  metadata?: Record<string, unknown>;
}

// ─── LIMS DTOs ──────────────────────────────────────────────────────────────

export interface LimsCreateTaskInput {
  /** Local experiment id we are tracing this back to. */
  internal_experiment_id?: string | null;
  related_formula_id?: string | null;
  related_formula_version_id?: string | null;
  test_method: string; // 'KV_100C', 'NOACK', 'POUR', …
  sample_count?: number;
  due_date?: string | null;
  notes?: string;
  /** Free-form passthrough to the LIMS adapter (lab code, priority, etc). */
  metadata?: Record<string, unknown>;
}

export interface LimsCreateTaskOutput {
  external_lims_task_id: string;
  external_url?: string;
  external_status_raw?: string;
  /** Adapter's confidence the task was accepted (0..1). */
  accepted: boolean;
}

export interface LimsResultMetric {
  name: string; // 'KV_100C'
  value: number;
  unit?: string;
  uncertainty?: number;
  passed?: boolean; // True if within spec — adapter-dependent.
}

export interface LimsPullResultOutput {
  external_lims_task_id: string;
  status: LimsTaskStatus;
  external_status_raw?: string;
  metrics?: LimsResultMetric[];
  /** Verbatim payload returned by the LIMS API for replay / audit. */
  raw_payload?: Record<string, unknown>;
}

// ─── Carbon footprint DTOs (reserved interface; mock returns deterministic) ──

export interface CarbonMaterialRecord {
  material_code: string;
  kgCO2e_per_kg: number;
  source: string; // 'mock', 'ecoinvent', 'gabi', etc.
  /** ISO date of the underlying dataset. */
  reference_year?: number;
  uncertainty?: number;
  metadata?: Record<string, unknown>;
}

export interface CarbonFormulaInput {
  bom: Array<{ material_code: string; ratio: number }>;
  product_category?: string;
}

export interface CarbonFormulaResult {
  kgCO2e_per_kg: number;
  breakdown: Array<{ material_code: string; ratio: number; contribution: number }>;
  source: string;
  /** Materials we couldn't price — caller should treat the result as partial. */
  missing_materials: string[];
}

// ─── Common adapter identity ────────────────────────────────────────────────

export interface AdapterIdentity {
  name: string; // e.g. 'mock-sap', 'sap-rfc-prod'
  version: string;
  mode: AdapterMode;
}

// ─── Persistence row shapes ────────────────────────────────────────────────

export interface ErpJobRow {
  id: string;
  code: string;
  source_system: ErpSourceSystem;
  operation: ErpOperation;
  mode: ErpJobMode;
  trigger_type: ErpTriggerType;
  adapter_name: string;
  adapter_version: string;
  adapter_mode: AdapterMode;
  status: ErpJobStatus;
  attempt_number: number;
  max_attempts: number;
  parent_job_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number;
  cursor_from: Record<string, unknown> | null;
  cursor_to: Record<string, unknown> | null;
  records_extracted: number;
  records_loaded: number;
  records_failed: number;
  records_skipped: number;
  reference_id: string | null;
  request_payload: Record<string, unknown>;
  response_payload: Record<string, unknown> | null;
  error_class: string | null;
  error_message: string | null;
  trace_id: string;
  triggered_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface ErpJobLogRow {
  id: string;
  job_id: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  phase: 'init' | 'request' | 'response' | 'transform' | 'retry' | 'finalize' | null;
  message: string;
  context: Record<string, unknown>;
  trace_id: string | null;
  occurred_at: string;
}

export interface LimsTaskLinkRow {
  id: string;
  external_lims_task_id: string;
  internal_experiment_id: string | null;
  related_formula_id: string | null;
  related_formula_version_id: string | null;
  test_method: string | null;
  sample_count: number;
  status: LimsTaskStatus;
  created_via: 'api' | 'manual' | 'batch' | 'event';
  external_url: string | null;
  external_status_raw: string | null;
  request_payload: Record<string, unknown>;
  result_payload: Record<string, unknown> | null;
  result_pulled_at: string | null;
  last_create_job_id: string | null;
  last_pull_job_id: string | null;
  last_sync_at: string | null;
  metadata: Record<string, unknown>;
  trace_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  version: number;
}

// ─── Service-layer DTOs (request / response shapes for HTTP) ────────────────

export interface SapSyncRequest {
  mode?: ErpJobMode; // 'full' | 'incremental' (default 'incremental')
  cursor?: Record<string, unknown>;
  limit?: number; // adapter hint (default 100)
  max_attempts?: number; // retry budget; default 3
  metadata?: Record<string, unknown>;
}

export interface SapSyncResponse<T> {
  job_id: string;
  status: ErpJobStatus;
  records_extracted: number;
  records_loaded: number;
  records_failed: number;
  cursor_from: Record<string, unknown> | null;
  cursor_to: Record<string, unknown> | null;
  records: T[];
  trace_id: string;
  duration_ms: number;
}

export interface CreateLimsTaskResponse {
  job_id: string;
  link: LimsTaskLinkRow;
  trace_id: string;
  duration_ms: number;
}

export interface PullLimsResultResponse {
  job_id: string;
  link: LimsTaskLinkRow;
  status: LimsTaskStatus;
  metrics: LimsResultMetric[];
  trace_id: string;
  duration_ms: number;
}

export interface CarbonLookupResponse {
  job_id: string;
  record: CarbonMaterialRecord;
  trace_id: string;
}

export interface CarbonFormulaResponse {
  job_id: string;
  result: CarbonFormulaResult;
  trace_id: string;
}

export interface JobDetailResponse {
  job: ErpJobRow;
  logs: ErpJobLogRow[];
}
