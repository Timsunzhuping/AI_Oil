/**
 * Knowledge & Document service.
 *
 *   • Raw-material KB CRUD
 *   • Formula KB CRUD
 *   • Document upload (writes file via storage adapter, then DB row)
 *   • Asynchronous parse workflow (enqueue task, runner does the work)
 *   • Human-review confirmation (approve / reject / edit + optional KB promotion)
 */
import type { Logger } from 'pino';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import type { StorageAdapter } from './adapters/storage/index.js';
import { buildStorageKey } from './adapters/storage/index.js';
import type { ParserRegistry } from './adapters/ocr/index.js';
import type { KnowledgeRepository } from './repository.js';
import type { ParseRunner } from './workers/parse-runner.js';
import { ACCEPTED_MIME_TYPES_SET } from './schemas.js';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_TYPES,
  extensionFor,
  type ConfirmRequest,
  type DocumentDetailResponse,
  type DocumentRow,
  type DocumentUploadInput,
  type FormulaKbInput,
  type FormulaKbRow,
  type KbStatus,
  type ParseEnqueueResponse,
  type ParseResultRow,
  type ParseTaskInput,
  type ParseTaskRow,
  type RawMaterialKbInput,
  type RawMaterialKbRow,
  type ReviewStatus,
  type UploadResponse,
  type UploadedFile,
} from './types.js';

export interface KnowledgeServiceDeps {
  repository: KnowledgeRepository;
  storage: StorageAdapter;
  registry: ParserRegistry;
  runner?: ParseRunner;
  logger: Logger;
}

export class KnowledgeService {
  constructor(private readonly deps: KnowledgeServiceDeps) {}

  // ──────────────────────────────────────────────────────────────────
  // Raw material KB
  // ──────────────────────────────────────────────────────────────────
  async createRawMaterialKb(
    input: RawMaterialKbInput,
    userId: string | null
  ): Promise<RawMaterialKbRow> {
    const code = await this.deps.repository.nextRawMaterialKbCode();
    return this.deps.repository.createRawMaterialKb(input, code, userId);
  }

  async updateRawMaterialKb(
    id: string,
    patch: Partial<RawMaterialKbInput>,
    userId: string | null
  ): Promise<RawMaterialKbRow> {
    const r = await this.deps.repository.updateRawMaterialKb(id, patch, userId);
    if (!r) throw new NotFoundError('Raw material KB');
    return r;
  }

  async getRawMaterialKb(id: string): Promise<RawMaterialKbRow> {
    const r = await this.deps.repository.findRawMaterialKb(id);
    if (!r) throw new NotFoundError('Raw material KB');
    return r;
  }

  async listRawMaterialKb(filter: {
    status?: KbStatus;
    q?: string;
    page: number;
    pageSize: number;
  }) {
    return this.deps.repository.listRawMaterialKb(filter);
  }

  async removeRawMaterialKb(id: string, userId: string | null): Promise<void> {
    const ok = await this.deps.repository.softDeleteRawMaterialKb(id, userId);
    if (!ok) throw new NotFoundError('Raw material KB');
  }

  // ──────────────────────────────────────────────────────────────────
  // Formula KB
  // ──────────────────────────────────────────────────────────────────
  async createFormulaKb(input: FormulaKbInput, userId: string | null): Promise<FormulaKbRow> {
    const code = await this.deps.repository.nextFormulaKbCode();
    return this.deps.repository.createFormulaKb(input, code, userId);
  }

  async updateFormulaKb(
    id: string,
    patch: Partial<FormulaKbInput>,
    userId: string | null
  ): Promise<FormulaKbRow> {
    const r = await this.deps.repository.updateFormulaKb(id, patch, userId);
    if (!r) throw new NotFoundError('Formula KB');
    return r;
  }

  async getFormulaKb(id: string): Promise<FormulaKbRow> {
    const r = await this.deps.repository.findFormulaKb(id);
    if (!r) throw new NotFoundError('Formula KB');
    return r;
  }

