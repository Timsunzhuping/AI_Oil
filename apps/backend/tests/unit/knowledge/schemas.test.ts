import { describe, it, expect } from 'vitest';
import {
  ConfirmSchema,
  CreateRawMaterialKbSchema,
  CreateFormulaKbSchema,
  ParseEnqueueSchema,
  UploadDocMetadataSchema,
  normaliseTags,
  normaliseMetadata,
} from '../../../src/modules/knowledge/schemas.js';

describe('CreateRawMaterialKbSchema', () => {
  it('requires a name', () => {
    const r = CreateRawMaterialKbSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('accepts a minimal payload', () => {
    const r = CreateRawMaterialKbSchema.safeParse({ name: 'PAO-6' });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown status', () => {
    const r = CreateRawMaterialKbSchema.safeParse({ name: 'PAO-6', status: 'banana' });
    expect(r.success).toBe(false);
  });
});

describe('CreateFormulaKbSchema', () => {
  it('requires a title', () => {
    expect(CreateFormulaKbSchema.safeParse({}).success).toBe(false);
  });
});

describe('UploadDocMetadataSchema', () => {
  it('requires a title', () => {
    expect(UploadDocMetadataSchema.safeParse({}).success).toBe(false);
  });

  it('accepts string-encoded tags + metadata (multipart form)', () => {
    const r = UploadDocMetadataSchema.safeParse({
      title: 'Doc',
      tags: 'a,b,c',
      metadata: '{"k":"v"}',
      parse: 'true',
    });
    expect(r.success).toBe(true);
  });
});

describe('ConfirmSchema', () => {
  it('approve does not require manual_edits', () => {
    expect(ConfirmSchema.safeParse({ action: 'approve' }).success).toBe(true);
  });
  it('edit requires manual_edits', () => {
    expect(ConfirmSchema.safeParse({ action: 'edit' }).success).toBe(false);
    expect(ConfirmSchema.safeParse({ action: 'edit', manual_edits: { x: 1 } }).success).toBe(true);
  });
});

describe('ParseEnqueueSchema', () => {
  it('clamps max_attempts', () => {
    expect(ParseEnqueueSchema.safeParse({ max_attempts: 0 }).success).toBe(false);
    expect(ParseEnqueueSchema.safeParse({ max_attempts: 6 }).success).toBe(false);
    expect(ParseEnqueueSchema.safeParse({ max_attempts: 3 }).success).toBe(true);
  });
});

describe('normaliseTags / normaliseMetadata', () => {
  it('splits comma-separated tag strings', () => {
    expect(normaliseTags('a, b ,c')).toEqual(['a', 'b', 'c']);
    expect(normaliseTags(['x', 'y'])).toEqual(['x', 'y']);
    expect(normaliseTags(undefined)).toBeUndefined();
  });

  it('parses metadata JSON strings', () => {
    expect(normaliseMetadata('{"k":1}')).toEqual({ k: 1 });
    expect(normaliseMetadata({ a: 'b' })).toEqual({ a: 'b' });
    expect(normaliseMetadata(undefined)).toBeUndefined();
    expect(normaliseMetadata('not json')).toBeUndefined();
  });
});
