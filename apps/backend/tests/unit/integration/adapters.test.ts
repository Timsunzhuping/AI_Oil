import { describe, it, expect } from 'vitest';
import { MockSapAdapter } from '../../../src/modules/integration/adapters/sap.js';
import { MockLimsAdapter } from '../../../src/modules/integration/adapters/lims.js';
import { MockFileAdapter } from '../../../src/modules/integration/adapters/file.js';
import { AdapterRegistry } from '../../../src/modules/integration/adapters/registry.js';
import type { ExtractContext, SourceRow } from '../../../src/modules/integration/types.js';

const baseSource = (source_type: 'sap' | 'lims' | 'file'): SourceRow => ({
  id: '00000000-0000-0000-0000-000000000001',
  code: `mock_${source_type}`,
  name: `Mock ${source_type}`,
  source_type,
  config: source_type === 'sap'
    ? { endpoint: 'https://sap.example' }
    : source_type === 'lims'
    ? { endpoint: 'https://lims.example', lab_code: 'US-01' }
    : { endpoint: 'http://minio.example', bucket: 'qa' },
  secret_ref: null,
  supported_entities: [],
  default_retry_max: 3,
  default_retry_backoff_ms: 30_000,
  is_active: true,
});

const ctx = (source: SourceRow, entity: string): ExtractContext => ({
  source,
  entityType: entity,
  jobId: 'job-1',
  traceId: 'trace-1',
  batchHint: 100,
});

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

describe('MockSapAdapter', () => {
  const a = new MockSapAdapter();

  it('reports capabilities', () => {
    const caps = a.capabilities();
    expect(caps.find((c) => c.entity_type === 'raw_materials')).toBeTruthy();
    expect(caps.find((c) => c.entity_type === 'suppliers')).toBeTruthy();
  });

  it('testConnection succeeds with valid config', async () => {
    const r = await a.testConnection(baseSource('sap'));
    expect(r.ok).toBe(true);
  });

  it('testConnection fails with missing endpoint', async () => {
    const src = baseSource('sap');
    src.config = {};
    const r = await a.testConnection(src);
    expect(r.ok).toBe(false);
  });

  it('extractFull yields all sample materials', async () => {
    const records = await collect(a.extractFull(ctx(baseSource('sap'), 'raw_materials')));
    expect(records.length).toBeGreaterThanOrEqual(4);
    expect(records[0].external_id.startsWith('SAP-MAT-')).toBe(true);
  });

  it('extractIncremental honors the cursor', async () => {
    const all = await collect(a.extractFull(ctx(baseSource('sap'), 'raw_materials')));
    const middle = all[Math.floor(all.length / 2)];
    const cursor = { since: middle.external_updated_at as string };

    const filtered = await collect(
      a.extractIncremental(ctx(baseSource('sap'), 'raw_materials'), cursor)
    );
    // strict > since, so middle is excluded
    expect(filtered.length).toBeLessThan(all.length);
    for (const r of filtered) {
      expect(new Date(r.external_updated_at as string).getTime()).toBeGreaterThan(
        new Date(middle.external_updated_at as string).getTime()
      );
    }
  });

  it('nextCursor advances by external_updated_at', () => {
    const cursor = a.nextCursor(null, {
      external_id: 'X',
      external_updated_at: '2026-04-10T00:00:00.000Z',
      payload: {},
    });
    expect(cursor?.since).toBe('2026-04-10T00:00:00.000Z');
  });
});

describe('MockLimsAdapter', () => {
  const a = new MockLimsAdapter();
  it('yields test_results', async () => {
    const records = await collect(a.extractFull(ctx(baseSource('lims'), 'test_results')));
    expect(records.length).toBeGreaterThan(0);
    expect(records[0].external_id.startsWith('LIMS-RESULT-')).toBe(true);
  });
});

describe('MockFileAdapter', () => {
  const a = new MockFileAdapter();

  it('yields files with etag and mtime', async () => {
    const records = await collect(a.extractFull(ctx(baseSource('file'), 'documents')));
    expect(records.length).toBeGreaterThan(0);
    const first = records[0].payload as { etag: string; mtime: string };
    expect(first.etag).toMatch(/^[0-9a-f]{32}$/);
    expect(first.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('nextCursor preserves etag + mtime separately', () => {
    const a2 = new MockFileAdapter();
    const cursor = a2.nextCursor(null, {
      external_id: '/p',
      external_updated_at: '2026-01-01T00:00:00Z',
      payload: { mtime: '2026-01-01T00:00:00Z', etag: 'abc' },
    });
    expect(cursor).toEqual({ since_mtime: '2026-01-01T00:00:00Z', last_etag: 'abc' });
  });
});

describe('AdapterRegistry', () => {
  it('resolves by source_type', () => {
    const reg = new AdapterRegistry();
    expect(reg.resolve('sap')).toBeInstanceOf(MockSapAdapter);
    expect(reg.resolve('lims')).toBeInstanceOf(MockLimsAdapter);
    expect(reg.resolve('file')).toBeInstanceOf(MockFileAdapter);
  });

  it('throws on unknown source_type', () => {
    const reg = new AdapterRegistry();
    expect(() => reg.resolve('unknown' as never)).toThrow();
  });

  it('list() reports every registered adapter', () => {
    const reg = new AdapterRegistry();
    const list = reg.list();
    const types = list.map((x) => x.source_type).sort();
    expect(types).toEqual(['file', 'lims', 'sap']);
  });
});
