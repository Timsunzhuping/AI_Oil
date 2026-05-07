/**
 * Storage adapter factory.
 *
 *   buildStorage()   → LocalFileStorage  (default)
 *   buildStorage({ provider: 'memory' }) → InMemoryStorage
 *   buildStorage({ provider: 'local',  root: '/tmp/uploads' })
 *
 * Honours `DOC_STORAGE_PROVIDER` env var ('local' | 'memory') for production
 * configuration without code changes.
 */
import { LocalFileStorage, type LocalFileStorageOptions } from './local.js';
import { InMemoryStorage } from './memory.js';
import type { StorageAdapter } from './types.js';

export interface BuildStorageOptions extends LocalFileStorageOptions {
  provider?: 'local' | 'memory';
  /** Inject an entirely custom adapter (e.g. an S3 client). */
  adapter?: StorageAdapter;
}

export function buildStorage(opts: BuildStorageOptions = {}): StorageAdapter {
  if (opts.adapter) return opts.adapter;
  const provider =
    opts.provider ?? (process.env.DOC_STORAGE_PROVIDER === 'memory' ? 'memory' : 'local');
  if (provider === 'memory') return new InMemoryStorage();
  return new LocalFileStorage(opts);
}

export { LocalFileStorage } from './local.js';
export { InMemoryStorage } from './memory.js';
export type { StorageAdapter, StorageObject, StoragePutInput } from './types.js';
export { buildStorageKey } from './types.js';
