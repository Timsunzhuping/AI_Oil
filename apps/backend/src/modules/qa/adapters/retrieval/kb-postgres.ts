/**
 * Postgres-backed retriever.
 *
 * Searches three knowledge sources with simple ILIKE matching + relevance
 * scoring. This is intentionally light: any future swap to pg_trgm /
 * pg_search / pgvector / Elastic / Pinecone is a one-class change behind
 * the `RetrieverAdapter` interface.
 *
 * Relevance scoring:
 *   • 1.0  exact whole-token match in title
 *   • 0.7  any token match in title
 *   • 0.5  any token match in summary / answer text
 *   • 0.4  full-text ILIKE
 *   • 0.2  category / keyword match only
 *
 * Final score is the weighted max + a small bonus for source-type alignment
 * with the requested intent (e.g. raw_material_lookup boosts raw_material_kb).
 */
import type { Pool } from 'pg';
import type { CitationSourceType, Intent, RetrievalHit } from '../../types.js';
import type { RetrieveQuery, RetrieverAdapter } from './types.js';

export interface KbPostgresRetrieverOptions {
  /** Override the per-source per-query LIMIT (default 8). */
  perSourceLimit?: number;
}

export class KbPostgresRetriever implements RetrieverAdapter {
  private readonly perSourceLimit: number;

  constructor(
    private readonly pool: Pool,
    opts: KbPostgresRetrieverOptions = {}
  ) {
    this.perSourceLimit = opts.perSourceLimit ?? 8;
  }

  supportedSources(): CitationSourceType[] {
    return ['raw_material_kb', 'formula_kb', 'parse_result'];
  }

  async retrieve(query: RetrieveQuery): Promise<RetrievalHit[]> {
    const tokens = tokenise(query.question);
    if (tokens.length === 0) return [];
    const sources = (query.source_types ?? this.supportedSources()).filter((s) =>
      this.supportedSources().includes(s)
    );
    const hits: RetrievalHit[] = [];

    if (sources.includes('raw_material_kb')) {
      hits.push(...(await this.searchRawMaterialKb(tokens, query)));
    }
    if (sources.includes('formula_kb')) {
      hits.push(...(await this.searchFormulaKb(tokens, query)));
    }
    if (sources.includes('parse_result')) {
      hits.push(...(await this.searchParseResults(tokens, query)));
    }

    return rankAndCap(hits, query.intent, query.limit ?? 5);
  }

  // ── per-source queries ──────────────────────────────────────────

  private async searchRawMaterialKb(tokens: string[], q: RetrieveQuery): Promise<RetrievalHit[]> {
    const conditions = tokens.map(
      (_, i) =>
        `(name ILIKE $${i + 1} OR coalesce(summary,'') ILIKE $${i + 1} OR coalesce(category,'') ILIKE $${i + 1} OR coalesce(technical_notes,'') ILIKE $${i + 1})`
    );
    const params = tokens.map((t) => `%${t}%`);
    const res = await this.pool.query<{
      id: string;
      code: string;
      name: string;
      summary: string | null;
      technical_notes: string | null;
      category: string | null;
      properties: Record<string, unknown>;
    }>(
      `SELECT id, code, name, summary, technical_notes, category, properties
         FROM raw_material_kb
        WHERE deleted_at IS NULL AND status <> 'archived'
          AND (${conditions.join(' OR ')})
        LIMIT ${this.perSourceLimit}`,
      params
    );
    return res.rows.map((r) => {
      const text = `${r.name}\n${r.summary ?? ''}\n${r.technical_notes ?? ''}`.trim();
      return {
        source_type: 'raw_material_kb' as const,
        source_id: r.id,
        title: `${r.name} (${r.code})`,
        snippet: snippet(text, tokens),
        relevance: scoreCandidate(tokens, r.name, r.summary ?? '', r.category ?? '', q),
        structured: { properties: r.properties },
      };
    });
  }

  private async searchFormulaKb(tokens: string[], q: RetrieveQuery): Promise<RetrievalHit[]> {
    const conditions = tokens.map(
      (_, i) =>
        `(title ILIKE $${i + 1} OR coalesce(summary,'') ILIKE $${i + 1} OR coalesce(product_category,'') ILIKE $${i + 1} OR coalesce(performance_highlights,'') ILIKE $${i + 1})`
    );
    const params = tokens.map((t) => `%${t}%`);
    const res = await this.pool.query<{
      id: string;
      code: string;
      title: string;
      summary: string | null;
      product_category: string | null;
      performance_highlights: string | null;
      sample_bom: Array<Record<string, unknown>>;
      target_metrics: Array<Record<string, unknown>>;
    }>(
      `SELECT id, code, title, summary, product_category, performance_highlights, sample_bom, target_metrics
         FROM formula_kb
        WHERE deleted_at IS NULL AND status <> 'archived'
          AND (${conditions.join(' OR ')})
        LIMIT ${this.perSourceLimit}`,
      params
    );
    return res.rows.map((r) => {
      const text = `${r.title}\n${r.summary ?? ''}\n${r.performance_highlights ?? ''}`.trim();
      return {
        source_type: 'formula_kb' as const,
        source_id: r.id,
        title: `${r.title} (${r.code})`,
        snippet: snippet(text, tokens),
        relevance: scoreCandidate(tokens, r.title, r.summary ?? '', r.product_category ?? '', q),
        structured: { sample_bom: r.sample_bom, target_metrics: r.target_metrics },
      };
    });
  }

