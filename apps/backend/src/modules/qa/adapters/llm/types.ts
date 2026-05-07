/**
 * LLM adapter contract.
 *
 * The composer asks the adapter to produce an answer given a question and a
 * set of citations. Concrete implementations may:
 *   • Render a deterministic template (`MockLlmAdapter`)
 *   • Call OpenAI / Anthropic / Qwen / DeepSeek / Doubao
 *   • Call a self-hosted vLLM endpoint
 *
 * Critical: the adapter MUST cite at most the citations it was given. The
 * composer enforces this by post-processing — adapters are expected to be
 * cooperative, and any unknown citation IDs are dropped before persistence.
 */
import type { Citation, Intent } from '../../types.js';

export interface LlmAdapterIdentity {
  /** Stable name used in qa_messages.llm_adapter (e.g. 'mock-rules', 'openai'). */
  name: string;
  /** Stable version (e.g. 'v1', 'gpt-4o-2024-08-06'). */
  version: string;
}

export interface LlmComposeInput {
  question: string;
  intent: Intent;
  citations: Citation[];
  product_category?: string;
}

export interface LlmComposeOutput {
  answer: string;
  /** 0..1 — adapter's own confidence; composer combines with retrieval score. */
  confidence: number;
  /** Optional usage / latency metadata persisted with qa_messages.llm_response_meta. */
  meta?: Record<string, unknown>;
}

export interface LlmAdapter {
  identity(): LlmAdapterIdentity;
  compose(input: LlmComposeInput): Promise<LlmComposeOutput>;
}
