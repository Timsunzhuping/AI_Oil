/**
 * QA pipeline orchestrator.
 *
 *   classifier → retriever → composer
 *
 * Each stage is interchangeable. Production wiring lives in
 * `module/index.ts → buildQaModule()`.
 */
import type { LlmAdapter } from '../adapters/llm/index.js';
import type { RetrieverAdapter } from '../adapters/retrieval/index.js';
import type { Intent, RetrievalHit, RetrievalSummary } from '../types.js';
import { AnswerComposer, type ComposeOutput } from './composer.js';
import { RuleBasedClassifier, type IntentClassifier } from './classifier.js';

export interface QaPipelineDeps {
  classifier?: IntentClassifier;
  retriever: RetrieverAdapter;
  llm: LlmAdapter;
}

export interface PipelineRunInput {
  question: string;
  product_category?: string;
  max_citations?: number;
}

export interface PipelineRunOutput extends ComposeOutput {
  intent: Intent;
  intent_confidence: number;
  retrieval_summary: RetrievalSummary;
}

export class QaPipeline {
  readonly classifier: IntentClassifier;
  readonly retriever: RetrieverAdapter;
  readonly composer: AnswerComposer;

  constructor(deps: QaPipelineDeps) {
    this.classifier = deps.classifier ?? new RuleBasedClassifier();
    this.retriever = deps.retriever;
    this.composer = new AnswerComposer({ llm: deps.llm });
  }

  async run(input: PipelineRunInput): Promise<PipelineRunOutput> {
    const intentResult = this.classifier.classify(input.question, {
      ...(input.product_category !== undefined ? { product_category: input.product_category } : {}),
    });

    let hits: RetrievalHit[] = [];
    let usedFallback = false;
    try {
      hits = await this.retriever.retrieve({
        question: input.question,
        intent: intentResult.intent,
        ...(input.product_category !== undefined
          ? { product_category: input.product_category }
          : {}),
        ...(input.max_citations !== undefined ? { limit: input.max_citations } : {}),
      });
    } catch (err) {
      // Retriever failure is treated as "no hits" — the composer will emit
      // the no-source fallback. Caller still gets a clean response, and the
      // exception is signalled via metadata for ops to inspect.
      hits = [];
      usedFallback = true;
      void err;
    }

    const composed = await this.composer.compose({
      question: input.question,
      intent: intentResult.intent,
      intent_confidence: intentResult.confidence,
      hits,
      ...(input.product_category !== undefined ? { product_category: input.product_category } : {}),
      ...(input.max_citations !== undefined ? { max_citations: input.max_citations } : {}),
    });

    const retrieval_summary: RetrievalSummary = {
      hits: hits.length,
      sources_searched: this.retriever.supportedSources(),
      ...(usedFallback ? { used_fallback: true } : {}),
      metadata: {
        matched_rules: intentResult.matched_rules,
      },
    };

    const intent: Intent = composed.no_source_fallback ? 'no_match' : intentResult.intent;

    return {
      ...composed,
      intent,
      intent_confidence: intentResult.confidence,
      retrieval_summary,
    };
  }
}

export { RuleBasedClassifier, type IntentClassifier } from './classifier.js';
export { AnswerComposer } from './composer.js';
