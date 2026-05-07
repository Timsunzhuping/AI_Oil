/**
 * Persistence layer for the QA module.
 *
 * Three tables:
 *   qa_sessions   — conversation envelope
 *   qa_messages   — user + assistant rows; assistant rows carry citations + LLM identity
 *   qa_feedback   — per-message ratings
 */
import type { Pool, PoolClient } from 'pg';
import type {
  Citation,
  FeedbackRating,
  Intent,
  QaFeedbackRow,
  QaMessageRow,
  QaRole,
  QaSessionRow,
  QaSessionStatus,
  RetrievalSummary,
} from './types.js';

export interface InsertSessionInput {
  code: string;
  title: string;
  product_category: string | null;
  metadata: Record<string, unknown>;
  trace_id: string | null;
  created_by: string | null;
}

export interface InsertMessageInput {
  session_id: string;
  role: QaRole;
  parent_message_id: string | null;
  question: string | null;
  answer: string | null;
  intent: Intent | null;
  intent_confidence: number | null;
  confidence: number | null;
  citations: Citation[];
  retrieval_summary: RetrievalSummary | null;
  llm_adapter: string | null;
  llm_version: string | null;
  llm_request: Record<string, unknown> | null;
  llm_response_meta: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  trace_id: string | null;
  duration_ms: number;
  created_by: string | null;
}

export interface InsertFeedbackInput {
  message_id: string;
  session_id: string;
  user_id: string | null;
  rating: FeedbackRating;
  category: string | null;
  comment: string | null;
  metadata: Record<string, unknown>;
  trace_id: string | null;
}

export class QaRepository {
  constructor(private readonly pool: Pool) {}

  // ── code generator (QA-YYYY-NNNNNN) ──────────────────────────
  async nextSessionCode(): Promise<string> {
    const year = new Date().getFullYear();
    const res = await this.pool.query<{ code: string }>(
      `SELECT code FROM qa_sessions WHERE code LIKE $1 ORDER BY code DESC LIMIT 1`,
      [`QA-${year}-%`]
    );
    let n = 1;
    if (res.rows[0]?.code) {
      const m = /^QA-\d{4}-(\d+)$/.exec(res.rows[0].code);
      if (m) n = Number(m[1]) + 1;
    }
    return `QA-${year}-${String(n).padStart(6, '0')}`;
  }

  // ── sessions ─────────────────────────────────────────────────
  async createSession(input: InsertSessionInput): Promise<QaSessionRow> {
    const res = await this.pool.query<RawSession>(
      `INSERT INTO qa_sessions (
         code, title, product_category, metadata, trace_id, created_by, status
       )
       VALUES ($1,$2,$3,$4,$5,$6,'active')
       RETURNING *`,
      [
        input.code,
        input.title,
        input.product_category,
        JSON.stringify(input.metadata),
        input.trace_id,
        input.created_by,
      ]
    );
    return mapSession(res.rows[0]!);
  }

  async findSession(id: string): Promise<QaSessionRow | null> {
    const res = await this.pool.query<RawSession>(`SELECT * FROM qa_sessions WHERE id = $1`, [id]);
    return res.rows[0] ? mapSession(res.rows[0]) : null;
  }

  async setSessionTitleIfDefault(id: string, title: string): Promise<void> {
    await this.pool.query(
      `UPDATE qa_sessions SET title = $2
         WHERE id = $1 AND (title = '(未命名会话)' OR title = '' OR title IS NULL)`,
      [id, title.slice(0, 120)]
    );
  }

  async updateSessionStatus(id: string, status: QaSessionStatus): Promise<QaSessionRow | null> {
    const res = await this.pool.query<RawSession>(
      `UPDATE qa_sessions SET status = $2 WHERE id = $1 RETURNING *`,
      [id, status]
    );
    return res.rows[0] ? mapSession(res.rows[0]) : null;
  }

  /** Bumps message_count and last_message_at after a successful turn. */
  async bumpSessionStats(id: string, increment: number): Promise<void> {
    await this.pool.query(
      `UPDATE qa_sessions
          SET message_count = message_count + $2,
              last_message_at = NOW()
        WHERE id = $1`,
      [id, increment]
    );
  }

  // ── messages ─────────────────────────────────────────────────
  async insertMessage(input: InsertMessageInput): Promise<QaMessageRow> {
    return this.runInsertMessage(this.pool, input);
  }

  /** Insert user + assistant in a single transaction so they share a logical turn. */
  async insertTurn(
    userInput: InsertMessageInput,
    assistantInput: InsertMessageInput
  ): Promise<{ user: QaMessageRow; assistant: QaMessageRow }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const user = await this.runInsertMessage(client, userInput);
      const assistant = await this.runInsertMessage(client, {
        ...assistantInput,
        parent_message_id: user.id,
      });
      await client.query(
        `UPDATE qa_sessions
            SET message_count = message_count + 2,
                last_message_at = NOW()
          WHERE id = $1`,
        [user.session_id]
      );
      await client.query('COMMIT');
      return { user, assistant };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async findMessage(id: string): Promise<QaMessageRow | null> {
    const res = await this.pool.query<RawMessage>(`SELECT * FROM qa_messages WHERE id = $1`, [id]);
    return res.rows[0] ? mapMessage(res.rows[0]) : null;
  }

