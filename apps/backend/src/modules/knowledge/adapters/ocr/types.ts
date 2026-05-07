/**
 * OCR / parser adapter contract.
 *
 * One adapter per parser strategy. The registry (see ../registry below) maps
 * mime type → adapter so the runner can dispatch automatically.
 *
 * Concrete strategies you might plug in later:
 *   • Tesseract / PaddleOCR for images
 *   • pdf-parse / PDFium / poppler for PDFs
 *   • Mammoth.js for DOCX
 *   • SheetJS / xlsx for XLSX
 *   • Azure Document Intelligence / GCP Document AI for cloud-only flows
 *
 * The mock adapter in `mock.ts` returns deterministic synthetic content so
 * the rest of the pipeline (tasks, results, KB promotion) can be tested
 * end-to-end without external services.
 */
import type { ParseTaskRow, ResultOrigin } from '../../types.js';

export interface ParserInput {
  /** The raw bytes pulled from storage. */
  body: Buffer;
  /** Document mime type (helps cross-validation). */
  mimeType: string;
  /** Original filename — used by some parsers for hints. */
  originalName: string;
  /** Per-task options (e.g. language='eng+chi_sim'). */
  options: Record<string, unknown>;
}

export interface ParserOutput {
  /** Concatenated raw text (across pages) for free-text RAG indexing. */
  raw_text: string;
  /** Normalised structured payload. Shape varies by document type. */
  structured_payload: Record<string, unknown>;
  /** Shallow key-value summary the human-review UI lists. */
  extracted_fields: Record<string, unknown>;
  /** Per-page snippets if the parser produces them. */
  page_snippets?: Array<{ page: number; text: string; confidence?: number }>;
  /** 0..1 average confidence score. */
  confidence: number;
  /** Detected language code, if any. */
  language?: string;
  /** Number of pages detected (PDF / DOCX). */
  page_count?: number;
  /** Search keywords for retrieval indexing. */
  search_keywords?: string[];
  /** What pipeline stage produced this result (defaults to 'ocr'). */
  origin?: ResultOrigin;
  /** Stable parser identity for the audit row. */
  parser_name: string;
  parser_version: string;
}

export interface ParserAdapter {
  /** Mime types this adapter supports. */
  supports(mime: string): boolean;
  /** Run the parser. Should never throw — wrap in try/catch and return empty output. */
  parse(input: ParserInput, task: ParseTaskRow): Promise<ParserOutput>;
}
