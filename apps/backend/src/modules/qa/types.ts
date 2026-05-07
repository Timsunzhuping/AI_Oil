/**
 * QA Assistant — shared types.
 *
 * The pipeline is:
 *   classifier(question) → intent
 *   retriever(question, intent, product_category) → hits[]
 *   composer(question, intent, hits) → { answer, confidence, citations[] }
 *
 * Hard rule (enforced in service): every assistant message MUST have at least
 * one citation. When the retriever returns nothing, the composer emits a
 * `no_match` fallback whose `citations` is empty by design — but the service
 * surfaces that as a CLEAR "we couldn't answer this without sources" message,
 * never a hallucinated free-form answer.
 */

// ─── Intents ────────────────────────────────────────────────────────────────
export const INTENT_NAMES = [
  'raw_material_lookup',
  'formula_history',
  'regulation',
  'process',
  'general',
  'no_match',
] as const;
export type Intent = (typeof INTENT_NAMES)[number];

// ─── Citations & retrieval ──────────────────────────────────────────────────
export const CITATION_SOURCE_TYPES = [
  'raw_material_kb',
  'formula_kb',
  'document',
  'parse_result',
  'rule',
  'experiment',
  'external',
] as const;
export type CitationSourceType = (typeof CITATION_SOURCE_TYPES)[number];

export interface Citation {
  source_type: CitationSourceType;
  source_id: string; // UUID or stable identifier
  title: string;
  snippet: string;
  /** 0..1 — relevance score returned by retriever. */
  relevance: number;
  /** Optional canonical reference URL (e.g. document URL). */
  url?: string | null;
}

export interface RetrievalHit extends Citation {
  /** Optional structured payload kept for the composer (not surfaced to client). */
  structured?: Record<string, unknown>;
}

export interface RetrievalSummary {
  hits: number;
  sources_searched: CitationSourceType[];
  /** Whether the retriever fell back to a generic search across all sources. */
  used_fallback?: boolean;
  /** Free-form metadata (latency, fts vs ilike, …). */
  metadata?: Record<string, unknown>;
}

// ─── Sessions / messages / feedback ─────────────────────────────────────────
export const QA_SESSION_STATUSES = ['active', 'archived'] as const;
export type QaSessionStatus = (typeof QA_SESSION_STATUSES)[number];

export const QA_ROLES = ['user', 'assistant', 'system'] as const;
export type QaRole = (typeof QA_ROLES)[number];

export const FEEDBACK_RATINGS = [-1, 0, 1] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

export interface QaSessionRow {
  id: string;
  code: string;
  title: string;
  product_category: string | null;
  status: QaSessionStatus;
  message_count: number;
  last_message_at: string | null;
  metadata: Record<string, unknown>;
  trace_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  version: number;
}

export interface QaMessageRow {
  id: string;
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
  created_at: string;
  created_by: string | null;
}

export interface QaFeedbackRow {
  id: string;
  message_id: string;
  session_id: string;
  user_id: string | null;
  rating: FeedbackRating;
  category: string | null;
  comment: string | null;
  metadata: Record<string, unknown>;
  trace_id: string | null;
  created_at: string;
}

// ─── DTOs ───────────────────────────────────────────────────────────────────

export interface AskRequest {
  question: string;
  product_category?: string;
  session_id?: string;
  /** Cap returned citations (default 5, max 20). */
  max_citations?: number;
  metadata?: Record<string, unknown>;
}

export interface AskResponse {
  session_id: string;
  message_id: string;
  /** Echoed back so clients can show the persisted version of their input. */
  user_message_id: string;
  answer: string;
  citations: Citation[];
  confidence: number;
  intent: Intent;
  intent_confidence: number;
  llm_adapter: string;
  llm_version: string;
  trace_id: string | null;
  duration_ms: number;
  /** True when the answer was suppressed for lack of sources. */
  no_source_fallback: boolean;
}

export interface HistoryResponse {
  session: QaSessionRow;
  messages: QaMessageRow[];
}

export interface FeedbackRequest {
  message_id: string;
  rating: FeedbackRating;
  category?: string;
  comment?: string;
  metadata?: Record<string, unknown>;
}

export interface FeedbackResponse {
  feedback_id: string;
  message_id: string;
  session_id: string;
}
