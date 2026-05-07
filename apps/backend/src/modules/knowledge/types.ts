/**
 * Knowledge & Document module — shared types.
 *
 * Three concerns live in this module:
 *   1. raw_material_kb / formula_kb  — encyclopedic knowledge entries
 *   2. document_records              — uploaded files (PDF/DOCX/XLSX/JPG/PNG)
 *   3. document_parse_tasks          — async OCR / extraction queue
 *      document_parse_results        — versioned extraction outputs
 *
 * The split mirrors the database. Service / routes operate on these types.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Common enums
// ─────────────────────────────────────────────────────────────────────────────

export const DOCUMENT_STATUSES = [
  'uploaded',
  'parsing',
  'parsed',
  'review',
  'confirmed',
  'rejected',
  'archived',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_TYPES = [
  'datasheet',
  'test_report',
  'formula_card',
  'sop',
  'image',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_CATEGORIES = [
  'raw_material',
  'formula',
  'test',
  'process',
  'regulatory',
  'other',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const PARSE_TASK_STATUSES = [
  'queued',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type ParseTaskStatus = (typeof PARSE_TASK_STATUSES)[number];

export const PARSE_TASK_TYPES = ['ocr', 'extract_structured', 'full_parse', 'classify'] as const;
export type ParseTaskType = (typeof PARSE_TASK_TYPES)[number];

export const RESULT_ORIGINS = ['ocr', 'extractor', 'manual', 'merged'] as const;
export type ResultOrigin = (typeof RESULT_ORIGINS)[number];

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected', 'edited'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const KB_STATUSES = ['draft', 'published', 'archived'] as const;
export type KbStatus = (typeof KB_STATUSES)[number];

export const STORAGE_PROVIDERS = ['local', 's3', 'memory', 'external'] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

/** Mime types we accept on /docs/upload. Anything else is rejected by Multer + service. */
export const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'image/jpeg',
  'image/png',
] as const;
export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];

export function extensionFor(mime: string): string {
  switch (mime) {
    case 'application/pdf':
      return 'pdf';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'xlsx';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    default:
      return 'bin';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// raw_material_kb
// ─────────────────────────────────────────────────────────────────────────────

export interface RawMaterialKbInput {
  name: string;
  category?: string;
  raw_material_id?: string | null;
  summary?: string;
  technical_notes?: string;
  usage_guidance?: string;
  regulatory_notes?: string;
  storage_handling?: string;
  properties?: Record<string, unknown>;
  search_keywords?: string[];
  tags?: string[];
  status?: KbStatus;
  metadata?: Record<string, unknown>;
  source_document_id?: string | null;
  source_result_id?: string | null;
}

export interface RawMaterialKbRow extends RawMaterialKbInput {
  id: string;
  code: string;
  status: KbStatus;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  version: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// formula_kb
// ─────────────────────────────────────────────────────────────────────────────

export interface FormulaKbInput {
  title: string;
  product_category?: string;
  application_scene?: string;
  related_formula_id?: string | null;
  related_formula_version_id?: string | null;
  summary?: string;
  composition_overview?: string;
  performance_highlights?: string;
  process_notes?: string;
  sample_bom?: Array<Record<string, unknown>>;
  target_metrics?: Array<Record<string, unknown>>;
  search_keywords?: string[];
  tags?: string[];
  status?: KbStatus;
  metadata?: Record<string, unknown>;
  source_document_id?: string | null;
  source_result_id?: string | null;
}

export interface FormulaKbRow extends FormulaKbInput {
  id: string;
  code: string;
  status: KbStatus;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  version: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// document_records
// ─────────────────────────────────────────────────────────────────────────────

export interface DocumentUploadInput {
  title: string;
  description?: string;
  doc_type?: DocumentType;
  category?: DocumentCategory;
  language?: string;
  visibility?: 'private' | 'team' | 'public';
  tags?: string[];
  related_raw_material_id?: string | null;
  related_formula_id?: string | null;
  related_supplier_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UploadedFile {
  /** Original filename from the multipart upload. */
  originalName: string;
  buffer: Buffer;
  mimeType: string;
  size: number;
}

export interface DocumentRow extends DocumentUploadInput {
  id: string;
  code: string;
  doc_type: DocumentType;
  category: DocumentCategory;
  mime_type: string;
  file_extension: string;
  size_bytes: number;
  checksum_sha256: string | null;
  storage_provider: StorageProvider;
  storage_key: string;
  storage_url: string;
  page_count: number | null;
  language_detected: string | null;
  status: DocumentStatus;
  visibility: 'private' | 'team' | 'public';
  search_keywords: string[];
  tags: string[];
  trace_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  version: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// document_parse_tasks
// ─────────────────────────────────────────────────────────────────────────────

export interface ParseTaskInput {
  document_id: string;
  task_type?: ParseTaskType;
  options?: Record<string, unknown>;
  parser_name?: string;
  parser_version?: string;
  max_attempts?: number;
}

export interface ParseTaskRow {
  id: string;
  document_id: string;
  task_type: ParseTaskType;
  status: ParseTaskStatus;
  parser_name: string | null;
  parser_version: string | null;
  options: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number;
  error_class: string | null;
  error_message: string | null;
  trace_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// document_parse_results
// ─────────────────────────────────────────────────────────────────────────────

export interface ParseResultRow {
  id: string;
  document_id: string;
  task_id: string | null;
  result_version: number;
  is_current: boolean;
  origin: ResultOrigin;
  confidence: number | null;
  raw_text: string | null;
  structured_payload: Record<string, unknown>;
  extracted_fields: Record<string, unknown>;
  page_snippets: Array<{ page: number; text: string; confidence?: number }>;

  review_status: ReviewStatus;
  reviewer_id: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  manual_edits: Record<string, unknown>;

  linked_raw_material_kb_id: string | null;
  linked_formula_kb_id: string | null;

  search_keywords: string[];
  metadata: Record<string, unknown>;
  trace_id: string | null;

  created_at: string;
  updated_at: string;
  created_by: string | null;
  version: number;
}

export interface UploadResponse {
  document: DocumentRow;
  parse_task?: ParseTaskRow;
}

export interface ParseEnqueueResponse {
  document: DocumentRow;
  task: ParseTaskRow;
}

export interface DocumentDetailResponse {
  document: DocumentRow;
  current_result: ParseResultRow | null;
  active_task: ParseTaskRow | null;
}

export interface ConfirmRequest {
  /** Defaults to the current is_current=true result. */
  result_id?: string;
  /** 'approve' marks confirmed; 'reject' rejects; 'edit' creates a new
   *  manual revision with the supplied edits and approves it. */
  action: 'approve' | 'reject' | 'edit';
  reviewer_id?: string | null;
  review_comment?: string;
  manual_edits?: Record<string, unknown>;
  /**
   * When `promote_to_kb` is set on approve/edit, the service auto-creates a
   * raw_material_kb or formula_kb entry from the result and links it back
   * via linked_*_kb_id.
   */
  promote_to_kb?: 'raw_material' | 'formula' | null;
}
