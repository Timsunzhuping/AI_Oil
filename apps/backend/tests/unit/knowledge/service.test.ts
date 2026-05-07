import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { KnowledgeService } from '../../../src/modules/knowledge/service.js';
import { ParseRunner } from '../../../src/modules/knowledge/workers/parse-runner.js';
import { InMemoryStorage } from '../../../src/modules/knowledge/adapters/storage/memory.js';
import { buildOcrRegistry } from '../../../src/modules/knowledge/adapters/ocr/index.js';
import { FakeKnowledgeRepository } from './_fakes.js';
import type { KnowledgeRepository } from '../../../src/modules/knowledge/repository.js';

const logger = pino({ level: 'silent' });

function buildService(repo = new FakeKnowledgeRepository()) {
  const storage = new InMemoryStorage();
  const registry = buildOcrRegistry();
  const runner = new ParseRunner({
    repository: repo as unknown as KnowledgeRepository,
    storage,
    registry,
    logger,
  });
  const service = new KnowledgeService({
    repository: repo as unknown as KnowledgeRepository,
    storage,
    registry,
    runner,
    logger,
  });
  return { service, repo, storage, registry, runner };
}

const TRACE = 'trace-1';

describe('KnowledgeService — Raw material KB CRUD', () => {
  it('creates, reads, updates and deletes a KB entry', async () => {
    const { service } = buildService();
    const created = await service.createRawMaterialKb(
      { name: 'PAO-6', category: 'base_oil', summary: 'Synthetic baseline', tags: ['base', 'pao'] },
      'user-1'
    );
    expect(created.code).toMatch(/^RMK-2026-/);
    expect(created.status).toBe('draft');

    const read = await service.getRawMaterialKb(created.id);
    expect(read.id).toBe(created.id);

    const updated = await service.updateRawMaterialKb(
      created.id,
      { summary: 'Updated summary' },
      'user-1'
    );
    expect(updated.summary).toBe('Updated summary');

    await service.removeRawMaterialKb(created.id, 'user-1');
    await expect(service.getRawMaterialKb(created.id)).rejects.toThrow();
  });

  it('list paginates correctly', async () => {
    const { service } = buildService();
    for (let i = 0; i < 7; i++) {
      await service.createRawMaterialKb({ name: `mat-${i}` }, null);
    }
    const page = await service.listRawMaterialKb({ page: 1, pageSize: 3 });
    expect(page.items).toHaveLength(3);
    expect(page.total).toBe(7);
  });
});

describe('KnowledgeService — Formula KB CRUD', () => {
  it('creates and reads a formula KB entry', async () => {
    const { service } = buildService();
    const created = await service.createFormulaKb(
      {
        title: '5W-30 baseline',
        product_category: 'engine_oil_pcmo',
        sample_bom: [{ material_code: 'PAO-6', ratio: 0.42 }],
      },
      null
    );
    expect(created.code).toMatch(/^FKB-2026-/);
    expect(created.sample_bom).toHaveLength(1);
  });
});

describe('KnowledgeService — upload + parse flow', () => {
  it('uploads a PDF, kicks parse, produces a versioned result', async () => {
    const { service, repo } = buildService();
    const file = {
      originalName: 'pao6-datasheet.pdf',
      buffer: Buffer.from('pdf-bytes-' + 'x'.repeat(20000)),
      mimeType: 'application/pdf',
      size: 20015,
    };
    const out = await service.uploadDocument(
      file,
      { title: 'PAO-6 datasheet', doc_type: 'datasheet', category: 'raw_material', parse: true },
      { trace_id: TRACE, user_id: 'user-1' }
    );
    expect(out.document.code).toMatch(/^DOC-2026-/);
    expect(out.document.mime_type).toBe('application/pdf');
    expect(out.parse_task).toBeDefined();
    expect(out.parse_task!.status).toBe('succeeded');

    // Document should now be in 'review'.
    const detail = await service.getDocumentDetail(out.document.id);
    expect(detail.document.status).toBe('review');
    expect(detail.current_result).not.toBeNull();
    expect(detail.current_result!.result_version).toBe(1);
    expect(detail.current_result!.review_status).toBe('pending');

    // Result list returns one row.
    const results = await service.listResults(out.document.id);
    expect(results).toHaveLength(1);
    expect(results[0]!.origin).toBe('ocr');

    // Sanity: bytes are still in storage.
    expect(repo.documents.size).toBe(1);
  });

  it('rejects unsupported mime types', async () => {
    const { service } = buildService();
    await expect(
      service.uploadDocument(
        { originalName: 'a.txt', buffer: Buffer.from('hi'), mimeType: 'text/plain', size: 2 },
        { title: 'plain' },
        { trace_id: TRACE, user_id: null }
      )
    ).rejects.toThrow(/Unsupported mime type/);
  });

  it('rejects empty uploads', async () => {
    const { service } = buildService();
    await expect(
      service.uploadDocument(
        { originalName: 'a.pdf', buffer: Buffer.alloc(0), mimeType: 'application/pdf', size: 0 },
        { title: 'empty' },
        { trace_id: TRACE, user_id: null }
      )
    ).rejects.toThrow(/empty/);
  });

  it('re-parsing creates a new result_version and demotes the old one', async () => {
    const { service } = buildService();
    const file = {
      originalName: 'doc.pdf',
      buffer: Buffer.from('a'.repeat(100)),
      mimeType: 'application/pdf',
      size: 100,
    };
    const up = await service.uploadDocument(
      file,
      { title: 'Doc', parse: true },
      { trace_id: TRACE, user_id: null }
    );
    await service.enqueueParse(up.document.id, {}, { trace_id: TRACE, user_id: null });
    const results = await service.listResults(up.document.id);
    expect(results).toHaveLength(2);
    expect(results[0]!.result_version).toBe(2);
    expect(results[0]!.is_current).toBe(true);
    expect(results[1]!.is_current).toBe(false);
  });
});

