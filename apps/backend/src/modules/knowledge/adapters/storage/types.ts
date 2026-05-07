/**
 * Storage adapter contract.
 *
 * Concrete implementations decide where the binary lives:
 *   • LocalFileStorage   — filesystem under DOC_STORAGE_PATH (default ./var/uploads)
 *   • InMemoryStorage    — only used by tests
 *   • S3Storage          — placeholder; not implemented in this round
 *
 * The service layer only knows about this contract — swap implementations
 * via env / DI to plug into MinIO / S3 / Tencent COS.
 */
import type { StorageProvider } from '../../types.js';

export interface StoragePutInput {
  /** Stable opaque key under which the binary is stored. */
  key: string;
  /** Raw bytes. */
  body: Buffer;
  /** Mime type, used by some providers for download Content-Type. */
  contentType: string;
  /** When set, the provider may include this filename in headers. */
  originalName?: string;
}

export interface StorageObject {
  key: string;
  /** Adapter-specific URL: file://, s3://, mem:// */
  url: string;
  size: number;
  contentType: string;
  /** SHA-256 of the bytes, hex. */
  checksumSha256: string;
}

export interface StorageAdapter {
  /** Store the bytes; return a stable {key, url, size, checksum} record. */
  put(input: StoragePutInput): Promise<StorageObject>;
  /** Retrieve the bytes for a previously-stored key. */
  get(key: string): Promise<Buffer>;
  /** Remove the bytes; idempotent — returns false if the key didn't exist. */
  delete(key: string): Promise<boolean>;
  /** Provider tag for `document_records.storage_provider`. */
  provider(): StorageProvider;
}

/**
 * Build a stable storage key for an upload.
 *
 *   <yyyy>/<mm>/<dd>/<doc_code>/<timestamp>-<safe_filename>
 *
 * Doesn't depend on `crypto.randomUUID` so it stays deterministic for tests.
 */
export function buildStorageKey(
  docCode: string,
  originalName: string,
  ext: string,
  now: Date = new Date()
): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  // Defang anything that could escape the storage root: collapse `..` first,
  // then replace remaining unsafe characters with `_`.
  const sanitised = originalName
    .replace(/\.{2,}/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(0, 60);
  const safe = sanitised || 'file';
  return `${yyyy}/${mm}/${dd}/${docCode}/${Date.now()}-${safe}.${ext}`;
}
