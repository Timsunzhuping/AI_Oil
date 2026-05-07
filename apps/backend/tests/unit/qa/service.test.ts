import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { QaService, deriveTitle } from '../../../src/modules/qa/service.js';
import { QaPipeline } from '../../../src/modules/qa/pipeline/index.js';
import { RuleBasedClassifier } from '../../../src/modules/qa/pipeline/classifier.js';
import { MockLlmAdapter } from '../../../src/modules/qa/adapters/llm/index.js';
import type { QaRepository } from '../../../src/modules/qa/repository.js';
import { FakeQaRepository, StaticRetriever, ThrowingRetriever, makeHit } from './_fakes.js';

const logger = pino({ level: 'silent' });
const TRACE = 'trace-1';

function buildService(opts: { hits?: ReturnType<typeof makeHit>[]; throwing?: boolean } = {}) {
  const repo = new FakeQaRepository();
  const retriever = opts.throwing
    ? new ThrowingRetriever()
    : new StaticRetriever(opts.hits ?? [makeHit({ relevance: 0.9 })]);
  const pipeline = new QaPipeline({
    classifier: new RuleBasedClassifier(),
    retriever,
    llm: new MockLlmAdapter(),
  });
  const service = new QaService({
    pipeline,
    repository: repo as unknown as QaRepository,
    logger,
  });
  return { repo, service, retriever };
}

