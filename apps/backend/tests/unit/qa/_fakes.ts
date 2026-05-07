/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * In-memory fakes for the QA module tests:
 *   • FakeQaRepository       — mirrors QaRepository's surface
 *   • FakeRetriever          — emits deterministic hits
 *
 * Underscore-prefixed parameters mirror the production interface (the service
 * passes them); the fakes don't actually need them.
 */
import { randomUUID } from 'node:crypto';
import type {
  Citation,
  Intent,
  QaFeedbackRow,
  QaMessageRow,
  QaSessionRow,
  RetrievalHit,
  RetrievalSummary,
} from '../../../src/modules/qa/types.js';
import type {
  InsertFeedbackInput,
  InsertMessageInput,
  InsertSessionInput,
} from '../../../src/modules/qa/repository.js';
import type {
  RetrieveQuery,
  RetrieverAdapter,
} from '../../../src/modules/qa/adapters/retrieval/index.js';
import type { CitationSourceType } from '../../../src/modules/qa/types.js';

// ─── Repository fake ────────────────────────────────────────────────────────

export class FakeQaRepository {
  sessions = new Map<string, QaSessionRow>();
  messages = new Map<string, QaMessageRow>();
  feedback = new Map<string, QaFeedbackRow>();
  private codeCounter = 1;

  async nextSessionCode(): Promise<string> {
    return `QA-2026-${String(this.codeCounter++).padStart(6, '0')}`;
  }

  async createSession(input: InsertSessionInput): Promise<QaSessionRow> {
    const row: QaSessionRow = {
      id: randomUUID(),
      code: input.code,
      title: input.title,
      product_category: input.product_category,
      status: 'active',
      message_count: 0,
      last_message_at: null,
      metadata: input.metadata,
      trace_id: input.trace_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: input.created_by,
      version: 1,
    };
    this.sessions.set(row.id, row);
    return row;
  }

  async findSession(id: string): Promise<QaSessionRow | null> {
    return this.sessions.get(id) ?? null;
  }

  async setSessionTitleIfDefault(id: string, title: string): Promise<void> {
    const s = this.sessions.get(id);
    if (s && (s.title === '(未命名会话)' || s.title === '')) s.title = title;
  }

  async updateSessionStatus(
    id: string,
    status: 'active' | 'archived'
  ): Promise<QaSessionRow | null> {
    const s = this.sessions.get(id);
    if (!s) return null;
    s.status = status;
    return s;
  }

  async bumpSessionStats(id: string, increment: number): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    s.message_count += increment;
    s.last_message_at = new Date().toISOString();
  }

  async insertMessage(input: InsertMessageInput): Promise<QaMessageRow> {
    return this.materialise(input);
  }

  async insertTurn(userInput: InsertMessageInput, assistantInput: InsertMessageInput) {
    const user = await this.materialise(userInput);
    const assistant = await this.materialise({ ...assistantInput, parent_message_id: user.id });
    const s = this.sessions.get(user.session_id);
    if (s) {
      s.message_count += 2;
      s.last_message_at = new Date().toISOString();
    }
    return { user, assistant };
  }

  async findMessage(id: string): Promise<QaMessageRow | null> {
    return this.messages.get(id) ?? null;
  }

  async listMessages(sessionId: string): Promise<QaMessageRow[]> {
    return [...this.messages.values()]
      .filter((m) => m.session_id === sessionId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async insertFeedback(input: InsertFeedbackInput): Promise<QaFeedbackRow> {
    const row: QaFeedbackRow = {
      id: randomUUID(),
      message_id: input.message_id,
      session_id: input.session_id,
      user_id: input.user_id,
      rating: input.rating,
      category: input.category,
      comment: input.comment,
      metadata: input.metadata,
      trace_id: input.trace_id,
      created_at: new Date().toISOString(),
    };
    this.feedback.set(row.id, row);
    return row;
  }

  // ── helpers ──────────────────────────────────────────────────────
  private async materialise(input: InsertMessageInput): Promise<QaMessageRow> {
    const row: QaMessageRow = {
      id: randomUUID(),
      session_id: input.session_id,
      role: input.role,
      parent_message_id: input.parent_message_id,
      question: input.question,
      answer: input.answer,
      intent: input.intent,
      intent_confidence: input.intent_confidence,
      confidence: input.confidence,
      citations: input.citations,
      retrieval_summary: input.retrieval_summary,
      llm_adapter: input.llm_adapter,
      llm_version: input.llm_version,
      llm_request: input.llm_request,
      llm_response_meta: input.llm_response_meta,
      metadata: input.metadata,
      trace_id: input.trace_id,
      duration_ms: input.duration_ms,
      created_at: new Date().toISOString(),
      created_by: input.created_by,
    };
    this.messages.set(row.id, row);
    return row;
  }
}

// ─── Retriever fakes ────────────────────────────────────────────────────────

/**
 * Returns a fixed hit list. Unit tests use this to exercise composer +
 * service logic without hitting Postgres.
 */
export class StaticRetriever implements RetrieverAdapter {
  constructor(
    private readonly hits: RetrievalHit[],
    private readonly sources: CitationSourceType[] = ['raw_material_kb', 'formula_kb']
  ) {}

  async retrieve(_query: RetrieveQuery): Promise<RetrievalHit[]> {
    return this.hits;
  }

  supportedSources(): CitationSourceType[] {
    return this.sources;
  }
}

/** Always throws — used to test error-path resilience in the pipeline. */
export class ThrowingRetriever implements RetrieverAdapter {
  async retrieve(): Promise<RetrievalHit[]> {
    throw new Error('retriever explosion');
  }
  supportedSources(): CitationSourceType[] {
    return ['raw_material_kb'];
  }
}

export function makeHit(over: Partial<RetrievalHit> = {}): RetrievalHit {
  return {
    source_type: 'raw_material_kb',
    source_id: randomUUID(),
    title: 'Test material PAO-6',
    snippet: '高黏度指数合成基础油，常用于全合成机油。',
    relevance: 0.9,
    ...over,
  };
}

export const NO_SUMMARY: RetrievalSummary = { hits: 0, sources_searched: [] };
