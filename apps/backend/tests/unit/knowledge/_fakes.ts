/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * In-memory KnowledgeRepository fake — used by service / runner tests so
 * we don't need a Postgres instance to exercise the orchestration logic.
 *
 * Implements just the methods touched by KnowledgeService + ParseRunner;
 * the rest are stubbed to throw so missing coverage is obvious. The
 * underscore-prefixed parameters mirror real-repository signatures (the
 * service passes them) but the fake doesn't enforce auth, hence disabled.
 */
import { randomUUID } from 'node:crypto';
import type {
  DocumentCategory,
  DocumentRow,
  DocumentStatus,
  DocumentType,
  FormulaKbInput,
  FormulaKbRow,
  KbStatus,
  ParseResultRow,
  ParseTaskRow,
  ParseTaskStatus,
  ParseTaskType,
  RawMaterialKbInput,
  RawMaterialKbRow,
  ResultOrigin,
  ReviewStatus,
  StorageProvider,
} from '../../../src/modules/knowledge/types.js';

export class FakeKnowledgeRepository {
  documents = new Map<string, DocumentRow>();
  tasks = new Map<string, ParseTaskRow>();
  results = new Map<string, ParseResultRow>();
  rawMaterialKb = new Map<string, RawMaterialKbRow>();
  formulaKb = new Map<string, FormulaKbRow>();

  private rawCounter = 1;
  private formulaCounter = 1;
  private docCounter = 1;

  // ── code generators ────────────────────────────────────────────
  async nextRawMaterialKbCode(): Promise<string> {
    return `RMK-2026-${String(this.rawCounter++).padStart(4, '0')}`;
  }
  async nextFormulaKbCode(): Promise<string> {
    return `FKB-2026-${String(this.formulaCounter++).padStart(4, '0')}`;
  }
  async nextDocumentCode(): Promise<string> {
    return `DOC-2026-${String(this.docCounter++).padStart(4, '0')}`;
  }