  async listFormulaKb(filter: { status?: KbStatus; q?: string; page: number; pageSize: number }) {
    return this.deps.repository.listFormulaKb(filter);
  }

  async removeFormulaKb(id: string, userId: string | null): Promise<void> {
    const ok = await this.deps.repository.softDeleteFormulaKb(id, userId);
    if (!ok) throw new NotFoundError('Formula KB');
  }

  // ──────────────────────────────────────────────────────────────────
  // Document upload
  // ──────────────────────────────────────────────────────────────────
  async uploadDocument(
    file: UploadedFile,
    meta: DocumentUploadInput & { parse?: boolean },
    ctx: { trace_id: string | null; user_id: string | null }
  ): Promise<UploadResponse> {
    if (!ACCEPTED_MIME_TYPES_SET.has(file.mimeType)) {
      throw new BadRequestError(
        `Unsupported mime type '${file.mimeType}'. Accepted: ${[...ACCEPTED_MIME_TYPES_SET].join(', ')}`
      );
    }
    if (!file.buffer || file.buffer.byteLength === 0) {
      throw new BadRequestError('Uploaded file is empty');
    }

    const code = await this.deps.repository.nextDocumentCode();
    const ext = extensionFor(file.mimeType);
    const storageKey = buildStorageKey(code, file.originalName, ext);
    const stored = await this.deps.storage.put({
      key: storageKey,
      body: file.buffer,
      contentType: file.mimeType,
      originalName: file.originalName,
    });

    const document = await this.deps.repository.createDocument({
      code,
      title: meta.title,
      description: meta.description ?? null,
      doc_type: validatedDocType(meta.doc_type),
      category: validatedCategory(meta.category),
      mime_type: file.mimeType,
      file_extension: ext,
      size_bytes: stored.size,
      checksum_sha256: stored.checksumSha256,
      storage_provider: this.deps.storage.provider(),
      storage_key: stored.key,
      storage_url: stored.url,
      language: meta.language ?? null,
      visibility: meta.visibility ?? 'team',
      tags: meta.tags ?? [],
      related_raw_material_id: meta.related_raw_material_id ?? null,
      related_formula_id: meta.related_formula_id ?? null,
      related_supplier_id: meta.related_supplier_id ?? null,
      metadata: meta.metadata ?? {},
      trace_id: ctx.trace_id,
      created_by: ctx.user_id,
    });

    let parseTask: ParseTaskRow | undefined;
    if (meta.parse) {
      const enqueue = await this.enqueueParse(document.id, {}, ctx);
      parseTask = enqueue.task;
    }

    return parseTask ? { document, parse_task: parseTask } : { document };
  }

  // ──────────────────────────────────────────────────────────────────
  // Parse workflow
  // ──────────────────────────────────────────────────────────────────
  async enqueueParse(
    documentId: string,
    options: ParseTaskInput,
    ctx: { trace_id: string | null; user_id: string | null }
  ): Promise<ParseEnqueueResponse> {
    const document = await this.deps.repository.findDocument(documentId);
    if (!document) throw new NotFoundError('Document');
    if (document.status === 'archived') {
      throw new ConflictError('Cannot parse archived document');
    }

    // Snapshot the parser identity now so the audit row tells us which
    // adapter was scheduled even if the registry changes later.
    const adapter = this.deps.registry.resolve(document.mime_type);
    const placeholderTask: ParseTaskRow = {
      id: '',
      document_id: '',
      task_type: 'full_parse',
      status: 'queued',
      parser_name: null,
      parser_version: null,
      options: {},
      attempt_count: 0,
      max_attempts: 0,
      started_at: null,
      completed_at: null,
      duration_ms: 0,
      error_class: null,
      error_message: null,
      trace_id: null,
      created_by: null,
      created_at: '',
      updated_at: '',
    };
    let parserName = options.parser_name ?? null;
    let parserVersion: string | null = null;
    try {
      // Use a synthetic empty task to ask the adapter for its identity via
      // a 0-byte parse — but we don't actually call parse(); the registry
      // already points to a concrete adapter, so we read its constructor metadata
      // by invoking parse() lazily inside the runner. Here we just snapshot
      // the class name as parser_name when the caller didn't override it.
      parserName = parserName ?? adapter.constructor.name;
      parserVersion = (adapter as unknown as { parserVersion?: string }).parserVersion ?? null;
      void placeholderTask;
    } catch {
      /* ignore — adapter identity is best-effort */
    }

    const task = await this.deps.repository.createParseTask({
      document_id: documentId,
      task_type: options.task_type ?? 'full_parse',
      parser_name: parserName,
      parser_version: parserVersion,
      options: options.options ?? {},
      max_attempts: options.max_attempts ?? 3,
      trace_id: ctx.trace_id,
      created_by: ctx.user_id,
    });

    // Synchronously process so callers (and tests) see the result immediately.
    // Production deployments that prefer async semantics can pass `runner=null`
    // and rely on `runner.start()` polling.
    if (this.deps.runner) {
      await this.deps.runner.runTask(task.id);
    }
    const fresh = await this.deps.repository.findParseTask(task.id);
    const document2 = await this.deps.repository.findDocument(documentId);
    return { task: fresh ?? task, document: document2 ?? document };
  }

