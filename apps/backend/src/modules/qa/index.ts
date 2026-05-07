/**
 * QA module factory.
 *
 *   const { router } = buildQaModule(pool, logger, { llm?, retriever?, classifier? });
 *   v1.use('/qa', router);
 *
 * Adapters are pluggable:
 *   • llm        — defaults to MockLlmAdapter
 *   • retriever  — defaults to KbPostgresRetriever (or EmptyRetriever when no pool)
 *   • classifier — defaults to RuleBasedClassifier
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { buildLlm, type LlmAdapter } from './adapters/llm/index.js';
import { buildRetriever, type RetrieverAdapter } from './adapters/retrieval/index.js';
import { QaPipeline } from './pipeline/index.js';
import { RuleBasedClassifier, type IntentClassifier } from './pipeline/classifier.js';
import { QaRepository } from './repository.js';
import { QaService } from './service.js';
import { buildQaRouter } from './routes.js';

export interface BuildQaModuleOptions {
  llm?: LlmAdapter;
  retriever?: RetrieverAdapter;
  classifier?: IntentClassifier;
}

export function buildQaModule(pool: Pool, logger: Logger, opts: BuildQaModuleOptions = {}) {
  const llm = opts.llm ?? buildLlm();
  const retriever = opts.retriever ?? buildRetriever(pool);
  const classifier = opts.classifier ?? new RuleBasedClassifier();
  const pipeline = new QaPipeline({ classifier, retriever, llm });
  const repository = new QaRepository(pool);
  const service = new QaService({ pipeline, repository, logger });
  const router = buildQaRouter(service);
  return { llm, retriever, classifier, pipeline, repository, service, router };
}

export { QaService } from './service.js';
export { QaRepository } from './repository.js';
export { QaPipeline, AnswerComposer, RuleBasedClassifier } from './pipeline/index.js';
export {
  buildLlm,
  MockLlmAdapter,
  formatCitationLine,
  aggregateConfidence,
} from './adapters/llm/index.js';
export type {
  LlmAdapter,
  LlmComposeInput,
  LlmComposeOutput,
  LlmAdapterIdentity,
} from './adapters/llm/index.js';
export {
  buildRetriever,
  KbPostgresRetriever,
  EmptyRetriever,
  tokenise,
  scoreCandidate,
  snippet,
  rankAndCap,
} from './adapters/retrieval/index.js';
export type { RetrieverAdapter, RetrieveQuery } from './adapters/retrieval/index.js';
export { AskSchema, SessionIdParamSchema, FeedbackSchema } from './schemas.js';
export type * from './types.js';
