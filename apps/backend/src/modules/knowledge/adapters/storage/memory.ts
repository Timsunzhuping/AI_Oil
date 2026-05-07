/**
 * In-memory StorageAdapter.
 *
 * Used by:
 *   • test runs (no filesystem mutation)
 *   • DB-less smoke tests
 *
 * Returns `mem://<key>` URLs.
 */
import { createHash } from 'node:crypto';
import type { StorageAdapter, StorageObject, StoragePutInput } from './types.js';

export class InMemoryStorage implements StorageAdapter {
  private readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  provider(): 'memory' {
    return 'memory';
  }

  async put(input: StoragePutInput): Promise<StorageObject> {
    this.objects.set(input.key, { body: input.body, contentType: input.contentType });
    const checksum = createHash('sha256').update(input.body).digest('hex');
    return {
      key: input.key,
      url: `mem://${input.key}`,
      size: input.body.byteLength,
      contentType: input.contentType,
      checksumSha256: checksum,
    };
  }

  async get(key: string): Promise<Buffer> {
    const o = this.objects.get(key);
    if (!o) throw new Error(`Key not found: ${key}`);
    return o.body;
  }

  async delete(key: string): Promise<boolean> {
    return this.objects.delete(key);
  }

  /** Test helper — exposes the number of stored objects. */
  size(): number {
    return this.objects.size;
  }
}
