/**
 * R&D Task Center — shared types.
 *
 * The lifecycle for AI-workflow tasks is:
 *
 *     draft ──submit──▶ submitted ──pickup──▶ processing ──complete──▶ completed
 *                              │                    │              │
 *                              │                    └─fail──▶ failed
 *                              │                                    │
 *                              └─cancel──▶ cancelled                │
 *
 *     {completed | failed | cancelled} ──archive──▶ archived
 *     archived ──restore──▶ (prior terminal status)
 */

export type TaskKind = 'project_task' | 'ai_workflow';

export type AiWorkflowStatus =
  | 'draft'
  | 'submitted'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'archived';

/** All AI workflow task types this module orchestrates. */
export const AI_TASK_TYPES = [
  'forward_prediction',
  'batch_prediction',
  'cost_optimization',
  'material_replacement',
  'new_product_generation',
  'knowledge_qa',
] as const;
export type AiTaskType = (typeof AI_TASK_TYPES)[number];

export const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;

export type EventType =
  | 'created'
  | 'draft_saved'
  | 'input_attached'
  | 'submitted'
  | 'processing_started'
  | 'progress_update'
  | 'output_attached'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'archived'
  | 'restored'
  | 'comment'
  | 'manual_override'
  | 'retry';

export type InputMode = 'structured' | 'natural_language' | 'template';

export type InputType =
  | 'structured'
  | 'natural_language'
  | 'template_filled'
  | 'attachment'
  | 'reference';

export type OutputType =
  | 'prediction'
  | 'recommendation'
  | 'report'
  | 'attachment'
  | 'error'
  | 'partial'
  | 'citation';

// ----------------------------------------------------------------------------
// Task row shape (mirror of r_and_d_tasks for the AI workflow path).
// ----------------------------------------------------------------------------
export interface TaskRow {
  id: string;
  code: string;
  task_kind: TaskKind;
  task_type: AiTaskType | string;
  status: AiWorkflowStatus | string;

  title: string;
  description: string | null;
  summary: string | null;

  input_mode: InputMode | null;
  template_id: string | null;
  trace_id: string | null;
  handler_version: string | null;

  priority: 'low' | 'medium' | 'high' | 'critical';
  assigned_to: string | null;
  reporter_id: string | null;

  related_formula_id: string | null;
  related_formula_version_id: string | null;
  related_product_id: string | null;
  related_experiment_id: string | null;

  submitted_at: Date | null;
  processing_started_at: Date | null;
  completed_at: Date | null;
  archived_at: Date | null;
  error_class: string | null;
  error_message: string | null;

  tags: string[];
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: Date | null;
  version: number;
}

export interface InputRow {
  id: string;
  task_id: string;
  input_type: InputType;
  payload: Record<string, unknown>;
  raw_text: string | null;
  attachment_url: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  is_primary: boolean;
  metadata: Record<string, unknown>;
  created_at: Date;
  created_by: string | null;
}

export interface OutputRow {
  id: string;
  task_id: string;
  output_type: OutputType;
  payload: Record<string, unknown>;
  summary: string | null;
  attachment_url: string | null;
  attachment_mime: string | null;
  model_version_id: string | null;
  feature_set_version: string | null;
  confidence: number | null;
  is_primary: boolean;
  metadata: Record<string, unknown>;
  generated_at: Date;
  created_by: string | null;
}

export interface EventRow {
  id: string;
  task_id: string;
  event_type: EventType;
  from_status: string | null;
  to_status: string | null;
  actor_id: string | null;
  trace_id: string | null;
  message: string | null;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

export interface TemplateRow {
  id: string;
  code: string;
  name: string;
  task_type: AiTaskType;
  description: string | null;
  input_schema: Record<string, unknown>;
  default_payload: Record<string, unknown>;
  example_payload: Record<string, unknown> | null;
  is_active: boolean;
}

// ----------------------------------------------------------------------------
// Handler contract.
// ----------------------------------------------------------------------------
export interface HandlerContext {
  task: TaskRow;
  primaryInput: InputRow | null;
  traceId: string;
}

export interface HandlerResult {
  success: boolean;
  outputs: Array<{
    output_type: OutputType;
    payload: Record<string, unknown>;
    summary?: string;
    confidence?: number;
    feature_set_version?: string;
    model_version_id?: string;
    is_primary?: boolean;
  }>;
  summary?: string;
  error?: { class: string; message: string };
}

export interface TaskHandler {
  readonly task_type: AiTaskType;
  readonly version: string;
  validateInput(payload: Record<string, unknown>, raw_text?: string | null): { ok: true } | { ok: false; errors: string[] };
  execute(ctx: HandlerContext): Promise<HandlerResult>;
}

// ----------------------------------------------------------------------------
// API shapes.
// ----------------------------------------------------------------------------
export interface CreateTaskInput {
  code?: string;
  task_type: AiTaskType;
  title: string;
  description?: string | null;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  input_mode?: InputMode;
  template_id?: string | null;
  related_formula_id?: string | null;
  related_formula_version_id?: string | null;
  related_product_id?: string | null;
  related_experiment_id?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  /** Optional initial input — equivalent to POSTing to /:id/inputs after create. */
  input?: {
    input_type?: InputType;
    payload?: Record<string, unknown>;
    raw_text?: string | null;
    is_primary?: boolean;
  };
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  input_mode?: InputMode;
  template_id?: string | null;
  related_formula_id?: string | null;
  related_formula_version_id?: string | null;
  related_product_id?: string | null;
  related_experiment_id?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  expected_version: number;
}

export interface AttachInputBody {
  input_type: InputType;
  payload?: Record<string, unknown>;
  raw_text?: string | null;
  attachment_url?: string | null;
  attachment_mime?: string | null;
  is_primary?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AttachOutputBody {
  output_type: OutputType;
  payload?: Record<string, unknown>;
  summary?: string;
  attachment_url?: string;
  attachment_mime?: string;
  model_version_id?: string;
  feature_set_version?: string;
  confidence?: number;
  is_primary?: boolean;
  metadata?: Record<string, unknown>;
}