  async getDocumentDetail(id: string): Promise<DocumentDetailResponse> {
    const document = await this.deps.repository.findDocument(id);
    if (!document) throw new NotFoundError('Document');
    const tasks = await this.deps.repository.listTasksForDocument(id);
    const activeTask =
      tasks.find((t) => t.status === 'queued' || t.status === 'processing') ?? null;
    const currentResult = await this.deps.repository.findCurrentResult(id);
    return { document, current_result: currentResult, active_task: activeTask };
  }

  async listDocuments(filter: {
    status?: string;
    doc_type?: 'datasheet' | 'test_report' | 'formula_card' | 'sop' | 'image' | 'other';
    category?: 'raw_material' | 'formula' | 'test' | 'process' | 'regulatory' | 'other';
    q?: string;
    page: number;
    pageSize: number;
  }) {
    return this.deps.repository.listDocuments(filter);
  }

  async listResults(documentId: string): Promise<ParseResultRow[]> {
    const document = await this.deps.repository.findDocument(documentId);
    if (!document) throw new NotFoundError('Document');
    return this.deps.repository.listResultsForDocument(documentId);
  }

  // ──────────────────────────────────────────────────────────────────
  // Confirmation (human review)
  // ──────────────────────────────────────────────────────────────────
  async confirm(
    documentId: string,
    body: ConfirmRequest,
    ctx: { trace_id: string | null; user_id: string | null }
  ): Promise<{ document: DocumentRow; result: ParseResultRow; promoted_kb_id?: string }> {
    const document = await this.deps.repository.findDocument(documentId);
    if (!document) throw new NotFoundError('Document');

    const baseResult = body.result_id
      ? await this.deps.repository.findParseResult(body.result_id)
      : await this.deps.repository.findCurrentResult(documentId);

    if (!baseResult || baseResult.document_id !== documentId) {
      throw new NotFoundError('Parse result');
    }

    const reviewerId = body.reviewer_id ?? ctx.user_id ?? null;

    let finalResult: ParseResultRow;
    if (body.action === 'edit') {
      // Append a new manual revision; mark approved.
      const manual = await this.deps.repository.appendManualRevision({
        document_id: documentId,
        base_result: baseResult,
        manual_edits: body.manual_edits ?? {},
        reviewer_id: reviewerId,
        review_comment: body.review_comment ?? null,
        trace_id: ctx.trace_id,
      });
      const reviewed = await this.deps.repository.patchResultReview(manual.id, {
        review_status: 'approved' as ReviewStatus,
        reviewer_id: reviewerId,
        review_comment: body.review_comment ?? null,
        manual_edits: body.manual_edits,
      });
      finalResult = reviewed ?? manual;
    } else {
      const review_status: ReviewStatus = body.action === 'approve' ? 'approved' : 'rejected';
      const updated = await this.deps.repository.patchResultReview(baseResult.id, {
        review_status,
        reviewer_id: reviewerId,
        review_comment: body.review_comment ?? null,
      });
      finalResult = updated ?? baseResult;
    }

    // Move document into the matching terminal state.
    const docStatus = body.action === 'reject' ? 'rejected' : 'confirmed';
    await this.deps.repository.updateDocumentStatus(documentId, docStatus, reviewerId);

    let promotedKbId: string | undefined;
    if ((body.action === 'approve' || body.action === 'edit') && body.promote_to_kb) {
      const promotion = await this.promoteToKb(
        document,
        finalResult,
        body.promote_to_kb,
        reviewerId
      );
      promotedKbId = promotion.id;
      // Link the result row to the KB entry.
      await this.deps.repository.patchResultReview(finalResult.id, {
        review_status: finalResult.review_status,
        reviewer_id: finalResult.reviewer_id,
        review_comment: finalResult.review_comment ?? null,
        ...(body.promote_to_kb === 'raw_material'
          ? { linked_raw_material_kb_id: promotion.id }
          : { linked_formula_kb_id: promotion.id }),
      });
    }

    const docFinal = await this.deps.repository.findDocument(documentId);
    return {
      document: docFinal ?? document,
      result: finalResult,
      ...(promotedKbId ? { promoted_kb_id: promotedKbId } : {}),
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // KB promotion (auto-create draft KB entry from extraction)
  // ──────────────────────────────────────────────────────────────────
  private async promoteToKb(
    document: DocumentRow,
    result: ParseResultRow,
    target: 'raw_material' | 'formula',
    userId: string | null
  ): Promise<{ id: string }> {
    const payload = result.structured_payload ?? {};
    if (target === 'raw_material') {
      const material = (payload['material'] as Record<string, unknown> | undefined) ?? {};
      const proposedName = (material['proposed_name'] as string | undefined) ?? document.title;
      const code = await this.deps.repository.nextRawMaterialKbCode();
      const kb = await this.deps.repository.createRawMaterialKb(
        {
          name: proposedName,
          summary: document.description ?? `Auto-promoted from document ${document.code}`,
          properties: material,
          source_document_id: document.id,
          source_result_id: result.id,
          search_keywords: result.search_keywords,
          status: 'draft',
        },
        code,
        userId
      );
      return { id: kb.id };
    }
    // formula
    const code = await this.deps.repository.nextFormulaKbCode();
    const composition =
      (payload['composition'] as Array<Record<string, unknown>> | undefined) ?? [];
    const targetMetrics =
      (payload['target_metrics'] as Array<Record<string, unknown>> | undefined) ?? [];
    const kb = await this.deps.repository.createFormulaKb(
      {
        title: (payload['title'] as string | undefined) ?? document.title,
        product_category: payload['product_category'] as string | undefined,
        summary: document.description ?? `Auto-promoted from document ${document.code}`,
        composition_overview:
          composition.length > 0 ? `${composition.length} BOM lines` : undefined,
        sample_bom: composition,
        target_metrics: targetMetrics,
        source_document_id: document.id,
        source_result_id: result.id,
        search_keywords: result.search_keywords,
        status: 'draft',
      },
      code,
      userId
    );
    return { id: kb.id };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function validatedDocType(v: string | undefined): (typeof DOCUMENT_TYPES)[number] {
  if (!v) return 'other';
  return (DOCUMENT_TYPES as readonly string[]).includes(v)
    ? (v as (typeof DOCUMENT_TYPES)[number])
    : 'other';
}

function validatedCategory(v: string | undefined): (typeof DOCUMENT_CATEGORIES)[number] {
  if (!v) return 'other';
  return (DOCUMENT_CATEGORIES as readonly string[]).includes(v)
    ? (v as (typeof DOCUMENT_CATEGORIES)[number])
    : 'other';
}
