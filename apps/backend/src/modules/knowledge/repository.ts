/**
 * Persistence layer for the knowledge / documents module.
 *
 * One class — five tables. Methods are grouped by entity:
 *
 *   raw_material_kb / formula_kb     — CRUD + paginated list + search
 *   document_records                 — insert / get / list / status update / delete
 *   document_parse_tasks             — enqueue / mark processing / mark final
 *   document_parse_results           — append (auto-increments result_version) /
 *                                       set is_current / record review state
 */
import type { Pool, PoolClient } from 'pg';
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
} from './types.js';

export class KnowledgeRepository {
  constructor(private readonly pool: Pool) {}

  // ──────────────────────────────────────────────────────────────────
  // Code generators (RMK-/FKB-/DOC-YYYY-NNNN)
  // ──────────────────────────────────────────────────────────────────
  async nextRawMaterialKbCode(): Promise<string> {
    return this.nextCode('raw_material_kb', 'RMK');
  }
  async nextFormulaKbCode(): Promise<string> {
    return this.nextCode('formula_kb', 'FKB');
  }
  async nextDocumentCode(): Promise<string> {
    return this.nextCode('document_records', 'DOC');
  }
  private async nextCode(table: string, prefix: string): Promise<string> {
    const year = new Date().getFullYear();
    const res = await this.pool.query<{ code: string }>(
      `SELECT code FROM ${table} WHERE code LIKE $1 ORDER BY code DESC LIMIT 1`,
      [`${prefix}-${year}-%`]
    );
    let n = 1;
    if (res.rows[0]?.code) {
      const m = new RegExp(`^${prefix}-\\d{4}-(\\d+)$`).exec(res.rows[0].code);
      if (m) n = Number(m[1]) + 1;
    }
    return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
  }

