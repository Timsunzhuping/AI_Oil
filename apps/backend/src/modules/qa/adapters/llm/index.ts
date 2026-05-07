/**
 * LLM adapter factory.
 *
 *   buildLlm()            → MockLlmAdapter (default)
 *   buildLlm({ adapter }) → caller-supplied adapter
 *
 * Honours `QA_LLM_MODE=mock` (default) — set to anything else and the factory
 * still returns mock today, but the env hook lets you flip between adapters
 * via configuration once a real one is wired in.
 */
import { MockLlmAdapter, type MockLlmAdapterOptions } from './mock.js';
import type { LlmAdapter } from './types.js';

export interface BuildLlmOptions {
  adapter?: LlmAdapter;
  mock?: MockLlmAdapterOptions;
}

export function buildLlm(opts: BuildLlmOptions = {}): LlmAdapter {
  if (opts.adapter) return opts.adapter;
  return new MockLlmAdapter(opts.mock);
}

export { MockLlmAdapter, formatCitationLine, aggregateConfidence } from './mock.js';
export type { LlmAdapter, LlmAdapterIdentity, LlmComposeInput, LlmComposeOutput } from './types.js';