  // ── raw_material_kb ───────────────────────────────────────────
  async createRawMaterialKb(
    input: RawMaterialKbInput,
    code: string,
    userId: string | null
  ): Promise<RawMaterialKbRow> {
    const row: RawMaterialKbRow = {
      id: randomUUID(),
      code,
      name: input.name,
      ...(input.category !== undefined ? { category: input.category } : {}),
      raw_material_id: input.raw_material_id ?? null,
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.technical_notes !== undefined ? { technical_notes: input.technical_notes } : {}),
      ...(input.usage_guidance !== undefined ? { usage_guidance: input.usage_guidance } : {}),
      ...(input.regulatory_notes !== undefined ? { regulatory_notes: input.regulatory_notes } : {}),
      ...(input.storage_handling !== undefined ? { storage_handling: input.storage_handling } : {}),
      properties: input.properties ?? {},
      search_keywords: input.search_keywords ?? [],
      tags: input.tags ?? [],
      status: input.status ?? 'draft',
      metadata: input.metadata ?? {},
      source_document_id: input.source_document_id ?? null,
      source_result_id: input.source_result_id ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: userId,
      version: 1,
    };
    this.rawMaterialKb.set(row.id, row);
    return row;
  }
  async updateRawMaterialKb(
    id: string,
    patch: Partial<RawMaterialKbInput>,
    _userId: string | null
  ) {
    const cur = this.rawMaterialKb.get(id);
    if (!cur) return null;
    const next = {
      ...cur,
      ...patch,
      updated_at: new Date().toISOString(),
      version: cur.version + 1,
    } as RawMaterialKbRow;
    this.rawMaterialKb.set(id, next);
    return next;
  }
  async findRawMaterialKb(id: string) {
    return this.rawMaterialKb.get(id) ?? null;
  }
  async listRawMaterialKb(filter: {
    status?: KbStatus;
    q?: string;
    page: number;
    pageSize: number;
  }) {
    const all = [...this.rawMaterialKb.values()].filter(
      (r) =>
        (!filter.status || r.status === filter.status) &&
        (!filter.q || r.name.includes(filter.q) || r.code.includes(filter.q))
    );
    const start = (filter.page - 1) * filter.pageSize;
    return { items: all.slice(start, start + filter.pageSize), total: all.length };
  }
  async softDeleteRawMaterialKb(id: string, _userId: string | null) {
    return this.rawMaterialKb.delete(id);
  }

  // ── formula_kb ────────────────────────────────────────────────
  async createFormulaKb(
    input: FormulaKbInput,
    code: string,
    userId: string | null
  ): Promise<FormulaKbRow> {
    const row: FormulaKbRow = {
      id: randomUUID(),
      code,
      title: input.title,
      ...(input.product_category !== undefined ? { product_category: input.product_category } : {}),
      ...(input.application_scene !== undefined
        ? { application_scene: input.application_scene }
        : {}),
      related_formula_id: input.related_formula_id ?? null,
      related_formula_version_id: input.related_formula_version_id ?? null,
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.composition_overview !== undefined
        ? { composition_overview: input.composition_overview }
        : {}),
      ...(input.performance_highlights !== undefined
        ? { performance_highlights: input.performance_highlights }
        : {}),
      ...(input.process_notes !== undefined ? { process_notes: input.process_notes } : {}),
      sample_bom: input.sample_bom ?? [],
      target_metrics: input.target_metrics ?? [],
      search_keywords: input.search_keywords ?? [],
      tags: input.tags ?? [],
      status: input.status ?? 'draft',
      metadata: input.metadata ?? {},
      source_document_id: input.source_document_id ?? null,
      source_result_id: input.source_result_id ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: userId,
      version: 1,
    };
    this.formulaKb.set(row.id, row);
    return row;
  }
  async updateFormulaKb(id: string, patch: Partial<FormulaKbInput>, _userId: string | null) {
    const cur = this.formulaKb.get(id);
    if (!cur) return null;
    const next = {
      ...cur,
      ...patch,
      updated_at: new Date().toISOString(),
      version: cur.version + 1,
    } as FormulaKbRow;
    this.formulaKb.set(id, next);
    return next;
  }
  async findFormulaKb(id: string) {
    return this.formulaKb.get(id) ?? null;
  }
  async listFormulaKb(filter: { status?: KbStatus; q?: string; page: number; pageSize: number }) {
    const all = [...this.formulaKb.values()].filter(
      (r) =>
        (!filter.status || r.status === filter.status) &&
        (!filter.q || r.title.includes(filter.q) || r.code.includes(filter.q))
    );
    const start = (filter.page - 1) * filter.pageSize;
    return { items: all.slice(start, start + filter.pageSize), total: all.length };
  }
  async softDeleteFormulaKb(id: string, _userId: string | null) {
    return this.formulaKb.delete(id);
  }

  // ── documents ─────────────────────────────────────────────────
  async createDocument(input: {
    code: string;
    title: string;
    description: string | null;
    doc_type: DocumentType;
    category: DocumentCategory;
    mime_type: string;
    file_extension: string;
    size_bytes: number;
    checksum_sha256: string | null;
    storage_provider: StorageProvider;
    storage_key: string;
    storage_url: string;
    language: string | null;
    visibility: 'private' | 'team' | 'public';
    tags: string[];
    related_raw_material_id: string | null;
    related_formula_id: string | null;
    related_supplier_id: string | null;
    metadata: Record<string, unknown>;
    trace_id: string | null;
    created_by: string | null;
  }): Promise<DocumentRow> {
    const row: DocumentRow = {
      id: randomUUID(),
      code: input.code,
      title: input.title,
      ...(input.description !== null ? { description: input.description } : {}),
      doc_type: input.doc_type,
      category: input.category,
      mime_type: input.mime_type,
      file_extension: input.file_extension,
      size_bytes: input.size_bytes,
      checksum_sha256: input.checksum_sha256,
      storage_provider: input.storage_provider,
      storage_key: input.storage_key,
      storage_url: input.storage_url,
      page_count: null,
      ...(input.language !== null ? { language: input.language } : {}),
      language_detected: null,
      status: 'uploaded',
      visibility: input.visibility,
      tags: input.tags,
      related_raw_material_id: input.related_raw_material_id,
      related_formula_id: input.related_formula_id,
      related_supplier_id: input.related_supplier_id,
      metadata: input.metadata,
      search_keywords: [],
      trace_id: input.trace_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: input.created_by,
      version: 1,
    };
    this.documents.set(row.id, row);
    return row;
  }
  async findDocument(id: string) {
    return this.documents.get(id) ?? null;
  }
  async listDocuments(filter: {
    status?: string;
    doc_type?: DocumentType;
    category?: DocumentCategory;
    q?: string;
    page: number;
    pageSize: number;
  }) {
    const all = [...this.documents.values()].filter(
      (d) =>
        (!filter.status || d.status === filter.status) &&
        (!filter.doc_type || d.doc_type === filter.doc_type) &&
        (!filter.category || d.category === filter.category) &&
        (!filter.q || d.title.includes(filter.q) || d.code.includes(filter.q))
    );
    const start = (filter.page - 1) * filter.pageSize;
    return { items: all.slice(start, start + filter.pageSize), total: all.length };
  }
  async updateDocumentStatus(id: string, status: DocumentStatus, _userId: string | null = null) {
    const d = this.documents.get(id);
    if (!d) return null;
    d.status = status;
    d.updated_at = new Date().toISOString();
    return d;
  }
  async patchDocumentMeta(
    id: string,
    patch: {
      language_detected?: string | null;
      page_count?: number | null;
      search_keywords?: string[];
    }
  ) {
    const d = this.documents.get(id);
    if (!d) return null;
    if (patch.language_detected !== undefined) d.language_detected = patch.language_detected;
    if (patch.page_count !== undefined) d.page_count = patch.page_count;
    if (patch.search_keywords !== undefined) d.search_keywords = patch.search_keywords;
    return d;
  }
  async softDeleteDocument(id: string, _userId: string | null) {
    return this.documents.delete(id);
  }

  // ── tasks ─────────────────────────────────────────────────────
  async createParseTask(input: {
    document_id: string;
    task_type: ParseTaskType;
    parser_name: string | null;
    parser_version: string | null;
    options: Record<string, unknown>;
    max_attempts: number;
    trace_id: string | null;
    created_by: string | null;
  }): Promise<ParseTaskRow> {
    const row: ParseTaskRow = {
      id: randomUUID(),
      document_id: input.document_id,
      task_type: input.task_type,
      status: 'queued',
      parser_name: input.parser_name,
      parser_version: input.parser_version,
      options: input.options,
      attempt_count: 0,
      max_attempts: input.max_attempts,
      started_at: null,
      completed_at: null,
      duration_ms: 0,
      error_class: null,
      error_message: null,
      trace_id: input.trace_id,
      created_by: input.created_by,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.tasks.set(row.id, row);
    return row;
  }
  async findParseTask(id: string) {
    return this.tasks.get(id) ?? null;
  }
  async listTasksForDocument(documentId: string) {
    return [...this.tasks.values()]
      .filter((t) => t.document_id === documentId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async claimNextQueuedTask(): Promise<ParseTaskRow | null> {
    const next = [...this.tasks.values()].find((t) => t.status === 'queued');
    if (!next) return null;
    next.status = 'processing';
    next.attempt_count += 1;
    next.started_at = new Date().toISOString();
    next.updated_at = new Date().toISOString();
    return next;
  }
  async markTaskProcessing(id: string) {
    const t = this.tasks.get(id);
    if (!t) return null;
    if (t.status === 'queued') {
      t.status = 'processing';
      t.attempt_count += 1;
      t.started_at = new Date().toISOString();
      t.updated_at = new Date().toISOString();
    }
    return t;
  }
  async finishTask(
    id: string,
    status: ParseTaskStatus,
    opts: { error_class?: string | null; error_message?: string | null; duration_ms: number }
  ) {
    const t = this.tasks.get(id);
    if (!t) return null;
    t.status = status;
    t.completed_at = new Date().toISOString();
    t.duration_ms = opts.duration_ms;
    t.error_class = opts.error_class ?? null;
    t.error_message = opts.error_message ?? null;
    t.updated_at = new Date().toISOString();
    return t;
  }

  // ── results ───────────────────────────────────────────────────
  async appendParseResult(input: {
    document_id: string;
    task_id: string | null;
    origin: ResultOrigin;
    confidence: number | null;
    raw_text: string | null;
    structured_payload: Record<string, unknown>;
    extracted_fields: Record<string, unknown>;
    page_snippets: Array<{ page: number; text: string; confidence?: number }>;
    search_keywords: string[];
    metadata: Record<string, unknown>;
    trace_id: string | null;
    created_by: string | null;
  }): Promise<ParseResultRow> {
    // Demote previous current.
    for (const r of this.results.values()) {
      if (r.document_id === input.document_id && r.is_current) r.is_current = false;
    }
    const versions = [...this.results.values()].filter((r) => r.document_id === input.document_id);
    const next: ParseResultRow = {
      id: randomUUID(),
      document_id: input.document_id,
      task_id: input.task_id,
      result_version: versions.length + 1,
      is_current: true,
      origin: input.origin,
      confidence: input.confidence,
      raw_text: input.raw_text,
      structured_payload: input.structured_payload,
      extracted_fields: input.extracted_fields,
      page_snippets: input.page_snippets,
      review_status: 'pending',
      reviewer_id: null,
      reviewed_at: null,
      review_comment: null,
      manual_edits: {},
      linked_raw_material_kb_id: null,
      linked_formula_kb_id: null,
      search_keywords: input.search_keywords,
      metadata: input.metadata,
      trace_id: input.trace_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: input.created_by,
      version: 1,
    };
    this.results.set(next.id, next);
    return next;
  }

  async findParseResult(id: string) {
    return this.results.get(id) ?? null;
  }
  async findCurrentResult(documentId: string) {
    return (
      [...this.results.values()].find((r) => r.document_id === documentId && r.is_current) ?? null
    );
  }
  async listResultsForDocument(documentId: string) {
    return [...this.results.values()]
      .filter((r) => r.document_id === documentId)
      .sort((a, b) => b.result_version - a.result_version);
  }
  async patchResultReview(
    id: string,
    patch: {
      review_status: ReviewStatus;
      reviewer_id: string | null;
      review_comment: string | null;
      manual_edits?: Record<string, unknown>;
      linked_raw_material_kb_id?: string | null;
      linked_formula_kb_id?: string | null;
    }
  ) {
    const r = this.results.get(id);
    if (!r) return null;
    r.review_status = patch.review_status;
    r.reviewer_id = patch.reviewer_id;
    r.review_comment = patch.review_comment ?? null;
    r.reviewed_at = new Date().toISOString();
    if (patch.manual_edits) r.manual_edits = patch.manual_edits;
    if (patch.linked_raw_material_kb_id !== undefined)
      r.linked_raw_material_kb_id = patch.linked_raw_material_kb_id;
    if (patch.linked_formula_kb_id !== undefined)
      r.linked_formula_kb_id = patch.linked_formula_kb_id;
    return r;
  }
  async appendManualRevision(input: {
    document_id: string;
    base_result: ParseResultRow;
    manual_edits: Record<string, unknown>;
    reviewer_id: string | null;
    review_comment: string | null;
    trace_id: string | null;
  }): Promise<ParseResultRow> {
    return this.appendParseResult({
      document_id: input.document_id,
      task_id: input.base_result.task_id,
      origin: 'manual',
      confidence: input.base_result.confidence,
      raw_text: input.base_result.raw_text,
      structured_payload: { ...input.base_result.structured_payload, ...input.manual_edits },
      extracted_fields: input.base_result.extracted_fields,
      page_snippets: input.base_result.page_snippets,
      search_keywords: input.base_result.search_keywords,
      metadata: {
        ...input.base_result.metadata,
        derived_from: input.base_result.id,
        manual_edits: input.manual_edits,
      },
      trace_id: input.trace_id,
      created_by: input.reviewer_id,
    });
  }
}
