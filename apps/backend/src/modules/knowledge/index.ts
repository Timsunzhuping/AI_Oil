/**
 * Knowledge & Document module factory.
 *
 *   const { knowledgeRouter, documentRouter, runner } =
 *     buildKnowledgeModule(pool, logger, { storage?, registry? });
 *
 *   v1.use('/knowledge', knowledgeRouter);
 *   v1.use('/docs',      documentRouter);
 *   runner.start();   // background drain (optional; /docs/parse already drains synchronously)
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { buildOcrRegistry, type ParserRegistry } from './adapters/ocr/index.js';
import {
  buildStorage,
  type BuildStorageOptions,
  type StorageAdapter,
} from './adapters/storage/index.js';
import { KnowledgeRepository } from './repository.js';
import { KnowledgeService } from './service.js';
import { ParseRunner } from './workers/parse-runner.js';
import { buildKnowledgeRouter } from './routes.js';

export interface BuildKnowledgeModuleOptions {
  storage?: StorageAdapter;
  storageOptions?: BuildStorageOptions;
  registry?: ParserRegistry;
  /** Override the multer per-file size limit (MB). */
  maxUploadMb?: number;
}

export function buildKnowledgeModule(
  pool: Pool,
  logger: Logger,
  opts: BuildKnowledgeModuleOptions = {}
) {
  const repository = new KnowledgeRepository(pool);
  const storage = opts.storage ?? buildStorage(opts.storageOptions);
  const registry = opts.registry ?? buildOcrRegistry();
  const runner = new ParseRunner({ repository, storage, registry, logger });
  const service = new KnowledgeService({ repository, storage, registry, runner, logger });
  const { knowledgeRouter, documentRouter } = buildKnowledgeRouter(service, {
    ...(opts.maxUploadMb !== undefined ? { maxUploadMb: opts.maxUploadMb } : {}),
  });
  return { repository, storage, registry, runner, service, knowledgeRouter, documentRouter };
}

export { KnowledgeService } from './service.js';
export { KnowledgeRepository } from './repository.js';
export { ParseRunner } from './workers/parse-runner.js';
export {
  buildStorage,
  LocalFileStorage,
  InMemoryStorage,
  buildStorageKey,
} from './adapters/storage/index.js';
export type { StorageAdapter, StorageObject, StoragePutInput } from './adapters/storage/index.js';
export { buildOcrRegistry, ParserRegistry, MockOcrAdapter } from './adapters/ocr/index.js';
export type { ParserAdapter, ParserInput, ParserOutput } from './adapters/ocr/index.js';
export {
  canTransitionDocument,
  canTransitionTask,
  assertDocumentTransition,
  assertTaskTransition,
} from './state-machine.js';
export {
  CreateRawMaterialKbSchema,
  UpdateRawMaterialKbSchema,
  CreateFormulaKbSchema,
  UpdateFormulaKbSchema,
  UploadDocMetadataSchema,
  ParseEnqueueSchema,
  ConfirmSchema,
} from './schemas.js';
export type * from './types.js';
