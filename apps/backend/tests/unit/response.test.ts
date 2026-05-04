import { describe, it, expect } from 'vitest';
import { success, paginated, failure } from '../../src/lib/response.js';
import { withContext } from '../../src/lib/context.js';

describe('response wrapper', () => {
  describe('success()', () => {
    it('builds the unified success envelope', () => {
      const r = success({ id: 1 }, 'ok', 'trace-1');
      expect(r.code).toBe(0);
      expect(r.message).toBe('ok');
      expect(r.data).toEqual({ id: 1 });
      expect(r.traceId).toBe('trace-1');
      expect(r.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('defaults message to "success"', () => {
      const r = success({ x: 1 }, undefined, 't');
      expect(r.message).toBe('success');
    });

    it('falls back to "no-trace" when context is empty', () => {
      const r = success({});
      expect(r.traceId).toBe('no-trace');
    });

    it('picks up trace_id from AsyncLocalStorage when not given', () => {
      withContext({ traceId: 'ctx-trace', startTime: Date.now() }, () => {
        const r = success({});
        expect(r.traceId).toBe('ctx-trace');
      });
    });
  });

  describe('paginated()', () => {
    it('wraps items with pagination metadata', () => {
      const r = paginated([1, 2, 3], 100, 1, 3, 't');
      expect(r.code).toBe(0);
      expect(r.data.items).toEqual([1, 2, 3]);
      expect(r.data.total).toBe(100);
      expect(r.data.page).toBe(1);
      expect(r.data.pageSize).toBe(3);
    });
  });

  describe('failure()', () => {
    it('builds an error envelope', () => {
      const r = failure(40002, 'Validation failed', undefined, 't');
      expect(r.code).toBe(40002);
      expect(r.message).toBe('Validation failed');
      expect(r.traceId).toBe('t');
      expect((r as { errors?: unknown }).errors).toBeUndefined();
    });

    it('omits errors field when array is empty', () => {
      const r = failure(40002, 'x', [], 't');
      expect(r).not.toHaveProperty('errors');
    });

    it('includes errors field when non-empty', () => {
      const r = failure(40002, 'x', [{ field: 'email', message: 'bad' }], 't');
      expect(r.errors).toHaveLength(1);
    });
  });
});
