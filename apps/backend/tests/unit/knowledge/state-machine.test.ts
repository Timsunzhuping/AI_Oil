import { describe, it, expect } from 'vitest';
import {
  assertDocumentTransition,
  assertTaskTransition,
  canTransitionDocument,
  canTransitionTask,
} from '../../../src/modules/knowledge/state-machine.js';

describe('document state machine', () => {
  it('allows the canonical happy path', () => {
    expect(canTransitionDocument('uploaded', 'parsing')).toBe(true);
    expect(canTransitionDocument('parsing', 'parsed')).toBe(true);
    expect(canTransitionDocument('parsed', 'review')).toBe(true);
    expect(canTransitionDocument('review', 'confirmed')).toBe(true);
  });

  it('allows reject and re-review', () => {
    expect(canTransitionDocument('review', 'rejected')).toBe(true);
    expect(canTransitionDocument('rejected', 'parsing')).toBe(true);
    expect(canTransitionDocument('confirmed', 'review')).toBe(true);
  });

  it('disallows nonsensical transitions', () => {
    expect(canTransitionDocument('uploaded', 'confirmed')).toBe(false);
    expect(canTransitionDocument('archived', 'parsing')).toBe(false);
    expect(canTransitionDocument('confirmed', 'uploaded')).toBe(false);
  });

  it('archive is a terminal sink', () => {
    for (const from of [
      'uploaded',
      'parsing',
      'parsed',
      'review',
      'confirmed',
      'rejected',
    ] as const) {
      expect(canTransitionDocument(from, 'archived')).toBe(true);
    }
    expect(canTransitionDocument('archived', 'uploaded')).toBe(false);
  });

  it('asserts throw on illegal transitions', () => {
    expect(() => assertDocumentTransition('uploaded', 'confirmed')).toThrow();
  });
});

describe('parse-task state machine', () => {
  it('queued → processing → succeeded is the happy path', () => {
    expect(canTransitionTask('queued', 'processing')).toBe(true);
    expect(canTransitionTask('processing', 'succeeded')).toBe(true);
  });

  it('queued can be cancelled', () => {
    expect(canTransitionTask('queued', 'cancelled')).toBe(true);
  });

  it('processing can fail', () => {
    expect(canTransitionTask('processing', 'failed')).toBe(true);
  });

  it('succeeded / failed / cancelled are terminal', () => {
    for (const from of ['succeeded', 'failed', 'cancelled'] as const) {
      for (const to of ['queued', 'processing', 'succeeded', 'failed', 'cancelled'] as const) {
        expect(canTransitionTask(from, to)).toBe(false);
      }
    }
  });

  it('asserts throw on illegal transitions', () => {
    expect(() => assertTaskTransition('queued', 'succeeded')).toThrow();
  });
});
