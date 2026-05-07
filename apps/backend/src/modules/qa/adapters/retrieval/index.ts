/**
 * Retriever factory.
 *
 *   buildRetriever(pool)   → KbPostgresRetriever
 *   buildRetriever({ adapter: ... }) → custom adapter
 *
 * The default adapter searches `raw_material_kb`, `formula_kb`, and
 * `document_parse_results`. To add a knowledge-graph or vector retriever,
 * implement `RetrieverAdapter` and pass it via `adapter`.
 */
import type { Pool } from 'pg';
import { KbPostgresRetriever, type KbPostgresRetrieverOptions } from './kb-postgres.js';
import type { RetrieverAdapter } from './types.js';

export interface BuildRetrieverOptions extends KbPostgresRetrieverOptions {
  adapter?: RetrieverAdapter;
}

export function buildRetriever(
  pool: Pool | null,
  opts: BuildRetrieverOptions = {}
): RetrieverAdapter {
  if (opts.adapter) return opts.adapter;
  if (!pool) {
    return new EmptyRetriever();
  }
  return new KbPostgresRetriever(pool, opts);
}

/** Returns no hits — useful when no DB is available (smoke tests). */
export class EmptyRetriever implements RetrieverAdapter {
  async retrieve() {
    return [];
  }
  supportedSources() {
    return [] as never[];
  }
}

export {
  KbPostgresRetriever,
  tokenise,
  scoreCandidate,
  snippet,
  rankAndCap,
} from './kb-postgres.js';
export type { RetrieverAdapter, RetrieveQuery } from './types.js';
