/**
 * Asynchronous parse runner.
 *
 * Drains the `document_parse_tasks` queue:
 *
 *   queued ──▶ processing ──▶ succeeded
 *                          └▶ failed
 *
 * Architecture:
 *   • The runner is an in-process worker; it knows nothing about HTTP.
 *     Service-layer code calls `enqueue()` after a task row is written, then
 *     either `runOne()` (sync drain — used by /docs/parse so the caller gets
 *     immediate feedback in dev / tests) or `start()` (background drain via
 *     setInterval).
 *   • Each iteration claims a queued task with `SELECT … FOR UPDATE SKIP LOCKED`
 *     so multiple workers don't race; this is a no-op when running solo.
 *   • Parser failures are recorded on the task row and surface via /docs/:id;
 *     the document stays in 'parsed' (or whatever it was) so the user can
 *     re-issue /docs/parse.
 *
 * The runner doesn't perform retries automatically; instead, each /docs/parse
 * call creates a new task row, which keeps the audit history clean.
 */
import type { Logger } from 'pino';
import { assertDocumentTransition, assertTaskTransition } from '../state-machine.js';
import type { ParserRegistry } from '../adapters/ocr/index.js';
import type { StorageAdapter } from '../adapters/storage/index.js';
import type { KnowledgeRepository } from '../repository.js';
import type { DocumentRow, ParseTaskRow } from '../types.js';

export interface ParseRunnerDeps {
  repository: KnowledgeRepository;
  storage: StorageAdapter;
  registry: ParserRegistry;
  logger: Logger;
}

export class ParseRunner {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: ParseRunnerDeps) {}

  /** Drain queued tasks one-by-one until there are none left. */
  async drain(): Promise<number> {
    let processed = 0;
    for (;;) {
      const claimed = await this.deps.repository.claimNextQueuedTask();
      if (!claimed) break;
      await this.processTask(claimed);
      processed += 1;
    }
    return processed;
  }

  /**
   * Process a SPECIFIC task — used right after enqueue so the caller's
   * /docs/parse synchronously sees the result. Tolerates races (returns the
   * task as-is if some other worker already grabbed it).
   */
  async runTask(taskId: string): Promise<ParseTaskRow | null> {
    const task = await this.deps.repository.findParseTask(taskId);
    if (!task) return null;
    if (task.status !== 'queued') return task; // already in-flight or terminal
    const moved = await this.deps.repository.markTaskProcessing(task.id);
    if (!moved) return task;
    return this.processTask(moved);
  }

  /**
   * Background loop. `intervalMs` controls polling cadence. Safe to call
   * multiple times — only one timer runs at a time.
   */
  start(intervalMs = 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.drain()
        .catch((err) => this.deps.logger.warn({ err }, 'ParseRunner.drain failed'))
        .finally(() => {
          this.running = false;
        });
    }, intervalMs).unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────

  /** Run one task end-to-end. Updates document + result + task atomically (logically). */
  private async processTask(task: ParseTaskRow): Promise<ParseTaskRow> {
    const startedAt = Date.now();
    const document = await this.deps.repository.findDocument(task.document_id);
    if (!document) {
      return this.failTask(task, startedAt, 'NotFoundError', 'Document not found');
    }

    // Move document into 'parsing' (best-effort; ignore illegal transitions
    // because the user may have re-parsed an already-parsed/reviewed doc).
    await this.tryMoveDocument(document, 'parsing');

    let parserOutput;
    try {
      const adapter = this.deps.registry.resolve(document.mime_type);
      const body = await this.deps.storage.get(document.storage_key);
      parserOutput = await adapter.parse(
        {
          body,
          mimeType: document.mime_type,
          originalName: document.title,
          options: task.options ?? {},
        },
        task
      );
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.deps.logger.warn({ err: e, taskId: task.id, documentId: document.id }, 'Parser failed');
      // Keep document in 'parsed' so the user can re-trigger; the task row
      // captures the failure reason for the review UI.
      await this.tryMoveDocument(document, 'parsed');
      return this.failTask(task, startedAt, e.name, e.message);
    }

    // Persist a versioned result row.
    const result = await this.deps.repository.appendParseResult({
      document_id: document.id,
      task_id: task.id,
      origin: parserOutput.origin ?? 'ocr',
      confidence: parserOutput.confidence,
      raw_text: parserOutput.raw_text,
      structured_payload: parserOutput.structured_payload,
      extracted_fields: parserOutput.extracted_fields,
      page_snippets: parserOutput.page_snippets ?? [],
      search_keywords: parserOutput.search_keywords ?? [],
      metadata: {
        parser_name: parserOutput.parser_name,
        parser_version: parserOutput.parser_version,
      },
      trace_id: task.trace_id,
      created_by: task.created_by,
    });

    // Stamp document with parser-derived metadata.
    await this.deps.repository.patchDocumentMeta(document.id, {
      ...(parserOutput.language ? { language_detected: parserOutput.language } : {}),
      ...(parserOutput.page_count ? { page_count: parserOutput.page_count } : {}),
      ...(parserOutput.search_keywords && parserOutput.search_keywords.length > 0
        ? { search_keywords: parserOutput.search_keywords }
        : {}),
    });

    // Move document → review (so the human-review UI can pick it up).
    await this.tryMoveDocument(document, 'review');

    const finished = await this.deps.repository.finishTask(task.id, 'succeeded', {
      duration_ms: Date.now() - startedAt,
    });
    this.deps.logger.info(
      {
        taskId: task.id,
        documentId: document.id,
        resultVersion: result.result_version,
        durationMs: Date.now() - startedAt,
      },
      'Parse task succeeded'
    );
    return finished ?? task;
  }

  private async failTask(
    task: ParseTaskRow,
    startedAt: number,
    errorClass: string,
    errorMessage: string
  ): Promise<ParseTaskRow> {
    const updated = await this.deps.repository.finishTask(task.id, 'failed', {
      duration_ms: Date.now() - startedAt,
      error_class: errorClass,
      error_message: errorMessage,
    });
    return updated ?? task;
  }

  /** Update doc.status, swallowing illegal-transition errors. */
  private async tryMoveDocument(doc: DocumentRow, to: typeof doc.status): Promise<void> {
    try {
      assertDocumentTransition(doc.status, to);
    } catch {
      // not a fatal error — just skip the update
      return;
    }
    try {
      assertTaskTransition('queued', 'processing'); // sanity-check the SM is wired
    } catch {
      /* no-op */
    }
    await this.deps.repository.updateDocumentStatus(doc.id, to);
  }
}
