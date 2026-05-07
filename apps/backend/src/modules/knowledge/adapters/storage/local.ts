/**
 * Filesystem-backed StorageAdapter.
 *
 * Files are placed under `<root>/<key>`. `root` defaults to
 * `process.env.DOC_STORAGE_PATH ?? './var/uploads'`. Directories are created
 * lazily on first put. URLs are `file:///abs/path`.
 *
 * This adapter is good enough for dev, on-prem deploys, and unit tests that
 * exercise real disk I/O. Swap to S3 in production.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { StorageAdapter, StorageObject, StoragePutInput } from './types.js';

export interface LocalFileStorageOptions {
  root?: string;
}

export class LocalFileStorage implements StorageAdapter {
  private readonly root: string;

  constructor(opts: LocalFileStorageOptions = {}) {
    this.root = path.resolve(opts.root ?? process.env.DOC_STORAGE_PATH ?? './var/uploads');
  }

  provider(): 'local' {
    return 'local';
  }

  async put(input: StoragePutInput): Promise<StorageObject> {
    const dest = path.join(this.root, input.key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, input.body);
    const checksum = createHash('sha256').update(input.body).digest('hex');
    return {
      key: input.key,
      url: `file://${dest}`,
      size: input.body.byteLength,
      contentType: input.contentType,
      checksumSha256: checksum,
    };
  }

  async get(key: string): Promise<Buffer> {
    const target = path.join(this.root, key);
    return fs.readFile(target);
  }

  async delete(key: string): Promise<boolean> {
    const target = path.join(this.root, key);
    try {
      await fs.unlink(target);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }
}