  async listMessages(sessionId: string): Promise<QaMessageRow[]> {
    const res = await this.pool.query<RawMessage>(
      `SELECT * FROM qa_messages WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId]
    );
    return res.rows.map(mapMessage);
  }

  // ── feedback ─────────────────────────────────────────────────
  async insertFeedback(input: InsertFeedbackInput): Promise<QaFeedbackRow> {
    const res = await this.pool.query<RawFeedback>(
      `INSERT INTO qa_feedback (
         message_id, session_id, user_id, rating, category, comment, metadata, trace_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        input.message_id,
        input.session_id,
        input.user_id,
        input.rating,
        input.category,
        input.comment,
        JSON.stringify(input.metadata),
        input.trace_id,
      ]
    );
    return mapFeedback(res.rows[0]!);
  }

  // ──────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────
  private async runInsertMessage(
    runner: Pool | PoolClient,
    input: InsertMessageInput
  ): Promise<QaMessageRow> {
    const res = await runner.query<RawMessage>(
      `INSERT INTO qa_messages (
         session_id, role, parent_message_id,
         question, answer, intent, intent_confidence, confidence,
         citations, retrieval_summary,
         llm_adapter, llm_version, llm_request, llm_response_meta,
         metadata, trace_id, duration_ms, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        input.session_id,
        input.role,
        input.parent_message_id,
        input.question,
        input.answer,
        input.intent,
        input.intent_confidence,
        input.confidence,
        JSON.stringify(input.citations),
        input.retrieval_summary === null ? null : JSON.stringify(input.retrieval_summary),
        input.llm_adapter,
        input.llm_version,
        input.llm_request === null ? null : JSON.stringify(input.llm_request),
        input.llm_response_meta === null ? null : JSON.stringify(input.llm_response_meta),
        JSON.stringify(input.metadata),
        input.trace_id,
        input.duration_ms,
        input.created_by,
      ]
    );
    return mapMessage(res.rows[0]!);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Row mapping
// ─────────────────────────────────────────────────────────────────────────────

interface RawSession {
  id: string;
  code: string;
  title: string;
  product_category: string | null;
  status: QaSessionStatus;
  message_count: number;
  last_message_at: Date | null;
  metadata: Record<string, unknown>;
  trace_id: string | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  version: number;
}

interface RawMessage {
  id: string;
  session_id: string;
  role: QaRole;
  parent_message_id: string | null;
  question: string | null;
  answer: string | null;
  intent: Intent | null;
  intent_confidence: string | number | null;
  confidence: string | number | null;
  citations: Citation[];
  retrieval_summary: RetrievalSummary | null;
  llm_adapter: string | null;
  llm_version: string | null;
  llm_request: Record<string, unknown> | null;
  llm_response_meta: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  trace_id: string | null;
  duration_ms: number;
  created_at: Date;
  created_by: string | null;
}

interface RawFeedback {
  id: string;
  message_id: string;
  session_id: string;
  user_id: string | null;
  rating: number;
  category: string | null;
  comment: string | null;
  metadata: Record<string, unknown>;
  trace_id: string | null;
  created_at: Date;
}

function num(n: string | number | null | undefined): number | null {
  if (n === null || n === undefined) return null;
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v : null;
}

function mapSession(r: RawSession): QaSessionRow {
  return {
    id: r.id,
    code: r.code,
    title: r.title,
    product_category: r.product_category,
    status: r.status,
    message_count: r.message_count,
    last_message_at: r.last_message_at ? r.last_message_at.toISOString() : null,
    metadata: r.metadata ?? {},
    trace_id: r.trace_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    created_by: r.created_by,
    version: r.version,
  };
}

function mapMessage(r: RawMessage): QaMessageRow {
  return {
    id: r.id,
    session_id: r.session_id,
    role: r.role,
    parent_message_id: r.parent_message_id,
    question: r.question,
    answer: r.answer,
    intent: r.intent,
    intent_confidence: num(r.intent_confidence),
    confidence: num(r.confidence),
    citations: r.citations ?? [],
    retrieval_summary: r.retrieval_summary,
    llm_adapter: r.llm_adapter,
    llm_version: r.llm_version,
    llm_request: r.llm_request,
    llm_response_meta: r.llm_response_meta,
    metadata: r.metadata ?? {},
    trace_id: r.trace_id,
    duration_ms: r.duration_ms,
    created_at: r.created_at.toISOString(),
    created_by: r.created_by,
  };
}

function mapFeedback(r: RawFeedback): QaFeedbackRow {
  return {
    id: r.id,
    message_id: r.message_id,
    session_id: r.session_id,
    user_id: r.user_id,
    rating: r.rating as FeedbackRating,
    category: r.category,
    comment: r.comment,
    metadata: r.metadata ?? {},
    trace_id: r.trace_id,
    created_at: r.created_at.toISOString(),
  };
}
