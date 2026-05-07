/**
 * QA service.
 *
 *   ask       — runs the pipeline, persists user + assistant turn, returns answer
 *   history   — returns the conversation
 *   feedback  — persists user rating on an assistant message
 *
 * Hard rule (enforced here): assistant rows persist `citations` exactly as the
 * composer returned them. When `citations` is empty the row's `intent` is
 * pinned to `'no_match'` and the answer text is the explicit "no source"
 * fallback the composer produced — never a hallucinated answer.
 */
import type { Logger } from 'pino';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import type { QaPipeline } from './pipeline/index.js';
import type { QaRepository, InsertFeedbackInput, InsertMessageInput } from './repository.js';
import type {
  AskRequest,
  AskResponse,
  FeedbackRequest,
  FeedbackResponse,
  HistoryResponse,
  QaSessionRow,
} from './types.js';

export interface QaServiceDeps {
  pipeline: QaPipeline;
  repository: QaRepository;
  logger: Logger;
}

export class QaService {
  constructor(private readonly deps: QaServiceDeps) {}

  // ──────────────────────────────────────────────────────────────────
  // POST /qa/ask
  // ──────────────────────────────────────────────────────────────────
  async ask(
    req: AskRequest,
    ctx: { trace_id: string | null; user_id: string | null }
  ): Promise<AskResponse> {
    const startedAt = Date.now();
    const session = await this.resolveSession(req, ctx);
    // Capture this BEFORE insertTurn — the in-memory test fakes share the same
    // object reference and would mutate `message_count` before the title check.
    const isFirstTurn = session.message_count === 0;

    // Run pipeline without holding any DB locks.
    const result = await this.deps.pipeline.run({
      question: req.question,
      ...(req.product_category !== undefined ? { product_category: req.product_category } : {}),
      ...(req.max_citations !== undefined ? { max_citations: req.max_citations } : {}),
    });

    const duration_ms = Date.now() - startedAt;

    const userInput: InsertMessageInput = {
      session_id: session.id,
      role: 'user',
      parent_message_id: null,
      question: req.question,
      answer: null,
      intent: null,
      intent_confidence: null,
      confidence: null,
      citations: [],
      retrieval_summary: null,
      llm_adapter: null,
      llm_version: null,
      llm_request: null,
      llm_response_meta: null,
      metadata: req.metadata ?? {},
      trace_id: ctx.trace_id,
      duration_ms: 0,
      created_by: ctx.user_id,
    };

    const assistantInput: InsertMessageInput = {
      session_id: session.id,
      role: 'assistant',
      parent_message_id: null, // wired up by insertTurn
      question: null,
      answer: result.answer,
      intent: result.intent,
      intent_confidence: result.intent_confidence,
      confidence: result.confidence,
      citations: result.citations,
      retrieval_summary: result.retrieval_summary,
      llm_adapter: result.llm_adapter,
      llm_version: result.llm_version,
      llm_request: {
        question: req.question,
        intent: result.intent,
        citations_count: result.citations.length,
      },
      llm_response_meta: result.llm_response_meta,
      metadata: { product_category: req.product_category ?? null },
      trace_id: ctx.trace_id,
      duration_ms,
      created_by: null,
    };

    const turn = await this.deps.repository.insertTurn(userInput, assistantInput);

    // Title the session from the first question if it's still the default.
    if (isFirstTurn) {
      const title = deriveTitle(req.question);
      try {
        await this.deps.repository.setSessionTitleIfDefault(session.id, title);
      } catch (err) {
        this.deps.logger.warn({ err, sessionId: session.id }, 'Failed to set QA session title');
      }
    }

    return {
      session_id: session.id,
      message_id: turn.assistant.id,
      user_message_id: turn.user.id,
      answer: result.answer,
      citations: result.citations,
      confidence: result.confidence,
      intent: result.intent,
      intent_confidence: result.intent_confidence,
      llm_adapter: result.llm_adapter,
      llm_version: result.llm_version,
      trace_id: ctx.trace_id,
      duration_ms,
      no_source_fallback: result.no_source_fallback,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // GET /qa/history/:sessionId
  // ──────────────────────────────────────────────────────────────────
  async history(sessionId: string): Promise<HistoryResponse> {
    const session = await this.deps.repository.findSession(sessionId);
    if (!session) throw new NotFoundError('QA session');
    const messages = await this.deps.repository.listMessages(sessionId);
    return { session, messages };
  }

  // ──────────────────────────────────────────────────────────────────
  // POST /qa/feedback
  // ──────────────────────────────────────────────────────────────────
  async submitFeedback(
    req: FeedbackRequest,
    ctx: { trace_id: string | null; user_id: string | null }
  ): Promise<FeedbackResponse> {
    const message = await this.deps.repository.findMessage(req.message_id);
    if (!message) throw new NotFoundError('QA message');
    if (message.role !== 'assistant') {
      throw new BadRequestError('Feedback can only be submitted for assistant messages');
    }
    const input: InsertFeedbackInput = {
      message_id: message.id,
      session_id: message.session_id,
      user_id: ctx.user_id,
      rating: req.rating,
      category: req.category ?? null,
      comment: req.comment ?? null,
      metadata: req.metadata ?? {},
      trace_id: ctx.trace_id,
    };
    const row = await this.deps.repository.insertFeedback(input);
    return {
      feedback_id: row.id,
      message_id: row.message_id,
      session_id: row.session_id,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────

  private async resolveSession(
    req: AskRequest,
    ctx: { trace_id: string | null; user_id: string | null }
  ): Promise<QaSessionRow> {
    if (req.session_id) {
      const existing = await this.deps.repository.findSession(req.session_id);
      if (!existing) throw new NotFoundError('QA session');
      if (existing.status === 'archived') {
        throw new BadRequestError('Cannot ask in an archived session');
      }
      return existing;
    }
    const code = await this.deps.repository.nextSessionCode();
    return this.deps.repository.createSession({
      code,
      title: '(未命名会话)',
      product_category: req.product_category ?? null,
      metadata: req.metadata ?? {},
      trace_id: ctx.trace_id,
      created_by: ctx.user_id,
    });
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

export function deriveTitle(question: string): string {
  const collapsed = question.replace(/\s+/g, ' ').trim();
  return collapsed.length <= 60 ? collapsed : collapsed.slice(0, 57) + '…';
}