describe('KnowledgeService — confirmation', () => {
  async function uploadAndParse() {
    const { service, repo } = buildService();
    const up = await service.uploadDocument(
      {
        originalName: 'pao6-datasheet.pdf',
        buffer: Buffer.from('a'.repeat(40)),
        mimeType: 'application/pdf',
        size: 40,
      },
      { title: 'PAO-6', doc_type: 'datasheet', category: 'raw_material', parse: true },
      { trace_id: TRACE, user_id: null }
    );
    return { service, repo, document: up.document };
  }

  it('approve marks current result approved and document confirmed', async () => {
    const { service, document } = await uploadAndParse();
    const r = await service.confirm(
      document.id,
      { action: 'approve' },
      { trace_id: TRACE, user_id: 'user-1' }
    );
    expect(r.document.status).toBe('confirmed');
    expect(r.result.review_status).toBe('approved');
    expect(r.result.reviewer_id).toBe('user-1');
  });

  it('reject moves document into rejected', async () => {
    const { service, document } = await uploadAndParse();
    const r = await service.confirm(
      document.id,
      { action: 'reject', review_comment: 'wrong tag' },
      { trace_id: TRACE, user_id: 'user-1' }
    );
    expect(r.document.status).toBe('rejected');
    expect(r.result.review_status).toBe('rejected');
    expect(r.result.review_comment).toBe('wrong tag');
  });

  it('edit appends a new manual revision and approves it', async () => {
    const { service, document } = await uploadAndParse();
    const r = await service.confirm(
      document.id,
      {
        action: 'edit',
        manual_edits: { material: { proposed_name: 'Hand-edited PAO-6' } },
        review_comment: 'fixed name',
      },
      { trace_id: TRACE, user_id: 'user-1' }
    );
    expect(r.result.origin).toBe('manual');
    expect(r.result.review_status).toBe('approved');
    expect(r.document.status).toBe('confirmed');
    expect(
      (r.result.structured_payload['material'] as { proposed_name: string }).proposed_name
    ).toBe('Hand-edited PAO-6');
  });

  it('promote_to_kb=raw_material auto-creates a raw_material_kb row and links it', async () => {
    const { service, repo, document } = await uploadAndParse();
    const r = await service.confirm(
      document.id,
      { action: 'approve', promote_to_kb: 'raw_material' },
      { trace_id: TRACE, user_id: 'user-1' }
    );
    expect(r.promoted_kb_id).toBeDefined();
    const kb = await repo.findRawMaterialKb(r.promoted_kb_id!);
    expect(kb).not.toBeNull();
    expect(kb!.source_document_id).toBe(document.id);
    expect(r.result.linked_raw_material_kb_id).toBe(r.promoted_kb_id);
  });
});

describe('KnowledgeService — error paths', () => {
  it('parse on unknown document throws NotFound', async () => {
    const { service } = buildService();
    await expect(
      service.enqueueParse(
        '00000000-0000-0000-0000-000000000abc',
        {},
        { trace_id: null, user_id: null }
      )
    ).rejects.toThrow();
  });

  it('confirm on unknown document throws NotFound', async () => {
    const { service } = buildService();
    await expect(
      service.confirm(
        '00000000-0000-0000-0000-000000000abc',
        { action: 'approve' },
        { trace_id: null, user_id: null }
      )
    ).rejects.toThrow();
  });
});