  // ──────────────────────────────────────────────────────────────────
  // raw_material_kb
  // ──────────────────────────────────────────────────────────────────
  async createRawMaterialKb(
    input: RawMaterialKbInput,
    code: string,
    userId: string | null
  ): Promise<RawMaterialKbRow> {
    const res = await this.pool.query<RawRawMaterialKb>(
      `INSERT INTO raw_material_kb (
         code, name, category, raw_material_id,
         summary, technical_notes, usage_guidance, regulatory_notes, storage_handling,
         properties, search_keywords, tags, status, metadata,
         source_document_id, source_result_id, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        code,
        input.name,
        input.category ?? null,
        input.raw_material_id ?? null,
        input.summary ?? null,
        input.technical_notes ?? null,
        input.usage_guidance ?? null,
        input.regulatory_notes ?? null,
        input.storage_handling ?? null,
        JSON.stringify(input.properties ?? {}),
        input.search_keywords ?? [],
        input.tags ?? [],
        input.status ?? 'draft',
        JSON.stringify(input.metadata ?? {}),
        input.source_document_id ?? null,
        input.source_result_id ?? null,
        userId,
      ]
    );
    return mapRawMaterialKb(res.rows[0]!);
  }

  async updateRawMaterialKb(
    id: string,
    patch: Partial<RawMaterialKbInput>,
    userId: string | null
  ): Promise<RawMaterialKbRow | null> {
    const fields = buildPatchFields({
      name: patch.name,
      category: patch.category,
      raw_material_id: patch.raw_material_id,
      summary: patch.summary,
      technical_notes: patch.technical_notes,
      usage_guidance: patch.usage_guidance,
      regulatory_notes: patch.regulatory_notes,
      storage_handling: patch.storage_handling,
      properties: patch.properties === undefined ? undefined : JSON.stringify(patch.properties),
      search_keywords: patch.search_keywords,
      tags: patch.tags,
      status: patch.status,
      metadata: patch.metadata === undefined ? undefined : JSON.stringify(patch.metadata),
      source_document_id: patch.source_document_id,
      source_result_id: patch.source_result_id,
    });
    if (fields.assignments.length === 0) return this.findRawMaterialKb(id);
    const res = await this.pool.query<RawRawMaterialKb>(
      `UPDATE raw_material_kb
          SET ${fields.assignments.join(', ')}, updated_by = $${fields.values.length + 1}
        WHERE id = $${fields.values.length + 2} AND deleted_at IS NULL
        RETURNING *`,
      [...fields.values, userId, id]
    );
    return res.rows[0] ? mapRawMaterialKb(res.rows[0]) : null;
  }

  async findRawMaterialKb(id: string): Promise<RawMaterialKbRow | null> {
    const res = await this.pool.query<RawRawMaterialKb>(
      `SELECT * FROM raw_material_kb WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return res.rows[0] ? mapRawMaterialKb(res.rows[0]) : null;
  }

  async listRawMaterialKb(filter: {
    status?: KbStatus;
    q?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: RawMaterialKbRow[]; total: number }> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.status) {
      where.push(`status = $${i++}`);
      params.push(filter.status);
    }
    if (filter.q) {
      where.push(`(name ILIKE $${i} OR code ILIKE $${i} OR coalesce(category,'') ILIKE $${i})`);
      params.push(`%${filter.q}%`);
      i += 1;
    }
    const totalRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM raw_material_kb WHERE ${where.join(' AND ')}`,
      params
    );
    const offset = (filter.page - 1) * filter.pageSize;
    const itemsRes = await this.pool.query<RawRawMaterialKb>(
      `SELECT * FROM raw_material_kb
         WHERE ${where.join(' AND ')}
         ORDER BY updated_at DESC
         LIMIT ${filter.pageSize} OFFSET ${offset}`,
      params
    );
    return { items: itemsRes.rows.map(mapRawMaterialKb), total: Number(totalRes.rows[0]!.count) };
  }

  async softDeleteRawMaterialKb(id: string, userId: string | null): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE raw_material_kb SET deleted_at = NOW(), updated_by = $2
         WHERE id = $1 AND deleted_at IS NULL`,
      [id, userId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  // ──────────────────────────────────────────────────────────────────
  // formula_kb
  // ──────────────────────────────────────────────────────────────────
  async createFormulaKb(
    input: FormulaKbInput,
    code: string,
    userId: string | null
  ): Promise<FormulaKbRow> {
    const res = await this.pool.query<RawFormulaKb>(
      `INSERT INTO formula_kb (
         code, title, product_category, application_scene,
         related_formula_id, related_formula_version_id,
         summary, composition_overview, performance_highlights, process_notes,
         sample_bom, target_metrics,
         search_keywords, tags, status, metadata,
         source_document_id, source_result_id, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        code,
        input.title,
        input.product_category ?? null,
        input.application_scene ?? null,
        input.related_formula_id ?? null,
        input.related_formula_version_id ?? null,
        input.summary ?? null,
        input.composition_overview ?? null,
        input.performance_highlights ?? null,
        input.process_notes ?? null,
        JSON.stringify(input.sample_bom ?? []),
        JSON.stringify(input.target_metrics ?? []),
        input.search_keywords ?? [],
        input.tags ?? [],
        input.status ?? 'draft',
        JSON.stringify(input.metadata ?? {}),
        input.source_document_id ?? null,
        input.source_result_id ?? null,
        userId,
      ]
    );
    return mapFormulaKb(res.rows[0]!);
  }

  async updateFormulaKb(
    id: string,
    patch: Partial<FormulaKbInput>,
    userId: string | null
  ): Promise<FormulaKbRow | null> {
    const fields = buildPatchFields({
      title: patch.title,
      product_category: patch.product_category,
      application_scene: patch.application_scene,
      related_formula_id: patch.related_formula_id,
      related_formula_version_id: patch.related_formula_version_id,
      summary: patch.summary,
      composition_overview: patch.composition_overview,
      performance_highlights: patch.performance_highlights,
      process_notes: patch.process_notes,
      sample_bom: patch.sample_bom === undefined ? undefined : JSON.stringify(patch.sample_bom),
      target_metrics:
        patch.target_metrics === undefined ? undefined : JSON.stringify(patch.target_metrics),
      search_keywords: patch.search_keywords,
      tags: patch.tags,
      status: patch.status,
      metadata: patch.metadata === undefined ? undefined : JSON.stringify(patch.metadata),
      source_document_id: patch.source_document_id,
      source_result_id: patch.source_result_id,
    });
    if (fields.assignments.length === 0) return this.findFormulaKb(id);
    const res = await this.pool.query<RawFormulaKb>(
      `UPDATE formula_kb
          SET ${fields.assignments.join(', ')}, updated_by = $${fields.values.length + 1}
        WHERE id = $${fields.values.length + 2} AND deleted_at IS NULL
        RETURNING *`,
      [...fields.values, userId, id]
    );
    return res.rows[0] ? mapFormulaKb(res.rows[0]) : null;
  }

  async findFormulaKb(id: string): Promise<FormulaKbRow | null> {
    const res = await this.pool.query<RawFormulaKb>(
      `SELECT * FROM formula_kb WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return res.rows[0] ? mapFormulaKb(res.rows[0]) : null;
  }

  async listFormulaKb(filter: {
    status?: KbStatus;
    q?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: FormulaKbRow[]; total: number }> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.status) {
      where.push(`status = $${i++}`);
      params.push(filter.status);
    }
    if (filter.q) {
      where.push(
        `(title ILIKE $${i} OR code ILIKE $${i} OR coalesce(product_category,'') ILIKE $${i})`
      );
      params.push(`%${filter.q}%`);
      i += 1;
    }
    const totalRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM formula_kb WHERE ${where.join(' AND ')}`,
      params
    );
    const offset = (filter.page - 1) * filter.pageSize;
    const itemsRes = await this.pool.query<RawFormulaKb>(
      `SELECT * FROM formula_kb
         WHERE ${where.join(' AND ')}
         ORDER BY updated_at DESC
         LIMIT ${filter.pageSize} OFFSET ${offset}`,
      params
    );
    return { items: itemsRes.rows.map(mapFormulaKb), total: Number(totalRes.rows[0]!.count) };
  }

  async softDeleteFormulaKb(id: string, userId: string | null): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE formula_kb SET deleted_at = NOW(), updated_by = $2
         WHERE id = $1 AND deleted_at IS NULL`,
      [id, userId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  // ──────────────────────────────────────────────────────────────────
  // document_records
  // ──────────────────────────────────────────────────────────────────
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
    const res = await this.pool.query<RawDocument>(
      `INSERT INTO document_records (
         code, title, description, doc_type, category,
         mime_type, file_extension, size_bytes, checksum_sha256,
         storage_provider, storage_key, storage_url, language,
         visibility, tags, related_raw_material_id, related_formula_id, related_supplier_id,
         metadata, trace_id, created_by, status
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'uploaded')
       RETURNING *`,
      [
        input.code,
        input.title,
        input.description,
        input.doc_type,
        input.category,
        input.mime_type,
        input.file_extension,
        input.size_bytes,
        input.checksum_sha256,
        input.storage_provider,
        input.storage_key,
        input.storage_url,
        input.language,
        input.visibility,
        input.tags,
        input.related_raw_material_id,
        input.related_formula_id,
        input.related_supplier_id,
        JSON.stringify(input.metadata),
        input.trace_id,
        input.created_by,
      ]
    );
    return mapDocument(res.rows[0]!);
  }

  async findDocument(id: string): Promise<DocumentRow | null> {
    const res = await this.pool.query<RawDocument>(
      `SELECT * FROM document_records WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return res.rows[0] ? mapDocument(res.rows[0]) : null;
  }

  async listDocuments(filter: {
    status?: string;
    doc_type?: DocumentType;
    category?: DocumentCategory;
    q?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: DocumentRow[]; total: number }> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    if (filter.status) {
      where.push(`status = $${i++}`);
      params.push(filter.status);
    }
    if (filter.doc_type) {
      where.push(`doc_type = $${i++}`);
      params.push(filter.doc_type);
    }
    if (filter.category) {
      where.push(`category = $${i++}`);
      params.push(filter.category);
    }
    if (filter.q) {
      where.push(`(title ILIKE $${i} OR code ILIKE $${i} OR coalesce(description,'') ILIKE $${i})`);
      params.push(`%${filter.q}%`);
      i += 1;
    }
    const totalRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM document_records WHERE ${where.join(' AND ')}`,
      params
    );
    const offset = (filter.page - 1) * filter.pageSize;
    const itemsRes = await this.pool.query<RawDocument>(
      `SELECT * FROM document_records
         WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT ${filter.pageSize} OFFSET ${offset}`,
      params
    );
    return { items: itemsRes.rows.map(mapDocument), total: Number(totalRes.rows[0]!.count) };
  }

  async updateDocumentStatus(
    id: string,
    status: DocumentStatus,
    userId: string | null = null
  ): Promise<DocumentRow | null> {
    const res = await this.pool.query<RawDocument>(
      `UPDATE document_records SET status = $2, updated_by = $3
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING *`,
      [id, status, userId]
    );
    return res.rows[0] ? mapDocument(res.rows[0]) : null;
  }

  async patchDocumentMeta(
    id: string,
    patch: {
      language_detected?: string | null;
      page_count?: number | null;
      search_keywords?: string[];
    }
  ): Promise<DocumentRow | null> {
    const fields = buildPatchFields({
      language_detected: patch.language_detected,
      page_count: patch.page_count,
      search_keywords: patch.search_keywords,
    });
    if (fields.assignments.length === 0) return this.findDocument(id);
    const res = await this.pool.query<RawDocument>(
      `UPDATE document_records SET ${fields.assignments.join(', ')}
         WHERE id = $${fields.values.length + 1} AND deleted_at IS NULL
         RETURNING *`,
      [...fields.values, id]
    );
    return res.rows[0] ? mapDocument(res.rows[0]) : null;
  }

  async softDeleteDocument(id: string, userId: string | null): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE document_records SET deleted_at = NOW(), status = 'archived', updated_by = $2
         WHERE id = $1 AND deleted_at IS NULL`,
      [id, userId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  // ──────────────────────────────────────────────────────────────────
  // document_parse_tasks
  // ──────────────────────────────────────────────────────────────────
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
    const res = await this.pool.query<RawParseTask>(
      `INSERT INTO document_parse_tasks (
         document_id, task_type, status, parser_name, parser_version, options,
         max_attempts, trace_id, created_by
       )
       VALUES ($1,$2,'queued',$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        input.document_id,
        input.task_type,
        input.parser_name,
        input.parser_version,
        JSON.stringify(input.options),
        input.max_attempts,
        input.trace_id,
        input.created_by,
      ]
    );
    return mapParseTask(res.rows[0]!);
  }

  async findParseTask(id: string): Promise<ParseTaskRow | null> {
    const res = await this.pool.query<RawParseTask>(
      `SELECT * FROM document_parse_tasks WHERE id = $1`,
      [id]
    );
    return res.rows[0] ? mapParseTask(res.rows[0]) : null;
  }

  async listTasksForDocument(documentId: string): Promise<ParseTaskRow[]> {
    const res = await this.pool.query<RawParseTask>(
      `SELECT * FROM document_parse_tasks WHERE document_id = $1 ORDER BY created_at DESC`,
      [documentId]
    );
    return res.rows.map(mapParseTask);
  }

  async claimNextQueuedTask(): Promise<ParseTaskRow | null> {
    /* SKIP LOCKED ensures multiple worker processes don't pick the same row. */
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<RawParseTask>(
        `SELECT * FROM document_parse_tasks
           WHERE status = 'queued'
           ORDER BY created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1`
      );
      const task = res.rows[0];
      if (!task) {
        await client.query('COMMIT');
        return null;
      }
      const upd = await client.query<RawParseTask>(
        `UPDATE document_parse_tasks
            SET status = 'processing',
                started_at = NOW(),
                attempt_count = attempt_count + 1,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [task.id]
      );
      await client.query('COMMIT');
      return upd.rows[0] ? mapParseTask(upd.rows[0]) : null;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async markTaskProcessing(id: string): Promise<ParseTaskRow | null> {
    const res = await this.pool.query<RawParseTask>(
      `UPDATE document_parse_tasks
          SET status='processing', started_at = COALESCE(started_at, NOW()),
              attempt_count = attempt_count + 1,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );
    return res.rows[0] ? mapParseTask(res.rows[0]) : null;
  }

  async finishTask(
    id: string,
    status: ParseTaskStatus,
    opts: { error_class?: string | null; error_message?: string | null; duration_ms: number }
  ): Promise<ParseTaskRow | null> {
    const res = await this.pool.query<RawParseTask>(
      `UPDATE document_parse_tasks
          SET status = $2,
              completed_at = NOW(),
              duration_ms = $3,
              error_class = $4,
              error_message = $5,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, status, opts.duration_ms, opts.error_class ?? null, opts.error_message ?? null]
    );
    return res.rows[0] ? mapParseTask(res.rows[0]) : null;
  }

  // ──────────────────────────────────────────────────────────────────
  // document_parse_results — versioned
  // ──────────────────────────────────────────────────────────────────
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
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Demote previous current row.
      await client.query(
        `UPDATE document_parse_results SET is_current = FALSE
           WHERE document_id = $1 AND is_current = TRUE`,
        [input.document_id]
      );
      const versionRes = await client.query<{ next_version: number }>(
        `SELECT COALESCE(MAX(result_version), 0) + 1 AS next_version
           FROM document_parse_results WHERE document_id = $1`,
        [input.document_id]
      );
      const next = versionRes.rows[0]!.next_version;
      const res = await client.query<RawParseResult>(
        `INSERT INTO document_parse_results (
           document_id, task_id, result_version, is_current, origin,
           confidence, raw_text, structured_payload, extracted_fields, page_snippets,
           review_status, search_keywords, metadata, trace_id, created_by
         )
         VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,$8,$9,'pending',$10,$11,$12,$13)
         RETURNING *`,
        [
          input.document_id,
          input.task_id,
          next,
          input.origin,
          input.confidence,
          input.raw_text,
          JSON.stringify(input.structured_payload),
          JSON.stringify(input.extracted_fields),
          JSON.stringify(input.page_snippets),
          input.search_keywords,
          JSON.stringify(input.metadata),
          input.trace_id,
          input.created_by,
        ]
      );
      await client.query('COMMIT');
      return mapParseResult(res.rows[0]!);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async findParseResult(id: string): Promise<ParseResultRow | null> {
    const res = await this.pool.query<RawParseResult>(
      `SELECT * FROM document_parse_results WHERE id = $1`,
      [id]
    );
    return res.rows[0] ? mapParseResult(res.rows[0]) : null;
  }

  async findCurrentResult(documentId: string): Promise<ParseResultRow | null> {
    const res = await this.pool.query<RawParseResult>(
      `SELECT * FROM document_parse_results
         WHERE document_id = $1 AND is_current = TRUE
         LIMIT 1`,
      [documentId]
    );
    return res.rows[0] ? mapParseResult(res.rows[0]) : null;
  }

  async listResultsForDocument(documentId: string): Promise<ParseResultRow[]> {
    const res = await this.pool.query<RawParseResult>(
      `SELECT * FROM document_parse_results
         WHERE document_id = $1
         ORDER BY result_version DESC`,
      [documentId]
    );
    return res.rows.map(mapParseResult);
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
  ): Promise<ParseResultRow | null> {
    const fields = buildPatchFields({
      review_status: patch.review_status,
      reviewer_id: patch.reviewer_id,
      review_comment: patch.review_comment,
      reviewed_at: 'NOW()' as never,
      manual_edits:
        patch.manual_edits === undefined ? undefined : JSON.stringify(patch.manual_edits),
      linked_raw_material_kb_id: patch.linked_raw_material_kb_id,
      linked_formula_kb_id: patch.linked_formula_kb_id,
    });
    if (fields.assignments.length === 0) return this.findParseResult(id);
    const res = await this.pool.query<RawParseResult>(
      `UPDATE document_parse_results
          SET ${fields.assignments.join(', ')}
        WHERE id = $${fields.values.length + 1}
        RETURNING *`,
      [...fields.values, id]
    );
    return res.rows[0] ? mapParseResult(res.rows[0]) : null;
  }

  /** Append a "manual" revision with the user's edits. Marks the new row current. */
  async appendManualRevision(input: {
    document_id: string;
    base_result: ParseResultRow;
    manual_edits: Record<string, unknown>;
    reviewer_id: string | null;
    review_comment: string | null;
    trace_id: string | null;
  }): Promise<ParseResultRow> {
    const merged = mergeStructured(input.base_result.structured_payload, input.manual_edits);
    return this.appendParseResult({
      document_id: input.document_id,
      task_id: input.base_result.task_id,
      origin: 'manual',
      confidence: input.base_result.confidence,
      raw_text: input.base_result.raw_text,
      structured_payload: merged,
      extracted_fields: { ...input.base_result.extracted_fields, ...flattenForExtracted(merged) },
      page_snippets: input.base_result.page_snippets,
      search_keywords: input.base_result.search_keywords,
      metadata: {
        ...input.base_result.metadata,
        derived_from: input.base_result.id,
        manual_edits: input.manual_edits,
        reviewer_id: input.reviewer_id,
        review_comment: input.review_comment,
      },
      trace_id: input.trace_id,
      created_by: input.reviewer_id,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Row → DTO mapping
// ─────────────────────────────────────────────────────────────────────────────

interface RawRawMaterialKb {
  id: string;
  code: string;
  name: string;
  category: string | null;
  raw_material_id: string | null;
  summary: string | null;
  technical_notes: string | null;
  usage_guidance: string | null;
  regulatory_notes: string | null;
  storage_handling: string | null;
  properties: Record<string, unknown>;
  search_keywords: string[];
  tags: string[];
  status: KbStatus;
  metadata: Record<string, unknown>;
  source_document_id: string | null;
  source_result_id: string | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  version: number;
}

interface RawFormulaKb {
  id: string;
  code: string;
  title: string;
  product_category: string | null;
  application_scene: string | null;
  related_formula_id: string | null;
  related_formula_version_id: string | null;
  summary: string | null;
  composition_overview: string | null;
  performance_highlights: string | null;
  process_notes: string | null;
  sample_bom: Array<Record<string, unknown>>;
  target_metrics: Array<Record<string, unknown>>;
  search_keywords: string[];
  tags: string[];
  status: KbStatus;
  metadata: Record<string, unknown>;
  source_document_id: string | null;
  source_result_id: string | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  version: number;
}

interface RawDocument {
  id: string;
  code: string;
  title: string;
  description: string | null;
  doc_type: DocumentType;
  category: DocumentCategory;
  mime_type: string;
  file_extension: string | null;
  size_bytes: string | number;
  checksum_sha256: string | null;
  storage_provider: StorageProvider;
  storage_key: string;
  storage_url: string;
  page_count: number | null;
  language: string | null;
  language_detected: string | null;
  status: DocumentStatus;
  visibility: 'private' | 'team' | 'public';
  related_raw_material_id: string | null;
  related_formula_id: string | null;
  related_supplier_id: string | null;
  search_keywords: string[];
  tags: string[];
  metadata: Record<string, unknown>;
  trace_id: string | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  version: number;
}

interface RawParseTask {
  id: string;
  document_id: string;
  task_type: ParseTaskType;
  status: ParseTaskStatus;
  parser_name: string | null;
  parser_version: string | null;
  options: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
  started_at: Date | null;
  completed_at: Date | null;
  duration_ms: number;
  error_class: string | null;
  error_message: string | null;
  trace_id: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface RawParseResult {
  id: string;
  document_id: string;
  task_id: string | null;
  result_version: number;
  is_current: boolean;
  origin: ResultOrigin;
  confidence: string | number | null;
  raw_text: string | null;
  structured_payload: Record<string, unknown>;
  extracted_fields: Record<string, unknown>;
  page_snippets: Array<{ page: number; text: string; confidence?: number }>;
  review_status: ReviewStatus;
  reviewer_id: string | null;
  reviewed_at: Date | null;
  review_comment: string | null;
  manual_edits: Record<string, unknown>;
  linked_raw_material_kb_id: string | null;
  linked_formula_kb_id: string | null;
  search_keywords: string[];
  metadata: Record<string, unknown>;
  trace_id: string | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  version: number;
}

function mapRawMaterialKb(r: RawRawMaterialKb): RawMaterialKbRow {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    category: r.category ?? undefined,
    raw_material_id: r.raw_material_id,
    summary: r.summary ?? undefined,
    technical_notes: r.technical_notes ?? undefined,
    usage_guidance: r.usage_guidance ?? undefined,
    regulatory_notes: r.regulatory_notes ?? undefined,
    storage_handling: r.storage_handling ?? undefined,
    properties: r.properties ?? {},
    search_keywords: r.search_keywords ?? [],
    tags: r.tags ?? [],
    status: r.status,
    metadata: r.metadata ?? {},
    source_document_id: r.source_document_id,
    source_result_id: r.source_result_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    created_by: r.created_by,
    version: r.version,
  };
}

function mapFormulaKb(r: RawFormulaKb): FormulaKbRow {
  return {
    id: r.id,
    code: r.code,
    title: r.title,
    product_category: r.product_category ?? undefined,
    application_scene: r.application_scene ?? undefined,
    related_formula_id: r.related_formula_id,
    related_formula_version_id: r.related_formula_version_id,
    summary: r.summary ?? undefined,
    composition_overview: r.composition_overview ?? undefined,
    performance_highlights: r.performance_highlights ?? undefined,
    process_notes: r.process_notes ?? undefined,
    sample_bom: r.sample_bom ?? [],
    target_metrics: r.target_metrics ?? [],
    search_keywords: r.search_keywords ?? [],
    tags: r.tags ?? [],
    status: r.status,
    metadata: r.metadata ?? {},
    source_document_id: r.source_document_id,
    source_result_id: r.source_result_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    created_by: r.created_by,
    version: r.version,
  };
}

function mapDocument(r: RawDocument): DocumentRow {
  return {
    id: r.id,
    code: r.code,
    title: r.title,
    description: r.description ?? undefined,
    doc_type: r.doc_type,
    category: r.category,
    mime_type: r.mime_type,
    file_extension: r.file_extension ?? '',
    size_bytes: Number(r.size_bytes),
    checksum_sha256: r.checksum_sha256,
    storage_provider: r.storage_provider,
    storage_key: r.storage_key,
    storage_url: r.storage_url,
    page_count: r.page_count,
    language: r.language ?? undefined,
    language_detected: r.language_detected,
    status: r.status,
    visibility: r.visibility,
    related_raw_material_id: r.related_raw_material_id,
    related_formula_id: r.related_formula_id,
    related_supplier_id: r.related_supplier_id,
    search_keywords: r.search_keywords ?? [],
    tags: r.tags ?? [],
    trace_id: r.trace_id,
    metadata: r.metadata ?? {},
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    created_by: r.created_by,
    version: r.version,
  };
}

function mapParseTask(r: RawParseTask): ParseTaskRow {
  return {
    id: r.id,
    document_id: r.document_id,
    task_type: r.task_type,
    status: r.status,
    parser_name: r.parser_name,
    parser_version: r.parser_version,
    options: r.options ?? {},
    attempt_count: r.attempt_count,
    max_attempts: r.max_attempts,
    started_at: r.started_at ? r.started_at.toISOString() : null,
    completed_at: r.completed_at ? r.completed_at.toISOString() : null,
    duration_ms: r.duration_ms,
    error_class: r.error_class,
    error_message: r.error_message,
    trace_id: r.trace_id,
    created_by: r.created_by,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function mapParseResult(r: RawParseResult): ParseResultRow {
  return {
    id: r.id,
    document_id: r.document_id,
    task_id: r.task_id,
    result_version: r.result_version,
    is_current: r.is_current,
    origin: r.origin,
    confidence: r.confidence === null ? null : Number(r.confidence),
    raw_text: r.raw_text,
    structured_payload: r.structured_payload ?? {},
    extracted_fields: r.extracted_fields ?? {},
    page_snippets: r.page_snippets ?? [],
    review_status: r.review_status,
    reviewer_id: r.reviewer_id,
    reviewed_at: r.reviewed_at ? r.reviewed_at.toISOString() : null,
    review_comment: r.review_comment,
    manual_edits: r.manual_edits ?? {},
    linked_raw_material_kb_id: r.linked_raw_material_kb_id,
    linked_formula_kb_id: r.linked_formula_kb_id,
    search_keywords: r.search_keywords ?? [],
    metadata: r.metadata ?? {},
    trace_id: r.trace_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    created_by: r.created_by,
    version: r.version,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildPatchFields(patch: Record<string, unknown>): {
  assignments: string[];
  values: unknown[];
} {
  const assignments: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    // Allow `'NOW()'` as a literal SQL fragment for `reviewed_at`.
    if (typeof value === 'string' && value === 'NOW()') {
      assignments.push(`${key} = NOW()`);
      continue;
    }
    assignments.push(`${key} = $${i++}`);
    values.push(value);
  }
  return { assignments, values };
}

function flattenForExtracted(obj: unknown, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (obj === null || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenForExtracted(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

/** Recursively merges manual edits over the existing structured payload. */
function mergeStructured(
  base: Record<string, unknown>,
  edits: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(edits)) {
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      typeof out[k] === 'object' &&
      out[k] !== null &&
      !Array.isArray(out[k])
    ) {
      out[k] = mergeStructured(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// `PoolClient` import used when transactions matter; not directly exported.
export type { PoolClient };