  private async searchParseResults(tokens: string[], q: RetrieveQuery): Promise<RetrievalHit[]> {
    const conditions = tokens.map((_, i) => `coalesce(r.raw_text,'') ILIKE $${i + 1}`);
    const params = tokens.map((t) => `%${t}%`);
    const res = await this.pool.query<{
      id: string;
      raw_text: string | null;
      document_id: string;
      doc_code: string;
      doc_title: string;
    }>(
      `SELECT r.id, r.raw_text, r.document_id, d.code AS doc_code, d.title AS doc_title
         FROM document_parse_results r
         JOIN document_records d ON d.id = r.document_id AND d.deleted_at IS NULL
        WHERE r.is_current = TRUE
          AND r.review_status IN ('approved','edited')
          AND (${conditions.join(' OR ')})
        ORDER BY r.confidence DESC NULLS LAST
        LIMIT ${this.perSourceLimit}`,
      params
    );
    return res.rows.map((r) => ({
      source_type: 'parse_result' as const,
      source_id: r.id,
      title: `${r.doc_title} (${r.doc_code})`,
      snippet: snippet(r.raw_text ?? '', tokens),
      relevance: scoreCandidate(tokens, r.doc_title, r.raw_text ?? '', '', q, /* docMatch */ true),
    }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (pure — exported for tests via `index.ts`)
// ─────────────────────────────────────────────────────────────────────────────

/** Lower-case word/code tokeniser; keeps Chinese characters untouched. */
export function tokenise(question: string): string[] {
  const cleaned = question
    .toLowerCase()
    .replace(/[、，。？！,.?!；;:：]+/g, ' ')
    .trim();
  if (!cleaned) return [];
  // Split on whitespace and on transitions between latin and Chinese.
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    // Yank out Chinese runs and ASCII tokens separately.
    const matches = p.match(/[一-鿿]+|[a-z0-9._-]+/g);
    if (matches) out.push(...matches);
  }
  return [...new Set(out)].filter((t) => t.length >= 2 || /[一-鿿]/.test(t));
}

export function scoreCandidate(
  tokens: string[],
  title: string,
  body: string,
  meta: string,
  query: { intent: Intent; product_category?: string },
  docMatch = false
): number {
  const t = title.toLowerCase();
  const b = body.toLowerCase();
  const m = meta.toLowerCase();
  let best = 0;
  for (const tok of tokens) {
    if (!tok) continue;
    if (new RegExp(`\\b${escapeRe(tok)}\\b`, 'i').test(t)) best = Math.max(best, 1.0);
    else if (t.includes(tok)) best = Math.max(best, 0.7);
    else if (b.includes(tok)) best = Math.max(best, 0.5);
    else if (docMatch && b.length > 0) best = Math.max(best, 0.4);
    else if (m.includes(tok)) best = Math.max(best, 0.2);
  }
  if (query.product_category && m.includes(query.product_category.toLowerCase())) best += 0.05;
  return Math.max(0, Math.min(1, best));
}

export function snippet(text: string, tokens: string[], window = 80): string {
  if (!text) return '';
  const lower = text.toLowerCase();
  for (const tok of tokens) {
    const i = lower.indexOf(tok);
    if (i >= 0) {
      const start = Math.max(0, i - Math.floor(window / 2));
      const slice = text.slice(start, start + window).trim();
      return (start > 0 ? '…' : '') + slice + (start + window < text.length ? '…' : '');
    }
  }
  return text.slice(0, window).trim() + (text.length > window ? '…' : '');
}

const SOURCE_BOOSTS: Record<Intent, Partial<Record<CitationSourceType, number>>> = {
  raw_material_lookup: { raw_material_kb: 0.1, parse_result: 0.05 },
  formula_history: { formula_kb: 0.1 },
  regulation: { parse_result: 0.05, raw_material_kb: 0.05 },
  process: { formula_kb: 0.05, parse_result: 0.05 },
  general: {},
  no_match: {},
};

export function rankAndCap(hits: RetrievalHit[], intent: Intent, cap: number): RetrievalHit[] {
  const boosts = SOURCE_BOOSTS[intent] ?? {};
  for (const h of hits) {
    h.relevance = Math.max(0, Math.min(1, h.relevance + (boosts[h.source_type] ?? 0)));
  }
  return [...hits]
    .filter((h) => h.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, cap);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
