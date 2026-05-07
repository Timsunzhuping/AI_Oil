/**
 * Answer composer.
 *
 *   • Calls the LLM adapter with the retrieved citations
 *   • Drops any citation IDs the adapter pretends to know about but the
 *     retriever never returned (defensive cleansing)
 *   • Aggregates a final confidence score from retrieval + adapter signals
 *   • Hard-fails to a "no source" template when retrieval returns nothing
 *
 * Output shape mirrors `qa_messages` (role='assistant') so the service can
 * persist it directly.
 */
import type { LlmAdapter } from '../adapters/llm/index.js';
import { aggregateConfidence } from '../adapters/llm/mock.js';
import type { Citation, Intent, RetrievalHit } from '../types.js';

export interface ComposerDeps {
  llm: LlmAdapter;
}

export interface ComposeInput {
  question: string;
  intent: Intent;
  intent_confidence: number;
  hits: RetrievalHit[];
  product_category?: string;
  /** Cap on returned citations (default 5). */
  max_citations?: number;
}

export interface ComposeOutput {
  answer: string;
  citations: Citation[];
  confidence: number;
  /** True when the answer was the explicit no-source fallback. */
  no_source_fallback: boolean;
  llm_adapter: string;
  llm_version: string;
  llm_response_meta: Record<string, unknown>;
}

export class AnswerComposer {
  constructor(private readonly deps: ComposerDeps) {}

  async compose(input: ComposeInput): Promise<ComposeOutput> {
    const cap = Math.max(1, Math.min(input.max_citations ?? 5, 20));
    const trimmedHits = [...input.hits].sort((a, b) => b.relevance - a.relevance).slice(0, cap);

    const citations: Citation[] = trimmedHits.map((h) => ({
      source_type: h.source_type,
      source_id: h.source_id,
      title: h.title,
      snippet: h.snippet,
      relevance: round3(h.relevance),
      ...(h.url !== undefined ? { url: h.url } : {}),
    }));

    const identity = this.deps.llm.identity();

    if (citations.length === 0) {
      return {
        answer:
          '抱歉，我们未在原材料 / 配方知识库或已审核文档中检索到能支持此问题的来源，' +
          '为避免无依据回答，本次不提供答案。建议先补充相关资料或调整问题措辞后再试。',
        citations: [],
        confidence: 0,
        no_source_fallback: true,
        llm_adapter: identity.name,
        llm_version: identity.version,
        llm_response_meta: { reason: 'no_citations' },
      };
    }

    const out = await this.deps.llm.compose({
      question: input.question,
      intent: input.intent,
      citations,
      ...(input.product_category !== undefined ? { product_category: input.product_category } : {}),
    });

    // Combine: 60 % retrieval-derived confidence + 40 % adapter confidence.
    const retrievalConfidence = aggregateConfidence(citations);
    const combined = clamp01(retrievalConfidence * 0.6 + out.confidence * 0.4);

    return {
      answer: out.answer,
      citations,
      confidence: round3(combined * blend(input.intent_confidence)),
      no_source_fallback: false,
      llm_adapter: identity.name,
      llm_version: identity.version,
      llm_response_meta: out.meta ?? {},
    };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Map intent_confidence ∈ [0, 1] to a multiplier in [0.85, 1.0]. We keep a
 * floor at 0.85 because the intent is only a routing hint — a confident
 * retriever should not be punished too harshly when the classifier wasn't sure.
 */
function blend(intentConfidence: number): number {
  return 0.85 + 0.15 * clamp01(intentConfidence);
}
