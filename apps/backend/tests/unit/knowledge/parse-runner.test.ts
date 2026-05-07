import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { ParseRunner } from '../../../src/modules/knowledge/workers/parse-runner.js';
import { InMemoryStorage } from '../../../src/modules/knowledge/adapters/storage/memory.js';
import {
  buildOcrRegistry,
  ParserRegistry,
} from '../../../src/modules/knowledge/adapters/ocr/index.js';
import type { ParserAdapter } from '../../../src/modules/knowledge/adapters/ocr/index.js';
import { FakeKnowledgeRepository } from './_fakes.js';
import type { KnowledgeRepository } from '../../../src/modules/knowledge/repository.js';

const logger = pino({ level: 'silent' });

async function seed(
  repo: FakeKnowledgeRepository,
  storage: InMemoryStorage,
  mime = 'application/pdf'
) {
  const buf = Buffer.from('mock-pdf-bytes');
  const stored = await storage.put({ key: 'k/sample.pdf', body: buf, contentType: mime });
  const doc = await repo.createDocument({
    code: 'DOC-2026-0001',
    title: 'pao6-datasheet.pdf',
    description: null,
    doc_type: 'datasheet',
    category: 'raw_material',
    mime_type: mime,
    file_extension: 'pdf',
    size_bytes: buf.byteLength,
    checksum_sha256: stored.checksumSha256,
    storage_provider: 'memory',
    storage_key: stored.key,
    storage_url: stored.url,
    language: 'zh-CN',
    visibility: 'team',
    tags: [],
    related_raw_material_id: null,
    related_formula_id: null,
    related_supplier_id: null,
    metadata: {},
    trace_id: 'trace-1',
    created_by: null,
  });
  return doc;
}

describe('ParseRunner', () => {
  it('processes a queued task end-to-end (success path)', async () => {
    const repo = new FakeKnowledgeRepository();
    const storage = new InMemoryStorage();
    const registry = buildOcrRegistry();
    const runner = new ParseRunner({
      repository: repo as unknown as KnowledgeRepository,
      storage,
      registry,
      logger,
    });

    const doc = await seed(repo, storage);
    const task = await repo.createParseTask({
      document_id: doc.id,
      task_type: 'full_parse',
      parser_name: 'mock-doc-parser',
      parser_version: 'mock-v1',
      options: {},
      max_attempts: 3,
      trace_id: 'trace-1',
      created_by: null,
    });

    const finished = await runner.runTask(task.id);
    expect(finished?.status).toBe('succeeded');
    expect(finished?.duration_ms).toBeGreaterThanOrEqual(0);

    // A versioned result row was appended and is current.
    const results = await repo.listResultsForDocument(doc.id);
    expect(results).toHaveLength(1);
    expect(results[0]!.is_current).toBe(true);
    expect(results[0]!.review_status).toBe('pending');
    expect(results[0]!.origin).toBe('ocr');

    // Document moved into 'review'.
    const fresh = await repo.findDocument(doc.id);
    expect(fresh?.status).toBe('review');
    expect(fresh?.language_detected).toBeDefined();
    expect(fresh?.page_count).toBeGreaterThan(0);
  });

  it('marks task failed when parser throws and leaves doc in parsed', async () => {
    const repo = new FakeKnowledgeRepository();
    const storage = new InMemoryStorage();
    const failingAdapter: ParserAdapter = {
      supports: (m) => m === 'application/pdf',
      async parse() {
        throw new Error('parser exploded');
      },
    };
    const registry = new ParserRegistry([failingAdapter]);
    const runner = new ParseRunner({
      repository: repo as unknown as KnowledgeRepository,
      storage,
      registry,
      logger,
    });

    const doc = await seed(repo, storage);
    const task = await repo.createParseTask({
      document_id: doc.id,
      task_type: 'full_parse',
      parser_name: 'failing',
      parser_version: 'v0',
      options: {},
      max_attempts: 1,
      trace_id: null,
      created_by: null,
    });
    const finished = await runner.runTask(task.id);
    expect(finished?.status).toBe('failed');
    expect(finished?.error_message).toMatch(/exploded/);

    // No result row — failure does not write a phantom version.
    const results = await repo.listResultsForDocument(doc.id);
    expect(results).toEqual([]);
    const fresh = await repo.findDocument(doc.id);
    expect(fresh?.status).toBe('parsed');
  });

  it('drain() empties the queue and returns the count', async () => {
    const repo = new FakeKnowledgeRepository();
    const storage = new InMemoryStorage();
    const runner = new ParseRunner({
      repository: repo as unknown as KnowledgeRepository,
      storage,
      registry: buildOcrRegistry(),
      logger,
    });

    for (let i = 0; i < 3; i++) {
      const doc = await seed(repo, storage);
      await repo.createParseTask({
        document_id: doc.id,
        task_type: 'full_parse',
        parser_name: null,
        parser_version: null,
        options: {},
        max_attempts: 3,
        trace_id: null,
        created_by: null,
      });
    }
    const processed = await runner.drain();
    expect(processed).toBe(3);
    expect([...repo.tasks.values()].every((t) => t.status === 'succeeded')).toBe(true);
  });

  it('runTask is a no-op for non-queued tasks (idempotency)', async () => {
    const repo = new FakeKnowledgeRepository();
    const storage = new InMemoryStorage();
    const runner = new ParseRunner({
      repository: repo as unknown as KnowledgeRepository,
      storage,
      registry: buildOcrRegistry(),
      logger,
    });
    const doc = await seed(repo, storage);
    const task = await repo.createParseTask({
      document_id: doc.id,
      task_type: 'full_parse',
      parser_name: null,
      parser_version: null,
      options: {},
      max_attempts: 3,
      trace_id: null,
      created_by: null,
    });
    await runner.runTask(task.id);
    const second = await runner.runTask(task.id);
    expect(second?.status).toBe('succeeded'); // already terminal, returned as-is
  });
});
