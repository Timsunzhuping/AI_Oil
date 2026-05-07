import { describe, it, expect } from 'vitest';
import {
  AskSchema,
  FeedbackSchema,
  SessionIdParamSchema,
} from '../../../src/modules/qa/schemas.js';

describe('AskSchema', () => {
  it('requires a non-trivial question', () => {
    expect(AskSchema.safeParse({ question: 'a' }).success).toBe(false);
    expect(AskSchema.safeParse({ question: '   ok ?' }).success).toBe(true);
  });

  it('rejects an absurdly long question', () => {
    expect(AskSchema.safeParse({ question: 'q'.repeat(2001) }).success).toBe(false);
  });

  it('accepts optional fields', () => {
    const r = AskSchema.safeParse({
      question: 'PAO-6 datasheet?',
      product_category: 'engine_oil_pcmo',
      session_id: '00000000-0000-0000-0000-000000000001',
      max_citations: 5,
      metadata: { source: 'web' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects max_citations outside [1, 20]', () => {
    expect(AskSchema.safeParse({ question: 'q?', max_citations: 0 }).success).toBe(false);
    expect(AskSchema.safeParse({ question: 'q?', max_citations: 21 }).success).toBe(false);
  });
});

describe('FeedbackSchema', () => {
  it('only accepts rating in {-1, 0, 1}', () => {
    for (const r of [-1, 0, 1]) {
      expect(
        FeedbackSchema.safeParse({
          message_id: '00000000-0000-0000-0000-000000000001',
          rating: r,
        }).success
      ).toBe(true);
    }
    expect(
      FeedbackSchema.safeParse({
        message_id: '00000000-0000-0000-0000-000000000001',
        rating: 2,
      }).success
    ).toBe(false);
  });

  it('requires message_id to be a uuid', () => {
    expect(FeedbackSchema.safeParse({ message_id: 'not-uuid', rating: 1 }).success).toBe(false);
  });
});

describe('SessionIdParamSchema', () => {
  it('requires a uuid', () => {
    expect(SessionIdParamSchema.safeParse({ sessionId: 'x' }).success).toBe(false);
    expect(
      SessionIdParamSchema.safeParse({ sessionId: '00000000-0000-0000-0000-000000000001' }).success
    ).toBe(true);
  });
});
