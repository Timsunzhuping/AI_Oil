import { BaseAdapter, delay } from './base.js';
import { createHash } from 'node:crypto';
import type {
  AdapterRecord,
  ConnectionTestResult,
  Cursor,
  EntityCapability,
  ExtractContext,
  SourceRow,
  SourceType,
} from '../types.js';

/**
 * MOCK file / object-storage adapter.
 *
 * Simulates listing files in a bucket or directory. Real implementation
 * would replace `sampleFiles()` with an S3/MinIO list call (via aws-sdk
 * v3 / Minio JS) or `fs.readdir`. The cursor uses `{ since_mtime }`.
 */
export class MockFileAdapter extends BaseAdapter {
  readonly sourceType: SourceType = 'file';

  capabilities(): EntityCapability[] {
    return [
      { entity_type: 'documents', supports_full: true, supports_incremental: true, cursor_shape: '{ since_mtime: ISO8601, last_etag: string }' },
    ];
  }

  async testConnection(source: SourceRow): Promise<ConnectionTestResult> {
    const start = Date.now();
    await delay(15);
    const cfg = source.config as { endpoint?: string; bucket?: string };
    if (!cfg?.endpoint || !cfg?.bucket) {
      return { ok: false, latency_ms: Date.now() - start, error: 'config.endpoint and config.bucket required' };
    }
    return { ok: true, latency_ms: Date.now() - start, details: { bucket: cfg.bucket } };
  }

  async *extractFull(ctx: ExtractContext): AsyncIterable<AdapterRecord> {
    yield* this.iterate(ctx, null, true);
  }

  async *extractIncremental(ctx: ExtractContext, cursor: Cursor | null): AsyncIterable<AdapterRecord> {
    yield* this.iterate(ctx, cursor, false);
  }

  /**
   * Custom cursor: track BOTH since_mtime and last_etag so we can
   * detect content changes even when mtime is preserved (e.g. rsync).
   */
  override nextCursor(currentCursor: Cursor | null, lastRecord: AdapterRecord | null): Cursor | null {
    if (!lastRecord) return currentCursor;
    const payload = lastRecord.payload as { mtime?: string; etag?: string };
    return {
      ...(currentCursor ?? {}),
      since_mtime: payload.mtime ?? currentCursor?.since_mtime,
      last_etag: payload.etag ?? currentCursor?.last_etag,
    };
  }

  private async *iterate(
    ctx: ExtractContext,
    cursor: Cursor | null,
    ignoreCursor: boolean
  ): AsyncIterable<AdapterRecord> {
    const sinceMtime = !ignoreCursor && cursor && typeof cursor.since_mtime === 'string'
      ? new Date(cursor.since_mtime)
      : null;

    const samples = sampleFiles();
    for (const r of samples) {
      const payload = r.payload as { mtime: string };
      if (sinceMtime && new Date(payload.mtime) <= sinceMtime) continue;
      await delay(2);
      yield r;
    }
  }
}

function sampleFiles(): AdapterRecord[] {
  const base = new Date('2026-04-20T00:00:00Z').getTime();
  const hour = (n: number) => new Date(base + n * 3600_000).toISOString();
  const make = (path: string, mtimeIso: string, content: string): AdapterRecord => ({
    external_id: path,
    external_updated_at: mtimeIso,
    payload: {
      path,
      mtime: mtimeIso,
      size_bytes: content.length,
      mime_type: path.endsWith('.pdf') ? 'application/pdf' : 'text/plain',
      etag: createHash('md5').update(content).digest('hex'),
      content_preview: content.slice(0, 200),
    },
  });
  return [
    make('reports/2026-04-20/qa-batch-001.pdf',  hour(2), 'QA report — batch 001 — KV100=10.4 — pass'),
    make('reports/2026-04-21/qa-batch-002.pdf',  hour(28), 'QA report — batch 002 — KV100=10.5 — pass'),
    make('reports/2026-04-22/cold-flow-A.txt',   hour(50), 'Cold flow trial A: pour point -39C, satisfactory'),
    make('reports/2026-04-23/cold-flow-B.txt',   hour(72), 'Cold flow trial B: pour point -42C, improvement noted'),
  ];
}
