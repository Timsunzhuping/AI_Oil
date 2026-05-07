/**
 * Mock OCR / parser adapter.
 *
 * Generates deterministic synthetic content from the input bytes so tests
 * and demo flows behave reproducibly:
 *   • raw_text: header + filename + a few synthetic lines tied to the SHA-256
 *   • structured_payload: shape inferred from mime + filename hints (datasheet
 *     → properties, formula card → composition, test report → metric rows)
 *   • extracted_fields: shallow key-value summary
 *   • confidence: in [0.65, 0.95] derived from the same hash
 *
 * Because everything is hash-based, identical bytes always yield identical
 * extraction output — perfect for snapshot-style tests.
 */
import { createHash } from 'node:crypto';
import { ACCEPTED_MIME_TYPES, extensionFor } from '../../types.js';
import type { ParserAdapter, ParserInput, ParserOutput } from './types.js';
import type { ParseTaskRow } from '../../types.js';

export interface MockOcrAdapterOptions {
  parserName?: string;
  parserVersion?: string;
}

export class MockOcrAdapter implements ParserAdapter {
  private readonly parserName: string;
  private readonly parserVersion: string;

  constructor(opts: MockOcrAdapterOptions = {}) {
    this.parserName = opts.parserName ?? 'mock-doc-parser';
    this.parserVersion = opts.parserVersion ?? 'mock-v1';
  }

  supports(mime: string): boolean {
    return (ACCEPTED_MIME_TYPES as readonly string[]).includes(mime);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async parse(input: ParserInput, _task: ParseTaskRow): Promise<ParserOutput> {
    const ext = extensionFor(input.mimeType);
    const seed = createHash('sha256').update(input.body).digest('hex');
    const synth = synthesise(seed, input.originalName, input.mimeType);

    const docKind = inferDocKind(input.originalName, input.mimeType);
    const structured =
      docKind === 'datasheet'
        ? buildDatasheet(synth)
        : docKind === 'formula_card'
          ? buildFormulaCard(synth)
          : docKind === 'test_report'
            ? buildTestReport(synth)
            : buildGeneric(synth);

    const extracted_fields = flatten(structured);
    const raw_text = synth.body;
    const confidence = scaleConfidence(synth.scalar);
    const page_count = Math.max(1, Math.min(20, Math.floor(input.body.byteLength / 8192) + 1));

    return {
      raw_text,
      structured_payload: structured,
      extracted_fields,
      page_snippets: synth.pages,
      confidence,
      language: synth.language,
      page_count,
      search_keywords: synth.keywords,
      origin: 'ocr',
      parser_name: this.parserName,
      parser_version: this.parserVersion,
      ...({ ext } as never), // keep type-checked while signalling extension to debugger
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthesis helpers (pure)
// ─────────────────────────────────────────────────────────────────────────────

interface Synth {
  scalar: number; // [0, 1) derived from sha256
  language: string;
  body: string;
  pages: Array<{ page: number; text: string; confidence: number }>;
  keywords: string[];
  digits: number[];
}

function synthesise(seed: string, originalName: string, mime: string): Synth {
  const scalar = parseInt(seed.slice(0, 8), 16) / 0xffffffff;
  const language = scalar < 0.5 ? 'zh-CN' : 'en-US';
  const digits: number[] = Array.from({ length: 8 }, (_, i) =>
    parseInt(seed.slice(8 + i * 4, 12 + i * 4), 16)
  );
  const lines = [
    `# ${originalName}`,
    `Mime: ${mime}`,
    `Language detected: ${language}`,
    `Sample property A: ${((digits[0] ?? 0) % 1000) / 10}`,
    `Sample property B: ${(digits[1] ?? 0) % 200}`,
    `Reference: ${seed.slice(0, 12)}`,
  ];
  const body = lines.join('\n');
  const pages = [
    { page: 1, text: lines.slice(0, 3).join('\n'), confidence: scaleConfidence(scalar) },
    { page: 2, text: lines.slice(3).join('\n'), confidence: scaleConfidence((scalar + 0.13) % 1) },
  ];
  const keywords = uniqueLowercase(originalName)
    .split(/[^A-Za-z0-9一-鿿]+/)
    .filter((s) => s.length >= 3)
    .slice(0, 8);
  return { scalar, language, body, pages, keywords, digits };
}

function inferDocKind(
  originalName: string,
  mime: string
): 'datasheet' | 'formula_card' | 'test_report' | 'generic' {
  const lower = originalName.toLowerCase();
  if (mime.startsWith('image/')) return 'generic';
  if (lower.includes('datasheet') || lower.includes('tds') || lower.includes('技术'))
    return 'datasheet';
  if (lower.includes('formula') || lower.includes('recipe') || lower.includes('配方'))
    return 'formula_card';
  if (lower.includes('report') || lower.includes('test') || lower.includes('检测'))
    return 'test_report';
  return 'generic';
}

function buildDatasheet(s: Synth): Record<string, unknown> {
  return {
    doc_kind: 'datasheet',
    material: {
      proposed_code: `RM-MOCK-${(s.digits[0] ?? 0) % 1000}`,
      proposed_name: 'Synthetic mock material',
      density_g_cm3: round(1 + s.scalar * 0.2, 3),
      flash_point_c: 200 + ((s.digits[2] ?? 0) % 60),
      viscosity_100c_cst: round(4 + s.scalar * 6, 2),
    },
    suggested_role: 'base_oil',
    notes: 'Mock-extracted from a synthetic datasheet for pipeline testing.',
  };
}

function buildFormulaCard(s: Synth): Record<string, unknown> {
  const composition = ['PAO-6', 'GIII-4cSt', 'OCP', 'PKG-A'].map((code, i) => ({
    material_code: code,
    ratio: round(0.1 + ((s.digits[i] ?? 0) % 40) / 100, 3),
    role: i < 2 ? 'base_oil' : i === 2 ? 'vii' : 'detergent',
  }));
  // Re-balance to sum ≈ 1
  const total = composition.reduce((acc, c) => acc + c.ratio, 0);
  const normalised = composition.map((c) => ({ ...c, ratio: round(c.ratio / total, 4) }));
  return {
    doc_kind: 'formula_card',
    title: 'Synthetic mock formula',
    product_category: 'engine_oil_pcmo',
    composition: normalised,
    target_metrics: [
      { name: 'KV_100C', target: 11, unit: 'mm²/s' },
      { name: 'VI', lower_bound: 160 },
    ],
  };
}

function buildTestReport(s: Synth): Record<string, unknown> {
  return {
    doc_kind: 'test_report',
    metrics: [
      { name: 'KV_100C', value: round(9 + s.scalar * 4, 3), unit: 'mm²/s' },
      { name: 'VI', value: 150 + ((s.digits[1] ?? 0) % 30) },
      { name: 'POUR', value: -25 - ((s.digits[3] ?? 0) % 15), unit: '℃' },
      { name: 'FLASH', value: 200 + ((s.digits[4] ?? 0) % 50), unit: '℃' },
    ],
    sample_id: `LAB-MOCK-${(s.digits[5] ?? 0) % 10000}`,
  };
}

function buildGeneric(s: Synth): Record<string, unknown> {
  return {
    doc_kind: 'generic',
    summary: 'Synthetic mock document; no domain-specific fields detected.',
    confidence_hint: round(s.scalar, 3),
  };
}

function flatten(obj: unknown, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (obj === null || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

function scaleConfidence(scalar: number): number {
  return round(0.65 + scalar * 0.3, 3);
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function uniqueLowercase(s: string): string {
  return s.toLowerCase();
}
