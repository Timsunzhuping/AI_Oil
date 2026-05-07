import { describe, it, expect } from 'vitest';
import {
  rankAndCap,
  scoreCandidate,
  snippet,
  tokenise,
} from '../../../src/modules/qa/adapters/retrieval/kb-postgres.js';
import { EmptyRetriever } from '../../../src/modules/qa/adapters/retrieval/index.js';
import { makeHit } from './_fakes.js';

describe('tokenise', () => {
  it('splits ASCII text into lowercase tokens', () => {
    expect(tokenise('PAO-6 datasheet additive')).toEqual(['pao-6', 'datasheet', 'additive']);
  });

  it('drops punctuation and short tokens', () => {
    expect(tokenise('a, b? c.')).toEqual([]);
  });

  it('separates Chinese runs from Latin', () => {
    const t = tokenise('PAO-6 datasheet 高黏度指数 base_oil');
    expect(t).toContain('pao-6');
    expect(t).toContain('高黏度指数');
    expect(t).toContain('base_oil');
  });

  it('deduplicates tokens', () => {
    expect(tokenise('pao pao PAO').sort()).toEqual(['pao']);
  });
});

describe('scoreCandidate', () => {
  it('rewards whole-word title matches with 1.0', () => {
    const s = scoreCandidate(['pao'], 'PAO-6 base oil', 'body', 'meta', { intent: 'general' });
    expect(s).toBeGreaterThanOrEqual(0.7);
  });

  it('falls back to body match when title misses', () => {
    const s = scoreCandidate(['noack'], 'Misc title', 'noack volatility test', '', {
      intent: 'general',
    });
    expect(s).toBeCloseTo(0.5, 1);
  });

  it('returns 0 when no token appears', () => {
    expect(scoreCandidate(['xyzz'], 't', 'b', 'm', { intent: 'general' })).toBe(0);
  });

  it('boosts when product_category appears in meta', () => {
    // Use a body-only match so the base score is < 1 and the boost is observable.
    const a = scoreCandidate(['noack'], 'Title', 'noack volatility', 'engine_oil', {
      intent: 'general',
    });
    const b = scoreCandidate(['noack'], 'Title', 'noack volatility', 'engine_oil', {
      intent: 'general',
      product_category: 'engine_oil',
    });
    expect(b).toBeGreaterThan(a);
  });
});

describe('snippet', () => {
  it('extracts a window around the first matched token', () => {
    const s = snippet(
      'A long body containing the word noack volatility right in the middle',
      ['noack'],
      30
    );
    expect(s).toContain('noack');
    expect(s.length).toBeLessThanOrEqual(34); // window + ellipses
  });

  it('returns the head when no token matches', () => {
    const s = snippet('Hello world from the abyss', ['nope'], 12);
    expect(s.startsWith('Hello world')).toBe(true);
  });
});

describe('rankAndCap', () => {
  it('boosts source-type alignment with intent', () => {
    const a = makeHit({ source_type: 'raw_material_kb', relevance: 0.5 });
    const b = makeHit({ source_type: 'formula_kb', relevance: 0.5 });
    const out = rankAndCap([a, b], 'raw_material_lookup', 5);
    expect(out[0]!.source_type).toBe('raw_material_kb');
  });

  it('caps the result count', () => {
    const hits = Array.from({ length: 12 }, (_, i) => makeHit({ relevance: 0.5 + i * 0.01 }));
    const out = rankAndCap(hits, 'general', 3);
    expect(out).toHaveLength(3);
  });

  it('drops zero-relevance hits', () => {
    const hits = [makeHit({ relevance: 0 }), makeHit({ relevance: 0.5 })];
    const out = rankAndCap(hits, 'general', 5);
    expect(out).toHaveLength(1);
  });
});

describe('EmptyRetriever', () => {
  it('returns no hits and supports no sources', async () => {
    const r = new EmptyRetriever();
    expect(await r.retrieve()).toEqual([]);
    expect(r.supportedSources()).toEqual([]);
  });
});
