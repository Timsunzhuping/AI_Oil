import { describe, it, expect } from 'vitest';
import { AnswerComposer } from '../../../src/modules/qa/pipeline/composer.js';
import {
  MockLlmAdapter,
  formatCitationLine,
  aggregateConfidence,
} from '../../../src/modules/qa/adapters/llm/index.js';
import type { Citation, Intent, RetrievalHit } from '../../../src/modules/qa/types.js';
import { makeHit } from './_fakes.js';

const llm = new MockLlmAdapter();
const composer = new AnswerComposer({ llm });

describe('AnswerComposer.compose', () => {
  it('returns the no-source fallback when retriever yields nothing', async () => {
    const r = await composer.compose({
      question: '请回答这个问题',
      intent: 'general',
      intent_confidence: 0.4,
      hits: [],
    });
    expect(r.no_source_fallback).toBe(true);
    expect(r.citations).toEqual([]);
    expect(r.confidence).toBe(0);
    expect(r.answer).toMatch(/未在.*检索到/);
  });

  it('composes an answer with citation list when hits are present', async () => {
    const hits: RetrievalHit[] = [
      makeHit({ relevance: 0.92, title: 'PAO-6 (RMK-2026-0001)' }),
      makeHit({ relevance: 0.7, title: 'Group III 4cSt (RMK-2026-0002)' }),
    ];
    const r = await composer.compose({
      question: '推荐一种基础油',
      intent: 'raw_material_lookup',
      intent_confidence: 0.9,
      hits,
    });
    expect(r.no_source_fallback).toBe(false);
    expect(r.citations).toHaveLength(2);
    expect(r.answer).toContain('[1]');
    expect(r.answer).toContain('[2]');
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it('caps citations to max_citations', async () => {
    const hits = Array.from({ length: 8 }, (_, i) => makeHit({ relevance: 0.9 - i * 0.02 }));
    const r = await composer.compose({
      question: 'q',
      intent: 'raw_material_lookup',
      intent_confidence: 0.5,
      hits,
      max_citations: 3,
    });
    expect(r.citations).toHaveLength(3);
  });

  it('orders citations by relevance descending', async () => {
    const hits: RetrievalHit[] = [
      makeHit({ relevance: 0.4 }),
      makeHit({ relevance: 0.9 }),
      makeHit({ relevance: 0.7 }),
    ];
    const r = await composer.compose({
      question: 'q',
      intent: 'general',
      intent_confidence: 0.5,
      hits,
    });
    const rels = r.citations.map((c) => c.relevance);
    expect(rels).toEqual([...rels].sort((a, b) => b - a));
  });

  it('exposes the LLM identity', async () => {
    const r = await composer.compose({
      question: 'q',
      intent: 'general',
      intent_confidence: 0.5,
      hits: [makeHit({ relevance: 0.8 })],
    });
    expect(r.llm_adapter).toBe('mock-rules');
    expect(r.llm_version).toBe('v1');
  });
});

describe('formatCitationLine', () => {
  it('includes the source label', () => {
    const c: Citation = {
      source_type: 'raw_material_kb',
      source_id: 'x',
      title: 'PAO-6',
      snippet: 'Synthetic base oil',
      relevance: 0.9,
    };
    expect(formatCitationLine(c)).toContain('原材料知识库');
    expect(formatCitationLine(c)).toContain('PAO-6');
  });
});

describe('aggregateConfidence', () => {
  it('returns 0 for empty list', () => {
    expect(aggregateConfidence([])).toBe(0);
  });

  it('weights toward the top citation', () => {
    const c: Citation[] = [
      { source_type: 'raw_material_kb', source_id: '1', title: 't', snippet: 's', relevance: 0.9 },
      { source_type: 'raw_material_kb', source_id: '2', title: 't', snippet: 's', relevance: 0.3 },
    ];
    const v = aggregateConfidence(c);
    expect(v).toBeGreaterThan(0.6);
    expect(v).toBeLessThan(0.9);
  });

  it('clamps to [0, 1]', () => {
    const v = aggregateConfidence([
      {
        source_type: 'raw_material_kb',
        source_id: '1',
        title: 't',
        snippet: 's',
        relevance: 1.5,
      } as Citation,
    ]);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe('intent passes through', () => {
  it('respects intent label without changing it', async () => {
    const intents: Intent[] = [
      'raw_material_lookup',
      'formula_history',
      'regulation',
      'process',
      'general',
    ];
    for (const intent of intents) {
      const r = await composer.compose({
        question: 'q',
        intent,
        intent_confidence: 0.7,
        hits: [makeHit()],
      });
      expect(r.no_source_fallback).toBe(false);
    }
  });
});
