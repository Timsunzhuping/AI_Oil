import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalFileStorage } from '../../../src/modules/knowledge/adapters/storage/local.js';
import { InMemoryStorage } from '../../../src/modules/knowledge/adapters/storage/memory.js';
import {
  buildStorage,
  buildStorageKey,
} from '../../../src/modules/knowledge/adapters/storage/index.js';

describe('buildStorageKey', () => {
  it('builds a year/month/day/code/timestamp-name.ext path', () => {
    const key = buildStorageKey(
      'DOC-2026-0001',
      'My File.pdf',
      'pdf',
      new Date('2026-05-07T10:30:00Z')
    );
    expect(key).toMatch(/^2026\/05\/07\/DOC-2026-0001\/\d+-My_File\.pdf\.pdf$/);
  });

  it('strips disallowed characters from the original name', () => {
    const key = buildStorageKey('DOC-1', 'wëird/../File.pdf', 'pdf');
    expect(key).not.toContain('..');
    expect(key).not.toContain('/wëird');
  });
});

describe('InMemoryStorage', () => {
  it('round-trips bytes and returns a stable checksum', async () => {
    const s = new InMemoryStorage();
    const body = Buffer.from('hello fluid');
    const out = await s.put({ key: 'a/b.txt', body, contentType: 'text/plain' });
    expect(out.key).toBe('a/b.txt');
    expect(out.url).toBe('mem://a/b.txt');
    expect(out.size).toBe(body.byteLength);
    expect(out.checksumSha256).toMatch(/^[a-f0-9]{64}$/);

    const fetched = await s.get('a/b.txt');
    expect(fetched.equals(body)).toBe(true);
  });

  it('delete is idempotent', async () => {
    const s = new InMemoryStorage();
    expect(await s.delete('missing')).toBe(false);
    await s.put({ key: 'x', body: Buffer.from('x'), contentType: 'text/plain' });
    expect(await s.delete('x')).toBe(true);
    expect(await s.delete('x')).toBe(false);
  });

  it('reports the "memory" provider', () => {
    expect(new InMemoryStorage().provider()).toBe('memory');
  });
});

describe('LocalFileStorage', () => {
  let tmp: string;
  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluidmind-knowledge-'));
  });
  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('writes and reads files relative to the configured root', async () => {
    const s = new LocalFileStorage({ root: tmp });
    const body = Buffer.from('local-file-bytes');
    const out = await s.put({ key: 'a/b/c.dat', body, contentType: 'application/octet-stream' });
    expect(out.url.startsWith('file://')).toBe(true);
    const physical = path.join(tmp, 'a/b/c.dat');
    const onDisk = await fs.readFile(physical);
    expect(onDisk.equals(body)).toBe(true);

    const fetched = await s.get('a/b/c.dat');
    expect(fetched.equals(body)).toBe(true);

    expect(await s.delete('a/b/c.dat')).toBe(true);
    expect(await s.delete('a/b/c.dat')).toBe(false);
  });

  it('reports the "local" provider', () => {
    expect(new LocalFileStorage({ root: tmp }).provider()).toBe('local');
  });
});

describe('buildStorage', () => {
  it('returns LocalFileStorage by default', () => {
    const s = buildStorage();
    expect(s.provider()).toBe('local');
  });

  it('returns InMemoryStorage when provider=memory', () => {
    const s = buildStorage({ provider: 'memory' });
    expect(s.provider()).toBe('memory');
  });

  it('respects an explicit adapter override', () => {
    const sentinel = new InMemoryStorage();
    expect(buildStorage({ adapter: sentinel })).toBe(sentinel);
  });
});
