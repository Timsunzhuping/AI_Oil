import { describe, it, expect } from 'vitest';
import { MockOcrAdapter } from '../../../src/modules/knowledge/adapters/ocr/mock.js';
import {
  ParserRegistry,
  buildOcrRegistry,
} from '../../../src/modules/knowledge/adapters/ocr/index.js';
import type { ParseTaskRow } from '../../../src/modules/knowledge/types.js';

const TASK: ParseTaskRow = {
  id: 'task-1',
  document_id: 'doc-1',
  task_type: 'full_parse',
  status: 'processing',
  parser_name: null,
  parser_version: null,
  options: {},
  attempt_count: 1,
  max_attempts: 3,
  started_at: '2026-05-07T00:00:00Z',
  completed_at: null,
  duration_ms: 0,
  error_class: null,
  error_message: null,
  trace_id: null,
  created_by: null,
  created_at: '2026-05-07T00:00:00Z',
  updated_at: '2026-05-07T00:00:00Z',
};

describe('MockOcrAdapter', () => {
  const adapter = new MockOcrAdapter();

  it('supports all accepted mime types', () => {
    expect(adapter.supports('application/pdf')).toBe(true);
    expect(adapter.supports('image/jpeg')).toBe(true);
    expect(adapter.supports('text/plain')).toBe(false);
  });

  it('produces deterministic output for identical bytes', async () => {
    const body = Buffer.from('hello'.repeat(20));
    const a = await adapter.parse(
      { body, mimeType: 'application/pdf', originalName: 'test.pdf', options: {} },
      TASK
    );
    const b = await adapter.parse(
      { body, mimeType: 'application/pdf', originalName: 'test.pdf', options: {} },
      TASK
    );
    expect(a.raw_text).toBe(b.raw_text);
    expect(a.structured_payload).toEqual(b.structured_payload);
    expect(a.confidence).toBe(b.confidence);
  });

  it('reacts to byte changes (different bytes → different output)', async () => {
    const a = await adapter.parse(
      { body: Buffer.from('A'), mimeType: 'application/pdf', originalName: 'x.pdf', options: {} },
      TASK
    );
    const b = await adapter.parse(
      { body: Buffer.from('B'), mimeType: 'application/pdf', originalName: 'x.pdf', options: {} },
      TASK
    );
    expect(a.raw_text).not.toBe(b.raw_text);
  });

  it('infers datasheet doc kind from filename', async () => {
    const r = await adapter.parse(
      {
        body: Buffer.from('some pdf bytes'),
        mimeType: 'application/pdf',
        originalName: 'pao6-datasheet.pdf',
        options: {},
      },
      TASK
    );
    expect(r.structured_payload['doc_kind']).toBe('datasheet');
    expect(r.structured_payload['material']).toBeDefined();
  });

  it('infers formula card from "formula" keyword', async () => {
    const r = await adapter.parse(
      {
        body: Buffer.from('xx'),
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        originalName: 'engine_oil_formula_v3.docx',
        options: {},
      },
      TASK
    );
    expect(r.structured_payload['doc_kind']).toBe('formula_card');
    expect(Array.isArray(r.structured_payload['composition'])).toBe(true);
  });

  it('infers test report from "report" keyword', async () => {
    const r = await adapter.parse(
      {
        body: Buffer.from('zz'),
        mimeType: 'application/pdf',
        originalName: 'lab_test_report_2026.pdf',
        options: {},
      },
      TASK
    );
    expect(r.structured_payload['doc_kind']).toBe('test_report');
    expect(Array.isArray(r.structured_payload['metrics'])).toBe(true);
  });

  it('returns confidence in [0.65, 0.95]', async () => {
    const r = await adapter.parse(
      {
        body: Buffer.from('some'),
        mimeType: 'application/pdf',
        originalName: 'doc.pdf',
        options: {},
      },
      TASK
    );
    expect(r.confidence).toBeGreaterThanOrEqual(0.65);
    expect(r.confidence).toBeLessThanOrEqual(0.95);
  });

  it('returns extracted_fields keys flattened from structured_payload', async () => {
    const r = await adapter.parse(
      {
        body: Buffer.from('aa'),
        mimeType: 'application/pdf',
        originalName: 'pao-datasheet.pdf',
        options: {},
      },
      TASK
    );
    expect(Object.keys(r.extracted_fields).some((k) => k.startsWith('material.'))).toBe(true);
  });
});

describe('ParserRegistry', () => {
  it('throws when no adapter supports the mime type', () => {
    const reg = new ParserRegistry([new MockOcrAdapter()]);
    expect(() => reg.resolve('text/plain')).toThrow();
  });

  it('uses the first adapter that supports the mime', () => {
    const reg = new ParserRegistry([new MockOcrAdapter()]);
    expect(reg.resolve('application/pdf')).toBeDefined();
  });

  it('register() prepends a custom adapter', () => {
    const reg = buildOcrRegistry();
    const sentinel = new MockOcrAdapter({ parserName: 'sentinel' });
    reg.register(sentinel);
    expect(reg.resolve('application/pdf')).toBe(sentinel);
  });
});