describe('QaService.ask', () => {
  it('creates a session, persists user + assistant turn', async () => {
    const { repo, service } = buildService();
    const r = await service.ask(
      { question: '请介绍一下 PAO-6 基础油' },
      { trace_id: TRACE, user_id: 'user-1' }
    );

    expect(r.session_id).toBeDefined();
    expect(r.user_message_id).toBeDefined();
    expect(r.message_id).toBeDefined();
    expect(r.citations.length).toBe(1);
    expect(r.no_source_fallback).toBe(false);
    expect(repo.sessions.size).toBe(1);
    expect(repo.messages.size).toBe(2);

    const session = [...repo.sessions.values()][0]!;
    expect(session.message_count).toBe(2);
    // First question becomes the title.
    expect(session.title).toContain('PAO-6');
  });

  it('surfaces no_source_fallback when retriever returns nothing', async () => {
    const { service } = buildService({ hits: [] });
    const r = await service.ask(
      { question: '完全无关的随机问题' },
      { trace_id: TRACE, user_id: null }
    );
    expect(r.no_source_fallback).toBe(true);
    expect(r.citations).toEqual([]);
    expect(r.confidence).toBe(0);
    expect(r.intent).toBe('no_match');
    expect(r.answer).toMatch(/未在.*检索到/);
  });

  it('treats retriever failure as no-source instead of bubbling the error', async () => {
    const { service } = buildService({ throwing: true });
    const r = await service.ask({ question: '问题' }, { trace_id: TRACE, user_id: null });
    expect(r.no_source_fallback).toBe(true);
    expect(r.citations).toEqual([]);
  });

  it('appends to an existing session when session_id is supplied', async () => {
    const { repo, service } = buildService();
    const first = await service.ask(
      { question: '请介绍一下 PAO-6' },
      { trace_id: TRACE, user_id: 'user-1' }
    );
    const second = await service.ask(
      { question: '它和 Group III 有什么区别?', session_id: first.session_id },
      { trace_id: TRACE, user_id: 'user-1' }
    );
    expect(second.session_id).toBe(first.session_id);
    expect(repo.sessions.size).toBe(1);
    expect(repo.messages.size).toBe(4);
  });

  it('rejects asks against archived sessions', async () => {
    const { repo, service } = buildService();
    const first = await service.ask(
      { question: '请介绍一下 PAO-6' },
      { trace_id: TRACE, user_id: 'user-1' }
    );
    await repo.updateSessionStatus(first.session_id, 'archived');
    await expect(
      service.ask(
        { question: 'second', session_id: first.session_id },
        { trace_id: TRACE, user_id: null }
      )
    ).rejects.toThrow();
  });

  it('rejects asks against unknown session_id', async () => {
    const { service } = buildService();
    await expect(
      service.ask(
        { question: 'hi there', session_id: '00000000-0000-0000-0000-000000000999' },
        { trace_id: TRACE, user_id: null }
      )
    ).rejects.toThrow();
  });

  it('persists citations with the assistant row', async () => {
    const hits = [makeHit({ relevance: 0.85, title: 'Test' }), makeHit({ relevance: 0.6 })];
    const { repo, service } = buildService({ hits });
    const r = await service.ask({ question: '请介绍 PAO-6' }, { trace_id: TRACE, user_id: null });
    const assistant = repo.messages.get(r.message_id);
    expect(assistant?.citations).toHaveLength(2);
    expect(assistant?.intent).toBe(r.intent);
    expect(assistant?.confidence).toBe(r.confidence);
    expect(assistant?.llm_adapter).toBe('mock-rules');
  });

  it('echoes back trace_id and duration_ms', async () => {
    const { service } = buildService();
    const r = await service.ask({ question: '请介绍 PAO-6' }, { trace_id: TRACE, user_id: null });
    expect(r.trace_id).toBe(TRACE);
    expect(r.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('QaService.history', () => {
  it('returns the session and ordered messages', async () => {
    const { service } = buildService();
    const a = await service.ask({ question: 'first' }, { trace_id: TRACE, user_id: null });
    await service.ask(
      { question: 'second?', session_id: a.session_id },
      { trace_id: TRACE, user_id: null }
    );
    const h = await service.history(a.session_id);
    expect(h.session.id).toBe(a.session_id);
    expect(h.messages.length).toBe(4);
    // Roles should alternate user / assistant.
    expect(h.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('throws NotFound for unknown session', async () => {
    const { service } = buildService();
    await expect(service.history('00000000-0000-0000-0000-000000000abc')).rejects.toThrow();
  });
});

describe('QaService.submitFeedback', () => {
  it('persists feedback against an assistant message', async () => {
    const { repo, service } = buildService();
    const a = await service.ask(
      { question: '请介绍 PAO-6' },
      { trace_id: TRACE, user_id: 'user-1' }
    );
    const fb = await service.submitFeedback(
      { message_id: a.message_id, rating: 1, category: 'great', comment: 'helpful' },
      { trace_id: TRACE, user_id: 'user-1' }
    );
    expect(fb.feedback_id).toBeDefined();
    expect(repo.feedback.size).toBe(1);
    const persisted = [...repo.feedback.values()][0]!;
    expect(persisted.rating).toBe(1);
    expect(persisted.message_id).toBe(a.message_id);
    expect(persisted.user_id).toBe('user-1');
  });

  it('rejects feedback against a user message', async () => {
    const { service } = buildService();
    const a = await service.ask({ question: '请介绍 PAO-6' }, { trace_id: TRACE, user_id: null });
    await expect(
      service.submitFeedback(
        { message_id: a.user_message_id, rating: 1 },
        { trace_id: TRACE, user_id: null }
      )
    ).rejects.toThrow(/assistant/);
  });

  it('rejects feedback for unknown messages', async () => {
    const { service } = buildService();
    await expect(
      service.submitFeedback(
        { message_id: '00000000-0000-0000-0000-000000000abc', rating: -1 },
        { trace_id: TRACE, user_id: null }
      )
    ).rejects.toThrow();
  });
});

describe('deriveTitle', () => {
  it('returns the question verbatim when short', () => {
    expect(deriveTitle('Hello')).toBe('Hello');
  });
  it('truncates with ellipsis past 60 chars', () => {
    const long = 'a'.repeat(80);
    const t = deriveTitle(long);
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t.endsWith('…')).toBe(true);
  });
});
