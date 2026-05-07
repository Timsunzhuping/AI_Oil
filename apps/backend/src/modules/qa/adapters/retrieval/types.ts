/**
 * Retriever adapter contract.
 *
 * Implementations look up relevant passages across knowledge sources:
 *   • raw_material_kb
 *   • formula_kb
 *   • document_parse_results (the latest is_current=true result for each doc)
 *   • (future) knowledge_rules, experiments, embeddings, etc.
 *
 * Returning `[]` is fine — the QA pipeline interprets that as "no source"
 * and produces the explicit fallback answer instead of hallucinating.
 */
import type { CitationSourceType, Intent, RetrievalHit } from '../../types.js';

export interface RetrieveQuery {
  question: string;
  intent: Intent;
  product_category?: string;
  /** Cap returned hits (default 5). */
  limit?: number;
  /** Restrict the search to these source types. */
  source_types?: CitationSourceType[];
}

export interface RetrieverAdapter {
  /** Look up at most `limit` hits, ranked by relevance descending. */
  retrieve(query: RetrieveQuery): Promise<RetrievalHit[]>;
  /** Names of sources this retriever knows how to search. */
  supportedSources(): CitationSourceType[];
}
